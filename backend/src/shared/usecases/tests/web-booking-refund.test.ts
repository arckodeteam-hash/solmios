import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { refundCancelledWebBooking, SYSTEM_REFUND_ACTOR } from '../web-booking-refund'

const HOTEL = 'h1'

const CHARGE = { id: 'p1', type: 'charge', status: 'completed', amount: 200, stripeSessionId: 'cs_x', method: 'link' }

/** Grupo de 3: la líder (r1) tiene priceBreakdown y lleva el cobro; r2/r3 son hermanas. */
function groupRows() {
  return [
    { id: 'r1', hotelId: HOTEL, groupId: 'g1', currency: 'USD', priceBreakdown: { total: 200 }, refundStatus: 'none' },
    { id: 'r2', hotelId: HOTEL, groupId: 'g1', currency: 'USD', refundStatus: 'none' },
    { id: 'r3', hotelId: HOTEL, groupId: 'g1', currency: 'USD', refundStatus: 'none' },
  ]
}

interface Over {
  rows?: any[]
  /** paymentId → filas payments */
  payments?: Record<string, any[]>
  refundThrows?: boolean
  withNotify?: boolean
}

function harness(over: Over = {}) {
  const rows: any[] = over.rows ?? groupRows()
  const payments = over.payments ?? { r1: [CHARGE] }
  const refunds: any[] = []
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const notified: any[] = []
  const deps: any = {
    payments: {
      paymentsLinkedTo: async (_hotelId: string, ref: { reservationId: string }) => payments[ref.reservationId] ?? [],
      refundPayment: async (paymentId: string, amount?: number, user?: any, reason?: string) => {
        refunds.push({ paymentId, amount, user, reason })
        if (over.refundThrows) throw new Error('stripe caído')
        return { id: 're-1', type: 'refund', amount }
      },
    },
    reservations: {
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      findMany: async (where: Record<string, unknown>) =>
        rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)),
      update: async (id: string, patch: Record<string, unknown>) => {
        updates.push({ id, patch })
        const row = rows.find((r) => r.id === id)
        if (row) Object.assign(row, patch)
        return row
      },
    },
    notifyHotel: over.withNotify === false
      ? undefined
      : async (hotelId: string, n: any) => { notified.push({ hotelId, ...n }) },
    logger: silentLogger(),
  }
  return { deps, rows, refunds, updates, notified }
}

describe('refundCancelledWebBooking', () => {
  it('pagada 200 / refundAmount 100 → refundPayment(p1, 100, system, guest_cancellation) y done en las 3 filas', async () => {
    const h = harness()
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })

    expect(out).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(h.refunds).toHaveLength(1)
    expect(h.refunds[0].paymentId).toBe('p1')
    expect(h.refunds[0].amount).toBe(100)
    expect(h.refunds[0].user).toEqual(SYSTEM_REFUND_ACTOR)
    expect(h.refunds[0].user.id).toBe('system')
    expect(h.refunds[0].reason).toBe('guest_cancellation')
    for (const r of h.rows) {
      expect(r.refundStatus).toBe('done')
      expect(typeof r.refundedAt).toBe('string')
      expect(r.refundPaymentId).toBe('re-1')
    }
    // pasó por pending antes de done
    expect(h.updates.filter((u) => u.patch.refundStatus === 'pending')).toHaveLength(3)
    expect(h.notified).toHaveLength(0)
  })

  it('nunca devuelve más de lo cobrado: refundAmount 500 sobre cobro 200 → 200', async () => {
    const h = harness()
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 500 })
    expect(out.status).toBe('done')
    expect(h.refunds[0].amount).toBe(200)
  })

  it('refundAmount 0 → no llama a la pasarela y deja none', async () => {
    const h = harness()
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 0 })
    expect(out).toEqual({ status: 'none' })
    expect(h.refunds).toHaveLength(0)
    for (const r of h.rows) expect(r.refundStatus).toBe('none')
    expect(h.notified).toHaveLength(0)
  })

  it('refundPayment lanza → failed en las 3 filas y aviso al hotel "Reembolso de … pendiente"', async () => {
    const h = harness({ refundThrows: true })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })

    expect(out.status).toBe('failed')
    expect((out as any).error).toBe('stripe caído')
    expect(h.refunds).toHaveLength(1)
    for (const r of h.rows) {
      expect(r.refundStatus).toBe('failed')
      expect(r.refundPaymentId).toBeUndefined()
    }
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].hotelId).toBe(HOTEL)
    expect(h.notified[0].title).toContain('Reembolso de')
    expect(h.notified[0].title).toContain('100.00 USD')
    expect(h.notified[0].title).toContain('pendiente')
    expect(h.notified[0].metadata).toMatchObject({ reservationId: 'r1', refundAmount: 100 })
    expect(String(h.notified[0].metadata.link)).toContain('/panel/reservations?')
    expect(String(h.notified[0].metadata.link)).toContain('r1')
  })

  it('ya done → skipped already_done y no vuelve a llamar a la pasarela', async () => {
    const rows = groupRows().map((r) => ({ ...r, refundStatus: 'done', refundPaymentId: 're-0', refundedAt: '2026-09-01T00:00:00.000Z' }))
    const h = harness({ rows })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(out).toEqual({ status: 'skipped', reason: 'already_done' })
    expect(h.refunds).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
    expect(h.rows[0].refundPaymentId).toBe('re-0')
  })

  it('sin cobro Stripe (pago pending o sin referencia) → failed + aviso al hotel', async () => {
    const h = harness({
      payments: { r1: [{ id: 'p9', type: 'charge', status: 'pending', amount: 200 }, { id: 'p8', type: 'refund', status: 'completed', amount: 50, stripePaymentId: 'pi_z' }] },
    })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(out).toEqual({ status: 'failed', error: 'no_stripe_payment' })
    expect(h.refunds).toHaveLength(0)
    for (const r of h.rows) expect(r.refundStatus).toBe('failed')
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].title).toContain('Reembolso de')
    expect(h.notified[0].title).toContain('pendiente')
  })

  it('cancelada desde la hermana: encuentra el cobro de la LÍDER y marca todo el grupo', async () => {
    const h = harness()
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r3', hotelId: HOTEL, refundAmount: 100 })
    expect(out).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(h.refunds[0].paymentId).toBe('p1')
    expect(h.rows.map((r) => r.refundStatus)).toEqual(['done', 'done', 'done'])
    expect(h.rows.map((r) => r.refundPaymentId)).toEqual(['re-1', 're-1', 're-1'])
  })

  it('reserva inexistente o de otro hotel → skipped not_found sin tocar nada', async () => {
    const h = harness()
    expect(await refundCancelledWebBooking(h.deps, { reservationId: 'nope', hotelId: HOTEL, refundAmount: 100 }))
      .toEqual({ status: 'skipped', reason: 'not_found' })
    expect(await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: 'h2', refundAmount: 100 }))
      .toEqual({ status: 'skipped', reason: 'not_found' })
    expect(h.refunds).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
  })

  it('reserva simple (sin groupId) → sólo esa fila cambia', async () => {
    const h = harness({
      rows: [{ id: 's1', hotelId: HOTEL, currency: 'EUR', refundStatus: 'none' }],
      payments: { s1: [{ id: 'p5', status: 'completed', amount: 80, stripePaymentId: 'pi_5' }] },
    })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 's1', hotelId: HOTEL, refundAmount: 40 })
    expect(out).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 40 })
    expect(h.refunds[0].paymentId).toBe('p5')
    expect(h.updates.map((u) => u.id)).toEqual(['s1', 's1'])
  })

  it('sin notifyHotel el fallo no rompe', async () => {
    const h = harness({ refundThrows: true, withNotify: false })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(out.status).toBe('failed')
  })
})
