import { http } from './http'

/** Régimen de alimentación (issue #360). Catálogo ABIERTO por hotel: el admin crea, edita,
 *  activa/desactiva y borra regímenes desde Configuración → Regímenes. "Solo alojamiento" ya
 *  no es base implícita: es una fila más (el backend siembra 4 defaults la primera vez).
 *  `code` es el identificador estable (slug generado por el backend a partir del nombre) que
 *  keyea reservations.mealPlan, emails y widget.
 *  API: `/api/meal-plans` (admin, auth) — el widget los lee vía
 *  `GET /api/public/hotels/:slug/meal-plans` (sin auth). */
export type MealPlanPriceMode = 'included' | 'per_person_per_night'

export interface MealPlan {
  id: string
  hotelId: string
  code: string
  name: string
  description: string
  active: boolean
  priceMode: MealPlanPriceMode
  /** Precio por persona por noche, en la moneda del hotel. Solo aplica si priceMode='per_person_per_night'. */
  price: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateMealPlanInput {
  name: string
  description?: string
  priceMode?: MealPlanPriceMode
  price?: number
  active?: boolean
  sortOrder?: number
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
    return http.put<MealPlan>(`${BASE}/${id}`, input)
  },

  remove(id: string): Promise<void> {
    return http.delete<void>(`${BASE}/${id}`)
  },
}
