// bookingengine/usecases/meal-plans-crud.ts — Admin CRUD de regímenes de alimentación
// (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes → #361 catálogo abierto).
//
// Sub-dominio de bookingengine, mismo criterio que upsells-crud.ts. Hasta #361 era un enum fijo
// de 3 códigos con `upsert(code)`; ahora es un catálogo ABIERTO por hotel: `list`, `create`,
// `update(id)`, `remove(id)`. Lo que lo diferencia de upsells:
//  - `code` es un slug del nombre, ÚNICO por hotel, generado al crear y NUNCA editable: es la
//    identidad que las reservas persisten en `mealPlan`/`regime` (y por la que el motor público
//    y las etiquetas lo resuelven). Cambiar el nombre no cambia el código.
//  - `priceMode` se DERIVA del precio si no viene explícito (price > 0 → 'per_person_per_night').
//  - `ensureSeeded` siembra 4 ejemplos (`DEFAULT_MEAL_PLANS`) UNA sola vez por hotel, con
//    marcador en `configuration` (key `meal_plans_seeded`): si el hotel borra uno, no reaparece.
//  - Concurrencia: dos índices UNIQUE son los árbitros — `configuration(hotelId, key)` decide
//    quién siembra (el que crea el marcador) y `meal_plans(hotelId, code)` (migrate-db
//    `idx_meal_plans_hotel_code`) decide el slug al crear. El chequeo en JS sólo elige el
//    candidato; el perdedor de la carrera (`isUniqueViolation`) ignora o reintenta.
//
// Reglas de negocio (mismas que upsells-crud.ts):
//  - Ownership IDOR: `assertOwnershipOf` re-lee el hotelId del usuario vía userRepo, no confía
//    en el JWT directo.
//  - `priceMode` (enum) y `price` (>= 0) validados acá (el validador no soporta enums ni
//    condicionales — mismo motivo que upsells).
//
// Anti-patrón ORM (mem 1805): TODO campo persistido está declarado en model.ts.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import { isUniqueViolation } from '../../../shared/utils/db-errors'
import type {
  MealPlanDTO, MealPlanPriceMode, CreateMealPlanDTO, UpdateMealPlanDTO, UpsellCurrentUser,
} from '../types'

/** Longitud máxima del nombre visible. */
export const MEAL_PLAN_NAME_MAX = 80
/** Longitud máxima de la descripción. */
export const MEAL_PLAN_DESCRIPTION_MAX = 300
/** Longitud máxima del slug (`code`), sufijo `_N` incluido. */
export const MEAL_PLAN_CODE_MAX = 40
/** Reintentos de `create` cuando el slug candidato pierde la carrera contra el UNIQUE (hotelId, code). */
export const MEAL_PLAN_CODE_MAX_ATTEMPTS = 5

/** Marcador en `configuration` que indica que el hotel ya recibió los seeds (#361). */
export const MEAL_PLANS_SEEDED_KEY = 'meal_plans_seeded'

/**
 * Seeds iniciales (#361): 4 ejemplos, todos incluidos/sin costo/activos. Los códigos coinciden
 * con los que el motor y las reservas ya venían usando (`breakfast`/`half_board`/`all_inclusive`
 * del enum viejo + `room_only`, antes implícito), así el backfill de `migrate-db.ts` les pone
 * nombre a las filas existentes sin tocar reservas.
 */
export const DEFAULT_MEAL_PLANS: ReadonlyArray<{ code: string; name: string; description?: string }> = [
  { code: 'room_only', name: 'Solo alojamiento', description: 'Sin comidas incluidas' },
  { code: 'breakfast', name: 'Desayuno incluido' },
  { code: 'half_board', name: 'Desayuno y cena' },
  { code: 'all_inclusive', name: 'Todo incluido' },
]

/** Orden de presentación: los códigos históricos primero (mismo orden que el widget), el resto al final. */
export const LEGACY_ORDER: Record<string, number> = { room_only: 0, breakfast: 1, half_board: 2, all_inclusive: 3 }

/**
 * @deprecated #361 — el catálogo ya no es un enum cerrado. Queda vacío sólo para que compile
 * quien todavía lo importe; NO usar para validar códigos.
 */
export const MEAL_PLAN_CODES: string[] = []

export interface MealPlansCrudDeps {
  mealPlans: RepositoryAdapter<MealPlanDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  /** `Configuration` KV (shared/models.ts) — marcador `meal_plans_seeded` por hotel (#361). */
  configuration: RepositoryAdapter<any>
}

// ─── helpers ───────────────────────────────────────────────────────────────

function hotelFor(user: UpsellCurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
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

/** `name` obligatorio, trim, 1..80. */
function assertName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : ''
  if (!name) throw new ValidationError('name es requerido')
  if (name.length > MEAL_PLAN_NAME_MAX) throw new ValidationError(`name debe tener como máximo ${MEAL_PLAN_NAME_MAX} caracteres`)
  return name
}

/** `description` opcional, trim, ≤300; null/'' → null. */
function normalizeDescription(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const d = String(v).trim()
  if (!d) return null
  if (d.length > MEAL_PLAN_DESCRIPTION_MAX) {
    throw new ValidationError(`description debe tener como máximo ${MEAL_PLAN_DESCRIPTION_MAX} caracteres`)
  }
  return d
}

/** Si `priceMode` no viene, se deriva del precio: con costo → por persona/noche; sin costo → incluido. */
function derivePriceMode(priceMode: unknown, price: number): MealPlanPriceMode {
  if (priceMode !== undefined && priceMode !== null && priceMode !== '') return assertPriceMode(priceMode)
  return price > 0 ? 'per_person_per_night' : 'included'
}

/**
 * Slug del nombre: minúsculas, sin acentos, `[a-z0-9]+` unidos por `_`, máx 40. Un nombre sin
 * ningún carácter alfanumérico cae a `regimen`.
 */
export function slugifyMealPlanName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MEAL_PLAN_CODE_MAX)
    .replace(/_+$/g, '')
  return base || 'regimen'
}

/** Slug único dentro del hotel: `desayuno`, `desayuno_2`, `desayuno_3`… (siempre ≤ 40 chars). */
function uniqueCodeFor(name: string, taken: Set<string>): string {
  const base = slugifyMealPlanName(name)
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `_${n}`
    const candidate = base.slice(0, MEAL_PLAN_CODE_MAX - suffix.length).replace(/_+$/g, '') + suffix
    if (!taken.has(candidate)) return candidate
  }
}

async function assertOwnershipOf(deps: MealPlansCrudDeps, resourceHotelId: string, user: UpsellCurrentUser): Promise<void> {
  const me = await deps.userRepo.findOne({ id: user.id })
  deps.auth.assertOwnership(resourceHotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
}

function sortForList(rows: MealPlanDTO[]): MealPlanDTO[] {
  return [...rows].sort((a, b) => {
    const oa = LEGACY_ORDER[a.code] ?? 99
    const ob = LEGACY_ORDER[b.code] ?? 99
    if (oa !== ob) return oa - ob
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  })
}

// ─── seeds ─────────────────────────────────────────────────────────────────
/**
 * Siembra `DEFAULT_MEAL_PLANS` en el hotel UNA sola vez (#361). Idempotente por marcador en
 * `configuration` (`meal_plans_seeded`): sin marcador → completa name/description de las filas
 * viejas que coincidan por code y sin name, crea las que falten. Con marcador no toca nada — si
 * el hotel borró un ejemplo, no reaparece. Espeja `ensureMealPlanSeeds()` de `migrate-db.ts` (el
 * deploy) para los hoteles creados después del deploy.
 *
 * Orden anti-carrera (dos `list()` simultáneos del mismo hotel sin filas): el marcador se crea
 * PRIMERO y el UNIQUE (hotelId, key) de `configuration` elige un ganador; el perdedor recibe la
 * violación y sale sin insertar nada. Sólo quien ganó el marcador siembra/backfillea, y cada
 * insert va envuelto por si igual choca con `idx_meal_plans_hotel_code` (una fila creada a mano
 * entre medio): se ignora, ya existe.
 */
export async function ensureSeeded(
  deps: Pick<MealPlansCrudDeps, 'mealPlans' | 'configuration'>,
  hotelId: string,
): Promise<void> {
  const marker = await deps.configuration.findOne({ hotelId, key: MEAL_PLANS_SEEDED_KEY })
  if (marker) return

  try {
    await deps.configuration.create({ hotelId, key: MEAL_PLANS_SEEDED_KEY, value: { seeded: true } } as any)
  } catch (e: unknown) {
    if (isUniqueViolation(e)) return // otro request ganó el marcador y está sembrando
    throw e
  }

  const existing = await deps.mealPlans.findMany({ hotelId })
  for (const def of DEFAULT_MEAL_PLANS) {
    const row = existing.find((r) => r.code === def.code)
    if (row) {
      if (!(row.name ?? '').trim()) {
        await deps.mealPlans.update(row.id, { name: def.name, description: def.description ?? null } as Partial<Omit<MealPlanDTO, 'id'>>)
      }
      continue
    }
    try {
      await deps.mealPlans.create({
        hotelId,
        code: def.code,
        name: def.name,
        description: def.description ?? null,
        active: true,
        priceMode: 'included',
        price: 0,
      } as any)
    } catch (e: unknown) {
      if (!isUniqueViolation(e)) throw e // ya existe (creada entre medio): no es un error
    }
  }
}

// ─── list ──────────────────────────────────────────────────────────────────
/**
 * Las filas reales del hotel (sin rellenar códigos ausentes), ordenadas por `LEGACY_ORDER` y
 * después por `createdAt`. Siembra los ejemplos la primera vez (`ensureSeeded`).
 */
export async function list(
  deps: MealPlansCrudDeps,
  user: UpsellCurrentUser,
): Promise<{ data: MealPlanDTO[]; total: number }> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  await ensureSeeded(deps, hotelId)
  const data = sortForList(await deps.mealPlans.findMany({ hotelId }))
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
  const description = normalizeDescription(dto.description)
  const price = dto.price !== undefined && dto.price !== null ? assertPrice(dto.price) : 0
  const priceMode = derivePriceMode(dto.priceMode, price)

  const record: Omit<MealPlanDTO, 'id' | 'createdAt' | 'updatedAt' | 'code'> = {
    hotelId,
    name,
    description,
    active: typeof dto.active === 'boolean' ? dto.active : true,
    priceMode,
    price,
  }

  // El slug se elige leyendo los códigos existentes, pero el árbitro es el UNIQUE (hotelId, code)
  // (`idx_meal_plans_hotel_code`): si dos "Media pensión" simultáneos piden `media_pension`, el
  // perdedor recibe la violación, relee los códigos y reintenta con el siguiente sufijo.
  for (let attempt = 0; attempt < MEAL_PLAN_CODE_MAX_ATTEMPTS; attempt++) {
    const taken = new Set((await deps.mealPlans.findMany({ hotelId })).map((r) => r.code))
    const code = uniqueCodeFor(name, taken)
    try {
      return await deps.mealPlans.create({ ...record, code } as any) as MealPlanDTO
    } catch (e: unknown) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  throw new ValidationError('No se pudo generar un código único para el régimen')
}

// ─── update ────────────────────────────────────────────────────────────────
/** Patch parcial. `code` NUNCA cambia (identidad persistida en las reservas). */
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
  if (dto.description !== undefined) patch.description = normalizeDescription(dto.description)
  if (dto.price !== undefined && dto.price !== null) patch.price = assertPrice(dto.price)
  if (dto.priceMode !== undefined && dto.priceMode !== null) {
    patch.priceMode = assertPriceMode(dto.priceMode)
  } else if (patch.price !== undefined) {
    // Cambió el precio sin decir el modo: se re-deriva (mismo criterio que en create).
    patch.priceMode = derivePriceMode(undefined, patch.price as number)
  }
  if (dto.active !== undefined) patch.active = dto.active

  const updated = await deps.mealPlans.update(id, patch as Partial<Omit<MealPlanDTO, 'id'>>)
  if (!updated) throw new NotFoundError('Régimen no encontrado')
  return updated
}

// ─── delete ────────────────────────────────────────────────────────────────
/** Borrado físico. Las reservas conservan `mealPlan`/`regime` (el code) como snapshot. */
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
