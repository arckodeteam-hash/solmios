import { http } from './http'

// Plantillas de email de la plataforma (super-admin) — 6 eventos fijos, sin alta ni baja.
// GET /admin/platform-emails devuelve las 6 filas; PUT solo edita subject/body/isActive.
/** Espejo de `backend/src/modules/platform-emails/types.ts` — un evento nuevo se agrega en los dos. */
export const PLATFORM_EMAIL_EVENTS = [
  'welcome',
  'trial_ending',
  'trial_expired',
  'trial_extended',
  'payment_succeeded',
  'payment_failed',
  'subscription_canceled',
  'subscription_renewal_auto',
  'subscription_renewal_manual',
  'subscription_suspended',
  'subscription_reactivated',
] as const
export type PlatformEmailEvent = (typeof PLATFORM_EMAIL_EVENTS)[number]

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
