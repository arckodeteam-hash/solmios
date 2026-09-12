// shared/usecases/pending-payment-expiry.ts — Vencimiento de reservas web sin pago (#248 REQ-RWP-05, #266 MR-01).
//
// Una reserva hecha desde el motor público queda `pending` bloqueando la habitación hasta que
// el huésped paga. Si nunca paga, nadie la soltaba: el cuarto quedaba invendible para siempre.
// Este usecase (puro, puertos inyectados) vence las que pasaron su fecha límite de pago
// (`reservations.paymentDeadlineAt`, que public-booking fija en createdAt + booking_config.
// pendingTtlMinutes) cancelándolas vía `reservas.cancelBySystem` en modo `no-charge` — que emite
// `onReservationCancelled` y con eso los connectors existentes liberan disponibilidad.
//
// Dos entradas al mismo cierre (#266):
//   - `runPendingPaymentExpiry`: barrido del cron (cada 5 min) sobre todas las `pending` web.
//   - `expirePendingReservation`: UNA reserva, para el webhook `checkout.session.expired` de
//     Stripe (bookingengine/usecases/stripe.ts). Misma evaluación, misma cascada, mismo audit.
//
// Criterio de elegibilidad (una reserva vence si TODO se cumple):
//   (i)   `status === 'pending'`.
//   (ii)  Es web: `accessToken` no nulo (public-booking.ts lo genera) o `source === 'web'`.
//         Las del panel no vencen.
//   (iii) `paymentDeadlineAt` presente, parseable y anterior a `now`. Una fila SIN deadline
//         (reservas anteriores a #266) no vence nunca: no se calcula desde createdAt.
//   (iv)  `deposit` en 0: si ya hay algo cobrado, es de recepción y no del cron.
//   (v)   Sin fila `payments` con status `completed`, ni pago vivo/intento reciente en la pasarela
//         (cualquier `payments` tocada en los últimos 60 min, incluso failed), ni link de pago
//         pendiente. Un huésped a mitad del checkout no pierde la reserva.
//   (vi)  Grupo entero o nada: si una hermana del `groupId` no es elegible, ninguna vence.

import type { Logger } from 'arckode-framework'
import { auditSafely, type AuditPort } from './audit'

type Row = Record<string, any>
interface FindMany { findMany(q: Record<string, unknown>): Promise<any[]> }
interface FindById { findById(id: string): Promise<any | null> }

export interface PendingPaymentExpiryDeps {
  reservations: FindMany
  payments: FindMany
  paymentRequests: FindMany
  guests: FindById
  /** Para el slug del link "reservar de nuevo". */
  hotels: FindById
  /** `reservas.cancelBySystem(id, {hotelId, reason:'payment_timeout', penaltyMode:'no-charge'})` — lo arma composition-root. */
  cancel: (reservationId: string, hotelId: string) => Promise<{ ok: boolean; idempotent?: boolean; message?: string }>
  audit: AuditPort | null
  email: {
    enqueue?(to: string, subject: string, html: string, opts?: Record<string, unknown>): Promise<{ sent: boolean }>
    send?(to: string, subject: string, html: string, opts?: Record<string, unknown>): Promise<{ sent: boolean }>
  } | null
  publicBaseUrl: string
  logger: Logger
  /** #266: empuja disponibilidad a las OTAs (Channex) por habitación liberada. Fire-and-forget. */
  pushAvailability?: (hotelId: string, roomId: string) => void
  /** #266: tabla `groups` — cuando vence el grupo entero, el grupo queda `cancelled` (best-effort). */
  groups?: { update(id: string, data: Record<string, unknown>): Promise<unknown> }
}

export interface PendingPaymentExpiryResult {
  scanned: number
  expired: number
  skipped: number
  errors: Array<{ reservationId: string; reason: string }>
}

export type ExpireReason =
  | 'not_found'
  | 'not_pending'
  | 'not_web'
  | 'no_deadline'
  | 'not_due'
  | 'has_deposit'
  | 'has_payment'
  | 'payment_activity'
  | 'group_not_due'
  | 'cancel_failed'
  | 'already_cancelled'

/** Resultado de `expirePendingReservation`. `expired` = al menos una reserva se cerró en esta llamada. */
export interface ExpirePendingOutcome {
  expired: boolean
  reason?: ExpireReason
  /** Reservas cerradas en esta llamada (más de una si era un grupo). */
  expiredCount: number
  /** Reservas evaluadas y dejadas intactas (todas las hermanas si el grupo no venció). */
  skippedCount: number
  errors: Array<{ reservationId: string; reason: string }>
}

export const RECENT_PAYMENT_ATTEMPT_MS = 60 * 60 * 1000
export const EXPIRED_EMAIL_SUBJECT = 'Su reserva venció por falta de pago'

const LIVE_PAYMENT_STATUSES = new Set(['completed', 'pending', 'processing'])

const isWeb = (r: Row): boolean => Boolean(r.accessToken) || r.source === 'web'
const ms = (v: unknown): number => (v ? new Date(v as string).getTime() : NaN)

/** Motivo por el que una reserva NO vence, mirando sólo la fila (sin consultar pagos). */
function rowBlocker(r: Row, nowMs: number): ExpireReason | null {
  if (r.status === 'cancelled') return 'already_cancelled'
  if (r.status !== 'pending') return 'not_pending'
  if (!isWeb(r)) return 'not_web'
  const deadline = ms(r.paymentDeadlineAt)
  if (!Number.isFinite(deadline)) return 'no_deadline'
  if (deadline >= nowMs) return 'not_due'
  if (Number(r.deposit || 0) !== 0) return 'has_deposit'
  return null
}

/** Motivo por el que los pagos de la reserva frenan el vencimiento (pago completed, intento reciente, link pendiente). */
async function paymentBlocker(deps: PendingPaymentExpiryDeps, reservationId: string, nowMs: number): Promise<ExpireReason | null> {
  const payments = (await deps.payments.findMany({ reservationId })) as Row[]
  for (const p of payments) {
    if (String(p.status) === 'completed') return 'has_payment'
    if (LIVE_PAYMENT_STATUSES.has(String(p.status))) return 'payment_activity'
    const touched = Math.max(...[p.createdAt, p.updatedAt, p.processedAt].map(ms).filter(Number.isFinite), -Infinity)
    if (touched >= nowMs - RECENT_PAYMENT_ATTEMPT_MS) return 'payment_activity'
  }
  const links = (await deps.paymentRequests.findMany({ reservationId, status: 'pending' })) as Row[]
  return links.length > 0 ? 'payment_activity' : null
}

/** Elegible = pending + web + deadline vencida + deposit 0 + sin pago/intento/link. */
async function blockerFor(deps: PendingPaymentExpiryDeps, r: Row, nowMs: number): Promise<ExpireReason | null> {
  return rowBlocker(r, nowMs) ?? (await paymentBlocker(deps, String(r.id), nowMs))
}

export function renderExpiredEmailHtml(link: string, hotelName: string): string {
  const safeLink = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const safeHotel = hotelName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return [
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"></head>',
    '<body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background:#f5f5f7; margin:0; padding:24px;">',
    '<div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; padding:32px 24px;">',
    `<h1 style="margin:0 0 12px; font-size:22px; color:#1d1d1f;">${safeHotel || 'Su reserva'}</h1>`,
    '<p style="margin:0 0 16px; color:#3a3a3c; line-height:1.5;">Su reserva venció por falta de pago; puede reservar de nuevo aquí:</p>',
    `<a href="${safeLink}" style="display:inline-block; background:#0a84ff; color:#ffffff; text-decoration:none; padding:14px 24px; border-radius:12px; font-weight:600;">Reservar de nuevo</a>`,
    '</div></body></html>',
  ].join('')
}

/** Best-effort: la reserva YA venció; un correo que falla se loguea y no rompe nada. */
async function notifyGuest(deps: PendingPaymentExpiryDeps, r: Row): Promise<void> {
  try {
    if (!deps.email || !r.guestId) return
    const guest = (await deps.guests.findById(String(r.guestId))) as Row | null
    if (!guest?.email) return
    const hotel = (await deps.hotels.findById(String(r.hotelId))) as Row | null
    const base = (deps.publicBaseUrl || '').replace(/\/$/, '')
    const link = `${base}/book/${hotel?.slug ?? ''}`
    const html = renderExpiredEmailHtml(link, String(hotel?.name ?? ''))
    const sendFn = deps.email.enqueue ?? deps.email.send
    // `hotelId` en opts: el EmailService real exige tenant para encolar (composition-root lo adapta).
    if (sendFn) await sendFn.call(deps.email, String(guest.email), EXPIRED_EMAIL_SUBJECT, html, { hotelId: String(r.hotelId), reservationId: String(r.id) })
  } catch (e) {
    deps.logger.warn('pending-payment-expiry: no se pudo enviar el correo de vencimiento', { id: r.id, error: String(e) })
  }
}

/** Best-effort: el grupo ya venció entero; si `groups` no está cableado o falla, sólo se loguea. */
async function markGroupCancelled(deps: PendingPaymentExpiryDeps, groupId: string): Promise<void> {
  if (!deps.groups) return
  try {
    await deps.groups.update(groupId, { status: 'cancelled' })
  } catch (e) {
    deps.logger.warn('pending-payment-expiry: no se pudo marcar el grupo como cancelled', { groupId, error: String(e) })
  }
}

const fmtDeadline = (v: unknown): string => {
  const t = ms(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : String(v)
}

/**
 * Evalúa y cierra UNA reserva pendiente (con su grupo, si tiene): cancel `no-charge`, audit
 * `reservation.expired_unpaid`, correo de vencimiento, `pushAvailability` por habitación y
 * `groups.status='cancelled'` cuando vence el grupo entero. Idempotente: una reserva que ya no
 * está `pending` devuelve `{ expired: false, reason }` sin tocar nada.
 *
 * Sin transacciones entre reservas: si una hermana falla (Stripe caído en releaseChargeSessions),
 * se corta el grupo acá y la próxima llamada lo completa — las ya cancelled no bloquean la
 * evaluación del grupo, así que converge a "grupo entero".
 */
export async function expirePendingReservation(
  deps: PendingPaymentExpiryDeps,
  reservationId: string,
  hotelId: string,
  now: Date = new Date(),
): Promise<ExpirePendingOutcome> {
  const nowMs = now.getTime()
  const out: ExpirePendingOutcome = { expired: false, expiredCount: 0, skippedCount: 0, errors: [] }

  const r = ((await deps.reservations.findMany({ id: reservationId, hotelId })) as Row[])[0]
  if (!r) return { ...out, reason: 'not_found' }

  // Grupo entero o nada: una hermana viva sin vencer (o con pago/intento/link) frena a todas.
  let batch: Row[]
  if (r.groupId) {
    const siblings = ((await deps.reservations.findMany({ groupId: r.groupId, hotelId: String(r.hotelId) })) as Row[]).filter((s) => s.status !== 'cancelled')
    if (siblings.length === 0) return { ...out, reason: 'already_cancelled' }
    const blockers = await Promise.all(siblings.map((s) => blockerFor(deps, s, nowMs)))
    const own = blockers[siblings.findIndex((s) => String(s.id) === String(r.id))] ?? null
    const first = blockers.find((b) => b !== null) ?? null
    if (first) return { ...out, skippedCount: siblings.length, reason: own ?? 'group_not_due' }
    batch = siblings
  } else {
    const blocker = await blockerFor(deps, r, nowMs)
    if (blocker) return { ...out, skippedCount: 1, reason: blocker }
    batch = [r]
  }

  let allClosed = true
  for (const item of batch) {
    const itemId = String(item.id)
    let res: Awaited<ReturnType<PendingPaymentExpiryDeps['cancel']>>
    try {
      res = await deps.cancel(itemId, String(item.hotelId))
    } catch (e) {
      res = { ok: false, message: (e as Error)?.message ?? String(e) }
    }
    if (!res.ok) {
      allClosed = false
      out.errors.push({ reservationId: itemId, reason: res.message ?? 'cancel failed' })
      if (batch.length > 1) {
        deps.logger.warn('pending-payment-expiry: grupo vencido a medias, se completa en la próxima corrida', { groupId: r.groupId, failed: itemId })
        break
      }
      continue
    }
    if (res.idempotent) continue
    out.expired = true
    out.expiredCount++
    await auditSafely(deps.audit, deps.logger, {
      hotelId: String(item.hotelId), action: 'reservation.expired_unpaid', entity: 'reservation', entityId: itemId,
      detail: `Vencida por falta de pago (plazo hasta ${fmtDeadline(item.paymentDeadlineAt)})`,
    })
    await notifyGuest(deps, item)
    if (item.roomId && deps.pushAvailability) {
      try { deps.pushAvailability(String(item.hotelId), String(item.roomId)) } catch (e) {
        deps.logger.warn('pending-payment-expiry: pushAvailability falló', { id: itemId, error: String(e) })
      }
    }
  }

  if (r.groupId && allClosed) await markGroupCancelled(deps, String(r.groupId))
  if (!out.expired && !out.reason) out.reason = out.errors.length > 0 ? 'cancel_failed' : 'already_cancelled'
  return out
}

/** Barrido del cron: evalúa todas las `pending` web y reutiliza `expirePendingReservation` por reserva/grupo. */
export async function runPendingPaymentExpiry(
  deps: PendingPaymentExpiryDeps,
  now: Date = new Date(),
): Promise<PendingPaymentExpiryResult> {
  const result: PendingPaymentExpiryResult = { scanned: 0, expired: 0, skipped: 0, errors: [] }
  const seenGroups = new Set<string>()

  const candidates = ((await deps.reservations.findMany({ status: 'pending' })) as Row[]).filter(isWeb)

  for (const r of candidates) {
    result.scanned++
    const id = String(r.id)
    try {
      // Un grupo se evalúa una sola vez (la primera hermana decide por todas y las contabiliza).
      if (r.groupId) {
        if (seenGroups.has(String(r.groupId))) continue
        seenGroups.add(String(r.groupId))
      }
      const out = await expirePendingReservation(deps, id, String(r.hotelId), now)
      result.expired += out.expiredCount
      result.skipped += out.skippedCount
      result.errors.push(...out.errors)
    } catch (e) {
      result.errors.push({ reservationId: id, reason: (e as Error)?.message ?? String(e) })
    }
  }

  deps.logger.info(`pending-payment-expiry: vencidas: ${result.expired}`, { ...result })
  return result
}
