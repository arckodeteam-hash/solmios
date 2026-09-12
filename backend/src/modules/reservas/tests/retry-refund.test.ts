// reservas/tests/retry-refund.test.ts — #272: reintentar el reembolso web (POST /api/reservas/:id/retry-refund).
//
// Cubre el usecase retryRefund (no el HTTP controller): que llama al puerto con el monto de la
// RESERVA (nunca del cliente) y responde el estado releído, que una reserva ya `done` es
// idempotente (no toca la pasarela), que sólo aplica a canceladas con plata que devolver,
// ownership con Auth REAL (mismo criterio que mark-paid.test.ts) y fail-closed sin puerto.
import { describe, it, expect } from 'bun:test'
import { Auth, ConflictError, ForbiddenError, NotFoundError, ValidationError } from 'arckode-framework'
import { retryRefund, refundStatePatch, type RetryRefundDeps, type RetryWebRefundPort } from '../usecases/retry-refund'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
// Auth REAL: si assertOwnership se rompe, este test falla.
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const baseItem = {
  id: 'r1', hotelId: HOTEL, guestId: 'g1', status: 'cancelled', currency: 'USD',
  totalAmount: 200, refundAmount: 100, refundStatus: 'failed',
}

interface Harness {
  deps: RetryRefundDeps
  calls: Array<{ reservationId: string; hotelId: string; refundAmount: number }>
  row: any
}

/** El puerto simula lo que hace el usecase compartido: escribe el estado en la fila y responde. */
function harness(item: any | null = baseItem, opts: { port?: RetryWebRefundPort | undefined; outcome?: 'done' | 'failed' } = {}): Harness {
  const row = item ? { ...item } : null
  const calls: Harness['calls'] = []
  const defaultPort: RetryWebRefundPort = async (input) => {
    calls.push(input)
    if (opts.outcome === 'failed') { Object.assign(row, { refundStatus: 'failed' }); return { status: 'failed', error: 'stripe caído' } }
    Object.assign(row, { refundStatus: 'done', refundPaymentId: 're-1', refundedAt: '2026-09-12T10:00:00.000Z' })
    return { status: 'done', refundPaymentId: 're-1' }
  }
  const deps: RetryRefundDeps = {
    repo: { findById: async () => (row ? { ...row } : null) } as any,
    auth: realAuth,
    port: 'port' in opts ? opts.port : defaultPort,
  }
  return { deps, calls, row }
}

describe('retryRefund — camino feliz', () => {
  it('cancelled + failed + refundAmount 100 → puerto llamado con el monto de la reserva y respuesta done releída', async () => {
    const h = harness()
    const out = await retryRefund(h.deps, 'r1', user)

    expect(h.calls).toEqual([{ reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 }])
    expect(out).toEqual({
      reservationId: 'r1', refundStatus: 'done', refundPaymentId: 're-1',
      refundedAt: '2026-09-12T10:00:00.000Z', refundAmount: 100,
    })
  })

  it('la pasarela vuelve a fallar → responde failed sin tirar (el hotel puede reintentar de nuevo)', async () => {
    const h = harness(baseItem, { outcome: 'failed' })
    const out = await retryRefund(h.deps, 'r1', user)
    expect(h.calls).toHaveLength(1)
    expect(out.refundStatus).toBe('failed')
    expect(out.refundPaymentId).toBeNull()
  })

  it('super_admin de otro hotel puede reintentar', async () => {
    const h = harness()
    const out = await retryRefund(h.deps, 'r1', { id: 'root', role: 'super_admin', hotelId: OTRO_HOTEL })
    expect(out.refundStatus).toBe('done')
  })
})

describe('retryRefund — idempotencia y guardas', () => {
  it('ya done → 200 con el estado actual y NO llama al puerto', async () => {
    const h = harness({ ...baseItem, refundStatus: 'done', refundPaymentId: 're-0', refundedAt: '2026-09-01T00:00:00.000Z' })
    const out = await retryRefund(h.deps, 'r1', user)
    expect(h.calls).toHaveLength(0)
    expect(out).toMatchObject({ refundStatus: 'done', refundPaymentId: 're-0', refundedAt: '2026-09-01T00:00:00.000Z' })
  })

  it('reserva no cancelada → 409 y no llama al puerto', async () => {
    const h = harness({ ...baseItem, status: 'confirmed' })
    await expect(retryRefund(h.deps, 'r1', user)).rejects.toBeInstanceOf(ConflictError)
    expect(h.calls).toHaveLength(0)
  })

  it('cancelada sin plata que devolver (refundAmount 0) → 409', async () => {
    const h = harness({ ...baseItem, refundAmount: 0, refundStatus: 'none' })
    await expect(retryRefund(h.deps, 'r1', user)).rejects.toBeInstanceOf(ConflictError)
    expect(h.calls).toHaveLength(0)
  })

  it('reserva inexistente → 404', async () => {
    const h = harness(null)
    await expect(retryRefund(h.deps, 'nope', user)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('hotel_admin de OTRO hotel → rechazado (ownership real) y no llama al puerto', async () => {
    const h = harness()
    await expect(retryRefund(h.deps, 'r1', { id: 'u2', role: 'hotel_admin', hotelId: OTRO_HOTEL })).rejects.toBeInstanceOf(ForbiddenError)
    expect(h.calls).toHaveLength(0)
  })

  it('sin puerto cableado → ValidationError "Reembolso no disponible" (fail-closed)', async () => {
    const h = harness(baseItem, { port: undefined })
    await expect(retryRefund(h.deps, 'r1', user)).rejects.toBeInstanceOf(ValidationError)
    await expect(retryRefund(h.deps, 'r1', user)).rejects.toThrow('Reembolso no disponible')
  })
})

describe('refundStatePatch — sólo los campos del reembolso entran por setRefundState', () => {
  it('filtra cualquier otro campo (status, hotelId, totalAmount…)', () => {
    expect(refundStatePatch({ refundStatus: 'done', refundedAt: '2026-09-12T10:00:00.000Z', refundPaymentId: 're-1', status: 'confirmed', hotelId: 'x', totalAmount: 0 }))
      .toEqual({ refundStatus: 'done', refundedAt: '2026-09-12T10:00:00.000Z', refundPaymentId: 're-1' })
    expect(refundStatePatch({ refundStatus: 'pending' })).toEqual({ refundStatus: 'pending' })
    expect(refundStatePatch({ refundPaymentId: null })).toEqual({ refundPaymentId: null })
  })
})
