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
// #360 — catálogo ABIERTO: "Solo alojamiento" (`room_only`) es una fila normal de `meal_plans`
// (included, 0) que el hotel edita/desactiva/borra. Si está activa, `resolveMealPlanLine` devuelve
// una línea como para cualquier otro code (con `name` snapshot, total 0). `line: null` queda solo
// para "sin régimen": body vacío, o `room_only` cuando el hotel NO tiene esa fila (compat con
// widgets/reservas anteriores al catálogo abierto).
//
// `booking_config.showMealPlans === false` → `visibleMealPlans` devuelve `[]` y todos los
// consumidores tratan el catálogo como vacío (`/meal-plans` y `/rates` listan `[]`, `/booking`
// rechaza cualquier code con `meal_plan_unavailable`).
import { round2 } from '../../../shared/utils/money'
import type { MealPlanCode, MealPlanPriceMode, PublicRateMealPlan } from '../types'
import { displayName } from './meal-plans-crud'

/**
 * Línea del snapshot que se persiste en `Reservations.mealPlan*`. Precio CONGELADO al reservar:
 * cambiar el catálogo después no altera lo que la reserva cobró.
 */
export interface MealPlanLine {
  code: string
  /** #360 — nombre visible al momento de reservar (snapshot: renombrar el régimen no lo cambia). */
  name: string
  priceMode: MealPlanPriceMode
  /** Precio por persona por noche en `hotels.currency` (0 si `included`). */
  unitPrice: number
  persons: number
  nights: number
  total: number
}

/**
 * Código de "Solo alojamiento". #360: es una fila más del catálogo; el valor sigue reservado
 * porque `reservations.mealPlan` lo usa como "sin régimen" cuando el hotel no tiene esa fila.
 */
export const ROOM_ONLY_CODE = 'room_only'

const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

/**
 * Orden de presentación del catálogo — el mismo en admin, `/meal-plans`, `/rates` y widget:
 * `sortOrder` ASC y luego `createdAt` ASC (#360). Estable: sin ambos campos conserva el orden de
 * llegada. No muta el array.
 */
export function sortMealPlans<T extends { sortOrder?: unknown; createdAt?: unknown }>(rows: T[]): T[] {
  return [...(rows ?? [])].sort((a, b) => {
    const so = (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
    if (so !== 0) return so
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
  })
}

/**
 * Catálogo tal como lo ve el motor público: `[]` cuando el hotel apagó
 * `booking_config.showMealPlans` (#360), el catálogo intacto en cualquier otro caso (sin fila de
 * config, o `showMealPlans` ausente/true → visible, default del toggle). Todos los consumidores
 * públicos (`/meal-plans`, `/rates`, `/booking`, `/booking-group`) pasan por acá para que el
 * toggle apague TODO de una vez.
 */
export function visibleMealPlans<T>(catalog: T[], bookingConfig: { showMealPlans?: unknown } | null | undefined): T[] {
  if (bookingConfig?.showMealPlans === false) return []
  return catalog ?? []
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
 * Resuelve el `mealPlan` del body contra el catálogo del hotel.
 *  - sin code → `{ ok: true, line: null }` (sin régimen, sin cargo).
 *  - code activo del hotel (INCLUIDO `room_only` si existe como fila) → línea con `name` y precio
 *    releídos del catálogo (NUNCA del body); `included` → total 0.
 *  - `room_only` sin fila en el catálogo → `{ ok: true, line: null }` (compat: widgets/reservas
 *    anteriores a #360 lo mandan como "sin régimen").
 *  - cualquier otra cosa (no existe, inactivo, de otro hotel, catálogo oculto) → `meal_plan_unavailable`.
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

  const priceMode: MealPlanPriceMode = found.priceMode === 'per_person_per_night' ? 'per_person_per_night' : 'included'
  const unitPrice = priceMode === 'per_person_per_night' ? round2(Math.max(0, Number(found.price) || 0)) : 0
  return {
    ok: true,
    line: {
      code: wanted,
      name: displayName(found),
      priceMode,
      unitPrice,
      persons,
      nights,
      total: mealPlanTotal(priceMode, unitPrice, persons, nights),
    },
  }
}

/**
 * Catálogo público para `GET /rates`: regímenes ACTIVOS del hotel, ordenados por
 * `sortOrder`/`createdAt` (`sortMealPlans`), con `name`/`description` y `perNight`/`totalForStay`
 * ya resueltos para `persons × nights`. #360: "Solo alojamiento" va como cualquier otra fila si
 * el hotel la tiene activa (el widget ya no antepone nada). El caller pasa el catálogo por
 * `visibleMealPlans` para respetar `showMealPlans`.
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
  return sortMealPlans((catalog ?? []).filter((m) => m && m.hotelId === hotelId && isOn(m.active)))
    .map((m) => {
      const priceMode: MealPlanPriceMode = m.priceMode === 'per_person_per_night' ? 'per_person_per_night' : 'included'
      const price = priceMode === 'per_person_per_night' ? round2(Math.max(0, Number(m.price) || 0)) : 0
      return {
        code: m.code as MealPlanCode,
        name: displayName(m),
        description: String(m.description ?? ''),
        priceMode,
        price,
        persons: Math.max(0, persons),
        nights: Math.max(0, nights),
        perNight: priceMode === 'per_person_per_night' ? round2(price * Math.max(0, persons)) : 0,
        totalForStay: mealPlanTotal(priceMode, price, persons, nights),
      }
    })
}
