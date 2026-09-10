// utils/platform-billing-labels.ts — cómo se dice en español lo que la API devuelve en inglés.
//
// Vive fuera de `billing.vue` porque lo usan la tabla, el modal de detalle y el de recordatorio:
// tres lugares donde "failed" tiene que leerse igual. Son ETIQUETAS de un valor real que viene del
// backend (`status`, `method`, plantilla de correo), no datos inventados en la pantalla.
import type { PlatformInvoiceStatus, PlatformInvoiceMethod } from '@/services/PlatformBilling.service'

export const STATUS_LABEL: Record<PlatformInvoiceStatus, string> = {
  paid: 'Pagada',
  open: 'Pendiente',
  // En Stripe una factura cuyo cobro rebotó sigue `open`; el backend la marca así para que el
  // super-admin vea que hay algo que reclamar.
  failed: 'Cobro fallido',
  void: 'Anulada',
  uncollectible: 'Incobrable',
}

/** Fondo `color/10` + texto `color`, la regla de badges del design system. */
export const STATUS_BADGE: Record<PlatformInvoiceStatus, string> = {
  paid: 'bg-teal/10 text-teal',
  open: 'bg-gold/10 text-gold',
  failed: 'bg-danger/10 text-danger',
  void: 'bg-text-muted/10 text-text-muted',
  uncollectible: 'bg-text-muted/10 text-text-muted',
}

export const METHOD_LABEL: Record<PlatformInvoiceMethod, string> = {
  card: 'Tarjeta',
  manual: 'Manual',
}

/**
 * Qué correo sale al tocar "Recordar". El backend elige la plantilla por el estado y por si el
 * hotel tiene débito automático; acá solo se traduce para que el admin sepa QUÉ va a mandar
 * antes de mandarlo.
 */
export const TEMPLATE_LABEL: Record<string, string> = {
  payment_failed: 'Aviso de cobro rechazado',
  subscription_renewal_auto: 'Aviso de renovación automática',
  subscription_renewal_manual: 'Aviso de vencimiento (pago manual)',
}

/**
 * Estado de la SUSCRIPCIÓN del hotel (no de la factura). Mismas palabras que
 * `/admin/subscriptions`: el mismo hotel no puede figurar "past_due" en una pantalla y
 * "Pago pendiente" en la otra.
 */
export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trialing: 'En prueba', trial_expired: 'Prueba vencida', active: 'Activa', past_due: 'Pago pendiente',
  expired: 'Vencida', canceled: 'Cancelada', suspended: 'Suspendida', none: 'Sin suscripción',
}

export const subscriptionStatusLabel = (s: string): string => SUBSCRIPTION_STATUS_LABEL[s] ?? s

export const statusLabel = (s: string): string => STATUS_LABEL[s as PlatformInvoiceStatus] ?? s
export const statusBadge = (s: string): string => STATUS_BADGE[s as PlatformInvoiceStatus] ?? 'bg-surface text-text-muted'
export const methodLabel = (m: string): string => METHOD_LABEL[m as PlatformInvoiceMethod] ?? m
export const templateLabel = (t: string): string => TEMPLATE_LABEL[t] ?? t

/**
 * La plantilla que el backend va a elegir (`billing-actions.ts:reminderTemplateFor`). Se duplica
 * la regla —tres líneas— para poder anticiparla en el modal: la decisión REAL sigue siendo del
 * servidor, esto solo la anuncia.
 */
export function expectedTemplate(invoice: { status: string; isRecurring: boolean }): string {
  if (invoice.status === 'failed') return 'payment_failed'
  return invoice.isRecurring ? 'subscription_renewal_auto' : 'subscription_renewal_manual'
}

/** Identificador visible: el número de Stripe, o la referencia si es un pago manual. */
export function invoiceLabel(invoice: { number: string; method: string; reference: string; id: string }): string {
  if (invoice.number) return invoice.number
  if (invoice.method === 'manual' && invoice.reference) return `Manual · ${invoice.reference}`
  return invoice.id.slice(0, 8)
}

/** Fecha corta local. Devuelve '' (no '—') cuando no hay dato: los vacíos no se pintan. */
export function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-DO')
}

/** Monto con su moneda real — nunca un `$` fijo: la plataforma puede cobrar en USD o en DOP. */
export function money(amount: number, currency: string): string {
  return `${currency} ${Number(amount ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * `YYYY-MM-DD` de un `<input type="date">` → ISO para el backend.
 *
 * El día de HOY se manda como el instante actual, no como el mediodía: el backend rechaza una
 * fecha de pago futura (REQ-BIL-06) y en una zona al oeste de UTC el mediodía local todavía no
 * pasó en UTC — registrar un pago a las 11 de la mañana daba 400 "la fecha no puede ser futura".
 * Para cualquier otro día se usa el mediodía, que es la hora que no se corre a otro día al
 * convertir a UTC en ninguna zona horaria del continente.
 */
export function isoFromDayInput(day: string, now: Date = new Date()): string {
  if (!day) return ''
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (day === localToday) return now.toISOString()
  const d = new Date(`${day}T12:00:00`)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}
