// bookingengine/usecases/public-meal-plans.ts — GET /api/public/hotels/:slug/meal-plans
// (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes; catálogo abierto #360).
//
// Lista los regímenes ACTIVOS del hotel, sub-dominio de bookingengine. Público, sin auth,
// rate-limited. El widget lo consume en el paso de habitaciones: las opciones del radio son
// exactamente estas filas (sin códigos hardcodeados).
//
// #360 — "Solo alojamiento" (`room_only`) ya NO es una base implícita que se anteponga a mano:
// es una fila normal de `meal_plans` (included, 0) que el hotel edita/desactiva/borra como
// cualquier otra. Si no hay ninguna fila activa, la lista va vacía y el widget no muestra
// selector. Cada ítem trae `name`/`description` (filas legacy sin `name` → `displayName`).
//
// Orden: `sortOrder` ASC y luego `createdAt` ASC (mismo criterio que el admin y `/rates`).
//
// `booking_config.showMealPlans === false` (toggle de Página pública → Motor de reservas) →
// 200 `[]`: el catálogo se trata como vacío, sin tocar el estado de las filas.
//
// Anti-enumeración: mismo 404 para "no existe" y "no activo" (igual que public-upsells.ts).
import type { RepositoryAdapter } from 'arckode-framework'
import type { MealPlanDTO, PublicMealPlan } from '../types'
import { isEngineOpen, engineClosed } from '../../../shared/usecases/booking-engine-gate'
import { displayName } from './meal-plans-crud'
import { sortMealPlans, visibleMealPlans } from './public-meal-plan-lines'

export interface PublicMealPlansDeps {
  hotels: RepositoryAdapter<any>
  mealPlans: RepositoryAdapter<MealPlanDTO>
  /**
   * #276 (MR-11) — toggle Activo/Inactivo del hotel (`booking_config.enabled`) y #360 —
   * `booking_config.showMealPlans`. Opcional (compat).
   */
  bookingConfig?: RepositoryAdapter<any>
}

export async function getPublicMealPlans(
  deps: PublicMealPlansDeps,
  slug: string,
): Promise<{ status: number; body: any }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }

  // #276 (MR-11) — un solo interruptor del motor público (`shared/usecases/booking-engine-gate.ts`):
  // `hotels.onlineBookingStatus` (plataforma) + `booking_config.enabled` (hotel), mismo 404.
  const hotel = await deps.hotels.findOne({ slug })
  const bookingConfig = hotel && deps.bookingConfig ? await deps.bookingConfig.findOne({ hotelId: hotel.id }) : null
  if (!isEngineOpen(hotel, bookingConfig)) return engineClosed()

  const all = visibleMealPlans(await deps.mealPlans.findMany({ hotelId: hotel.id }), bookingConfig)
  const items: PublicMealPlan[] = sortMealPlans(all.filter((m) => Boolean((m as any).active) === true))
    .map((m) => ({
      code: m.code,
      name: displayName(m),
      description: String((m as any).description ?? ''),
      priceMode: m.priceMode,
      price: Number(m.price ?? 0),
    }))

  return { status: 200, body: items }
}
