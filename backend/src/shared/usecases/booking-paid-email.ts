// shared/usecases/booking-paid-email.ts — Correo "pago confirmado" del motor de reservas.
//
// Por qué existe (pedido del cliente, 2026-08-29): al pagar por el widget público el huésped
// SOLO recibía el correo del pase con el número de habitación y el código de la puerta. Dos
// problemas: (1) nunca se le confirmaba el PAGO, y (2) la habitación puede reasignarse hasta
// el día antes de la llegada, así que mandar el número al momento de reservar es prometer algo
// que el hotel todavía no puede sostener.
//
// Ahora al pagar va este correo — plata, fechas CON hora, política y datos del hotel, SIN
// habitación ni código — y el pase con el código lo manda `prearrival-pass-cron.ts` 24 h antes
// de la llegada, cuando la habitación ya está firme.
//
// Best-effort: cualquier fallo se loguea y se traga. El cobro ya está asentado; no se revierte
// una reserva pagada porque el correo no salió.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender } from '../../services/email-sender'
import type { NotificationLanguage } from '../../services/notification-defaults'
import { resolveGuestLanguage } from '../../services/guest-language'
import { cancellationPolicyText } from './cancellation-text'
import { hotelCancellationTypeOf } from './cancellation-math'
import { effectiveCheckInTime, effectiveCheckOutTime } from '../utils/hotel-schedule'

export interface BookingPaidEmailDeps {
  emailSender: EmailSender
  reservationsRepo: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<any>
  logger: Logger
}

const PAYMENT_LABELS: Record<string, Record<NotificationLanguage, string>> = {
  card: { es: 'Tarjeta', en: 'Card', pt: 'Cartão' },
  link: { es: 'Link de pago', en: 'Payment link', pt: 'Link de pagamento' },
  cash: { es: 'Efectivo', en: 'Cash', pt: 'Dinheiro' },
  transfer: { es: 'Transferencia', en: 'Bank transfer', pt: 'Transferência' },
}

function money(amount: unknown, currency: string): string {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n.toFixed(2)} ${currency}`
}

/**
 * Encola el correo de confirmación de pago de una reserva del motor público.
 * No-op silencioso si la reserva no existe o el huésped no dejó email.
 */
export async function sendBookingPaidEmail(
  deps: BookingPaidEmailDeps,
  reservationId: string,
): Promise<boolean> {
  const { emailSender, reservationsRepo, hotelRepo, guestRepo, logger } = deps
  try {
    const reservation = await reservationsRepo.findById(reservationId)
    if (!reservation) return false

    const hotel = await hotelRepo.findById(reservation.hotelId)
    const guest = reservation.guestId ? await guestRepo.findById(reservation.guestId) : null
    // Tenancy: el huésped tiene que ser del mismo hotel que la reserva (defensa IDOR).
    if (guest?.hotelId && guest.hotelId !== reservation.hotelId) return false

    const to = String(guest?.email ?? '').trim()
    if (!to) {
      logger.info('booking-paid-email: reserva sin email de huésped', { reservationId })
      return false
    }

    const language = resolveGuestLanguage(guest) as NotificationLanguage
    const currency = String(reservation.currency || 'USD').toUpperCase()
    const total = Number(reservation.totalAmount ?? 0)
    const paid = Number(reservation.deposit ?? 0)
    const pending = Math.max(0, Number((total - paid).toFixed(2)))
    const method = String(reservation.paymentMethod ?? '')
    const cancellationType = await hotelCancellationTypeOf(hotelRepo, reservation.hotelId)

    await emailSender.enqueueNotification({
      to,
      hotelId: reservation.hotelId,
      event: 'reservation_confirmed',
      language,
      variables: {
        guest_name: guest?.name || guest?.firstName || 'Huésped',
        hotel_name: hotel?.name ?? 'Hotel',
        hotel_phone: hotel?.phone ?? '',
        hotel_email: hotel?.email ?? '',
        hotel_address: [hotel?.address, hotel?.municipality, hotel?.province, hotel?.country]
          .filter(Boolean).join(', ') || '—',
        checkin_date: String(reservation.checkIn ?? ''),
        checkout_date: String(reservation.checkOut ?? ''),
        // Horario EFECTIVO: lo acordado con este huésped pisa el general del hotel.
        checkin_time: effectiveCheckInTime(reservation, hotel),
        checkout_time: effectiveCheckOutTime(reservation, hotel),
        total_amount: money(total, currency),
        deposit_amount: money(paid, currency),
        pending_amount: pending > 0 ? money(pending, currency) : '—',
        payment_method: PAYMENT_LABELS[method]?.[language] ?? (method || '—'),
        cancellation_policy: cancellationPolicyText(cancellationType, language),
        locator: String(reservation.id ?? '').slice(0, 8),
        // La habitación y el código NO viajan acá a propósito: van 24 h antes de la llegada.
        room_number: '',
        room_type: '',
        room_capacity: '',
        room_base_price: '',
        wifi_network: '',
        wifi_password: '',
        lock_code: '',
      },
      relatedType: 'reservation',
      relatedId: reservationId,
    })
    logger.info('booking-paid-email encolado', { to, reservationId, language })
    return true
  } catch (e) {
    logger.warn('booking-paid-email falló', { reservationId, error: (e as Error).message })
    return false
  }
}
