// bookingengine/usecases/public-meal-plan-lines.ts — régimen (meal plan) cobrado por persona y
// noche desde el motor público (MR-03, #268 → #361 catálogo abierto + switch).
//
// Dos consumidores, UNA sola aritmética:
//   - `GET /rates` → `buildPublicMealPlans`: lista los regímenes visibles del hotel con el
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
// #361 — el catálogo es ABIERTO (filas con `name`/`description`, `code` slug inmutable) y el
// motor público sólo lo ve si `booking_config.showMealPlans` está encendido:
// `visibleMealPlanCatalog(bookingConfig, rows)` es el ÚNICO filtro (switch + `active` + orden)
// y lo aplican los tres usecases ANTES de llamar a lo de abajo. Con el switch apagado el
// catálogo visible es `[]`: `/meal-plans` y `/rates` no ofrecen nada y cualquier `mealPlan`
// del body distinto de vacío/`room_only` cae en `meal_plan_unavailable`.
//
// "Solo alojamiento" (`room_only`) ahora ES una fila real del catálogo (seed, editable, puede
// tener precio). Si está visible, manda como cualquier otra; si no hay fila visible (switch
// apagado, borrada, inactiva, reservas del panel, widgets viejos), `room_only`/vacío sigue
// siendo la base implícita sin costo: `line: null`.
import { round2 } from '../../../shared/utils/money'
import { LEGACY_ORDER } from './meal-plans-crud'
import type { MealPlanCode, MealPlanPriceMode, PublicMealPlan, PublicRateMealPlan } from '../types'

/**
 * Línea del snapshot que se persiste en `Reservations.mealPlan*`. Precio CONGELADO al reservar:
 * cambiar el catálogo después no altera lo que la reserva cobró.
 */
export interface MealPlanLine {
  code: string
  /** #361 — `name` de la fila del catálogo al reservar (trim; puede venir vacío en filas sin backfill). */
  name: string
  priceMode: MealPlanPriceMode
  /** Precio por persona por noche en `hotels.currency` (0 si `included`). */
  unitPrice: number
  persons: number
  nights: number
  total: number
}

/**
 * @deprecated #361 — el orden vive en `meal-plans-crud.ts:LEGACY_ORDER` (códigos históricos
 * primero, el resto por `createdAt`). Alias para quien todavía lo importe.
 */
export const MEAL_PLAN_CODE_ORDER: Record<string, number> = LEGACY_ORDER

/** Código reservado para "Solo alojamiento": sin fila visible equivale a "sin régimen" (`line: null`). */
export const ROOM_ONLY_CODE = 'room_only'

/** Booleans de sqlite/pg llegan como `true`/`1`/`'1'` según el driver. */
const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

/** Nombre visible de una fila (trim; `''` si no tiene). */
const nameOf = (m: any): string => (typeof m?.name === 'string' ? m.name.trim() : '')

/** Descripción de una fila (trim) o `null`. */
const descriptionOf = (m: any): string | null => {
  const d = typeof m?.description === 'string' ? m.description.trim() : ''
  return d || null
}

/** Orden de presentación: `LEGACY_ORDER` (room_only, breakfast, half_board, all_inclusive) y después `createdAt`. */
function sortCatalog(rows: any[]): any[] {
  return [...rows].sort((a, b) => {
    const oa = LEGACY_ORDER[a.code] ?? 99
    const ob = LEGACY_ORDER[b.code] ?? 99
    if (oa !== ob) return oa - ob
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  })
}

/** Filas ACTIVAS del catálogo, ordenadas. Sin mirar el switch (compat callers sin `bookingConfig`). */
export function activeMealPlanCatalog(rows: any[]): any[] {
  return sortCatalog((rows ?? []).filter((m) => m && isOn(m.active)))
}

/**
 * #361 — Catálogo VISIBLE en el motor público: `[]` si `booking_config.showMealPlans` no está
 * encendido (sin fila de config = apagado; se acepta `true`/`1`/`'1'`, mismo criterio que el
 * resto de los flags), si no las filas activas ordenadas por `LEGACY_ORDER` + `createdAt`.
 * Es lo ÚNICO que `/meal-plans`, `/rates` y los POST ven del catálogo.
 */
export function visibleMealPlanCatalog(bookingConfig: any, rows: any[]): any[] {
  if (!isOn(bookingConfig?.showMealPlans)) return []
  return activeMealPlanCatalog(rows)
}

/** Fila del catálogo → ítem público (`code`, `name`, `description`, `priceMode`, `price`). */
export function toPublicMealPlan(m: any): PublicMealPlan {
  const priceMode: MealPlanPriceMode = m.priceMode === 'per_person_per_night' ? 'per_person_per_night' : 'included'
  const price = priceMode === 'per_person_per_night' ? round2(Math.max(0, Number(m.price) || 0)) : 0
  return { code: m.code as MealPlanCode, name: nameOf(m), description: descriptionOf(m), priceMode, price }
}

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
 * Resuelve el `mealPlan` del body contra el catálogo VISIBLE del hotel (ya pasado por
 * `visibleMealPlanCatalog`).
 *  - sin code (body sin `mealPlan`: reservas del panel, widgets viejos) → `{ ok: true, line: null }`
 *    SIEMPRE: nadie eligió nada, no se cobra lo que no se mostró (aunque exista fila `room_only`
 *    con precio).
 *  - fila visible con ese code (INCLUIDO `room_only` explícito, que puede tener precio) → línea
 *    con precio releído del catálogo (NUNCA del body). La fila MANDA siempre que exista y esté
 *    activa.
 *  - `room_only` explícito sin fila visible → `{ ok: true, line: null }` (base implícita, sin
 *    cargo — switch apagado, fila borrada/inactiva).
 *  - cualquier otro code sin fila visible (no existe, inactivo, de otro hotel, switch apagado)
 *    → `meal_plan_unavailable`.
 */
export function resolveMealPlanLine(
  catalog: any[],
  code: string | undefined | null,
  hotelId: string,
  persons: number,
  nights: number,
): { ok: true; line: MealPlanLine | null } | { ok: false; reason: 'meal_plan_unavailable' } {
  const wanted = typeof code === 'string' ? code.trim() : ''
  if (!wanted) return { ok: true, line: null }

  const found = (catalog ?? []).find((m) => m && m.code === wanted && m.hotelId === hotelId && isOn(m.active))
  if (!found) {
    if (wanted === ROOM_ONLY_CODE) return { ok: true, line: null }
    return { ok: false, reason: 'meal_plan_unavailable' }
  }

  const { priceMode, price: unitPrice } = toPublicMealPlan(found)
  return {
    ok: true,
    line: {
      code: wanted,
      name: nameOf(found),
      priceMode,
      unitPrice,
      persons,
      nights,
      total: mealPlanTotal(priceMode, unitPrice, persons, nights),
    },
  }
}

/**
 * Catálogo público para `GET /rates`: regímenes del catálogo VISIBLE del hotel (pasar antes por
 * `visibleMealPlanCatalog`; acá se vuelve a filtrar por hotel/`active` por defensa), con
 * `name`/`description` y `perNight`/`totalForStay` ya resueltos para `persons × nights`.
 * "Solo alojamiento" va si el hotel tiene la fila `room_only` visible (#361) — el widget ya no
 * la antepone a mano.
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
  return activeMealPlanCatalog((catalog ?? []).filter((m) => m && m.hotelId === hotelId))
    .map((m) => {
      const item = toPublicMealPlan(m)
      return {
        ...item,
        persons: Math.max(0, persons),
        nights: Math.max(0, nights),
        perNight: item.priceMode === 'per_person_per_night' ? round2(item.price * Math.max(0, persons)) : 0,
        totalForStay: mealPlanTotal(item.priceMode, item.price, persons, nights),
      }
    })
}
