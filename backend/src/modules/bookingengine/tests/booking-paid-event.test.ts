// booking-paid-event.test.ts — #276 (MR-11): el payload de `onBookingPaid` lleva nombre y email
// del huésped, así `payments.description` dice "Reserva web · Juan Pérez · …" y no "· huésped ·".
import { describe, it, expect } from 'bun:test'
import { bookingPaidPayload } from '../usecases/booking-paid-event'

describe('bookingPaidPayload', () => {
  it('copia guestName/guestEmail del SettleResult y el monto real del evento', () => {
    const paid = bookingPaidPayload('h1', {
      type: 'reservation_confirmed', reservationId: 'r1', providerRef: 'cs_1',
      amountMinor: 47200, currency: 'usd', totalAmount: 100, checkIn: '2026-10-01',
      provider: 'stripe', guestName: 'Juan Pérez', guestEmail: 'juan@x.com',
    } as any)
    expect(paid).toMatchObject({
      id: 'r1', hotelId: 'h1', totalAmount: 472, currency: 'usd', checkIn: '2026-10-01',
      paymentRef: 'cs_1', provider: 'stripe', guestName: 'Juan Pérez', guestEmail: 'juan@x.com',
    })
  })

  it('un resultado que no es una reserva recién confirmada no emite nada', () => {
    expect(bookingPaidPayload('h1', { type: 'already_processed', reservationId: 'r1' } as any)).toBeNull()
    expect(bookingPaidPayload('h1', null)).toBeNull()
  })
})
