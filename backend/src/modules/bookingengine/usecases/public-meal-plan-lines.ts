// bookingengine/usecases/public-meal-plan-lines.ts — régimen (meal plan) cobrado por persona y
// noche desde el motor público (MR-03, #268).
//
// Dos consumidores, UNA sola aritmética:
//   - `GET /rates` → `buildPublicMealPlans`: lista los regímenes activos del hotel con el
//     `totalForStay` ya calculado para la búsqueda (guests × nights), para que el widget muestre
//     el precio real de cada opción sin recomputar nada del lado del cliente.
//   - `POST /booking` / `/booking-group` → `resolveMealPlanLine`: convierte el `mealPlan` que
//     manda el body en una línea con precio CONGELADO, releído del catálogo del hotel.
//
// Igual que upsells/childAmenities/roomAmenities: el precio NUNCA sale del body. El widget
// manda solo el `code`; si el hotel desactivó el régimen entre que el huésped lo vio y reservó,
// se rechaza con `meal_plan_unavailable` (a diferencia de las amenidades, que se ignoran con
// warn: un régimen cambia el precio total de forma visible y el huésped lo eligió a propósito).
//
// "Solo alojamiento" (`room_only`) NO tiene fila en `meal_plans` — es la base implícita, sin
// costo, siempre disponible. Se representa como `line: null`.
import { round2 } from '../../../shared/utils/money'
import type { MealPlanCode, MealPlanPriceMode, PublicRateMealPlan } from '../types'

/**
 * Línea del snapshot que se persiste en `Reservations.mealPlan*`. Precio CONGELADO al reservar:
 * cambiar el catálogo después no altera lo que la reserva cobró.
 */
export interface MealPlanLine {
  code: string
  priceMode: MealPlanPriceMode
  /** Precio por persona por noche en `hotels.currency` (0 si `included`). */
  unitPrice: number
  persons: number
  nights: number
  total: number
}

/** Orden fijo de presentación — el mismo en admin, `/meal-plans` y widget. */
export const MEAL_PLAN_CODE_ORDER: Record<string, number> = { breakfast: 0, half_board: 1, all_inclusive: 2 }

/** Código reservado para "Solo alojamiento" — no existe en `meal_plans`, equivale a "sin régimen". */
export const ROOM_ONLY_CODE = 'room_only'

const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

/** Total del régimen para la estadía. `included` → 0 (ya está en la tarifa de la habitación). */
export function mealPlanTotal(
  priceMode: MealPlanPriceMode | string,
  price: number,
  persons: number,
  nights: number,
): number {
  if (priceMode !== 'per_person_per_night') return 0
  const unit = Math.max(0, Number(price) || 0)
  return round2(unit * Math.max(0, persons) * Math.max(0, nights))
}

/**
 * Resuelve el `mealPlan` del body contra el catálogo del hotel.
 *  - sin code / `room_only` → `{ ok: true, line: null }` (base implícita, sin cargo).
 *  - code activo del hotel → línea con precio releído del catálogo (NUNCA del body).
 *  - cualquier otra cosa (no existe, inactivo, de otro hotel) → `meal_plan_unavailable`.
 */
export function resolveMealPlanLine(
  catalog: any[],
  code: string | undefined | null,
  hotelId: string,
  persons: number,
  nights: number,
): { ok: true; line: MealPlanLine | null } | { ok: false; reason: 'meal_plan_unavailable' } {
  const wanted = typeof code === 'string' ? code.trim() : ''
  if (!wanted || wanted === ROOM_ONLY_CODE) return { ok: true, line: null }

  const found = (catalog ?? []).find((m) => m && m.code === wanted && m.hotelId === hotelId && isOn(m.active))
  if (!found) return { ok: false, reason: 'meal_plan_unavailable' }

  const priceMode: MealPlanPriceMode = found.priceMode === 'per_person_per_night' ? 'per_person_per_night' : 'included'
  const unitPrice = priceMode === 'per_person_per_night' ? round2(Math.max(0, Number(found.price) || 0)) : 0
  return {
    ok: true,
    line: {
      code: wanted,
      priceMode,
      unitPrice,
      persons,
      nights,
      total: mealPlanTotal(priceMode, unitPrice, persons, nights),
    },
  }
}

/**
 * Catálogo público para `GET /rates`: regímenes ACTIVOS del hotel, en `MEAL_PLAN_CODE_ORDER`,
 * con `perNight`/`totalForStay` ya resueltos para `persons × nights`. "Solo alojamiento" no va:
 * el widget lo antepone (igual que hace `/meal-plans`).
 *
 * Cada ítem ecoa `persons`/`nights` (para qué ocupación/estadía se calculó). El widget recalcula
 * por composición con la MISMA fórmula (`price × persons × nights`) cuando el huésped cambia
 * adultos/niños, y `POST /booking` la vuelve a aplicar server-side (`resolveMealPlanLine`).
 */
export function buildPublicMealPlans(
  catalog: any[],
  hotelId: string,
  persons: number,
  nights: number,
): PublicRateMealPlan[] {
  return (catalog ?? [])
    .filter((m) => m && m.hotelId === hotelId && isOn(m.active))
    .sort((a, b) => (MEAL_PLAN_CODE_ORDER[a.code] ?? 99) - (MEAL_PLAN_CODE_ORDER[b.code] ?? 99))
    .map((m) => {
      const priceMode: MealPlanPriceMode = m.priceMode === 'per_person_per_night' ? 'per_person_per_night' : 'included'
      const price = priceMode === 'per_person_per_night' ? round2(Math.max(0, Number(m.price) || 0)) : 0
      return {
        code: m.code as MealPlanCode,
        priceMode,
        price,
        persons: Math.max(0, persons),
        nights: Math.max(0, nights),
        perNight: priceMode === 'per_person_per_night' ? round2(price * Math.max(0, persons)) : 0,
        totalForStay: mealPlanTotal(priceMode, price, persons, nights),
      }
    })
}
