// shared/usecases/booking-received-unpaid-email.ts — Correo "recibimos tu pedido" al huésped
// cuando el motor web NO tiene pasarela de pago (#267).
//
// Por qué existe: el único correo al huésped del motor público salía en `onBookingPaid`
// (`booking-paid-email.ts`), que sólo dispara Stripe. Un hotel sin pasarela crea la reserva
// igual (`checkoutUrl: null`) y el huésped quedaba sin ningún acuse: ni localizador, ni fechas,
// ni a quién llamar. Este correo cubre ese hueco: fechas CON hora, total, localizador y datos
// de contacto del hotel, que es quien lo va a llamar para coordinar el pago.
//
// NO va si hubo pasarela (`hasCheckout: true`): ahí el acuse es el de pago, al pagar. Tampoco
// si el evento no trae el dato (`hasCheckout: undefined`, flujo viejo): ante la duda, silencio
// antes que un correo que le diga "sin pago" a alguien que está pagando en Stripe.
//
// Best-effort: cualquier fallo se loguea y se traga. La reserva ya está creada; no se revierte
// porque el correo no salió.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender } from '../../services/email-sender'
import type { NotificationLanguage } from '../../services/notification-defaults'
import { resolveGuestLanguage } from '../../services/guest-language'
import { effectiveCheckInTime, effectiveCheckOutTime } from '../utils/hotel-schedule'
import type { PlatformIdentity } from '../utils/platform-identity'
import { reservationGroupRows } from './reservation-group-rows'

export interface BookingReceivedUnpaidEmailDeps {
  emailSender: EmailSender
  reservationsRepo: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<any>
  logger: Logger
  /** Nombre de la plataforma para `{platform_name}` (Configuración → Plataforma). Sin esto va ''. */
  platformIdentity?: () => Promise<Partial<PlatformIdentity>>
}

/**
 * Guard puro: ¿corresponde el correo "recibimos tu pedido, sin pago"?
 * Sólo cuando el controller afirma que NO hubo pasarela (`hasCheckout === false`) y la reserva
 * no está pagada. `hasCheckout` ausente = flujo viejo sin el dato → NO manda (ese acuse sale al pagar).
 */
export function shouldSendReceivedUnpaidEmail(ev: { hasCheckout?: boolean; paid?: boolean }): boolean {
  return ev?.hasCheckout === false && !ev.paid
}

function money(amount: unknown, currency: string): string {
  const n = Number(amount ?? 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n.toFixed(2)} ${currency}`
}

/**
 * Encola el correo "recibimos tu pedido de reserva" de una reserva del motor público sin pasarela.
 * No-op silencioso si la reserva no existe o el huésped no dejó email.
 */
export async function sendBookingReceivedUnpaidEmail(
  deps: BookingReceivedUnpaidEmailDeps,
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
      logger.info('booking-received-unpaid-email: reserva sin email de huésped', { reservationId })
      return false
    }

    const language = resolveGuestLanguage(guest) as NotificationLanguage
    const currency = String(reservation.currency || 'USD').toUpperCase()
    const platformName = deps.platformIdentity ? String((await deps.platformIdentity())?.platformName ?? '') : ''
    // Grupo (varias habitaciones): el huésped pidió TODO el grupo, así que el total del acuse es
    // la suma de las hermanas vivas, no el de la líder sola (misma regla que booking-paid-email).
    const rows = await reservationGroupRows(reservationsRepo, reservation, logger, 'booking-received-unpaid-email')
    const total = rows.reduce((acc, r) => acc + Number(r.totalAmount ?? 0), 0)

    await emailSender.enqueueNotification({
      to,
      hotelId: reservation.hotelId,
      event: 'reservation_received_unpaid',
      language,
      variables: {
        guest_name: guest?.name || guest?.firstName || 'Huésped',
        hotel_name: hotel?.name ?? 'Hotel',
        hotel_phone: hotel?.phone ?? '',
        hotel_email: hotel?.email ?? '',
        checkin_date: String(reservation.checkIn ?? ''),
        checkout_date: String(reservation.checkOut ?? ''),
        // Horario EFECTIVO: lo acordado con este huésped pisa el general del hotel.
        checkin_time: effectiveCheckInTime(reservation, hotel),
        checkout_time: effectiveCheckOutTime(reservation, hotel),
        total_amount: money(total, currency),
        locator: String(reservation.id ?? '').slice(0, 8),
        platform_name: platformName,
      },
      relatedType: 'reservation',
      relatedId: reservationId,
    })
    logger.info('booking-received-unpaid-email encolado', { to, reservationId, language })
    return true
  } catch (e) {
    logger.warn('booking-received-unpaid-email falló', { reservationId, error: (e as Error).message })
    return false
  }
}
