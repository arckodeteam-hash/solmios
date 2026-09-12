// reservas/tests/cancel-no-charge.test.ts — PenaltyMode `no-charge` (#248, REQ-RWP-05).
//
// Una reserva web que nunca se pagó y venció por el TTL del hotel se cancela SIN política:
// fee 0, refund 0, snapshot `policyId: 'payment_timeout'`. Igual que `channel-managed`, no
// consulta policyRepo ni hotelRepo — el policyRepo de acá TIRA si alguien lo llama.
// El evento `onReservationCancelled` sale igual (con refundAmount 0): es lo que dispara la
// liberación de disponibilidad por los connectors existentes.
import { describe, it, expect } from 'bun:test'
import { cancelReservationBySystem } from '../usecases/cancel-system'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any

const HOTEL = 'hotel-a'

const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)

const baseItem = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', status: 'pending',
  checkIn: inTwoDays(), deposit: 100, accessToken: 'tok-1', ...over,
})

/** Repo con estado: la segunda llamada ve el `cancelled` que dejó la primera (idempotencia). */
function statefulRepo(item: any, updates: any[]) {
  let current = { ...item }
  return {
    findMany: async (q: any) => (q?.id === current.id ? [current] : []),
    findById: async (id: string) => (id === current.id ? current : null),
    update: async (_id: string, patch: any) => {
      updates.push(patch)
      current = { ...current, ...patch }
      return current
    },
  } as any
}

/** Si el modo no-charge consultara la política del hotel, este repo lo delata. */
const throwingPolicyRepo = {
  findMany: async () => { throw new Error('policyRepo.findMany NO debe llamarse en modo no-charge') },
} as any
const throwingHotelRepo = {
  findById: async () => { throw new Error('hotelRepo.findById NO debe llamarse en modo no-charge') },
  findMany: async () => { throw new Error('hotelRepo.findMany NO debe llamarse en modo no-charge') },
} as any

function depsFor(repo: any, sockets: any) {
  return {
    repo, policyRepo: throwingPolicyRepo, hotelRepo: throwingHotelRepo,
    logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {},
  }
}

describe('cancelReservationBySystem — penaltyMode no-charge (vencida por falta de pago)', () => {
  it('cancela con fee 0 / refund 0, snapshot payment_timeout, emite el evento y no mira la política', async () => {
    const updates: any[] = []
    const emitted: any[] = []
    const repo = statefulRepo(baseItem(), updates)
    const sockets = { onReservationCancelled: async (d: any) => { emitted.push(d) } }

    const out = await cancelReservationBySystem(depsFor(repo, sockets), 'r1', {
      hotelId: HOTEL, reason: 'payment_timeout', penaltyMode: 'no-charge',
    })

    expect(out).toMatchObject({ ok: true, idempotent: false, cancellationFee: 0, refundAmount: 0 })
    expect(updates).toHaveLength(1)
    expect(updates[0].status).toBe('cancelled')
    expect(updates[0].cancelledAt).toBeTruthy()
    expect(updates[0].cancellationReason).toBe('payment_timeout')
    expect(updates[0].refundAmount).toBe(0)
    expect(updates[0].cancellationFee).toBe(0)
    expect((updates[0].policyApplied as any).policyId).toBe('payment_timeout')
    expect((updates[0].policyApplied as any).label).toBe('Vencida por falta de pago')
    // El evento sale UNA vez y con refundAmount 0: libera disponibilidad, no plata.
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ reservationId: 'r1', hotelId: HOTEL, refundAmount: 0, cancellationFee: 0 })
  })

  it('segunda llamada → idempotent true, sin re-persistir ni re-emitir', async () => {
    const updates: any[] = []
    const emitted: any[] = []
    const repo = statefulRepo(baseItem(), updates)
    const sockets = { onReservationCancelled: async (d: any) => { emitted.push(d) } }
    const deps = depsFor(repo, sockets)

    const first = await cancelReservationBySystem(deps, 'r1', { hotelId: HOTEL, reason: 'payment_timeout', penaltyMode: 'no-charge' })
    const second = await cancelReservationBySystem(deps, 'r1', { hotelId: HOTEL, reason: 'payment_timeout', penaltyMode: 'no-charge' })

    expect(first).toMatchObject({ ok: true, idempotent: false })
    expect(second).toMatchObject({ ok: true, idempotent: true, refundAmount: 0, cancellationFee: 0 })
    expect(updates).toHaveLength(1)
    expect(emitted).toHaveLength(1)
  })
})
