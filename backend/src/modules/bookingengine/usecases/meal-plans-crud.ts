// bookingengine/usecases/meal-plans-crud.ts — Admin CRUD de regímenes de alimentación (#360).
//
// Sub-dominio de bookingengine, mismo patrón que upsells-crud.ts: catálogo ABIERTO por hotel
// (antes era un enum fijo de 3 códigos con `upsert` por code — tasks.md 2.2/2.4). El hotel crea,
// edita, ordena y borra sus regímenes desde Configuración → Regímenes.
//
// Reglas de negocio:
//  - `code` es el identificador ESTABLE (reservas/emails/widget keyean por él): slug del `name`
//    (a-z0-9_, max 40) con sufijo `_2`, `_3`… si ya existe en el hotel. NO se edita.
//  - Unicidad (hotelId, code) la garantiza el índice `meal_plans_hotel_code` (migrate-db.ts). El
//    pre-check findMany → uniqueCode no alcanza bajo concurrencia: `create()` captura la violación
//    (`isUniqueViolation`) y reintenta con el siguiente sufijo (máx. `CREATE_MAX_ATTEMPTS`);
//    `seedIfNeeded()` ignora la violación (otro request ya sembró esa fila) y relee.
//  - Semilla: `list()` crea UNA sola vez las 4 filas default que falten por code
//    (`DEFAULT_MEAL_PLANS`) y marca `booking_config.mealPlansSeeded = true`. Si no hay fila de
//    booking_config todavía, siembra sin marcar (la próxima carga vuelve a completar por code, sin
//    duplicar). Nunca se re-siembra después: si el hotel borra todo, queda vacío.
//  - Filas legacy sin `name` (creadas antes de #360) se rellenan al leer con `LEGACY_NAMES`.
//  - Ownership IDOR: `assertOwnershipOf` re-lee el hotelId del usuario vía userRepo, no confía
//    en el JWT directo. update/remove resuelven ownership por FILA (`findOne({id})`).
//  - `priceMode` (enum cerrado), `price` (>=0), `name` (no vacío, max 80) y `description`
//    (max 500) validados acá (el validador no soporta enums — mismo motivo que upsells).
//
// Anti-patrón ORM (mem 1805): TODO campo persistido está declarado en model.ts.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  MealPlanDTO, MealPlanPriceMode, CreateMealPlanDTO, UpdateMealPlanDTO, UpsellCurrentUser,
} from '../types'

export interface MealPlansCrudDeps {
  mealPlans: RepositoryAdapter<MealPlanDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  /** `booking_config` — para marcar `mealPlansSeeded`. Opcional (compat con wiring viejo/tests). */
  bookingConfig?: RepositoryAdapter<any>
}

/** Nombres de los códigos legacy (filas anteriores a #360, sin `name`). */
export const LEGACY_NAMES: Record<string, string> = {
  room_only: 'Solo alojamiento',
  breakfast: 'Desayuno incluido',
  half_board: 'Desayuno y cena',
  all_inclusive: 'Todo incluido',
}

/** Las 4 filas que se siembran una sola vez por hotel. Solo `room_only` nace activa. */
export const DEFAULT_MEAL_PLANS: ReadonlyArray<Pick<MealPlanDTO, 'code' | 'name' | 'description' | 'active' | 'priceMode' | 'price' | 'sortOrder'>> = [
  { code: 'room_only', name: LEGACY_NAMES.room_only, description: '', active: true, priceMode: 'included', price: 0, sortOrder: 0 },
  { code: 'breakfast', name: LEGACY_NAMES.breakfast, description: '', active: false, priceMode: 'included', price: 0, sortOrder: 1 },
  { code: 'half_board', name: LEGACY_NAMES.half_board, description: '', active: false, priceMode: 'included', price: 0, sortOrder: 2 },
  { code: 'all_inclusive', name: LEGACY_NAMES.all_inclusive, description: '', active: false, priceMode: 'included', price: 0, sortOrder: 3 },
]

export const NAME_MAX = 80
export const DESCRIPTION_MAX = 500
export const CODE_MAX = 40
/** Intentos de `create()` ante violaciones consecutivas del UNIQUE (hotelId, code). */
export const CREATE_MAX_ATTEMPTS = 5

/** Nombre visible de una fila: `name` propio, o el legacy por code, o el code pelado. */
export function displayName(row: { code?: string | null; name?: string | null }): string {
  const name = String(row.name ?? '').trim()
  if (name) return name
  const code = String(row.code ?? '')
  return LEGACY_NAMES[code] ?? code
}

// ─── helpers ───────────────────────────────────────────────────────────────

function hotelFor(user: UpsellCurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

function assertName(n: unknown): string {
  const name = String(n ?? '').trim()
  if (!name) throw new ValidationError('name es requerido')
  if (name.length > NAME_MAX) throw new ValidationError(`name no puede superar ${NAME_MAX} caracteres`)
  return name
}

function assertDescription(d: unknown): string {
  const description = String(d ?? '').trim()
  if (description.length > DESCRIPTION_MAX) {
    throw new ValidationError(`description no puede superar ${DESCRIPTION_MAX} caracteres`)
  }
  return description
}

function assertPriceMode(m: unknown): MealPlanPriceMode {
  if (m !== 'included' && m !== 'per_person_per_night') {
    throw new ValidationError("priceMode debe ser 'included' o 'per_person_per_night'")
  }
  return m
}

/** Permite 0 ("con costo, pero por ahora gratis" — caso raro, no lo prohibimos). */
function assertPrice(p: unknown): number {
  const n = Number(p)
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError('price debe ser un número >= 0')
  }
  return n
}

function assertSortOrder(s: unknown): number {
  const n = Number(s)
  if (!Number.isFinite(n)) throw new ValidationError('sortOrder debe ser un número')
  return n
}

/**
 * Violación del índice único `meal_plans_hotel_code` en SQLite ("UNIQUE constraint failed") o
 * Postgres (código 23505 / "duplicate key"). Mismo criterio que `public-booking.isUniqueViolation`
 * (copiado a propósito para no acoplar este usecase al de reservas públicas).
 */
function isUniqueViolation(e: unknown): boolean {
  const code = String((e as any)?.code ?? '')
  const msg = String((e as any)?.message ?? e).toLowerCase()
  return code === '23505'
    || msg.includes('unique')
    || msg.includes('duplicate key')
    || msg.includes('meal_plans_hotel_code')
}

async function assertOwnershipOf(deps: MealPlansCrudDeps, resourceHotelId: string, user: UpsellCurrentUser): Promise<void> {
  const me = await deps.userRepo.findOne({ id: user.id })
  deps.auth.assertOwnership(resourceHotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
}

/**
 * Slug estable a partir del nombre: minúsculas sin acentos, `[a-z0-9_]`, max `CODE_MAX`.
 * 'Desayuno y cena' → 'desayuno_y_cena'. Si queda vacío (nombre solo con símbolos) → 'regimen'.
 */
export function slugifyCode(name: string): string {
  const base = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, CODE_MAX)
    .replace(/_+$/g, '')
  return base || 'regimen'
}

/** Slug único dentro del hotel: `desayuno`, `desayuno_2`, `desayuno_3`… (el sufijo respeta CODE_MAX). */
function uniqueCode(name: string, taken: Set<string>): string {
  const base = slugifyCode(name)
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const suffix = `_${i}`
    const candidate = `${base.slice(0, CODE_MAX - suffix.length).replace(/_+$/g, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Fila lista para devolver: `name` rellenado para las legacy, numéricos normalizados. */
function normalize(row: MealPlanDTO): MealPlanDTO {
  return {
    ...row,
    name: displayName(row),
    description: String((row as any).description ?? ''),
    sortOrder: Number((row as any).sortOrder ?? 0),
    price: Number(row.price ?? 0),
  }
}

function sortRows(rows: MealPlanDTO[]): MealPlanDTO[] {
  return rows.sort((a, b) => {
    const sa = Number(a.sortOrder ?? 0)
    const sb = Number(b.sortOrder ?? 0)
    if (sa !== sb) return sa - sb
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  })
}

// ─── semilla ───────────────────────────────────────────────────────────────
/**
 * Crea las filas default que falten por code y marca `booking_config.mealPlansSeeded`. Devuelve
 * las filas del hotel después de sembrar (relectura fresca). Si ya está marcado, no toca nada
 * (aunque el hotel haya borrado todo — eso es una decisión suya).
 *
 * Race (dos GET simultáneos en un hotel sin sembrar): cada `create` puede chocar con el UNIQUE
 * `meal_plans_hotel_code` porque otro request ya insertó esa default. Se ignora la violación (la
 * fila existe, que es lo que queríamos) y al final se relee `findMany` para devolver lo que quedó
 * en DB en vez de concatenar lo que creyó crear este request.
 */
async function seedIfNeeded(deps: MealPlansCrudDeps, hotelId: string, existing: MealPlanDTO[]): Promise<MealPlanDTO[]> {
  const config = deps.bookingConfig ? await deps.bookingConfig.findOne({ hotelId }) : null
  if (config && (config as any).mealPlansSeeded === true) return existing

  const byCode = new Set(existing.map((r) => r.code))
  let touched = false
  for (const def of DEFAULT_MEAL_PLANS) {
    if (byCode.has(def.code)) continue
    touched = true
    try {
      await deps.mealPlans.create({ hotelId, ...def } as any)
    } catch (e: unknown) {
      if (!isUniqueViolation(e)) throw e
      // Otro request la sembró entre nuestro findMany y este create: ya existe, seguimos.
    }
  }
  if (config && deps.bookingConfig) {
    await deps.bookingConfig.update((config as any).id, { mealPlansSeeded: true } as any)
  }
  return touched ? await deps.mealPlans.findMany({ hotelId }) : existing
}

// ─── list ──────────────────────────────────────────────────────────────────
/** Regímenes del hotel del admin, ordenados por `sortOrder` ASC y `createdAt` ASC. Siembra una vez. */
export async function list(
  deps: MealPlansCrudDeps,
  user: UpsellCurrentUser,
): Promise<{ data: MealPlanDTO[]; total: number }> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  const existing = await deps.mealPlans.findMany({ hotelId })
  const rows = await seedIfNeeded(deps, hotelId, existing)
  const data = sortRows(rows.map(normalize))
  return { data, total: data.length }
}

// ─── create ────────────────────────────────────────────────────────────────
export async function create(
  deps: MealPlansCrudDeps,
  dto: CreateMealPlanDTO,
  user: UpsellCurrentUser,
): Promise<MealPlanDTO> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  const name = assertName(dto.name)
  const description = assertDescription(dto.description)
  const priceMode = dto.priceMode !== undefined ? assertPriceMode(dto.priceMode) : 'included'
  const price = dto.price !== undefined ? assertPrice(dto.price) : 0
  const sortOrder = dto.sortOrder !== undefined ? assertSortOrder(dto.sortOrder) : 0

  const base: Omit<MealPlanDTO, 'id' | 'createdAt' | 'updatedAt' | 'code'> = {
    hotelId,
    name,
    description,
    priceMode,
    price,
    active: typeof dto.active === 'boolean' ? dto.active : true,
    sortOrder,
  }

  // Race (dos POST con el mismo nombre): findMany → uniqueCode → create no es atómico, así que el
  // UNIQUE `meal_plans_hotel_code` puede rechazar el insert. Releemos los codes del hotel, sumamos
  // el code que acaba de chocar (por si la relectura todavía no lo ve) y probamos el siguiente
  // sufijo, acotado a CREATE_MAX_ATTEMPTS para no loopear.
  const failed = new Set<string>()
  for (let attempt = 1; attempt <= CREATE_MAX_ATTEMPTS; attempt++) {
    const siblings = await deps.mealPlans.findMany({ hotelId })
    const taken = new Set([...siblings.map((r) => r.code), ...failed])
    const code = uniqueCode(name, taken)
    try {
      const created = await deps.mealPlans.create({ ...base, code } as any) as MealPlanDTO
      return normalize(created)
    } catch (e: unknown) {
      if (!isUniqueViolation(e)) throw e
      failed.add(code)
    }
  }
  throw new ValidationError('No se pudo generar un código único para el régimen')
}

// ─── update ────────────────────────────────────────────────────────────────
/** Patch parcial por id. `code` NO se cambia (las reservas viejas keyean por él). */
export async function update(
  deps: MealPlansCrudDeps,
  id: string,
  dto: UpdateMealPlanDTO,
  user: UpsellCurrentUser,
): Promise<MealPlanDTO> {
  const existing = await deps.mealPlans.findOne({ id })
  if (!existing) throw new NotFoundError('Régimen no encontrado')
  await assertOwnershipOf(deps, existing.hotelId, user)

  const patch: Record<string, unknown> = {}
  if (dto.name !== undefined) patch.name = assertName(dto.name)
  if (dto.description !== undefined) patch.description = assertDescription(dto.description)
  if (dto.priceMode !== undefined) patch.priceMode = assertPriceMode(dto.priceMode)
  if (dto.price !== undefined) patch.price = assertPrice(dto.price)
  if (dto.active !== undefined) patch.active = dto.active
  if (dto.sortOrder !== undefined) patch.sortOrder = assertSortOrder(dto.sortOrder)

  const updated = await deps.mealPlans.update(id, patch as Partial<Omit<MealPlanDTO, 'id'>>)
  if (!updated) throw new NotFoundError('Régimen no encontrado')
  return normalize(updated)
}

// ─── delete ────────────────────────────────────────────────────────────────
export async function remove(
  deps: MealPlansCrudDeps,
  id: string,
  user: UpsellCurrentUser,
): Promise<{ id: string; deleted: true }> {
  const existing = await deps.mealPlans.findOne({ id })
  if (!existing) throw new NotFoundError('Régimen no encontrado')
  await assertOwnershipOf(deps, existing.hotelId, user)
  const ok = await deps.mealPlans.delete(id)
  if (!ok) throw new NotFoundError('Régimen no encontrado')
  return { id, deleted: true }
}
