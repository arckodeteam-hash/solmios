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
}

// SaaS subscription plans — super-admin CRUD (/admin/plans)
export const PlansService = {
  list: () => http.get<{ data: Plan[] }>('/admin/plans'),
  create: (payload: PlanPayload) => http.post<{ success: boolean }>('/admin/plans', payload),
  update: (id: string, payload: PlanPayload) => http.put<{ success: boolean }>(`/admin/plans/${id}`, payload),
  remove: (id: string) => http.delete<{ success: boolean }>(`/admin/plans/${id}`),
}
