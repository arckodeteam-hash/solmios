// shared/usecases/pending-payment-expiry.ts — Vencimiento de reservas web sin pago (#248, REQ-RWP-05).
//
// Una reserva hecha desde el motor público queda `pending` bloqueando la habitación hasta que
// el huésped paga. Si nunca paga, nadie la soltaba: el cuarto quedaba invendible para siempre.
// Este usecase (puro, puertos inyectados, lo corre un cron) vence las que superaron el TTL del
// hotel (`booking_config.pendingPaymentTtlHours`; 0 = nunca) cancelándolas vía
// `reservas.cancelBySystem` en modo `no-charge` — que emite `onReservationCancelled` y con eso
// los connectors existentes liberan disponibilidad.
//
// Decisiones (no hay datos "ideales" en el esquema, se usan los que existen):
//   (i)  No existe `source:'web'` estable: una reserva web es la que tiene `accessToken` no nulo
//        (public-booking.ts lo genera al crearla) o `source === 'web'`. Las del panel no vencen.
//   (ii) No existe tabla `payment_attempts`: "intento de pasarela reciente" = cualquier fila de
//        `payments` de la reserva (cualquier status, incluso failed) tocada en los últimos 60 min.
//        Un huésped que está intentando pagar no debe perder la reserva a mitad del checkout.
//   (iii) Grupo entero o nada: si una hermana del `groupId` tiene pago/intento/link, ninguna vence.

import type { Logger } from 'arckode-framework'
import { auditSafely, type AuditPort } from './audit'

type Row = Record<string, any>
interface FindMany { findMany(q: Record<string, unknown>): Promise<any[]> }
interface FindById { findById(id: string): Promise<any | null> }

export interface PendingPaymentExpiryDeps {
  reservations: FindMany
  /** BookingConfig (booking_config): `pendingPaymentTtlHours` por hotelId. */
  bookingConfig: FindMany
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
}

export interface PendingPaymentExpiryResult {
  scanned: number
  expired: number
  skipped: number
  errors: Array<{ reservationId: string; reason: string }>
}

/** Mismo default que bookingengine/usecases/config.ts (no se importa: shared no depende de módulos). */
export const DEFAULT_PENDING_PAYMENT_TTL_HOURS = 24
export const RECENT_PAYMENT_ATTEMPT_MS = 60 * 60 * 1000
export const EXPIRED_EMAIL_SUBJECT = 'Su reserva venció por falta de pago'

const MS_PER_HOUR = 3_600_000
const LIVE_PAYMENT_STATUSES = new Set(['completed', 'pending', 'processing'])

const isWeb = (r: Row): boolean => Boolean(r.accessToken) || r.source === 'web'
const ms = (v: unknown): number => (v ? new Date(v as string).getTime() : NaN)

/** true si la reserva tiene un pago vivo, un intento reciente en la pasarela o un link pendiente. */
async function hasPaymentActivity(deps: PendingPaymentExpiryDeps, reservationId: string, nowMs: number): Promise<boolean> {
  const payments = (await deps.payments.findMany({ reservationId })) as Row[]
  for (const p of payments) {
    if (LIVE_PAYMENT_STATUSES.has(String(p.status))) return true
    const touched = Math.max(...[p.createdAt, p.updatedAt, p.processedAt].map(ms).filter(Number.isFinite), -Infinity)
    if (touched >= nowMs - RECENT_PAYMENT_ATTEMPT_MS) return true
  }
  const links = (await deps.paymentRequests.findMany({ reservationId, status: 'pending' })) as Row[]
  return links.length > 0
}

/** Elegible = pending + web + más vieja que el TTL + sin actividad de pago. */
async function isEligible(deps: PendingPaymentExpiryDeps, r: Row, ttlHours: number, nowMs: number): Promise<boolean> {
  if (r.status !== 'pending' || !isWeb(r)) return false
  const created = ms(r.createdAt)
  if (!Number.isFinite(created) || created >= nowMs - ttlHours * MS_PER_HOUR) return false
  return !(await hasPaymentActivity(deps, String(r.id), nowMs))
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
    if (sendFn) await sendFn.call(deps.email, String(guest.email), EXPIRED_EMAIL_SUBJECT, html)
  } catch (e) {
    deps.logger.warn('pending-payment-expiry: no se pudo enviar el correo de vencimiento', { id: r.id, error: String(e) })
  }
}

/** TTL efectivo del hotel (cache por corrida). 0 = el hotel no vence reservas. */
async function ttlFor(deps: PendingPaymentExpiryDeps, cache: Map<string, number>, hotelId: string): Promise<number> {
  if (cache.has(hotelId)) return cache.get(hotelId)!
  const cfg = ((await deps.bookingConfig.findMany({ hotelId })) as Row[])[0]
  const raw = cfg?.pendingPaymentTtlHours
  const ttl = raw === null || raw === undefined ? DEFAULT_PENDING_PAYMENT_TTL_HOURS : Number(raw)
  cache.set(hotelId, ttl)
  return ttl
}

export async function runPendingPaymentExpiry(
  deps: PendingPaymentExpiryDeps,
  now: Date = new Date(),
): Promise<PendingPaymentExpiryResult> {
  const result: PendingPaymentExpiryResult = { scanned: 0, expired: 0, skipped: 0, errors: [] }
  const nowMs = now.getTime()
  const ttlCache = new Map<string, number>()
  const seenGroups = new Set<string>()

  const candidates = ((await deps.reservations.findMany({ status: 'pending' })) as Row[]).filter(isWeb)

  for (const r of candidates) {
    if (!Number.isFinite(ms(r.createdAt))) { result.skipped++; continue }
    result.scanned++
    const id = String(r.id)
    try {
      const ttl = await ttlFor(deps, ttlCache, String(r.hotelId))
      if (ttl === 0 || !(await isEligible(deps, r, ttl, nowMs))) { result.skipped++; continue }

      // Grupo entero o nada: una hermana viva sin vencer (o con pago/intento/link) frena a todas.
      let batch: Row[] = [r]
      if (r.groupId) {
        if (seenGroups.has(String(r.groupId))) continue
        seenGroups.add(String(r.groupId))
        const siblings = ((await deps.reservations.findMany({ groupId: r.groupId })) as Row[]).filter((s) => s.status !== 'cancelled')
        const checks = await Promise.all(siblings.map((s) => isEligible(deps, s, ttl, nowMs)))
        if (checks.some((ok) => !ok)) { result.skipped++; continue }
        batch = siblings
      }

      for (const item of batch) {
        const itemId = String(item.id)
        const out = await deps.cancel(itemId, String(item.hotelId))
        if (!out.ok) { result.errors.push({ reservationId: itemId, reason: out.message ?? 'cancel failed' }); continue }
        if (out.idempotent) continue
        result.expired++
        await auditSafely(deps.audit, deps.logger, {
          hotelId: String(item.hotelId), action: 'reservation.expired_unpaid', entity: 'reservation', entityId: itemId,
          detail: `Vencida por falta de pago (TTL ${ttl} h)`,
        })
        await notifyGuest(deps, item)
      }
    } catch (e) {
      result.errors.push({ reservationId: id, reason: (e as Error)?.message ?? String(e) })
    }
  }

  deps.logger.info(`pending-payment-expiry: vencidas: ${result.expired}`, { ...result })
  return result
}
