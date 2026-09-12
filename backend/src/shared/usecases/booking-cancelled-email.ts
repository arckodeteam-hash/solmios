// shared/usecases/booking-cancelled-email.ts — Correos de "reserva cancelada" del motor público (#272).
//
// Cuando el huésped cancela desde la web salen DOS correos: uno al huésped (en su idioma) y otro
// al buzón del hotel (`hotels.email`, en español porque es el idioma del panel). La campanita y
// el push al staff ya salieron por `bookingengine-notificaciones`; acá va sólo el correo.
//
// Se relee la reserva por id y NO se confía en el evento: cuando este listener corre, el
// connector `bookingengine-refunds` ya persistió `refundStatus`/`refundAmount`, y la frase del
// reembolso (`refund_line`) tiene que reflejar lo que Stripe hizo de verdad — no prometer plata
// que no volvió a la tarjeta.
//
// Best-effort: cualquier fallo se loguea y se traga. La cancelación ya está asentada.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender } from '../../services/email-sender'
import type { NotificationLanguage } from '../../services/notification-defaults'
import { resolveGuestLanguage } from '../../services/guest-language'
import { reservationPanelLink } from './notify-reservation-received'

export interface BookingCancelledEmailDeps {
  emailSender: EmailSender
  reservationsRepo: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<any>
  logger: Logger
}

export interface BookingCancelledEmailEvent {
  /** Reserva líder (la del token público). */
  reservationId: string
  hotelId: string
  /** Todas las reservas del grupo (líder incluida). Sin grupo: una sola. */
  reservationIds?: string[]
}

function money(amount: unknown, currency: string): string {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n.toFixed(2)} ${currency}`
}

const NO_REFUND: Record<NotificationLanguage, string> = {
  es: 'Sin reembolso según la política de cancelación aplicada.',
  en: 'No refund under the applied cancellation policy.',
  pt: 'Sem reembolso segundo a política de cancelamento aplicada.',
}
const REFUND_DONE: Record<NotificationLanguage, (m: string) => string> = {
  es: m => `Reembolso de ${m} procesado: lo verás en tu tarjeta en 5-10 días hábiles.`,
  en: m => `Refund of ${m} processed: it will show on your card within 5-10 business days.`,
  pt: m => `Reembolso de ${m} processado: vai aparecer no seu cartão em 5-10 dias úteis.`,
}
const REFUND_PENDING: Record<NotificationLanguage, (m: string) => string> = {
  es: m => `Reembolso de ${m} pendiente: el hotel lo está gestionando.`,
  en: m => `Refund of ${m} pending: the hotel is handling it.`,
  pt: m => `Reembolso de ${m} pendente: o hotel está a tratar dele.`,
}

/** Frase del estado del reembolso según lo que quedó persistido en la reserva. */
export function refundLine(
  refundAmount: number,
  refundStatus: string,
  currency: string,
  language: NotificationLanguage,
): string {
  if (!(refundAmount > 0)) return NO_REFUND[language]
  const m = money(refundAmount, currency)
  if (refundStatus === 'done') return REFUND_DONE[language](m)
  // 'failed' | 'pending' | cualquier otro con plata a devolver: todavía no llegó a la tarjeta.
  return REFUND_PENDING[language](m)
}

/**
 * Encola el correo de cancelación al huésped y al buzón del hotel.
 * Cada uno sale sólo si hay a quién escribirle; ninguno tira.
 */
export async function sendBookingCancelledEmails(
  deps: BookingCancelledEmailDeps,
  event: BookingCancelledEmailEvent,
): Promise<{ guest: boolean; staff: boolean }> {
  const { emailSender, reservationsRepo, hotelRepo, guestRepo, logger } = deps
  const { reservationId } = event
  const result = { guest: false, staff: false }
  try {
    const reservation = await reservationsRepo.findById(reservationId)
    if (!reservation) return result
    // Tenancy: el evento tiene que ser del hotel dueño de la reserva (defensa IDOR).
    if (event.hotelId && reservation.hotelId !== event.hotelId) {
      logger.warn('booking-cancelled-email: hotelId del evento no coincide con la reserva', { reservationId })
      return result
    }

    const hotel = await hotelRepo.findById(reservation.hotelId)
    const guest = reservation.guestId ? await guestRepo.findById(reservation.guestId) : null
    if (guest?.hotelId && guest.hotelId !== reservation.hotelId) return result

    const language = resolveGuestLanguage(guest ?? {}) as NotificationLanguage
    const currency = String(reservation.currency || 'USD').toUpperCase()
    const refundAmount = Number(reservation.refundAmount ?? 0) || 0
    const refundStatus = String(reservation.refundStatus ?? 'none')
    const cancellationFee = Number(reservation.cancellationFee ?? 0) || 0
    const roomsCount = event.reservationIds?.length || 1

    const common = {
      guest_name: guest?.name || guest?.firstName || 'Huésped',
      hotel_name: hotel?.name ?? 'Hotel',
      hotel_phone: hotel?.phone ?? '',
      hotel_email: hotel?.email ?? '',
      locator: String(reservation.id ?? '').slice(0, 8),
      reservation_id: String(reservation.id ?? ''),
      checkin_date: String(reservation.checkIn ?? ''),
      checkout_date: String(reservation.checkOut ?? ''),
      rooms_count: roomsCount,
      total_amount: money(reservation.totalAmount, currency),
      cancellation_fee: cancellationFee,
      cancellation_fee_text: cancellationFee > 0 ? money(cancellationFee, currency) : `0.00 ${currency}`,
      refund_amount: refundAmount,
      refund_amount_text: refundAmount > 0 ? money(refundAmount, currency) : `0.00 ${currency}`,
      cancelled_at: String(reservation.cancelledAt ?? new Date().toISOString()).slice(0, 16).replace('T', ' '),
    }

    // 1) Huésped, en su idioma.
    const guestTo = String(guest?.email ?? '').trim()
    if (guestTo) {
      try {
        await emailSender.enqueueNotification({
          to: guestTo,
          hotelId: reservation.hotelId,
          event: 'reservation_cancelled_guest',
          language,
          variables: {
            ...common,
            refund_line: refundLine(refundAmount, refundStatus, currency, language),
            reservation_link: '',
          },
          relatedType: 'reservation',
          relatedId: reservationId,
        })
        result.guest = true
        logger.info('booking-cancelled-email (huésped) encolado', { to: guestTo, reservationId, language })
      } catch (e) {
        logger.warn('booking-cancelled-email (huésped) falló', { reservationId, error: (e as Error).message })
      }
    } else {
      logger.info('booking-cancelled-email: reserva sin email de huésped', { reservationId })
    }

    // 2) Buzón del hotel, siempre en español (idioma del panel). Si el reembolso falló, el staff
    //    tiene que saber que hay un botón para reintentarlo desde la reserva.
    const staffTo = String(hotel?.email ?? '').trim()
    if (staffTo) {
      const staffLine = refundLine(refundAmount, refundStatus, currency, 'es')
        + (refundAmount > 0 && refundStatus === 'failed' ? ' Reintentar desde la reserva.' : '')
      const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
      try {
        await emailSender.enqueueNotification({
          to: staffTo,
          hotelId: reservation.hotelId,
          event: 'reservation_cancelled_staff',
          language: 'es',
          variables: {
            ...common,
            refund_line: staffLine,
            reservation_link: `${base}${reservationPanelLink(String(reservation.id ?? ''))}`,
          },
          relatedType: 'reservation',
          relatedId: reservationId,
        })
        result.staff = true
        logger.info('booking-cancelled-email (hotel) encolado', { to: staffTo, reservationId })
      } catch (e) {
        logger.warn('booking-cancelled-email (hotel) falló', { reservationId, error: (e as Error).message })
      }
    }
    return result
  } catch (e) {
    logger.warn('booking-cancelled-email falló', { reservationId, error: (e as Error).message })
    return result
  }
}
