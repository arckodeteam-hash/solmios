// shared/usecases/post-booking-payment.ts — Asienta el cobro del motor de reservas en `payments`.
//
// El widget público cobra con Stripe Checkout (`bookingengine/usecases/stripe.ts`). Su webhook solo
// marcaba `bookings.paymentStatus = 'paid'`. La plata entraba de verdad a la cuenta del hotel y no
// existía para `payments`, así que quedaba fuera de la conciliación bancaria y del balance.
//
// No impacta caja: un cobro con tarjeta ya está bancarizado, no entra al cajón físico.

import type { PublicBookingDTO } from '../../modules/bookingengine'

export interface RecordedPayment {
  id: string
  status: string
}

export interface BookingPaymentPort {
  createPayment(dto: Record<string, unknown>): Promise<RecordedPayment>
  findByStripeSession(hotelId: string, stripeSessionId: string): Promise<RecordedPayment | null>
}

/**
 * Idempotente por `stripeSessionId` (`booking.paymentRef`): Stripe reintenta el webhook ante
 * cualquier error, y el asiento no puede duplicarse.
 */
export async function postBookingPayment(
  payments: BookingPaymentPort,
  booking: PublicBookingDTO,
): Promise<RecordedPayment | null> {
  const amount = Number(booking.totalAmount || 0)
  const sessionId = booking.paymentRef || ''
  if (amount <= 0 || !sessionId) return null

  const existing = await payments.findByStripeSession(booking.hotelId, sessionId)
  if (existing) return existing

  return payments.createPayment({
    hotelId: booking.hotelId,
    // `booking.id` ES el reservationId (`bookingengine/service.ts:179` lo arma así). Sin esto el
    // cobro entraba a `payments` HUÉRFANO: el dinero aparecía en el arqueo pero no se podía cruzar
    // con su reserva, así que ningún reporte que una pago↔reserva veía las ventas del motor web.
    // Verificado en producción el 2026-08-29: fila de 76,70 con `reservationid` vacío.
    reservationId: booking.id,
    type: 'charge',
    // Entra por un checkout web, no por una tarjeta pasada en el mostrador.
    method: 'link',
    // Stripe ya confirmó el cobro: es dinero recibido, no una intención de pago.
    status: 'completed',
    amount,
    currency: (booking.currency || 'USD').toUpperCase(),
    description: `Reserva web · ${booking.guestName || 'huésped'} · ${booking.checkIn}`,
    reference: sessionId,
    stripeSessionId: sessionId,
  })
}
