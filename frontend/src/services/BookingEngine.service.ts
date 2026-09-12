// services/BookingEngine.service.ts — API client for booking engine
import { http } from './http'

export interface BookingConfig {
  id: string
  hotelId: string
  enabled: boolean
  theme: string
  position: string
  currency: string
  language: string
  minNights: number
  maxNights: number
  /** Minutos que tiene el huésped para completar el pago de una reserva web antes de que se cancele sola (15–1440). */
  pendingTtlMinutes: number
  /** #271 MR-06 — horas que tiene el hotel (con confirmación manual) para aprobar o rechazar una
   *  reserva pagada antes de que el cron le mande un recordatorio (1–168, default 24). */
  approvalDeadlineHours: number
  /** #262 REQ-HAC-07 — horas antes de la llegada a partir de las cuales el sistema asigna solo la
   *  habitación sugerida a una reserva sin unidad y manda el pase completo (0–168, 0 = apagado). */
  autoAssignBeforeArrivalHours: number
  cancellationPolicy: string
  showComparison: boolean
  googleAdsEnabled: boolean
  whatsappConfirmation: boolean
  instantConfirmation: boolean
  stripeAccountId: string
  allowedCountries: string[]
}

export interface FunnelStep {
  /** Nombre del step (view|search|select|upsell|form|pay|confirm). */
  step: string
  /** Etiqueta legible para el panel. */
  label: string
  /** Número de eventos de este step en el rango. */
  count: number
  /** % de conversión al siguiente step (0–100). null en el último step. */
  dropOff: number | null
}

export interface BookingAnalytics {
  totalSearches: number
  totalBookings: number
  conversionRate: number
  totalRevenue: number
  averageBookingValue: number
  /** F4 4.1 (D13) — Funnel de conversión desde tracking_events. */
  funnel: FunnelStep[]
}

export const BookingEngineService = {
  async getConfig(): Promise<BookingConfig> {
    return http.get('/booking-engine/config')
  },

  async updateConfig(config: Partial<BookingConfig>): Promise<BookingConfig> {
    return http.put('/booking-engine/config', config)
  },

  async getAnalytics(from?: string, to?: string): Promise<BookingAnalytics> {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return http.get(`/booking-engine/analytics?${params.toString()}`)
  },
}
