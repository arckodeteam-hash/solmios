// restaurant/usecases/items-crud.ts — CRUD de la carta: ítems (RES-1).
// Reglas: ownership (IDOR); categoryId REQUERIDO y del MISMO hotel; stationId (override) del mismo hotel o null;
// price ≥ 0 (rechaza negativos/NaN); taxRate opcional (si null, se resuelve al facturar desde config, NO acá).
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError } from 'arckode-framework'
import type { RecipePorts } from './food-cost'
import type { MenuItemDTO, CategoryDTO, StationDTO, ItemTranslation, CurrentUser, AllergenTag, ComboDTO, ComboItemDTO, ModifierGroupDTO, ModifierDTO } from '../types'
import { ALLERGEN_TAGS } from '../types'
import { assertNoBaseLangKey, resolveForLang } from '../../../shared/i18n'
import { isWithinAvailabilityWindow } from './order-totals'

/**
 * #208: abstracción mínima del ORM para la cascada atómica de `deleteItem` (mismo patrón que
 * `LandingTransactor` en landing/usecases/blocks-crud.ts). La define el módulo para que el service
 * no dependa del ORM concreto; index.ts la construye desde el `orm` real. El callback recibe un ORM
 * atado a la transacción: `tx.deleteMany(model, filters)` / `tx.delete(model, id)`.
 */
export interface ItemsTransactor {
  transaction<T>(fn: (tx: ItemsTx) => Promise<T>): Promise<T>
}
export interface ItemsTx {
  deleteMany(model: string, filters: Record<string, unknown>): Promise<number>
  delete(model: string, id: string): Promise<boolean>
}

export interface ItemsCrudDeps {
  items: RepositoryAdapter<MenuItemDTO>
  categories: RepositoryAdapter<CategoryDTO>
  stations: RepositoryAdapter<StationDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  // #208: integridad al borrar. Opcionales SOLO por retrocompat de tests viejos que no borran;
  // index.ts los pasa siempre. Sin `comboItems` no se puede comprobar el combo → se niega el borrado.
  comboItems?: RepositoryAdapter<ComboItemDTO>
  combos?: RepositoryAdapter<ComboDTO>
  modifierGroups?: RepositoryAdapter<ModifierGroupDTO>
  modifiers?: RepositoryAdapter<ModifierDTO>
  transactor?: ItemsTransactor
  /** #208: receta del ítem en inventario (puerto del conector restaurante-inventario). Sin puerto = no hay recetas que limpiar. */
  recipes?: RecipePorts
  logger?: Pick<Logger, 'warn' | 'error'>
}

// F4 — campos traducibles de un ítem: nombre + descripción.
const ITEM_TRANSLATABLE_FIELDS = ['name', 'description'] as const

export interface CreateItemInput {
  categoryId: string
  name: string
  description?: string
  price: number
  taxRate?: number | null
  stationId?: string | null
  available?: number
  imageUrl?: string
  sortOrder?: number
  translations?: Record<string, ItemTranslation> | null
  allergens?: AllergenTag[] | null
  // F6 — "plato del día"/recomendado (sin regla de negocio) + franja horaria "HH:mm" (todo-o-nada,
  // ver assertTimeWindow). '' se trata como "sin valor" (mismo criterio que stationId).
  featured?: number
  availableFrom?: string | null
  availableTo?: string | null
}
export interface UpdateItemInput extends Partial<CreateItemInput> {}

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

/** El precio debe ser un número finito ≥ 0. Rechaza NaN, Infinity y negativos. */
function assertPrice(price: unknown): number {
  const n = Number(price)
  if (!Number.isFinite(n) || n < 0) throw new ValidationError('El precio debe ser un número mayor o igual a 0')
  return n
}

/** taxRate (si viene) debe ser una tasa finita ≥ 0. `undefined` = usar la del hotel al facturar. */
function assertTaxRate(taxRate: number | null | undefined): void {
  if (taxRate === null || taxRate === undefined) return
  if (!Number.isFinite(Number(taxRate)) || Number(taxRate) < 0) throw new ValidationError('La tasa de impuesto debe ser ≥ 0')
}

/** categoryId REQUERIDO: debe existir y ser del MISMO hotel. findOne evita el falso IDOR. */
async function assertCategory(deps: ItemsCrudDeps, categoryId: string | undefined, hotelId: string): Promise<void> {
  if (!categoryId) throw new ValidationError('La categoría es obligatoria')
  const cat = await deps.categories.findOne({ id: categoryId })
  if (!cat || cat.hotelId !== hotelId) throw new ValidationError('La categoría no existe o es de otro hotel')
}

/** stationId (override opcional) debe existir y ser del MISMO hotel, o null. */
async function assertStation(deps: ItemsCrudDeps, stationId: string | null | undefined, hotelId: string): Promise<void> {
  if (stationId === null || stationId === undefined || stationId === '') return
  const st = await deps.stations.findOne({ id: stationId })
  if (!st || st.hotelId !== hotelId) throw new ValidationError('La estación no existe o es de otro hotel')
}

/** F5 — cada tag (si vienen) debe pertenecer al catálogo fijo ALLERGEN_TAGS. `undefined`/`null` = sin
 * tags declarados. Nunca bloquea addLine (informativo, no una regla de negocio, ver order-lines.ts). */
function assertAllergens(allergens: AllergenTag[] | null | undefined): void {
  if (allergens === null || allergens === undefined) return
  if (!Array.isArray(allergens)) throw new ValidationError('Los alérgenos deben ser un array')
  for (const tag of allergens) {
    if (!(ALLERGEN_TAGS as readonly string[]).includes(tag)) {
      throw new ValidationError(`"${tag}" no es un alérgeno/tag válido`)
    }
  }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** F6 — franja horaria "HH:mm", todo-o-nada: ninguno de los dos (sin restricción) o AMBOS con
 * formato válido. `''`/`null`/`undefined` cuentan como "sin valor" (mismo criterio que stationId). */
function assertTimeWindow(from: string | null | undefined, to: string | null | undefined): void {
  const hasFrom = !!from
  const hasTo = !!to
  if (!hasFrom && !hasTo) return
  if (hasFrom !== hasTo) throw new ValidationError('availableFrom y availableTo deben venir juntos (franja horaria todo-o-nada)')
  if (!TIME_RE.test(from as string) || !TIME_RE.test(to as string)) {
    throw new ValidationError('El horario debe tener formato HH:mm')
  }
}

// F6 — `availableNow` es DERIVADO (`available=1 AND dentro de franja`), nunca se persiste. El
// frontend SOLO lee este booleano — la lógica de franja vive en un solo lugar (order-totals.ts).
function withAvailableNow(item: MenuItemDTO, now: Date): MenuItemDTO {
  return { ...item, availableNow: (item.available ?? 1) === 1 && isWithinAvailabilityWindow(item, now) }
}

export async function listItems(deps: ItemsCrudDeps, categoryId: string | undefined, user: CurrentUser, lang?: string): Promise<{ data: MenuItemDTO[]; total: number }> {
  const filters: Record<string, unknown> = { hotelId: hotelFor(user) }
  if (categoryId) filters.categoryId = categoryId
  const data = await deps.items.findMany(filters)
  data.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const now = new Date()
  const resolved = data.map((i) => withAvailableNow(resolveForLang(i, lang, ITEM_TRANSLATABLE_FIELDS), now))
  return { data: resolved, total: resolved.length }
}

export async function getItem(deps: ItemsCrudDeps, id: string, user: CurrentUser, lang?: string): Promise<MenuItemDTO> {
  const item = await deps.items.findById(id)
  if (!item) throw new NotFoundError('Ítem no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(item.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  return withAvailableNow(resolveForLang(item, lang, ITEM_TRANSLATABLE_FIELDS), new Date())
}

export async function createItem(deps: ItemsCrudDeps, dto: CreateItemInput, user: CurrentUser): Promise<MenuItemDTO> {
  const hotelId = hotelFor(user)
  if (!dto.name?.trim()) throw new ValidationError('El nombre del ítem es obligatorio')
  const price = assertPrice(dto.price)
  assertTaxRate(dto.taxRate)
  await assertCategory(deps, dto.categoryId, hotelId)
  await assertStation(deps, dto.stationId, hotelId)
  assertNoBaseLangKey(dto.translations, 'name/description')
  assertAllergens(dto.allergens)
  assertTimeWindow(dto.availableFrom, dto.availableTo)
  return deps.items.create({
    hotelId,
    categoryId: dto.categoryId,
    name: dto.name.trim(),
    description: dto.description,
    price,
    taxRate: dto.taxRate ?? undefined,
    stationId: dto.stationId || undefined,   // '' → undefined (no referencia colgante)
    available: dto.available ?? 1,
    imageUrl: dto.imageUrl,
    sortOrder: dto.sortOrder ?? 0,
    translations: dto.translations ?? undefined,
    allergens: dto.allergens ?? undefined,
    featured: dto.featured ?? 0,
    availableFrom: dto.availableFrom || undefined,   // '' → undefined (sin restricción, compat retro)
    availableTo: dto.availableTo || undefined,
  } as Omit<MenuItemDTO, 'id'>)
}

export async function updateItem(deps: ItemsCrudDeps, id: string, dto: UpdateItemInput, user: CurrentUser): Promise<MenuItemDTO> {
  const existing = await deps.items.findById(id)
  if (!existing) throw new NotFoundError('Ítem no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  if (dto.translations !== undefined) assertNoBaseLangKey(dto.translations, 'name/description')
  if (dto.allergens !== undefined) assertAllergens(dto.allergens)
  const patch: Record<string, unknown> = { ...dto }
  if (dto.price !== undefined) patch.price = assertPrice(dto.price)
  if (dto.taxRate !== undefined) assertTaxRate(dto.taxRate)
  if (dto.categoryId !== undefined) await assertCategory(deps, dto.categoryId, existing.hotelId)
  // stationId: '' del front = "sin estación" (des-rutear) → guardamos null; un id se valida.
  if (dto.stationId !== undefined) {
    const sid = dto.stationId || null
    if (sid) await assertStation(deps, sid, existing.hotelId)
    patch.stationId = sid
  }
  // F6 — franja horaria: solo se valida/toca si el body trajo AL MENOS uno de los dos campos.
  // '' del front = "sin restricción" (Sin restricción) → guardamos null; ambos con formato → se persisten.
  if (dto.availableFrom !== undefined || dto.availableTo !== undefined) {
    assertTimeWindow(dto.availableFrom, dto.availableTo)
    patch.availableFrom = dto.availableFrom || null
    patch.availableTo = dto.availableTo || null
  }
  const item = await deps.items.update(id, patch as Partial<Omit<MenuItemDTO, 'id'>>)
  if (!item) throw new NotFoundError('Ítem no encontrado')
  return item
}

/** Toggle rápido de disponibilidad ("86'" del día). Si `available` viene, lo fija; si no, invierte el actual. */
export async function setAvailability(deps: ItemsCrudDeps, id: string, available: number | undefined, user: CurrentUser): Promise<MenuItemDTO> {
  const existing = await deps.items.findById(id)
  if (!existing) throw new NotFoundError('Ítem no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  const next = available !== undefined ? (available ? 1 : 0) : (existing.available ? 0 : 1)
  const item = await deps.items.update(id, { available: next } as Partial<Omit<MenuItemDTO, 'id'>>)
  if (!item) throw new NotFoundError('Ítem no encontrado')
  return item
}

/**
 * #208: borrar un ítem.
 *  - 409 si algún combo lo usa como componente (con el nombre del combo): al venderlo,
 *    order-lines.ts lanzaría por componente inexistente y el combo quedaría roto en silencio.
 *    Un `menu_combo_items` cuyo combo YA no existe (huérfano) no bloquea: no hay combo del cual
 *    "quitarlo", así que se limpia con el ítem.
 *  - Cascada de sus grupos de modificadores + opciones EN UNA TRANSACCIÓN: antes quedaban huérfanos
 *    (menu_item_modifier_groups.menuItemId apuntando a nada). Si el transactor no está cableado
 *    (tests viejos) se borra secuencial — en producción index.ts lo pasa siempre.
 *  - Después, la receta del ítem en inventario (`menu_item_recipes`, otro módulo → por puerto). Va
 *    fuera de la transacción porque es otra base de dominio; si falla, el ítem ya no existe y se
 *    avisa en el log — una receta huérfana no rompe nada (consumeForSale nunca la va a leer).
 *  Las líneas de comandas históricas guardan snapshot de name/price → la comanda sobrevive al borrado.
 */
export async function deleteItem(deps: ItemsCrudDeps, id: string, user: CurrentUser): Promise<void> {
  const existing = await deps.items.findById(id)
  if (!existing) throw new NotFoundError('Ítem no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')

  if (!deps.comboItems || !deps.combos) throw new ValidationError('Combos no configurados: no se puede comprobar si el ítem está en un combo')
  const usedIn = (await deps.comboItems.findMany({ menuItemId: id })) as ComboItemDTO[]
  const names: string[] = []
  const orphans: ComboItemDTO[] = []
  for (const ci of usedIn) {
    const combo = await deps.combos.findOne({ id: ci.comboId })
    if (!combo) { orphans.push(ci); continue }
    if (!names.includes(combo.name)) names.push(combo.name)
  }
  if (names.length > 0) {
    throw new ConflictError(`El ítem "${existing.name}" forma parte del combo ${names.map((n) => `"${n}"`).join(', ')}; quitalo del combo antes de borrarlo`)
  }

  const groups = deps.modifierGroups ? ((await deps.modifierGroups.findMany({ menuItemId: id })) as ModifierGroupDTO[]) : []
  const cascade = async (tx: ItemsTx): Promise<boolean> => {
    for (const g of groups) await tx.deleteMany('MenuItemModifiers', { groupId: g.id })
    if (groups.length) await tx.deleteMany('MenuItemModifierGroups', { menuItemId: id })
    for (const ci of orphans) await tx.delete('MenuComboItems', ci.id)
    return tx.delete('MenuItems', id)
  }
  const deleted = deps.transactor
    ? await deps.transactor.transaction(cascade)
    : await cascade(sequentialTx(deps))
  if (!deleted) throw new NotFoundError('Ítem no encontrado')

  if (deps.recipes?.deleteRecipesOfMenuItem) {
    try {
      await deps.recipes.deleteRecipesOfMenuItem(existing.hotelId, id)
    } catch (e) {
      deps.logger?.warn('deleteItem: el ítem se borró pero su receta en inventario no', { menuItemId: id, hotelId: existing.hotelId, error: e instanceof Error ? e.message : String(e) })
    }
  }
}

/** Sin transactor (tests): la misma secuencia sobre los repos, sin atomicidad. */
function sequentialTx(deps: ItemsCrudDeps): ItemsTx {
  const repoOf = (model: string): RepositoryAdapter<any> | undefined =>
    model === 'MenuItemModifiers' ? deps.modifiers : model === 'MenuItemModifierGroups' ? deps.modifierGroups : undefined
  return {
    deleteMany: async (model, filters) => {
      const repo = repoOf(model)
      if (!repo) return 0
      const rows = (await repo.findMany(filters)) as Array<{ id: string }>
      for (const r of rows) await repo.delete(r.id)
      return rows.length
    },
    delete: (model, rowId) => (model === 'MenuComboItems' ? deps.comboItems!.delete(rowId) : deps.items.delete(rowId)),
  }
}
