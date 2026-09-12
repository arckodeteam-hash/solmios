// reservas/tests/reject.test.ts — #271 MR-06: rechazo de una reserva pendiente de aprobación.
//
// Cubre el usecase rejectReservation (ownership con Auth REAL, como approve/cancel.test.ts),
// el orden reembolso → cancelación → efectos blandos, el caso de grupo (un solo cobro en la
// líder, todas las hermanas caen) y el mapeo HTTP del controller (400/404/409).
import { describe, it, expect } from 'bun:test'
import { Auth, ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import { rejectReservation, type RejectReservationDeps } from '../usecases/reject'
import { ReservasController } from '../controller'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
// Auth REAL: si assertOwnership se rompe, este test falla.
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'
const REASON = 'No tenemos disponibilidad real para esas fechas'
const userSameHotel = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
const inFourDays = () => new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10)

/** Repo en memoria: findById/findMany/update sobre una lista de reservas. */
const repoWith = (items: any[]) => {
  const store = new Map<string, any>(items.map((i) => [i.id, { ...i }]))
  return {
    store,
    findById: async (id: string) => store.get(id) ?? null,
    findMany: async (f: Record<string, any>) => [...store.values()].filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)),
    update: async (id: string, patch: any) => {
      const merged = { ...store.get(id), ...patch }
      store.set(id, merged)
      return merged
    },
  } as any
}

const fakeCache = () => {
  const s = new Map<string, unknown>()
  return { get: async (k: string) => s.get(k) ?? null, set: async (k: string, v: unknown) => { s.set(k, v) }, delete: async (k: string) => { s.delete(k) }, flush: async () => { s.clear() } } as any
}

const pendingItem = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', guestId: 'g1', status: 'confirmed', approvalStatus: 'pending',
  checkIn: inTwoDays(), checkOut: inFourDays(), currency: 'USD', totalAmount: 100, deposit: 0, ...over,
})

const webCharge = (id: string, reservationId: string, amount: number) => ({
  id, reservationId, hotelId: HOTEL, type: 'charge', method: 'link', status: 'completed', amount, currency: 'USD', stripeSessionId: 'cs_test_1', stripePaymentId: '',
})

interface Harness {
  deps: RejectReservationDeps
  repo: any
  refunds: any[]
  pushed: [string, string][]
  emitted: any[]
  notified: any[]
  groupUpdates: any[]
}

function harness(items: any[], payments: Record<string, any[]>, over: Partial<RejectReservationDeps> = {}): Harness {
  const repo = repoWith(items)
  const refunds: any[] = []
  const pushed: [string, string][] = []
  const emitted: any[] = []
  const notified: any[] = []
  const groupUpdates: any[] = []
  const deps: RejectReservationDeps = {
    repo,
    policyRepo: { findMany: async () => [] } as any,
    logger: noopLogger,
    cache: fakeCache(),
    sockets: { onReservationCancelled: async (e: any) => { emitted.push(e) } },
    releaseChargeSessions: async () => {},
    paymentsOf: async (_h, rid) => payments[rid] ?? [],
    refund: { refundPayment: async (paymentId, amount, user) => { refunds.push([paymentId, amount, user]); return { id: `re_${paymentId}`, amount } } },
    pushAvailability: (h, r) => { pushed.push([h, r]) },
    groupRepo: { update: async (id: string, patch: any) => { groupUpdates.push([id, patch]); return {} } } as any,
    notifyGuest: async (i) => { notified.push(i) },
    ...over,
  }
  return { deps, repo, refunds, pushed, emitted, notified, groupUpdates }
}

describe('rejectReservation — camino feliz (pendiente, pagada por checkout web)', () => {
  it('reembolsa el cobro, cancela con approvalStatus=rejected, libera disponibilidad, emite y avisa', async () => {
    const h = harness([pendingItem()], { r1: [webCharge('p1', 'r1', 100)] })

    const out = await rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)

    expect(out.status).toBe('cancelled')
    expect(out.approvalStatus).toBe('rejected')
    expect(out.cancellationReason).toBe(REASON)
    expect(out.refundAmount).toBe(100)
    expect(out.cancellationFee).toBe(0)
    expect(out.policyApplied?.policyId).toBe('hotel_rejected')
    expect(out.refundedAmount).toBe(100)
    expect(out.rejectedCount).toBe(1)

    expect(h.refunds).toHaveLength(1)
    expect(h.refunds[0]).toEqual(['p1', 100, userSameHotel])
    expect(h.pushed).toEqual([[HOTEL, 'room-1']])
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].reservationId).toBe('r1')
    expect(h.emitted[0].refundAmount).toBe(100)

    // notifyGuest es fire-and-forget: se resuelve en el siguiente tick.
    await new Promise((r) => setTimeout(r, 0))
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].event).toBe('reservation_rejected')
    expect(h.notified[0].reservationId).toBe('r1')
    expect(h.notified[0].variables.rejection_reason).toBe(REASON)
    expect(h.notified[0].variables.refund_amount).toBe('100.00 USD')

    // Persistido en el repo, no sólo en el retorno.
    expect(h.repo.store.get('r1').status).toBe('cancelled')
    expect(h.repo.store.get('r1').approvalStatus).toBe('rejected')
  })

  it('sin cobro reembolsable (pagó en mostrador) rechaza igual con refundedAmount 0', async () => {
    const cash = { id: 'p9', reservationId: 'r1', hotelId: HOTEL, type: 'charge', method: 'cash', status: 'completed', amount: 100, stripeSessionId: '', stripePaymentId: '' }
    const h = harness([pendingItem()], { r1: [cash] })

    const out = await rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)

    expect(h.refunds).toHaveLength(0)
    expect(out.status).toBe('cancelled')
    expect(out.refundedAmount).toBe(0)
    expect(out.refundAmount).toBe(0)
    await new Promise((r) => setTimeout(r, 0))
    expect(h.notified[0].variables.refund_amount).toBe('0.00 USD')
  })

  it('el fallo del email NO deshace el rechazo', async () => {
    const h = harness([pendingItem()], { r1: [webCharge('p1', 'r1', 100)] }, { notifyGuest: async () => { throw new Error('smtp caído') } })
    const out = await rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)
    await new Promise((r) => setTimeout(r, 0))
    expect(out.status).toBe('cancelled')
  })
})

describe('rejectReservation — validaciones y estados', () => {
  it('400 sin reason', async () => {
    const h = harness([pendingItem()], {})
    await expect(rejectReservation(h.deps, 'r1', {}, userSameHotel, realAuth)).rejects.toThrow(ValidationError)
    expect(h.repo.store.get('r1').status).toBe('confirmed')
  })

  it('400 con reason de 5 caracteres', async () => {
    const h = harness([pendingItem()], {})
    await expect(rejectReservation(h.deps, 'r1', { reason: 'corto' }, userSameHotel, realAuth)).rejects.toThrow(ValidationError)
  })

  it('404 si la reserva no existe', async () => {
    const h = harness([], {})
    await expect(rejectReservation(h.deps, 'nope', { reason: REASON }, userSameHotel, realAuth)).rejects.toThrow(NotFoundError)
  })

  it('409 sobre una reserva ya aprobada', async () => {
    const h = harness([pendingItem({ approvalStatus: 'approved' })], {})
    await expect(rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)).rejects.toThrow(ConflictError)
  })

  it('409 sobre una reserva pendiente pero ya cancelada', async () => {
    const h = harness([pendingItem({ status: 'cancelled' })], {})
    await expect(rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)).rejects.toThrow(ConflictError)
    expect(h.refunds).toHaveLength(0)
  })

  it('bloquea al usuario de otro hotel (no super_admin) — Auth real', async () => {
    const h = harness([pendingItem()], { r1: [webCharge('p1', 'r1', 100)] })
    // Criterio del issue: de otro hotel → 404 (NotFoundError), no 403: no se revela que el id existe.
    await expect(rejectReservation(h.deps, 'r1', { reason: REASON }, { id: 'u2', role: 'hotel_admin', hotelId: OTRO_HOTEL }, realAuth)).rejects.toThrow(NotFoundError)
    expect(h.refunds).toHaveLength(0)
    expect(h.repo.store.get('r1').status).toBe('confirmed')
  })

  it('deja pasar al super_admin de otro hotel', async () => {
    const h = harness([pendingItem()], { r1: [webCharge('p1', 'r1', 100)] })
    const out = await rejectReservation(h.deps, 'r1', { reason: REASON }, { id: 'u3', role: 'super_admin', hotelId: OTRO_HOTEL }, realAuth)
    expect(out.approvalStatus).toBe('rejected')
  })
})

describe('rejectReservation — reembolso fail-loud', () => {
  it('si el refund tira, propaga y la reserva NO se toca', async () => {
    const h = harness([pendingItem()], { r1: [webCharge('p1', 'r1', 100)] }, {
      refund: { refundPayment: async () => { throw new Error('Stripe: rate limited') } },
    })

    await expect(rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)).rejects.toThrow(/Stripe/)

    const r = h.repo.store.get('r1')
    expect(r.status).toBe('confirmed')
    expect(r.approvalStatus).toBe('pending')
    expect(h.emitted).toHaveLength(0)
    expect(h.pushed).toHaveLength(0)
    expect(h.notified).toHaveLength(0)
  })

  it('sin puerto de reembolso cableado y con cobro web → Error claro, nada se rechaza (fail-closed)', async () => {
    const h = harness([pendingItem()], { r1: [webCharge('p1', 'r1', 100)] }, { refund: undefined })
    await expect(rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)).rejects.toThrow(/puerto de reembolso/)
    expect(h.repo.store.get('r1').status).toBe('confirmed')
  })
})

describe('rejectReservation — grupo (un solo cobro en la líder)', () => {
  it('rechaza las 3 hermanas, reembolsa UNA vez el total, cancela el grupo y avisa UNA vez', async () => {
    const lead = pendingItem({ id: 'r1', groupId: 'grp-1', roomId: 'room-1' })
    const s2 = pendingItem({ id: 'r2', groupId: 'grp-1', roomId: 'room-2' })
    const s3 = pendingItem({ id: 'r3', groupId: 'grp-1', roomId: 'room-3' })
    const h = harness([lead, s2, s3], { r1: [webCharge('p1', 'r1', 300)] })

    const out = await rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)

    expect(out.rejectedCount).toBe(3)
    expect(out.refundedAmount).toBe(300)
    for (const id of ['r1', 'r2', 'r3']) {
      expect(h.repo.store.get(id).status).toBe('cancelled')
      expect(h.repo.store.get(id).approvalStatus).toBe('rejected')
      expect(h.repo.store.get(id).cancellationReason).toBe(REASON)
    }
    // El snapshot de refund va donde estaba el cobro (líder); las hermanas quedan en 0.
    expect(h.repo.store.get('r1').refundAmount).toBe(300)
    expect(h.repo.store.get('r2').refundAmount).toBe(0)

    expect(h.refunds).toHaveLength(1)
    expect(h.refunds[0]).toEqual(['p1', 300, userSameHotel])
    expect(h.emitted).toHaveLength(3)
    expect(h.pushed.map(([, r]) => r).sort()).toEqual(['room-1', 'room-2', 'room-3'])
    expect(h.groupUpdates).toEqual([['grp-1', { status: 'cancelled' }]])

    await new Promise((r) => setTimeout(r, 0))
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].reservationId).toBe('r1')
    expect(h.notified[0].variables.refund_amount).toBe('300.00 USD')
  })

  it('una hermana ya cancelada por otro camino no se toca (y no se cuenta)', async () => {
    const lead = pendingItem({ id: 'r1', groupId: 'grp-1' })
    const s2 = pendingItem({ id: 'r2', groupId: 'grp-1', status: 'cancelled' })
    const h = harness([lead, s2], { r1: [webCharge('p1', 'r1', 200)] })

    const out = await rejectReservation(h.deps, 'r1', { reason: REASON }, userSameHotel, realAuth)

    expect(out.rejectedCount).toBe(1)
    expect(h.emitted).toHaveLength(1)
    expect(h.repo.store.get('r2').approvalStatus).toBe('pending') // intacta
  })
})

// ── Controller: validación del body y mapeo de errores a HTTP ──────────────────────────────
function makeController(service: { reject: (id: string, dto: any, user: any) => Promise<any> }) {
  return new ReservasController(
    service as any, noopLogger,
    {} as any, {} as any, {} as any, {} as any, {} as any,
  )
}

describe('ReservasController.reject — HTTP', () => {
  it('400 sin reason en el body (no llega al service)', async () => {
    let called = false
    const c = makeController({ reject: async () => { called = true; return {} } })
    const res = await c.reject({ params: { id: 'r1' }, body: {}, user: userSameHotel } as any)
    expect(res.status).toBe(400)
    expect(called).toBe(false)
  })

  it('400 con reason menor a 10 caracteres', async () => {
    const c = makeController({ reject: async () => ({}) })
    const res = await c.reject({ params: { id: 'r1' }, body: { reason: 'corto' }, user: userSameHotel } as any)
    expect(res.status).toBe(400)
  })

  it('409 cuando el service tira ConflictError', async () => {
    const c = makeController({ reject: async () => { throw new ConflictError('ya aprobada') } })
    const res = await c.reject({ params: { id: 'r1' }, body: { reason: REASON }, user: userSameHotel } as any)
    expect(res.status).toBe(409)
  })

  it('404 cuando el service tira NotFoundError', async () => {
    const c = makeController({ reject: async () => { throw new NotFoundError('no existe') } })
    const res = await c.reject({ params: { id: 'r1' }, body: { reason: REASON }, user: userSameHotel } as any)
    expect(res.status).toBe(404)
  })

  it('200 con el resultado del service y el reason trimeado', async () => {
    let received: any = null
    const c = makeController({ reject: async (_id, dto) => { received = dto; return { id: 'r1', status: 'cancelled', refundedAmount: 100 } } })
    const res = await c.reject({ params: { id: 'r1' }, body: { reason: `  ${REASON}  ` }, user: userSameHotel } as any)
    expect(res.status).toBe(200)
    expect(received.reason).toBe(REASON)
    expect((res.body as any).refundedAmount).toBe(100)
  })
})
