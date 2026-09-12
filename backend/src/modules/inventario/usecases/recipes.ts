// inventario/usecases/recipes.ts — Recetas (BOM) por ítem de menú (INT-1). Define cuánto insumo consume
// cada unidad vendida. `consumeForSale` descuenta stock al vender/servir una comanda, reusando el ledger
// idempotente (source='pos_sale', sourceId=`${lineId}:${inventoryItemId}` → cada insumo dedup por su cuenta).
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { MenuItemRecipeDTO, InventoryItemDTO, StockMovementDTO, CurrentUser } from '../types'
import { applyMovement, type MovementDeps } from './movements'

export interface RecipeDeps {
  recipes: RepositoryAdapter<MenuItemRecipeDTO>
  items: RepositoryAdapter<InventoryItemDTO>
  movements: RepositoryAdapter<StockMovementDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  logger: Logger
}

function hotelOf(u: CurrentUser): string { const h = u.hotelId || ''; if (!h) throw new ValidationError('Sin hotel asignado'); return h }
function movDeps(d: RecipeDeps): MovementDeps { return { items: d.items, movements: d.movements, userRepo: d.userRepo, auth: d.auth } }
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/**
 * KDS — ingredientes CON NOMBRE de varios ítems de menú de una sola vez, para el tablero de cocina:
 * `{ [menuItemId]: [{ name, quantity, unit }] }`. Dos lecturas en total (recetas del hotel + insumos
 * del hotel), no una por plato: la cola del KDS puede tener decenas de líneas y se refresca cada
 * pocos segundos. Un ítem sin receta no aparece en el resultado (la pantalla muestra "sin receta").
 * Un insumo borrado del inventario se omite en vez de mostrar el id crudo.
 */
export async function recipeIngredientsFor(
  deps: Pick<RecipeDeps, 'recipes' | 'items'>,
  menuItemIds: string[],
  user: CurrentUser,
): Promise<Record<string, Array<{ name: string; quantity: number; unit: string }>>> {
  const hotelId = hotelOf(user)
  const wanted = new Set(menuItemIds.filter(Boolean))
  if (!wanted.size) return {}
  const rows = ((await deps.recipes.findMany({ hotelId })) as MenuItemRecipeDTO[]).filter((r) => wanted.has(r.menuItemId))
  if (!rows.length) return {}
  const items = new Map<string, InventoryItemDTO>()
  for (const it of (await deps.items.findMany({ hotelId })) as InventoryItemDTO[]) items.set(it.id, it)
  const out: Record<string, Array<{ name: string; quantity: number; unit: string }>> = {}
  for (const r of rows) {
    const it = items.get(r.inventoryItemId)
    if (!it) continue
    ;(out[r.menuItemId] ??= []).push({ name: it.name, quantity: Number(r.quantity) || 0, unit: it.unit || 'unit' })
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  return out
}

/** Recetas de un ítem de menú (los insumos que consume). */
export async function listRecipes(deps: RecipeDeps, menuItemId: string, user: CurrentUser): Promise<{ data: MenuItemRecipeDTO[]; total: number }> {
  const hotelId = hotelOf(user)
  const data = (await deps.recipes.findMany({ hotelId, menuItemId })) as MenuItemRecipeDTO[]
  return { data, total: data.length }
}

/**
 * F3 (carta-experiencia-avanzada) — Costo de receta de un ítem de menú:
 * Σ (recipe.quantity × inventoryItem.avgCost) sobre todas sus filas de `menu_item_recipes`.
 * Consumido por `restaurant` vía el puerto `getRecipeCost` (conector restaurante-inventario.ts) para
 * calcular margen (precio de venta − costo). Sin filas de receta → `hasRecipe: false`, `cost: 0` (NO
 * "margen 100%" falso — ese criterio se aplica en `restaurant/usecases/food-cost.ts`, no acá).
 */
export async function recipeCost(deps: RecipeDeps, menuItemId: string, user: CurrentUser): Promise<{ cost: number; hasRecipe: boolean }> {
  const hotelId = hotelOf(user)
  const recipes = (await deps.recipes.findMany({ hotelId, menuItemId })) as MenuItemRecipeDTO[]
  if (recipes.length === 0) return { cost: 0, hasRecipe: false }
  let cost = 0
  for (const r of recipes) {
    const invItem = await deps.items.findById(r.inventoryItemId)
    const avgCost = Number(invItem?.avgCost) || 0
    cost += Number(r.quantity) * avgCost
  }
  return { cost: round2(cost), hasRecipe: true }
}

/** Define/actualiza (upsert) el consumo de un insumo para un ítem de menú. quantity 0 elimina la línea. */
export async function setRecipe(deps: RecipeDeps, dto: { menuItemId: string; inventoryItemId: string; quantity: number }, user: CurrentUser): Promise<MenuItemRecipeDTO | null> {
  const hotelId = hotelOf(user)
  if (!dto.menuItemId || !dto.inventoryItemId) throw new ValidationError('menuItemId e inventoryItemId requeridos')
  const qty = Number(dto.quantity)
  if (!Number.isFinite(qty) || qty < 0) throw new ValidationError('La cantidad debe ser ≥ 0')
  // El insumo debe existir y ser del hotel (ownership).
  const item = await deps.items.findById(dto.inventoryItemId)
  if (!item) throw new NotFoundError('Insumo no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(item.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')

  const existing = await deps.recipes.findOne({ hotelId, menuItemId: dto.menuItemId, inventoryItemId: dto.inventoryItemId })
  if (qty === 0) {
    if (existing) await deps.recipes.delete(existing.id)
    return null
  }
  if (existing) return (await deps.recipes.update(existing.id, { quantity: qty } as any)) as MenuItemRecipeDTO
  return deps.recipes.create({ hotelId, menuItemId: dto.menuItemId, inventoryItemId: dto.inventoryItemId, quantity: qty } as Omit<MenuItemRecipeDTO, 'id'>)
}

/**
 * Descuenta stock por la venta de `soldQty` unidades de un ítem de menú (INT-1). Best-effort por insumo:
 * si un descuento falla, no rompe la venta. Idempotente por línea de comanda (sourceId incluye el lineId).
 * `user` suele ser el super_admin sintético del conector (bypasa ownership; el hotelId viene de la comanda).
 */
export async function consumeForSale(deps: RecipeDeps, input: { hotelId: string; menuItemId: string; soldQty: number; lineId: string }, user: CurrentUser): Promise<void> {
  if (!input.menuItemId || !input.lineId) return
  const soldQty = Number(input.soldQty)
  if (!Number.isFinite(soldQty) || soldQty <= 0) return
  const recipes = (await deps.recipes.findMany({ hotelId: input.hotelId, menuItemId: input.menuItemId })) as MenuItemRecipeDTO[]
  // Stock fantasma: el plato vendido no tiene receta → no hay insumos modelados que descontar. Antes esto
  // era silencioso y el admin no se enteraba de qué platos faltaba recetar (vendía y el stock no bajaba).
  // Lo avisamos para que se sepa qué cargar. NO descuenta por acá (correcto): sin receta no hay consumo
  // modelado; inventario real se descuenta cuando el admin dé de alta la receta y se vuelva a vender.
  if (recipes.length === 0) {
    deps.logger.warn('stock fantasma: plato vendido sin receta, descuento de inventario omitido', {
      hotelId: input.hotelId, menuItemId: input.menuItemId, lineId: input.lineId, soldQty,
    })
    return
  }
  for (const r of recipes) {
    const qty = Number(r.quantity) * soldQty
    if (!Number.isFinite(qty) || qty <= 0) continue
    try {
      await applyMovement(movDeps(deps), {
        itemId: r.inventoryItemId, type: 'out', quantity: qty,
        reason: 'Venta POS', source: 'pos_sale', sourceId: `${input.lineId}:${r.inventoryItemId}`,
      }, user)
    } catch { /* best-effort: un descuento de stock no debe romper el cobro de la comanda */ }
  }
}

/**
 * F1 (carta-experiencia-avanzada) — Descuenta el insumo declarado por cada modificador elegido en el
 * snapshot de la línea (`line.modifiers`), ADEMÁS del insumo de la receta base del ítem (`consumeForSale`,
 * llamado aparte por el conector). Un modificador sin `inventoryItemId` no genera movimiento. Best-effort
 * por opción: un fallo de descuento nunca rompe el cobro. `sourceId` distinto del de receta base
 * (`${lineId}:${modifierId}:${inventoryItemId}`) para no colisionar con la dedup existente
 * (`${lineId}:${inventoryItemId}`) y mantener idempotencia independiente por reintento.
 */
export async function consumeForSaleWithModifiers(deps: RecipeDeps, input: { hotelId: string; line: any }, user: CurrentUser): Promise<void> {
  const line = input?.line
  if (!line?.id || !Array.isArray(line.modifiers)) return
  const soldQty = Number(line.quantity)
  if (!Number.isFinite(soldQty) || soldQty <= 0) return
  for (const m of line.modifiers) {
    const inventoryItemId = m?.inventoryItemId
    const inventoryQuantity = Number(m?.inventoryQuantity)
    if (!inventoryItemId || !Number.isFinite(inventoryQuantity) || inventoryQuantity <= 0) continue
    const qty = inventoryQuantity * soldQty
    try {
      await applyMovement(movDeps(deps), {
        itemId: inventoryItemId, type: 'out', quantity: qty,
        reason: 'Venta POS (modificador)', source: 'pos_sale', sourceId: `${line.id}:${m.modifierId}:${inventoryItemId}`,
      }, user)
    } catch { /* best-effort: un descuento de stock no debe romper el cobro de la comanda */ }
  }
}

/**
 * #208: borra la receta completa de un ítem de menú que el restaurante acaba de eliminar. Lo llama el
 * conector restaurante-inventario (puerto `deleteRecipesOfMenuItem`) con el super_admin sintético y el
 * hotel del ítem (resuelto en BD por el restaurante). Sin esto, `menu_item_recipes` acumulaba filas
 * muertas apuntando a un `menuItemId` que ya no existe. Devuelve cuántas filas se borraron.
 */
export async function deleteRecipesOfMenuItem(deps: Pick<RecipeDeps, 'recipes'>, input: { hotelId: string; menuItemId: string }): Promise<number> {
  if (!input.hotelId || !input.menuItemId) throw new ValidationError('hotelId y menuItemId requeridos')
  const rows = (await deps.recipes.findMany({ hotelId: input.hotelId, menuItemId: input.menuItemId })) as MenuItemRecipeDTO[]
  for (const r of rows) await deps.recipes.delete(r.id)
  return rows.length
}
