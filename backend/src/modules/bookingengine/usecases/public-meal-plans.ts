// bookingengine/usecases/public-meal-plans.ts — GET /api/public/hotels/:slug/meal-plans
// (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes).
//
// Lista los regímenes ACTIVOS del hotel, sub-dominio de bookingengine. Público, sin auth,
// rate-limited. El widget lo consume en el paso de habitaciones (reemplaza el placeholder
// estático "Sólo alojamiento / Desayuno / Media pensión / Pensión completa").
//
// A diferencia de public-upsells.ts: "Solo alojamiento" NO tiene fila en `meal_plans` (es la
// base implícita, siempre disponible, sin costo) — se antepone acá a mano, no viene de la DB.
//
// Anti-enumeración: mismo 404 para "no existe" y "no activo" (igual que public-upsells.ts).
import type { RepositoryAdapter } from 'arckode-framework'
import type { MealPlanDTO, PublicMealPlan } from '../types'

export interface PublicMealPlansDeps {
  hotels: RepositoryAdapter<any>
  mealPlans: RepositoryAdapter<MealPlanDTO>
}

/** Orden fijo de presentación — el mismo en admin y widget. */
const CODE_ORDER: Record<string, number> = { breakfast: 0, half_board: 1, all_inclusive: 2 }

export async function getPublicMealPlans(
  deps: PublicMealPlansDeps,
  slug: string,
): Promise<{ status: number; body: any }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }

  const hotel = await deps.hotels.findOne({ slug })
  if (!hotel || hotel.onlineBookingStatus !== 'active') {
    return { status: 404, body: { error: 'Hotel not found' } }
  }

  const all = await deps.mealPlans.findMany({ hotelId: hotel.id })
  const items: PublicMealPlan[] = all
    .filter((m) => Boolean((m as any).active) === true)
    .sort((a, b) => (CODE_ORDER[a.code] ?? 99) - (CODE_ORDER[b.code] ?? 99))
    .map((m) => ({ code: m.code, priceMode: m.priceMode, price: Number(m.price ?? 0) }))

  return { status: 200, body: items }
}
