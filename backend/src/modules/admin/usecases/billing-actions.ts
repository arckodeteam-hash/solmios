// admin/usecases/billing-actions.ts — las dos acciones de /admin/billing (REQ-BIL-05, REQ-BIL-06).
//
// Hasta ahora las dos eran una mentira de la pantalla: "Recordar" cerraba el modal y mostraba un
// toast sin mandar nada, y "Pagado" cambiaba el estado en el array del navegador — al recargar
// volvía a estar impago y el hotel seguía suspendido. Acá pasan de verdad:
//
//   - Recordar manda el correo de plataforma que corresponde al ESTADO de la factura, y no deja
//     mandar dos en 24 h. Un cobro que falló genera un reintento automático de Stripe: si cada
//     clic manda un correo, el hotel recibe cinco avisos del mismo cobro en una tarde.
//   - Registrar pago manual escribe la fila `manual`/`paid` Y reactiva la suscripción. Sin lo
//     segundo el hotel pagó y sigue sin poder entrar, que es exactamente el problema que este
//     botón vino a resolver.
//
// Las dos dejan entrada en el audit log: mandan un correo a un cliente y mueven plata.
import { ValidationError, ConflictError, NotFoundError } from 'arckode-framework'
import { auditSafely, type AuditPort } from './audit'
import { round2 } from '../../../shared/utils/money'
import {
  getPlatformInvoice, type PlatformBillingDeps, type PlatformInvoiceDetailDTO,
} from './billing'

const MS_PER_DAY = 86_400_000
/** Una factura recordada hace menos de esto no se vuelve a recordar (REQ-BIL-05). */
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** Estados desde los que tiene sentido reclamar. `paid`/`void`/`uncollectible` ya no se reclaman. */
const CLAIMABLE = new Set(['open', 'failed'])

export type PlatformEmailSender =
  (event: string, to: string, hotelId: string, vars: Record<string, string>) => Promise<{ sent: boolean }>

/** Puerto al módulo `subscriptions` — lo inyecta el connector `admin-subscriptions-billing`. */
export interface BillingSubscriptionPort {
  activateAfterManualPayment(hotelId: string, periodEnd: string): Promise<{ activated: boolean; previousStatus?: string }>
}

export interface BillingActionDeps extends PlatformBillingDeps {
  auditPort?: AuditPort | null
  sendPlatformEmail?: PlatformEmailSender
  subscriptions?: BillingSubscriptionPort
}

export type Actor = { id?: string; name?: string } | undefined

/** El framework no tiene un error de 503; el controller mapea este nombre. */
export class ServiceUnavailableError extends Error {
  override readonly name = 'ServiceUnavailableError'
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

/** Hora local corta (HH:MM) para el mensaje del 409 — es lo que la UI le muestra al admin. */
const hhmm = (iso: string): string => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function assertIso(value: string, field: string): string {
  const d = new Date(value)
  if (!value || isNaN(d.getTime())) throw new ValidationError(`${field} no es una fecha válida (ISO)`)
  return d.toISOString()
}

/** Link a la suscripción del hotel — el mismo que usa el webhook (`handle-stripe-event.ts`). */
function subscriptionLink(): string {
  return `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/panel/suscripcion`
}

/**
 * Qué plantilla sale, según el estado y si el hotel tiene tarjeta:
 *   failed                  → `payment_failed` ("el cobro no salió")
 *   open + isRecurring      → `subscription_renewal_auto` ("se va a cobrar solo")
 *   open + !isRecurring     → `subscription_renewal_manual` ("tenés que pagar vos")
 *
 * Mandarle "se cobrará automáticamente" a un hotel sin tarjeta es peor que no mandar nada: se
 * queda esperando un cobro que no existe y el servicio se le corta igual.
 */
export function reminderTemplateFor(invoice: { status: string; isRecurring: boolean }): string {
  if (invoice.status === 'failed') return 'payment_failed'
  return invoice.isRecurring ? 'subscription_renewal_auto' : 'subscription_renewal_manual'
}

/** Días que faltan para el vencimiento (0 si ya venció). Es la variable `{days_left}` de las plantillas. */
function daysLeft(invoice: PlatformInvoiceDetailDTO, now: Date): number {
  const target = invoice.dueAt || invoice.currentPeriodEnd || invoice.periodEnd
  if (!target) return 0
  const diff = new Date(target).getTime() - now.getTime()
  return isNaN(diff) ? 0 : Math.max(0, Math.ceil(diff / MS_PER_DAY))
}

export interface RemindResult {
  sent: true
  template: string
  to: string
  sentAt: string
}

/**
 * Manda el recordatorio de UNA factura. Lanza (y el controller traduce):
 *   409 si la factura ya no se reclama, o si se recordó hace menos de 24 h (con la hora);
 *   400 si el hotel no tiene correo o la plantilla está desactivada;
 *   503 si el envío de correos no está cableado — nunca un 200 que no mandó nada.
 */
export async function remindInvoice(
  deps: BillingActionDeps, invoiceId: string, actor: Actor, now: Date = new Date(),
): Promise<RemindResult> {
  const invoice = await getPlatformInvoice(deps, invoiceId, now)

  if (!CLAIMABLE.has(invoice.status)) {
    throw new ConflictError(`No se puede recordar una factura ${invoice.status === 'paid' ? 'ya pagada' : 'que no está pendiente'}`)
  }
  if (invoice.lastReminderAt) {
    const elapsed = now.getTime() - new Date(invoice.lastReminderAt).getTime()
    if (elapsed >= 0 && elapsed < REMINDER_COOLDOWN_MS) {
      throw new ConflictError(`Ya se envió un recordatorio hoy a las ${hhmm(invoice.lastReminderAt)}`)
    }
  }
  if (!invoice.hotelEmail) throw new ValidationError('El hotel no tiene correo cargado: no hay a quién avisarle')
  if (!deps.sendPlatformEmail) throw new ServiceUnavailableError('El envío de correos de plataforma no está configurado')

  const template = reminderTemplateFor(invoice)
  const { sent } = await deps.sendPlatformEmail(template, invoice.hotelEmail, invoice.hotelId, {
    hotel_name: invoice.hotelName,
    plan_name: invoice.planName,
    amount: `${invoice.currency} ${round2(invoice.amountDue)}`,
    days_left: String(daysLeft(invoice, now)),
    link: subscriptionLink(),
  })
  // `sent:false` = la plantilla no existe o está desactivada. No se marca `lastReminderAt`: si se
  // marcara, el admin quedaría bloqueado 24 h por un correo que nunca salió.
  if (!sent) throw new ValidationError(`No se pudo enviar: la plantilla "${template}" no existe o está desactivada`)

  const sentAt = now.toISOString()
  await deps.invoicesRepo.update(invoice.id, { lastReminderAt: sentAt })
  await auditSafely(deps.auditPort ?? null, deps.logger, {
    hotelId: invoice.hotelId,
    userId: actor?.id,
    action: 'platform_invoice.remind',
    entity: 'platform_invoice',
    entityId: invoice.id,
    detail: `Recordatorio "${template}" enviado a ${invoice.hotelEmail} por ${invoice.currency} ${invoice.amountDue}`,
  })

  return { sent: true, template, to: invoice.hotelEmail, sentAt }
}

export interface ManualPaymentInput {
  hotelId: string
  /** Si viene, se marca PAGADA esa factura en vez de crear otra (REQ-BIL-06). */
  invoiceId?: string
  amount: number
  currency: string
  paidAt: string
  reference: string
  periodEnd: string
  notes?: string
}

export interface ManualPaymentResult {
  invoice: PlatformInvoiceDetailDTO
  subscriptionActivated: boolean
  /** Texto para la UI cuando el cobro quedó registrado pero la suscripción NO se pudo activar. */
  warning?: string
}

/**
 * Registra un pago hecho fuera de Stripe (transferencia, efectivo) y reactiva la suscripción.
 *
 * Orden a propósito: PRIMERO la fila del cobro, DESPUÉS la activación. La plata entró — ese hecho
 * se guarda sí o sí. Si la activación falla, el pago igual quedó registrado y el admin lo ve en el
 * aviso que devuelve esta función (y puede reactivar desde /admin/subscriptions); al revés
 * tendríamos una suscripción activa que nadie puede explicar con un comprobante.
 */
export async function registerManualPayment(
  deps: BillingActionDeps, input: ManualPaymentInput, actor: Actor, now: Date = new Date(),
): Promise<ManualPaymentResult> {
  const amount = round2(Number(input.amount))
  if (!(amount > 0)) throw new ValidationError('El monto tiene que ser mayor que cero')
  const reference = str(input.reference).trim()
  if (!reference) throw new ValidationError('La referencia del pago es obligatoria')

  const paidAt = assertIso(str(input.paidAt), 'La fecha de pago')
  if (new Date(paidAt).getTime() > now.getTime()) throw new ValidationError('La fecha de pago no puede ser futura')
  const periodEnd = assertIso(str(input.periodEnd), 'El fin del período')

  const hotelId = str(input.hotelId)
  // @ignore IDOR_RISK — ruta de super_admin de plataforma: el hotel es el ELEGIDO por el admin,
  // no el del token (el super-admin no tiene hotel propio).
  const hotel = await deps.hotelsRepo.findById(hotelId)
  if (!hotel) throw new NotFoundError('El hotel no existe')

  const currency = (str(input.currency) || 'USD').toUpperCase()
  const notes = str(input.notes)
  const paid = {
    status: 'paid', method: 'manual', currency,
    amountPaid: amount, paidAt, reference,
    recordedByUserId: actor?.id ?? '', ...(notes ? { notes } : {}),
  }

  let invoiceId = str(input.invoiceId)
  if (invoiceId) {
    // @ignore IDOR_RISK — misma ruta de plataforma; igual se verifica abajo que la factura sea
    // del hotel elegido, para no cerrar la de otro por un id copiado mal.
    const existing = await deps.invoicesRepo.findById(invoiceId)
    if (!existing) throw new NotFoundError('Factura no encontrada')
    if (str((existing as any).hotelId) !== hotelId) throw new ValidationError('La factura no es de ese hotel')
    if (!CLAIMABLE.has(str((existing as any).status))) throw new ConflictError('Esa factura ya no está pendiente')
    // `amountDue` NO se toca: el pago puede ser parcial o de más, y lo facturado es lo facturado.
    await deps.invoicesRepo.update(invoiceId, paid)
  } else {
    invoiceId = crypto.randomUUID()
    await deps.invoicesRepo.create({
      id: invoiceId, hotelId, amountDue: amount,
      issuedAt: paidAt, periodEnd,
      // Sin `stripeInvoiceId`: NULL, nunca '' — varios NULL conviven bajo el UNIQUE INDEX, varios '' no.
      ...paid,
    })
  }

  let subscriptionActivated = false
  let warning: string | undefined
  if (!deps.subscriptions) {
    warning = 'El pago quedó registrado, pero la suscripción no se pudo activar (módulo de suscripciones no cableado).'
  } else {
    try {
      const res = await deps.subscriptions.activateAfterManualPayment(hotelId, periodEnd)
      subscriptionActivated = res.activated
      if (!res.activated) warning = 'El pago quedó registrado, pero el hotel no tiene una suscripción que activar.'
    } catch (e) {
      deps.logger.error('Pago manual registrado pero la suscripción no se pudo activar', { hotelId, error: String(e) })
      warning = 'El pago quedó registrado, pero la suscripción no se pudo activar. Reactivala desde Suscripciones.'
    }
  }

  await auditSafely(deps.auditPort ?? null, deps.logger, {
    hotelId,
    userId: actor?.id,
    action: 'platform_invoice.manual_payment',
    entity: 'platform_invoice',
    entityId: invoiceId,
    detail: `Pago manual de ${currency} ${amount} (ref. ${reference}) — período hasta ${periodEnd.slice(0, 10)}${subscriptionActivated ? '' : ' · suscripción NO activada'}`,
  })

  return { invoice: await getPlatformInvoice(deps, invoiceId, now), subscriptionActivated, ...(warning ? { warning } : {}) }
}
