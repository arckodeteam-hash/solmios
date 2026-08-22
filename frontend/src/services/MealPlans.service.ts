import { http } from './http'

/** Régimen de alimentación (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes). Catálogo FIJO de
 *  3 códigos por hotel — a diferencia de `upsells`, no hay altas/bajas: el admin solo activa y
 *  fija precio de cada uno. "Solo alojamiento" es la base implícita, sin fila acá.
 *  API: `/api/meal-plans` (admin, auth) — el widget los lee vía
 *  `GET /api/public/hotels/:slug/meal-plans` (sin auth). */
export type MealPlanCode = 'breakfast' | 'half_board' | 'all_inclusive'
export type MealPlanPriceMode = 'included' | 'per_person_per_night'

export interface MealPlan {
  id: string
  hotelId: string
  code: MealPlanCode
  active: boolean
  priceMode: MealPlanPriceMode
  /** Precio por persona por noche, en la moneda del hotel. Solo aplica si priceMode='per_person_per_night'. */
  price: number
  createdAt: string
  updatedAt: string
}

export interface UpsertMealPlanInput {
  active?: boolean
  priceMode?: MealPlanPriceMode
  price?: number
}

const BASE = '/meal-plans'

export const MealPlansService = {
  async list(): Promise<MealPlan[]> {
    const res = await http.get<{ data: MealPlan[]; total: number }>(BASE)
    return res.data
  },

  upsert(code: MealPlanCode, input: UpsertMealPlanInput): Promise<MealPlan> {
    return http.put<MealPlan>(`${BASE}/${code}`, input)
  },
}
