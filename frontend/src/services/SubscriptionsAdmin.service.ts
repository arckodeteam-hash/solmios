import { http } from './http'

// "Condiciones especiales" del Super Admin (PLAN-SUSCRIPCIONES.md). Todo bajo
// /api/admin/subscriptions/*, solo super_admin. http.ts ya desenvuelve el `data` del
// envelope del framework — estos métodos devuelven el objeto plano tal cual lo manda el
// backend, salvo listCategories que sí es lista paginada real ({data, total}).

export type SpecialCategoryKey = 'founder_one' | 'founder_two' | 'pioneer'

export interface SpecialCategoryConfig {
  id: string
  key: SpecialCategoryKey
  totalSlots: number
  occupiedCount: number
  discountPct: number
  minPlanSortOrder: number | null
  sequenceGroup: string | null
  opensAfter: string | null
  status: 'closed' | 'open' | 'full'
}

export interface SubscriptionSearchResult {
  hotelId: string
  hotelName: string
  planId: string | null
  planSortOrder: number | null
  status: string
  specialCategory: SpecialCategoryKey | null
}

export interface SubscriptionDiscount {
  id: string
  hotelId: string
  subscriptionId: string
  type: 'percentage' | 'free_month' | 'category_bonus'
  discountPct: number
  startAt: string | null
  endsAt: string | null
  appliedByUserId: string | null
  reason: string | null
  status: 'active' | 'expired' | 'revoked'
}

export interface SubscriptionDetail {
  subscription: Record<string, unknown>
  plan: Record<string, unknown> | null
  discounts: SubscriptionDiscount[]
  founderHistory: Array<{ id: string; hotelId: string; category: string; lostAt: string; reason: string }>
}

export interface ApplySpecialConditionsPayload {
  type: 'category' | 'percentage' | 'free_month'
  category?: SpecialCategoryKey | null
  discountPct?: number
  durationMonths?: number | null
  reason?: string
}

export interface SubscriptionSettings {
  reminderDaysBefore: number
  gracePeriodDays: number
  founderChurnBlocksReturn: boolean
  maxManualDiscountPct: number
  /** #28 — el alta pide tarjeta antes de arrancar la prueba y cobra sola al vencer. */
  requireCardOnTrial: boolean
  /** Contador de la landing /hotel-fundador — apagarlo oculta la cuenta regresiva sin deploy. */
  founderCountdownEnabled: boolean
  /** Duración de cada ciclo del contador, en días (90 ≈ 3 meses). Al llegar a 0 arranca otro ciclo solo. */
  founderCountdownDurationDays: number
}

export const SubscriptionsAdminService = {
  search: (email: string) =>
    http.get<SubscriptionSearchResult>(`/admin/subscriptions/search?email=${encodeURIComponent(email)}`),
  detail: (hotelId: string) => http.get<SubscriptionDetail>(`/admin/subscriptions/${hotelId}`),
  applySpecialConditions: (hotelId: string, payload: ApplySpecialConditionsPayload) =>
    http.post<Record<string, unknown>>(`/admin/subscriptions/${hotelId}/special-conditions`, payload),
  suspend: (hotelId: string) => http.post<Record<string, unknown>>(`/admin/subscriptions/${hotelId}/suspend`),
  reactivate: (hotelId: string) => http.post<Record<string, unknown>>(`/admin/subscriptions/${hotelId}/reactivate`),
  listCategories: () => http.get<{ data: SpecialCategoryConfig[]; total: number }>('/admin/subscriptions/categories'),
  updateCategory: (key: SpecialCategoryKey, patch: Partial<SpecialCategoryConfig>) =>
    http.put<SpecialCategoryConfig>(`/admin/subscriptions/categories/${key}`, patch),
  getSettings: () => http.get<SubscriptionSettings>('/admin/subscriptions/settings'),
  updateSettings: (patch: Partial<SubscriptionSettings>) =>
    http.put<SubscriptionSettings>('/admin/subscriptions/settings', patch),
}
