// restaurant/usecases/public-menu.ts — Carta pública de solo lectura (F7), SIN sesión.
// La ruta HTTP que llama a este usecase NO tiene auth.authenticate() (huésped escaneando un QR de
// mesa): `hotelId` viene del PATH, no del JWT. Por eso NO hay `CurrentUser` real ni ownership que
// verificar — se reusan listCategories/listItems/listCombos YA existentes con un `CurrentUser`
// sintético `{ hotelId }` (mismo filtro por hotelId que esos usecases ya aplican; nunca llaman
// `auth.assertOwnership` en sus variantes de listado, solo en get/create/update/delete).
//
// El DTO de salida se arma por ALLOW-LIST explícito, campo por campo — NUNCA spread del DTO interno
// (specs/menu-public/spec.md, "Campos que el sistema NUNCA expone"). Prohibido en cualquier nivel:
// cost, margin, marginPercent, hasRecipe, complete, avgCost, currentStock, stationId, stationName,
// sortOrder, taxRate, hotelId (por fila).
import { NotFoundError } from 'arckode-framework'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import type { CategoryDTO, MenuItemDTO, StationDTO, ComboDTO, ComboItemDTO, CurrentUser, AllergenTag } from '../types'
import * as categoriesCrud from './categories-crud'
import * as itemsCrud from './items-crud'
import * as combosCrud from './combos-crud'
import { getModuleStateForHotel } from '../../admin/usecases/modules'

export interface PublicMenuDeps {
  categories: RepositoryAdapter<CategoryDTO>
  items: RepositoryAdapter<MenuItemDTO>
  stations: RepositoryAdapter<StationDTO>
  combos: RepositoryAdapter<ComboDTO>
  comboItems: RepositoryAdapter<ComboItemDTO>
  userRepo: RepositoryAdapter<any>
  hotels: RepositoryAdapter<any>
  config: RepositoryAdapter<any>
  plans: RepositoryAdapter<any>
  /** Suscripción SaaS del hotel — FUENTE DE VERDAD del plan para el gate (resolve-plan.ts). */
  subscriptions: RepositoryAdapter<any>
  /** E2: el WARN del fail-open del resolver se emite — lo cablea el service del módulo. */
  logger?: Pick<Logger, 'warn' | 'error'>
}

export interface PublicMenuItemDTO {
  id: string
  name: string
  description?: string
  price: number
  imageUrl?: string
  allergens?: AllergenTag[] | null
  featured?: number
  availableFrom?: string | null
  availableTo?: string | null
  availableNow?: boolean
}
export interface PublicComboDTO {
  id: string
  name: string
  description?: string
  price: number
  imageUrl?: string
  allergens?: AllergenTag[]
  featured?: number
  components: { name: string; quantity: number }[]
}
export interface PublicMenuCategoryDTO { id: string; name: string; items: PublicMenuItemDTO[] }
export interface PublicMenuDTO {
  hotel: { name: string }
  categories: PublicMenuCategoryDTO[]
  combos: PublicComboDTO[]
}

// Mensaje IDÉNTICO para "hotel no existe" y "módulo restaurant deshabilitado" — anti-enumeración
// (specs/menu-public/spec.md, scenario "hotelId inexistente no filtra información").
const NOT_FOUND_MSG = 'Carta no encontrada'

// No hay sesión: assertOwnership nunca se ejercita en list*, pero las interfaces de deps lo piden.
const NOOP_AUTH = { assertOwnership: () => undefined, authenticate: (() => []) as any } as any

/** Allow-list explícita de un ítem de carta pública — nunca spread del `MenuItemDTO` interno. */
function toPublicItem(item: MenuItemDTO): PublicMenuItemDTO {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    price: item.price,
    imageUrl: item.imageUrl,
    allergens: item.allergens ?? null,
    featured: item.featured ?? 0,
    availableFrom: item.availableFrom ?? null,
    availableTo: item.availableTo ?? null,
    availableNow: item.availableNow,
  }
}

/** Allow-list explícita de un combo público: componentes por `{name, quantity}`, NUNCA `menuItemId` crudo. */
function toPublicCombo(combo: ComboDTO, itemNameById: Map<string, string>): PublicComboDTO {
  const components = (combo.items ?? []).map((ci) => ({ name: itemNameById.get(ci.menuItemId) ?? '', quantity: ci.quantity }))
  return {
    id: combo.id,
    name: combo.name,
    description: combo.description,
    price: combo.price,
    imageUrl: combo.imageUrl,
    allergens: combo.allergens ?? [],
    // menu_combos no tiene columna `featured` propia (F6 solo la agregó a menu_items) — se expone en
    // 0 fijo para respetar la forma de respuesta del spec sin inventar una columna nueva (Database: "0 columnas nuevas").
    featured: (combo as unknown as { featured?: number }).featured ?? 0,
    components,
  }
}

export async function publicMenu(deps: PublicMenuDeps, hotelId: string, lang: string | undefined): Promise<PublicMenuDTO> {
  if (!hotelId) throw new NotFoundError(NOT_FOUND_MSG)
  // findOne (NUNCA findById): no hay usuario de sesión contra el cual afirmar ownership, así que no
  // corresponde `auth.assertOwnership()` — el chequeo real acá es "existe Y tiene el módulo prendido".
  const hotel = await deps.hotels.findOne({ id: hotelId })
  if (!hotel) throw new NotFoundError(NOT_FOUND_MSG)

  // F7 + fix plan-truth: el módulo `restaurant` se decide por la SUSCRIPCIÓN ACTIVA del hotel,
  // no por el espejo `hotels.plan` (que quedaba en el default 'professional' tras el trial).
  const state = await getModuleStateForHotel(deps.config, deps.plans, deps.subscriptions, hotelId, undefined, hotel.plan, deps.logger)
  if (state.restaurant === false) throw new NotFoundError(NOT_FOUND_MSG)

  const fakeUser: CurrentUser = { id: '', hotelId }
  const catDeps: categoriesCrud.CategoriesCrudDeps = { categories: deps.categories, items: deps.items, stations: deps.stations, userRepo: deps.userRepo, auth: NOOP_AUTH }
  const itemDeps: itemsCrud.ItemsCrudDeps = { items: deps.items, categories: deps.categories, stations: deps.stations, userRepo: deps.userRepo, auth: NOOP_AUTH }
  const comboDeps: combosCrud.CombosCrudDeps = { combos: deps.combos, comboItems: deps.comboItems, items: deps.items, userRepo: deps.userRepo, auth: NOOP_AUTH }

  const [{ data: categories }, { data: items }, { data: combos }] = await Promise.all([
    categoriesCrud.listCategories(catDeps, fakeUser, lang),
    itemsCrud.listItems(itemDeps, undefined, fakeUser, lang),
    combosCrud.listCombos(comboDeps, fakeUser, lang),
  ])

  // Ítems 86'd (available=0) se EXCLUYEN del todo; fuera de franja horaria (F6) SÍ se muestran, con
  // availableNow:false (ya calculado por listItems). Mismo criterio aplicado a combos agotados.
  const visibleItems = items.filter((i) => (i.available ?? 1) !== 0)
  const visibleCombos = combos.filter((c) => (c.available ?? 1) !== 0)

  // Nombres resueltos contra TODOS los ítems (no solo los visibles): un combo puede listar como
  // componente un ítem 86'd sin que eso oculte el combo ni deje el nombre vacío.
  const itemNameById = new Map(items.map((i) => [i.id, i.name]))

  const itemsByCategory = new Map<string, PublicMenuItemDTO[]>()
  for (const item of visibleItems) {
    const arr = itemsByCategory.get(item.categoryId) ?? []
    arr.push(toPublicItem(item))
    itemsByCategory.set(item.categoryId, arr)
  }

  return {
    hotel: { name: hotel.name },
    categories: categories.map((c) => ({ id: c.id, name: c.name, items: itemsByCategory.get(c.id) ?? [] })),
    combos: visibleCombos.map((c) => toPublicCombo(c, itemNameById)),
  }
}
