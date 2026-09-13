// bookingengine/usecases/public-meal-plans.ts — GET /api/public/hotels/:slug/meal-plans
// (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes → #361 catálogo abierto + switch).
//
// Lista los regímenes VISIBLES del hotel, sub-dominio de bookingengine. Público, sin auth,
// rate-limited. El widget lo consume en el paso de habitaciones: opciones con `name` y
// `description` del catálogo (ya no hay etiquetas fijas por código).
//
// #361 — visibilidad = `booking_config.showMealPlans` (Página pública → Motor de reservas) +
// `active` por fila, en `LEGACY_ORDER` + `createdAt` (`visibleMealPlanCatalog`, el MISMO filtro
// que `/rates` y los POST). Switch apagado o hotel sin fila de config → `[]` (200): el widget
// no muestra la sección. "Solo alojamiento" es una fila `room_only` como cualquier otra: va si
// el hotel la tiene activa — ya no se antepone acá a mano.
//
// Anti-enumeración: mismo 404 para "no existe" y "no activo" (igual que public-upsells.ts).
import type { RepositoryAdapter } from 'arckode-framework'
import type { MealPlanDTO, PublicMealPlan } from '../types'
import { isEngineOpen, engineClosed } from '../../../shared/usecases/booking-engine-gate'
import { activeMealPlanCatalog, toPublicMealPlan, visibleMealPlanCatalog } from './public-meal-plan-lines'

export interface PublicMealPlansDeps {
  hotels: RepositoryAdapter<any>
  mealPlans: RepositoryAdapter<MealPlanDTO>
  /** #276 (MR-11) — toggle Activo/Inactivo del hotel (`booking_config.enabled`) y #361 —
   *  switch `showMealPlans`. Opcional (compat callers/tests viejos): sin repo cableado no hay
   *  switch que leer y se lista el catálogo activo, como antes de #361. */
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

  const rows = (await deps.mealPlans.findMany({ hotelId: hotel.id })) as any[]
  const visible = deps.bookingConfig ? visibleMealPlanCatalog(bookingConfig, rows) : activeMealPlanCatalog(rows)
  const items: PublicMealPlan[] = visible.map(toPublicMealPlan)

  return { status: 200, body: items }
}
