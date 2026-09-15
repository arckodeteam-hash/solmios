// reservas/tests/cancellation-refund.test.ts — POST /api/reservas/:id/cancellation-refund.
//
// Lo que se cuida es plata que sale: que no salga dos veces, que no salga de más si ya se devolvió
// algo desde Finanzas, y que un fallo no deje la reserva en un estado que el panel reintente por el
// camino equivocado.
import { describe, it, expect } from 'bun:test'
import { Auth } from 'arckode-framework'
import { refundCancelledReservation, type CancellationRefundDeps } from '../usecases/cancellation-refund'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const realAuth = new Auth({ sign: () => '', verify: () => ({}) } as any, 'test-secret', noopLogger)
const HOTEL = 'hotel-a'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

/** Reserva cobrada 400, cancelada con 50%: retiene 200, devuelve 200. */
const cancelled = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, guestId: 'g1', currency: 'USD', status: 'cancelled',
  refundAmount: 200, cancellationFee: 200, cancellationReason: 'Solicitud del huésped', refundStatus: 'none',
  updatedAt: '2026-09-15T10:00:00.000Z', ...over,
})

function harness(item: any, opts: { paidNow?: number; claim?: boolean; creditThrows?: boolean } = {}) {
  const store = { ...item }
  const writes: any[] = []
  const creditCalls: any[] = []
  const audits: any[] = []
  const deps: CancellationRefundDeps = {
    repo: {
      findById: async () => store,
      update: async (_id: string, patch: any) => { writes.push(patch); Object.assign(store, patch); return { ...store } },
    } as any,
    auth: realAuth,
    logger: noopLogger,
    paidOf: async () => opts.paidNow ?? 400,
    claimRefund: async () => opts.claim ?? true,
    credit: async (params) => {
      creditCalls.push(params)
      if (opts.creditThrows) throw new Error('caja cerrada')
      return { action: 'refund', applied: true, target: 'cash', paymentId: 'pay-refund-1', message: 'Entregale el dinero al huésped: sale de la caja del turno.' }
    },
    notifyChanged: async () => {},
    audit: (e) => { audits.push(e) },
  }
  return { deps, store, writes, creditCalls, audits }
}

describe('refundCancelledReservation — devuelve lo que dejó la cancelación', () => {
  it('devuelve el monto de la política, marca done y lo deja en el historial', async () => {
    const h = harness(cancelled())
    const out = await refundCancelledReservation(h.deps, 'r1', user)
    expect(h.creditCalls).toHaveLength(1)
    expect(h.creditCalls[0]).toMatchObject({ amount: 200, action: 'refund', description: 'Devolución por cancelación', reason: 'Solicitud del huésped' })
    expect(out).toMatchObject({ amount: 200, target: 'cash', refundPaymentId: 'pay-refund-1', refundStatus: 'done' })
    expect(h.store.refundStatus).toBe('done')
    expect(h.store.refundPaymentId).toBe('pay-refund-1')
    expect(JSON.parse(h.audits[0].detail)).toMatchObject({ amount: 200, target: 'cash' })
  })

  it('lo ya devuelto desde Finanzas se descuenta (cobrado ahora 300 → devuelve 100)', async () => {
    const h = harness(cancelled(), { paidNow: 300 })
    const out = await refundCancelledReservation(h.deps, 'r1', user)
    expect(out.amount).toBe(100)
  })

  it('si ya se devolvió todo por otro lado: 409 y no sale plata', async () => {
    const h = harness(cancelled(), { paidNow: 200 })
    await expect(refundCancelledReservation(h.deps, 'r1', user)).rejects.toThrow(/Finanzas/)
    expect(h.creditCalls).toHaveLength(0)
  })

  it('segundo clic (candado tomado): 409 y no sale plata', async () => {
    const h = harness(cancelled(), { claim: false })
    await expect(refundCancelledReservation(h.deps, 'r1', user)).rejects.toThrow(/en curso/)
    expect(h.creditCalls).toHaveLength(0)
  })

  it('ya devuelta: 409', async () => {
    const h = harness(cancelled({ refundStatus: 'done' }))
    await expect(refundCancelledReservation(h.deps, 'r1', user)).rejects.toThrow(/ya se devolvió/)
    expect(h.creditCalls).toHaveLength(0)
  })

  it('reserva no cancelada o sin nada que devolver: 409', async () => {
    await expect(refundCancelledReservation(harness(cancelled({ status: 'confirmed' })).deps, 'r1', user)).rejects.toThrow(/cancelada/)
    await expect(refundCancelledReservation(harness(cancelled({ refundAmount: 0 })).deps, 'r1', user)).rejects.toThrow(/no dejó dinero/)
  })

  it('una cancelación web con reembolso fallido va por su propio reintento, no por acá', async () => {
    const h = harness(cancelled({ refundStatus: 'failed' }))
    await expect(refundCancelledReservation(h.deps, 'r1', user)).rejects.toThrow(/Reintentar reembolso/)
    expect(h.creditCalls).toHaveLength(0)
  })

  it('si la devolución falla, refundStatus vuelve a como estaba (no queda pending ni failed)', async () => {
    const h = harness(cancelled(), { creditThrows: true })
    await expect(refundCancelledReservation(h.deps, 'r1', user)).rejects.toThrow(/caja cerrada/)
    expect(h.store.refundStatus).toBe('none')
  })

  it('usuario de otro hotel: no puede', async () => {
    const h = harness(cancelled())
    await expect(refundCancelledReservation(h.deps, 'r1', { id: 'u9', role: 'hotel_admin', hotelId: 'hotel-b' })).rejects.toThrow()
    expect(h.creditCalls).toHaveLength(0)
  })
})
