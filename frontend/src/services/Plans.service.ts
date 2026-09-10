import { http } from './http'

export interface PlanLimits {
  rooms: number
  users: number
  properties: number
}

export interface Plan {
  id: string
  name: string
  price: number
  currency: string
  description?: string
  features: string[]
  /** Matriz de módulos: claves padre (módulo completo) + sub-claves sueltas (parte del módulo). */
  modules?: string[]
  limits: PlanLimits
  /**
   * #71: elegible para la prueba gratuita. La DB guarda 1/0 (`plans.trialEligible`, default 1) y
   * el admin lo devuelve tal cual; ausente/NULL en filas viejas = elegible.
   */
  trialEligible?: number | boolean
}

export interface PlanPayload {
  name: string
  price: number
  currency: string
  description?: string
  features: string[]
  /** Matriz de módulos: claves padre (módulo completo) + sub-claves sueltas (parte del módulo). */
  modules?: string[]
  limits: PlanLimits
  /** #71: `false` = el plan no se puede probar gratis (el alta lo rechaza con 400). */
  trialEligible?: boolean
}

// SaaS subscription plans — super-admin CRUD (/admin/plans)
export const PlansService = {
  list: () => http.get<{ data: Plan[] }>('/admin/plans'),
  create: (payload: PlanPayload) => http.post<{ success: boolean }>('/admin/plans', payload),
  update: (id: string, payload: PlanPayload) => http.put<{ success: boolean }>(`/admin/plans/${id}`, payload),
  remove: (id: string) => http.delete<{ success: boolean }>(`/admin/plans/${id}`),
}
