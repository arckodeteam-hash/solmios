// restaurant/usecases/food-cost.ts — Food cost visible (F3, carta-experiencia-avanzada).
// Dominio 100% de LECTURA: ningún INSERT/UPDATE nuevo. Cruza `menu_items.price`/`menu_combos.price`
// (dueño restaurant) contra el costo de receta (dueño inventario, vía el puerto `recipePorts.getRecipeCost`
// inyectado por el conector restaurante-inventario.ts — D4: el food cost de un combo se calcula ACÁ, no en
// inventario, porque `menu_combos`/`menu_combo_items` son de este módulo). Ver specs/menu-food-cost/spec.md.
import type { RepositoryAdapter } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { MenuItemDTO, ComboDTO, ComboItemDTO, CurrentUser, RecipeIngredient } from '../types'

// Puerto de recetas (inventario) inyectado por el conector restaurante-inventario.ts y consumido por
// service.ts (setRecipePorts). F3 extiende el mismo puerto (D4/design.md): `getRecipeCost` opcional,
// `undefined` si el módulo inventario no está montado en este hotel.
export interface RecipePorts {
  menuItemsWithRecipe?: (user: CurrentUser) => Promise<string[]>
  getRecipeCost?: (menuItemId: string, user: CurrentUser) => Promise<{ cost: number; hasRecipe: boolean }>
  // KDS: ingredientes con nombre por ítem ({ [menuItemId]: [{ name, quantity, unit }] }), para el tablero de cocina.
  getRecipeIngredients?: (menuItemIds: string[], user: CurrentUser) => Promise<Record<string, RecipeIngredient[]>>
  /** #208: al borrar un ítem (items-crud.deleteItem) su receta en inventario se va con él. Devuelve filas borradas. */
  deleteRecipesOfMenuItem?: (hotelId: string, menuItemId: string) => Promise<number>
}

export interface FoodCostDeps {
  items: RepositoryAdapter<MenuItemDTO>
  combos?: RepositoryAdapter<ComboDTO>
  comboItems?: RepositoryAdapter<ComboItemDTO>
  recipePorts: RecipePorts
}

export interface ItemFoodCostResult {
  menuItemId: string
  price: number
  cost: number | null
  hasRecipe: boolean
  available: boolean
  margin: number | null
  marginPercent: number | null
}

export interface ComboFoodCostResult {
  comboId: string
  price: number
  cost: number | null
  complete: boolean
  available: boolean
  margin: number | null
  marginPercent: number | null
}

export interface FoodCostReportRow {
  id: string
  kind: 'item' | 'combo'
  name: string
  price: number
  cost: number
  margin: number
  marginPercent: number | null
  complete: boolean
  hasRecipe: boolean
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

/** menuItemId REQUERIDO: debe existir y ser del MISMO hotel. findOne evita el falso IDOR (mismo criterio
 * que assertCategory/assertStation en items-crud.ts). */
async function loadItem(deps: FoodCostDeps, id: string, hotelId: string): Promise<MenuItemDTO> {
  const item = await deps.items.findOne({ id })
  if (!item || item.hotelId !== hotelId) throw new NotFoundError('Ítem no encontrado')
  return item
}

/** comboId REQUERIDO: debe existir y ser del MISMO hotel. Requiere F2 aplicado (deps.combos montado). */
async function loadCombo(deps: FoodCostDeps, id: string, hotelId: string): Promise<ComboDTO> {
  if (!deps.combos) throw new NotFoundError('Combo no encontrado')
  const combo = await deps.combos.findOne({ id })
  if (!combo || combo.hotelId !== hotelId) throw new NotFoundError('Combo no encontrado')
  return combo
}

/**
 * Costo de receta de un ítem vía el puerto de inventario. Degrada con gracia si el puerto no está
 * inyectado (inventario no montado en este hotel): `available: false`, nunca lanza ni rompe con 500.
 */
async function costOf(deps: FoodCostDeps, menuItemId: string, user: CurrentUser): Promise<{ cost: number; hasRecipe: boolean; available: boolean }> {
  if (!deps.recipePorts.getRecipeCost) return { cost: 0, hasRecipe: false, available: false }
  try {
    const r = await deps.recipePorts.getRecipeCost(menuItemId, user)
    return { cost: Number(r.cost) || 0, hasRecipe: !!r.hasRecipe, available: true }
  } catch {
    return { cost: 0, hasRecipe: false, available: false }
  }
}

/** Costo de receta + margen de un ítem simple de la carta. */
export async function itemFoodCost(deps: FoodCostDeps, menuItemId: string, user: CurrentUser): Promise<ItemFoodCostResult> {
  const hotelId = hotelFor(user)
  const item = await loadItem(deps, menuItemId, hotelId)
  const price = Number(item.price) || 0
  const c = await costOf(deps, menuItemId, user)

  if (!c.available) return { menuItemId, price, cost: null, hasRecipe: false, available: false, margin: null, marginPercent: null }
  // Ítem sin receta: se EXCLUYE del cálculo de margen (no "0% costo" falso).
  if (!c.hasRecipe) return { menuItemId, price, cost: 0, hasRecipe: false, available: true, margin: null, marginPercent: null }

  const margin = round2(price - c.cost)
  const marginPercent = price > 0 ? round2((margin / price) * 100) : null
  return { menuItemId, price, cost: c.cost, hasRecipe: true, available: true, margin, marginPercent }
}

/**
 * Food cost de un combo (F2) = Σ (costo de receta del componente × su cantidad) sobre `menu_combo_items`.
 * Vive acá (restaurant, dueño de menu_combos), NUNCA en inventario. Un componente sin receta aporta 0 a
 * la suma (igual criterio que `consumeForSale` con "stock fantasma": no rompe, no inventa costo) y marca
 * `complete: false` — el margen mostrado se ve artificialmente alto, el dueño necesita saber que no es
 * definitivo.
 */
export async function comboFoodCost(deps: FoodCostDeps, comboId: string, user: CurrentUser): Promise<ComboFoodCostResult> {
  if (!deps.combos || !deps.comboItems) throw new ValidationError('Combos no configurados')
  const hotelId = hotelFor(user)
  const combo = await loadCombo(deps, comboId, hotelId)
  const price = Number(combo.price) || 0

  if (!deps.recipePorts.getRecipeCost) {
    return { comboId, price, cost: null, complete: false, available: false, margin: null, marginPercent: null }
  }

  const components = (await deps.comboItems.findMany({ hotelId, comboId })) as ComboItemDTO[]
  let cost = 0
  let complete = true
  for (const comp of components) {
    const c = await costOf(deps, comp.menuItemId, user)
    if (!c.hasRecipe) { complete = false; continue }
    cost += c.cost * (Number(comp.quantity) || 0)
  }
  cost = round2(cost)
  const margin = round2(price - cost)
  const marginPercent = price > 0 ? round2((margin / price) * 100) : null
  return { comboId, price, cost, complete, available: true, margin, marginPercent }
}

/**
 * Reporte de food cost: TODOS los ítems con receta + TODOS los combos del hotel (que tengan costo
 * disponible), ordenado por `marginPercent` ascendente por defecto ("¿qué plato me está comiendo el
 * margen?"). Ítems sin receta se EXCLUYEN (no hay costo real que reportar).
 */
export async function foodCostReport(deps: FoodCostDeps, user: CurrentUser): Promise<{ data: FoodCostReportRow[]; total: number }> {
  const hotelId = hotelFor(user)
  const rows: FoodCostReportRow[] = []

  const items = (await deps.items.findMany({ hotelId })) as MenuItemDTO[]
  for (const item of items) {
    const c = await costOf(deps, item.id, user)
    if (!c.available || !c.hasRecipe) continue
    const price = Number(item.price) || 0
    const margin = round2(price - c.cost)
    const marginPercent = price > 0 ? round2((margin / price) * 100) : null
    rows.push({ id: item.id, kind: 'item', name: item.name, price, cost: c.cost, margin, marginPercent, complete: true, hasRecipe: true })
  }

  if (deps.combos && deps.comboItems) {
    const combos = (await deps.combos.findMany({ hotelId })) as ComboDTO[]
    for (const combo of combos) {
      const res = await comboFoodCost(deps, combo.id, user)
      if (!res.available) continue
      rows.push({
        id: combo.id, kind: 'combo', name: combo.name, price: res.price, cost: res.cost ?? 0,
        margin: res.margin ?? 0, marginPercent: res.marginPercent, complete: res.complete, hasRecipe: true,
      })
    }
  }

  rows.sort((a, b) => (a.marginPercent ?? Infinity) - (b.marginPercent ?? Infinity))
  return { data: rows, total: rows.length }
}
