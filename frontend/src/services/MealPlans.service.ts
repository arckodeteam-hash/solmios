import { http } from './http'

/** Régimen de alimentación (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes → #361 catálogo
 *  abierto). Hasta #361 era un enum FIJO de 3 códigos con `upsert(code)`; ahora cada hotel
 *  administra su propio catálogo desde Configuración Base → Regímenes: altas, bajas, nombre,
 *  descripción, suplemento y activo. `code` es un slug del nombre que genera el backend al crear
 *  y NUNCA cambia (es la identidad que persisten las reservas), por eso no viaja en los inputs.
 *  API: `/api/meal-plans` (admin, auth) — el widget los lee vía
 *  `GET /api/public/hotels/:slug/meal-plans` (sin auth) sólo cuando el motor tiene encendido
 *  `showMealPlans` (Página pública → Motor de reservas). */
export type MealPlanCode = string
export type MealPlanPriceMode = 'included' | 'per_person_per_night'

export interface MealPlan {
  id: string
  hotelId: string
  /** Slug único por hotel, generado del nombre al crear. Sólo lectura. */
  code: MealPlanCode
  /** Nombre visible (1..80). */
  name: string
  /** Descripción opcional (≤300). */
  description: string | null
  active: boolean
  /** Derivado del precio por el backend si no se manda: price > 0 → 'per_person_per_night'. */
  priceMode: MealPlanPriceMode
  /** Suplemento por persona por noche, en la moneda del hotel. 0 = incluido en la tarifa. */
  price: number
  createdAt: string
  updatedAt: string
}

export interface CreateMealPlanInput {
  name: string
  description?: string | null
  /** ≥ 0. 0 (o ausente) = incluido en la tarifa. */
  price?: number
  active?: boolean
}

export type UpdateMealPlanInput = Partial<CreateMealPlanInput>

const BASE = '/meal-plans'

export const MealPlansService = {
  async list(): Promise<MealPlan[]> {
    const res = await http.get<{ data: MealPlan[]; total: number }>(BASE)
    return res.data
  },

  create(input: CreateMealPlanInput): Promise<MealPlan> {
    return http.post<MealPlan>(BASE, input)
  },

  update(id: string, input: UpdateMealPlanInput): Promise<MealPlan> {
    return http.put<MealPlan>(`${BASE}/${encodeURIComponent(id)}`, input)
  },

  remove(id: string): Promise<{ id: string; deleted: true }> {
    return http.delete<{ id: string; deleted: true }>(`${BASE}/${encodeURIComponent(id)}`)
  },
}
