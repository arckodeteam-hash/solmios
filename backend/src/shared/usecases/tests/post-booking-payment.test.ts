// post-booking-payment.test.ts — El cobro del motor web tiene que quedar ATADO a su reserva.
//
// Sin `reservationId` el pago entra a `payments` huérfano: el dinero aparece en el arqueo, pero
// ningún reporte que cruce pago↔reserva ve las ventas del motor web, y la reserva no puede probar
// con qué cobro se pagó. Verificado en producción el 2026-08-29: una fila de 76,70 USD con
// `reservationid` vacío después de un pago real.
import { describe, it, expect } from 'bun:test'
import { postBookingPayment } from '../post-booking-payment'

const booking = (over: any = {}) => ({
  id: 'res-1', hotelId: 'h1', totalAmount: 76.7, currency: 'usd',
  guestName: 'Ana', checkIn: '2026-08-29', paymentRef: 'cs_test_1', ...over,
}) as any

function portOf(existing: any = null) {
  const created: any[] = []
  return {
    created,
    port: {
      findByStripeSession: async () => existing,
      createPayment: async (dto: any) => { created.push(dto); return dto },
    } as any,
  }
}

describe('postBookingPayment', () => {
  it('ata el cobro a su reserva (`booking.id` ES el reservationId)', async () => {
    const { port, created } = portOf()
    await postBookingPayment(port, booking())
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      reservationId: 'res-1', hotelId: 'h1', amount: 76.7,
      status: 'completed', method: 'link', type: 'charge',
    })
  })

  it('es idempotente por sessionId: Stripe reintenta y el asiento no se duplica', async () => {
    const { port, created } = portOf({ id: 'pay-existente' })
    const r = await postBookingPayment(port, booking())
    expect(created).toHaveLength(0)
    expect(r).toMatchObject({ id: 'pay-existente' })
  })

  it('sin monto o sin sessionId no asienta nada', async () => {
    const a = portOf(); await postBookingPayment(a.port, booking({ totalAmount: 0 }))
    const b = portOf(); await postBookingPayment(b.port, booking({ paymentRef: '' }))
    expect(a.created).toHaveLength(0)
    expect(b.created).toHaveLength(0)
  })
})
