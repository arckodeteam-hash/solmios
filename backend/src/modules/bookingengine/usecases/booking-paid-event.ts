// booking-paid-event.ts — Payload del socket `onBookingPaid` a partir de un pago asentado.
//
// B-1 (auditoría 2026-08-19): el payload era SOLO {id} → `postBookingPayment` (connector
// bookingengine-payments) hacía early-return por amount 0 / sin sessionId y el cobro del widget
// JAMÁS llegaba a `payments` (arqueo de caja y conciliación ciegos al widget). Acá viaja el shape
// que ese puerto consume: totalAmount (dinero REAL del evento amountMinor/100, con fallback al
// total de la reserva), currency, checkIn y paymentRef = referencia del proveedor (dedup).
//
// Vive en un usecase porque lo emiten DOS caminos —el webhook de Stripe y el retorno de
// Azul/CardNet (#196)— y tienen que mandar exactamente lo mismo.
import type { SettleResult } from './stripe'

export interface BookingPaidPayload {
  id: string
  hotelId: string
  totalAmount: number
  currency?: string
  checkIn?: string
  paymentRef: string
}

/** `null` si el resultado no es una reserva recién confirmada (duplicado, fallido, pendiente). */
export function bookingPaidPayload(hotelId: string, result: SettleResult | null): BookingPaidPayload | null {
  if (!result || result.type !== 'reservation_confirmed' || !result.reservationId) return null
  const amount = result.amountMinor && result.amountMinor > 0
    ? Math.round((result.amountMinor / 100) * 100) / 100
    : Number(result.totalAmount) || 0
  return {
    id: result.reservationId,
    hotelId,
    totalAmount: amount,
    currency: result.currency ?? undefined,
    checkIn: result.checkIn ?? undefined,
    paymentRef: result.providerRef || '',
  }
}
