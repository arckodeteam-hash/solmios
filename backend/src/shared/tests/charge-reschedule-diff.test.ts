// shared/tests/charge-reschedule-diff.test.ts — BUG-ceiling-bypass: el cobro de una reprogramación
// tiene que quedar VINCULADO a la reserva.
//
// `commitReschedule` sube `reservations.totalAmount` con la diferencia y delega el cobro acá. Las
// vías `cash` y `card` crean la fila de `payments` sin folio y sin factura, que eran los dos únicos
// caminos por los que `shared/usecases/reservation-paid.ts` llegaba de una reserva a su dinero. Con
// la reserva sólo en `metadata` (JSON, no filtrable por WHERE) esa plata no contaba como cobrada y
// el techo de `payment-requests/usecases/charge-ceiling.ts` autorizaba recobrarla por Stripe.

import { describe, it, expect } from 'bun:test'
import { chargeRescheduleDiff } from '../usecases/charge-reschedule-diff'
import { paidForReservation } from '../usecases/reservation-paid'

const params = {
  reservationId: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'ro1',
  currency: 'USD', amount: 150, method: 'cash' as const, reason: 'noche extra',
}

function paymentsDouble() {
  const rows: any[] = []
  return {
    rows,
    createPayment: async (dto: any) => { const p = { id: `pay${rows.length + 1}`, ...dto }; rows.push(p); return p },
    chargeCard: async (dto: any) => {
      const p = { id: `pay${rows.length + 1}`, status: 'processing', ...dto }
      rows.push(p)
      return { payment: p, checkoutUrl: 'https://pay/x' }
    },
  }
}

describe('chargeRescheduleDiff · vínculo con la reserva', () => {
  it('el cobro en efectivo lleva `reservationId` como COLUMNA, no sólo en metadata', async () => {
    const payments = paymentsDouble()
    await chargeRescheduleDiff({}, payments, params, { id: 'u1' })
    expect(payments.rows[0].reservationId).toBe('r1')
    expect(payments.rows[0].metadata).toMatchObject({ reservationId: 'r1', source: 'reschedule' })
  })

  it('el cobro con tarjeta también lo lleva', async () => {
    const payments = paymentsDouble()
    await chargeRescheduleDiff({}, payments, { ...params, method: 'card' }, { id: 'u1' })
    expect(payments.rows[0].reservationId).toBe('r1')
  })

  it('el cargo a folio sigue colgando del folio (no necesita la columna)', async () => {
    const folios = {
      list: async () => ({ data: [{ id: 'f1' }] }),
      postCharge: async () => ({ id: 'ch1' }),
    }
    const out = await chargeRescheduleDiff(folios, paymentsDouble(), { ...params, method: 'folio' }, { id: 'u1' })
    expect(out).toMatchObject({ target: 'folio', folioId: 'f1' })
  })

  it('extremo a extremo: lo cobrado en efectivo YA no es recobrable por el techo', async () => {
    const payments = paymentsDouble()
    await chargeRescheduleDiff({}, payments, params, { id: 'u1' })
    // El mismo WHERE que hace `paidForReservation` sobre la tabla real.
    const repos = {
      folioRepo: { findMany: async () => [] },
      invoiceRepo: { findMany: async () => [] },
      paymentRepo: {
        findMany: async (f: any) => payments.rows.filter((p) => p.hotelId === f.hotelId && p.reservationId === f.reservationId),
      },
    }
    expect(await paidForReservation(repos, 'h1', 'r1', { deposit: 500 })).toBe(650)
  })
})
