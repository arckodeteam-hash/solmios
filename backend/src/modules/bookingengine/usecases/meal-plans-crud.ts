// bookingengine/usecases/meal-plans-crud.ts — Admin config de regímenes de alimentación
// (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes).
//
// Sub-dominio de bookingengine, mismo criterio que upsells-crud.ts — pero MÁS SIMPLE: acá no
// hay altas/bajas libres, `MEAL_PLAN_CODES` es un enum fijo de 3 elementos. `list()` siempre
// devuelve los 3 (con defaults si el hotel nunca los configuró) y `upsert()` crea-o-actualiza
// la fila de UN código a la vez — no existe "crear un régimen nuevo" ni "borrar un régimen".
//
// Reglas de negocio (mismas que upsells-crud.ts):
//  - Ownership IDOR: `assertOwnershipOf` re-lee el hotelId del usuario vía userRepo, no confía
//    en el JWT directo.
//  - `code` (enum cerrado) y `priceMode`/`price` validados acá (el validador no soporta enums
//    ni condicionales — mismo motivo que upsells).
//
// Anti-patrón ORM (mem 1805): TODO campo persistido está declarado en model.ts.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type {
  MealPlanDTO, MealPlanCode, MealPlanPriceMode, UpsertMealPlanDTO, UpsellCurrentUser,
} from '../types'

export const MEAL_PLAN_CODES: MealPlanCode[] = ['breakfast', 'half_board', 'all_inclusive']

export interface MealPlansCrudDeps {
  mealPlans: RepositoryAdapter<MealPlanDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
}

// ─── helpers ───────────────────────────────────────────────────────────────

function hotelFor(user: UpsellCurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

function assertCode(c: unknown): MealPlanCode {
  if (c !== 'breakfast' && c !== 'half_board' && c !== 'all_inclusive') {
    throw new ValidationError("code debe ser 'breakfast', 'half_board' o 'all_inclusive'")
  }
  return c
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

async function assertOwnershipOf(deps: MealPlansCrudDeps, resourceHotelId: string, user: UpsellCurrentUser): Promise<void> {
  const me = await deps.userRepo.findOne({ id: user.id })
  deps.auth.assertOwnership(resourceHotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
}

/** Fila default para un código que el hotel nunca configuró — inactivo, incluido, sin precio. */
function defaultRow(hotelId: string, code: MealPlanCode): MealPlanDTO {
  return {
    id: '', hotelId, code, active: false, priceMode: 'included', price: 0,
    createdAt: '', updatedAt: '',
  }
}

// ─── list ──────────────────────────────────────────────────────────────────
/** Los 3 códigos SIEMPRE, en orden fijo — el hotel nunca ve una lista vacía ni incompleta. */
export async function list(
  deps: MealPlansCrudDeps,
  user: UpsellCurrentUser,
): Promise<{ data: MealPlanDTO[]; total: number }> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  const existing = await deps.mealPlans.findMany({ hotelId })
  const byCode = new Map(existing.map((r) => [r.code, r]))
  const data = MEAL_PLAN_CODES.map((code) => byCode.get(code) ?? defaultRow(hotelId, code))
  return { data, total: data.length }
}

// ─── upsert ────────────────────────────────────────────────────────────────
export async function upsert(
  deps: MealPlansCrudDeps,
  codeInput: unknown,
  dto: UpsertMealPlanDTO,
  user: UpsellCurrentUser,
): Promise<MealPlanDTO> {
  const hotelId = hotelFor(user)
  await assertOwnershipOf(deps, hotelId, user)
  const code = assertCode(codeInput)

  const priceMode = dto.priceMode !== undefined ? assertPriceMode(dto.priceMode) : undefined
  const price = dto.price !== undefined ? assertPrice(dto.price) : undefined

  const existing = (await deps.mealPlans.findMany({ hotelId, code }))[0]
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (dto.active !== undefined) patch.active = dto.active
    if (priceMode !== undefined) patch.priceMode = priceMode
    if (price !== undefined) patch.price = price
    const updated = await deps.mealPlans.update(existing.id, patch as Partial<Omit<MealPlanDTO, 'id'>>)
    return updated ?? existing
  }

  const record: Omit<MealPlanDTO, 'id' | 'createdAt' | 'updatedAt'> = {
    hotelId,
    code,
    active: typeof dto.active === 'boolean' ? dto.active : false,
    priceMode: priceMode ?? 'included',
    price: price ?? 0,
  } as any
  return await deps.mealPlans.create(record as any) as MealPlanDTO
}
