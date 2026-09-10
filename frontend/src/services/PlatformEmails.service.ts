import { http } from './http'

// Plantillas de email de la plataforma (super-admin) — eventos fijos, sin alta ni baja.
// GET /admin/platform-emails devuelve una fila por evento; PUT solo edita subject/body/isActive.
/** Espejo de `backend/src/modules/platform-emails/types.ts` — un evento nuevo se agrega en los dos. */
export const PLATFORM_EMAIL_EVENTS = [
  'welcome',
  'trial_ending',
  'trial_expired',
  'trial_extended',
  'activation_no_rooms',
  'activation_no_rates',
  'activation_no_channel',
  'trial_offer',
  'trial_rescue_1',
  'trial_rescue_2',
  'payment_succeeded',
  'payment_failed',
  'subscription_canceled',
  'subscription_renewal_auto',
  'subscription_renewal_manual',
  'subscription_suspended',
  'subscription_reactivated',
  // Pedido de conexión de OTA (REQ-CAN-07): el hotel recibe estos tres.
  'channel_request_scheduled',
  'channel_request_connected',
  'channel_request_rejected',
] as const
export type PlatformEmailEvent = (typeof PLATFORM_EMAIL_EVENTS)[number]

export const PLATFORM_EMAIL_EVENT_LABELS: Record<PlatformEmailEvent, string> = {
  welcome: 'Bienvenida',
  trial_ending: 'Aviso: trial por vencer',
  trial_expired: 'Trial vencido',
  trial_extended: 'Trial extendido',
  activation_no_rooms: 'Activación: sin habitaciones',
  activation_no_rates: 'Activación: sin tarifas',
  activation_no_channel: 'Activación: sin canales',
  trial_offer: 'Oferta: trial por vencer',
  trial_rescue_1: 'Rescate 1: trial vencido (+2 d)',
  trial_rescue_2: 'Rescate 2: trial vencido (+7 d)',
  payment_succeeded: 'Pago exitoso',
  payment_failed: 'Pago fallido',
  subscription_canceled: 'Suscripción cancelada',
  subscription_renewal_auto: 'Aviso: renovación automática',
  subscription_renewal_manual: 'Aviso: renovación manual',
  subscription_suspended: 'Suscripción suspendida',
  subscription_reactivated: 'Suscripción reactivada',
  channel_request_scheduled: 'Conexión de OTA: cita agendada',
  channel_request_connected: 'Conexión de OTA: canal conectado',
  channel_request_rejected: 'Conexión de OTA: pedido rechazado',
}

export function platformEmailEventLabel(event: PlatformEmailEvent | string): string {
  return PLATFORM_EMAIL_EVENT_LABELS[event as PlatformEmailEvent] || event
}

/**
 * Variables que TODA plantilla tiene disponibles (las agrega el backend a `variables`). Salen de
 * Configuración → Plataforma: nombre, email y teléfono de soporte.
 */
export const PLATFORM_EMAIL_GLOBAL_VARIABLES: Array<{ name: string; description: string }> = [
  { name: 'platform_name', description: 'Nombre de la plataforma' },
  { name: 'support_email', description: 'Email de soporte' },
  { name: 'support_phone', description: 'Teléfono de soporte' },
]

/** Ordena por PLATFORM_EMAIL_EVENTS; los eventos desconocidos van al final, en el orden recibido. */
export function sortPlatformEmailTemplates<T extends { event: string }>(templates: T[]): T[] {
  const byEvent = new Map(templates.map(t => [t.event, t]))
  const known = PLATFORM_EMAIL_EVENTS.map(ev => byEvent.get(ev)).filter((t): t is T => !!t)
  const rest = templates.filter(t => !(PLATFORM_EMAIL_EVENTS as readonly string[]).includes(t.event))
  return [...known, ...rest]
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
