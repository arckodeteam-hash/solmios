import { http } from './http'

// Plantillas de email de la plataforma (super-admin) — 10 eventos fijos, sin alta ni baja.
// GET /admin/platform-emails devuelve las 10 filas; PUT solo edita subject/body/isActive.
// Espejo de backend/src/modules/platform-emails/types.ts — mantener sincronizado.
export type PlatformEmailEvent =
  | 'welcome'
  | 'trial_ending'
  | 'trial_expired'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'subscription_renewal_auto'
  | 'subscription_renewal_manual'
  | 'subscription_suspended'
  | 'subscription_reactivated'

/** Nombre legible (español) de cada evento — compartido por /admin/email-templates y la tarjeta de /admin/settings. */
export const PLATFORM_EMAIL_EVENT_LABELS: Record<PlatformEmailEvent, string> = {
  welcome: 'Bienvenida',
  trial_ending: 'Aviso: trial por vencer',
  trial_expired: 'Trial vencido',
  payment_succeeded: 'Pago exitoso',
  payment_failed: 'Pago fallido',
  subscription_canceled: 'Suscripción cancelada',
  subscription_renewal_auto: 'Renovación automática',
  subscription_renewal_manual: 'Renovación manual',
  subscription_suspended: 'Suscripción suspendida',
  subscription_reactivated: 'Suscripción reactivada',
}

/** Label del evento; si llega uno desconocido devuelve el código tal cual. */
export function eventLabel(event: PlatformEmailEvent | string): string {
  return PLATFORM_EMAIL_EVENT_LABELS[event as PlatformEmailEvent] || event
}

export interface PlatformEmailTemplate {
  id: string
  event: PlatformEmailEvent
  subject: string
  body: string
  /** El backend lo persiste como JSON string (columna TEXT) — parsear con parsePlatformEmailVariables(). */
  variables: string
  isActive: boolean
  updatedAt?: string
}

export interface PlatformEmailUpdate {
  subject?: string
  body?: string
  isActive?: boolean
}

export interface PlatformEmailTestResult {
  sent: boolean
}

/** `variables` viaja como JSON string; nunca asumir que ya llegó parseado. */
export function parsePlatformEmailVariables(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export const PlatformEmailsService = {
  list: () => http.get<PlatformEmailTemplate[]>('/admin/platform-emails'),
  get: (event: PlatformEmailEvent) => http.get<PlatformEmailTemplate>(`/admin/platform-emails/${event}`),
  update: (event: PlatformEmailEvent, patch: PlatformEmailUpdate) =>
    http.put<PlatformEmailTemplate>(`/admin/platform-emails/${event}`, patch),
  test: (event: PlatformEmailEvent, to: string) =>
    http.post<PlatformEmailTestResult>(`/admin/platform-emails/${event}/test`, { to }),
}
