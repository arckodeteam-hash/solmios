// inventario/service.ts — Facade del módulo de inventario. Orquesta; la lógica vive en usecases/.
// Depende de RepositoryAdapter (NO del ORM directo). NO importa de otros módulos (eso va por conectores).
// El stock se mueve SOLO por el ledger (applyMovement); currentStock es el balance materializado.
import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { InventoryItemDTO, StockMovementDTO, MenuItemRecipeDTO, MovementType, CurrentUser } from './types'
import type { InventarioSockets } from './sockets'
import * as itemsCrud from './usecases/items-crud'
import * as ledger from './usecases/movements'
import * as recipesUc from './usecases/recipes'
import * as revertUc from './usecases/revert-pos-sale'

export class InventarioService {
  private sockets: InventarioSockets = {}

  constructor(
    private readonly items: RepositoryAdapter<InventoryItemDTO>,
    private readonly movements: RepositoryAdapter<StockMovementDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly auth: Auth,
    private readonly recipes?: RepositoryAdapter<MenuItemRecipeDTO>,
  ) {}

  /** Acumula handlers, nunca pisa el anterior (composición de sockets). */
  setSockets(s: Partial<InventarioSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  private itemDeps(): itemsCrud.ItemsCrudDeps {
    return { items: this.items, userRepo: this.userRepo, auth: this.auth }
  }
  private ledgerDeps(): ledger.MovementDeps {
    return { items: this.items, movements: this.movements, userRepo: this.userRepo, auth: this.auth }
  }

  // ─── Ítems (INV-1) ───
  listItems(query: { category?: string; belowMin?: boolean } | undefined, user: CurrentUser) { return itemsCrud.listItems(this.itemDeps(), query, user) }
  getItem(id: string, user: CurrentUser) { return itemsCrud.getItem(this.itemDeps(), id, user) }
  createItem(dto: itemsCrud.CreateItemInput, user: CurrentUser) { return itemsCrud.createItem(this.itemDeps(), dto, user) }
  updateItem(id: string, dto: itemsCrud.UpdateItemInput, user: CurrentUser) { return itemsCrud.updateItem(this.itemDeps(), id, dto, user) }
  deleteItem(id: string, user: CurrentUser) { return itemsCrud.deleteItem(this.itemDeps(), id, user) }

  // ─── Ledger de stock (INV-2) ───
  /** Movimiento manual (entrada/salida/ajuste) desde la UI. Los conectores usan applyMovement directo. */
  async moveStock(itemId: string, dto: { type: MovementType; quantity: number; unitCost?: number; reason?: string }, user: CurrentUser): Promise<InventoryItemDTO> {
    if (!dto?.type) throw new ValidationError('Tipo de movimiento requerido')
    const item = await ledger.applyMovement(this.ledgerDeps(), {
      itemId, type: dto.type, quantity: dto.quantity, unitCost: dto.unitCost, reason: dto.reason, source: 'manual',
    }, user)
    await this.sockets.onStockChanged?.(item)
    return item
  }

  /** Aplica un movimiento desde un conector (recepción de compra / venta del POS). Idempotente por source+sourceId. */
  async applyExternalMovement(input: ledger.ApplyMovementInput, user: CurrentUser): Promise<InventoryItemDTO> {
    const item = await ledger.applyMovement(this.ledgerDeps(), input, user)
    await this.sockets.onStockChanged?.(item)
    return item
  }

  listMovements(itemId: string, user: CurrentUser) { return ledger.listMovements(this.ledgerDeps(), itemId, user) }

  /**
   * Lista movimientos por `source` (query interna para conectores — p.ej. reversión de inventario
   * ante un refund POS: halla los `out` pos_sale originales). El `hotelId` lo aporta el conector
   * desde el recurso disparador (comanda, cuya ownership ya fue validada por el módulo origen).
   */
  listMovementsBySource(hotelId: string, source: string): Promise<StockMovementDTO[]> {
    return ledger.listMovementsBySource(this.ledgerDeps(), hotelId, source)
  }

  async valuation(user: CurrentUser): Promise<{ total: number; items: number }> {
    const { data } = await itemsCrud.listItems(this.itemDeps(), undefined, user)
    return { total: ledger.valuation(data), items: data.length }
  }

  // ─── Recetas / consumo por venta (INT-1) ───
  private recipeDeps(): recipesUc.RecipeDeps {
    if (!this.recipes) throw new ValidationError('Recetas no configuradas')
    return { recipes: this.recipes, items: this.items, movements: this.movements, userRepo: this.userRepo, auth: this.auth, logger: this.logger }
  }
  listRecipes(menuItemId: string, user: CurrentUser) { return recipesUc.listRecipes(this.recipeDeps(), menuItemId, user) }
  /** F3: costo de receta (Σ quantity×avgCost). Expuesto vía el puerto `getRecipeCost` al conector restaurante-inventario. */
  recipeCost(menuItemId: string, user: CurrentUser) { return recipesUc.recipeCost(this.recipeDeps(), menuItemId, user) }
  setRecipe(dto: { menuItemId: string; inventoryItemId: string; quantity: number }, user: CurrentUser) { return recipesUc.setRecipe(this.recipeDeps(), dto, user) }
  /** Descuenta stock por la venta de una línea de comanda (lo llama el conector restaurant→inventario). */
  consumeForSale(input: { hotelId: string; menuItemId: string; soldQty: number; lineId: string }, user: CurrentUser) { return recipesUc.consumeForSale(this.recipeDeps(), input, user) }

  /** #208: el restaurante borró el ítem → su receta se va con él (puerto del conector restaurante-inventario). */
  deleteRecipesOfMenuItem(input: { hotelId: string; menuItemId: string }) { return recipesUc.deleteRecipesOfMenuItem(this.recipeDeps(), input) }

  /** F1: descuenta el insumo extra declarado por cada modificador elegido en el snapshot de la línea. */
  consumeForSaleWithModifiers(input: { hotelId: string; line: any }, user: CurrentUser) { return recipesUc.consumeForSaleWithModifiers(this.recipeDeps(), input, user) }

  /**
   * Revierte el stock descontado por una venta POS reembolsada (lo llama el conector restaurant→inventario
   * ante `onOrderRefunded`). Crea un `in` pos_refund espejo por cada `out` pos_sale de las líneas de la
   * orden. Idempotente por UNIQUE (hotelId,source,sourceId). Best-effort: nunca rompe el refund del payment.
   */
  revertPosSale(input: { hotelId: string; lineIds: string[] }, user: CurrentUser) {
    return revertUc.revertPosSale(this.ledgerDeps(), input, user)
  }

  /** Menu items del hotel que TIENEN al menos una receta. Lo inyecta el conector en restaurant para el badge "Sin receta". */
  async menuItemsWithRecipe(user: CurrentUser): Promise<string[]> {
    if (!this.recipes) return []
    const hotelId = user.hotelId || ''
    if (!hotelId) return []
    const rows = (await this.recipes.findMany({ hotelId })) as MenuItemRecipeDTO[]
    return [...new Set(rows.map((r) => r.menuItemId))]
  }
}
