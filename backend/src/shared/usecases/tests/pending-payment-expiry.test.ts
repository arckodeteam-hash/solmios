// shared/usecases/tests/pending-payment-expiry.test.ts — Vencimiento de reservas web sin pago (#248, #266).
//
// World en memoria: arrays por tabla + puertos fake. `cancel` marca `cancelled` en el array
// (idempotente si ya estaba) para que una segunda corrida vea el estado que dejó la primera.
// Criterio #266: vence por `paymentDeadlineAt < now` (null = nunca), deposit 0, sin `payments`
// completed ni intento reciente/link pendiente; pending web solamente.
import { describe, it, expect } from 'bun:test'
import { runPendingPaymentExpiry, expirePendingReservation, type PendingPaymentExpiryDeps } from '../pending-payment-expiry'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const HOTEL = 'hotel-a'
const NOW = new Date('2026-09-11T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()
const minutesAhead = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString()

const matches = (f: Record<string, unknown>) => (row: any) => Object.entries(f).every(([k, v]) => row[k] === v)

interface World {
  reservations: any[]
  payments: any[]
  paymentRequests: any[]
  cancelCalls: Array<{ id: string; hotelId: string }>
  pushCalls: Array<{ hotelId: string; roomId: string }>
  groupUpdates: Array<{ id: string; data: Record<string, unknown> }>
  audits: any[]
  emails: Array<{ to: string; subject: string; html: string; opts?: Record<string, unknown> }>
  deps: PendingPaymentExpiryDeps
}

function world(over: Partial<Pick<World, 'reservations' | 'payments' | 'paymentRequests'>> = {}): World {
  const w: World = {
    reservations: over.reservations ?? [],
    payments: over.payments ?? [],
    paymentRequests: over.paymentRequests ?? [],
    cancelCalls: [], pushCalls: [], groupUpdates: [], audits: [], emails: [],
    deps: null as any,
  }
  w.deps = {
    reservations: { findMany: async (q) => w.reservations.filter(matches(q)) },
    payments: { findMany: async (q) => w.payments.filter(matches(q)) },
    paymentRequests: { findMany: async (q) => w.paymentRequests.filter(matches(q)) },
    guests: { findById: async (id) => (id === 'g1' ? { id: 'g1', email: 'guest@example.com' } : null) },
    hotels: { findById: async (id) => (id === HOTEL ? { id: HOTEL, slug: 'hotel-a', name: 'Hotel A' } : null) },
    cancel: async (id, hotelId) => {
      w.cancelCalls.push({ id, hotelId })
      const r = w.reservations.find((x) => x.id === id && x.hotelId === hotelId)
      if (!r) return { ok: false, message: 'not_found' }
      if (r.status === 'cancelled') return { ok: true, idempotent: true }
      r.status = 'cancelled'
      r.cancellationReason = 'payment_timeout'
      return { ok: true, idempotent: false }
    },
    audit: { record: async (e) => { w.audits.push(e) } },
    email: { enqueue: async (to, subject, html, opts) => { w.emails.push({ to, subject, html, opts }); return { sent: true } } },
    publicBaseUrl: 'https://solmios.test',
    logger: noopLogger,
    pushAvailability: (hotelId, roomId) => { w.pushCalls.push({ hotelId, roomId }) },
    groups: { update: async (id, data) => { w.groupUpdates.push({ id, data }); return null } },
  }
  return w
}

/** Pending web con deadline vencida hace 1 min (elegible por defecto). */
const webPending = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', guestId: 'g1', status: 'pending', accessToken: 'tok-1',
  createdAt: hoursAgo(2), paymentDeadlineAt: minutesAgo(1), deposit: 0, ...over,
})

describe('runPendingPaymentExpiry', () => {
  it('feliz: deadline vencida hace 1 min → cancel payment_timeout, audit expired_unpaid, correo y pushAvailability(hotelId, roomId)', async () => {
    const w = world({ reservations: [webPending()] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)

    expect(out).toMatchObject({ scanned: 1, expired: 1, skipped: 0, errors: [] })
    expect(w.cancelCalls).toEqual([{ id: 'r1', hotelId: HOTEL }])
    expect(w.reservations[0]).toMatchObject({ status: 'cancelled', cancellationReason: 'payment_timeout' })
    expect(w.pushCalls).toEqual([{ hotelId: HOTEL, roomId: 'room-1' }])
    expect(w.audits).toHaveLength(1)
    expect(w.audits[0]).toMatchObject({ hotelId: HOTEL, action: 'reservation.expired_unpaid', entity: 'reservation', entityId: 'r1' })
    // El detail dice la fecha límite, no un "TTL N h".
    expect(w.audits[0].detail).toContain(minutesAgo(1))
    expect(w.audits[0].detail).not.toContain('TTL')
    expect(w.emails).toHaveLength(1)
    expect(w.emails[0].to).toBe('guest@example.com')
    expect(w.emails[0].subject).toContain('venció')
    expect(w.emails[0].html).toContain('https://solmios.test/book/hotel-a')
    expect(w.emails[0].opts).toEqual({ hotelId: 'hotel-a', reservationId: 'r1' })
    expect(w.groupUpdates).toHaveLength(0)
  })

  it('deadline en now+1min → intacta (not_due)', async () => {
    const w = world({ reservations: [webPending({ paymentDeadlineAt: minutesAhead(1) })] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 1, expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
    expect(w.reservations[0].status).toBe('pending')
    expect(w.pushCalls).toHaveLength(0)
  })

  it('paymentDeadlineAt null (reserva anterior a #266) → nunca vence, aunque tenga 100 h', async () => {
    const w = world({ reservations: [webPending({ paymentDeadlineAt: null, createdAt: hoursAgo(100) })] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 1, expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
    expect(w.reservations[0].status).toBe('pending')
  })

  it('paymentDeadlineAt no parseable → intacta', async () => {
    const w = world({ reservations: [webPending({ paymentDeadlineAt: 'nope' })] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('con payments completed (aunque viejo) → intacta', async () => {
    const w = world({
      reservations: [webPending()],
      payments: [{ id: 'p1', reservationId: 'r1', status: 'completed', createdAt: hoursAgo(29), processedAt: hoursAgo(29) }],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
    expect(w.reservations[0].status).toBe('pending')
  })

  it('con deposit > 0 → intacta (ya hay dinero cobrado)', async () => {
    const w = world({ reservations: [webPending({ deposit: 50 })] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('un pago failed hace 10 min (intento reciente en la pasarela) → NO vence', async () => {
    const w = world({
      reservations: [webPending()],
      payments: [{ id: 'p1', reservationId: 'r1', status: 'failed', createdAt: minutesAgo(10) }],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
    expect(w.reservations[0].status).toBe('pending')
  })

  it('un payment_request pending → NO vence', async () => {
    const w = world({
      reservations: [webPending()],
      paymentRequests: [{ id: 'pr1', reservationId: 'r1', status: 'pending' }],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('pending sin accessToken y source direct (creada desde el panel) → NO vence', async () => {
    const w = world({ reservations: [webPending({ accessToken: null, source: 'direct' })] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 0, expired: 0 })
    expect(w.cancelCalls).toHaveLength(0)
    expect(w.reservations[0].status).toBe('pending')
  })

  it('grupo de 3 con la líder vencida → las 3 cancelled, 3 push y groups.update(groupId, {status:cancelled})', async () => {
    const w = world({
      reservations: [
        webPending({ id: 'r1', groupId: 'grp', roomId: 'room-1' }),
        webPending({ id: 'r2', groupId: 'grp', roomId: 'room-2' }),
        webPending({ id: 'r3', groupId: 'grp', roomId: 'room-3' }),
      ],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 3, expired: 3, skipped: 0, errors: [] })
    expect(w.cancelCalls.map((c) => c.id).sort()).toEqual(['r1', 'r2', 'r3'])
    expect(w.reservations.map((r) => r.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(w.pushCalls.map((c) => c.roomId).sort()).toEqual(['room-1', 'room-2', 'room-3'])
    expect(w.groupUpdates).toEqual([{ id: 'grp', data: { status: 'cancelled' } }])
    expect(w.audits).toHaveLength(3)
  })

  it('grupo entero o nada: dos hermanas vencidas, una con pago completed → ninguna vence ni se toca el grupo', async () => {
    const w = world({
      reservations: [webPending({ id: 'r1', groupId: 'grp' }), webPending({ id: 'r2', groupId: 'grp' })],
      payments: [{ id: 'p1', reservationId: 'r2', status: 'completed', createdAt: hoursAgo(29) }],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 2, expired: 0, skipped: 2 })
    expect(w.cancelCalls).toHaveLength(0)
    expect(w.reservations.map((r) => r.status)).toEqual(['pending', 'pending'])
    expect(w.groupUpdates).toHaveLength(0)
  })

  it('grupo: una hermana con deadline futura frena a todas', async () => {
    const w = world({
      reservations: [webPending({ id: 'r1', groupId: 'grp' }), webPending({ id: 'r2', groupId: 'grp', paymentDeadlineAt: minutesAhead(5) })],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 2 })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('grupo: si el cancel de una hermana tira, se corta el grupo con el error bien atribuido, el grupo NO se marca y la próxima corrida lo completa', async () => {
    const w = world({
      reservations: [webPending({ id: 'r1', groupId: 'grp' }), webPending({ id: 'r2', groupId: 'grp' }), webPending({ id: 'r3', groupId: 'grp' })],
    })
    const realCancel = w.deps.cancel
    let fail = true
    w.deps.cancel = async (id, hotelId) => {
      if (fail && id === 'r2') throw new Error('stripe down')
      return realCancel(id, hotelId)
    }
    const first = await runPendingPaymentExpiry(w.deps, NOW)
    expect(first.expired).toBe(1)
    expect(first.errors).toEqual([{ reservationId: 'r2', reason: 'stripe down' }])
    expect(w.reservations.map((r) => r.status)).toEqual(['cancelled', 'pending', 'pending'])
    expect(w.groupUpdates).toHaveLength(0)

    fail = false
    const second = await runPendingPaymentExpiry(w.deps, NOW)
    expect(second.expired).toBe(2)
    expect(second.errors).toHaveLength(0)
    expect(w.reservations.map((r) => r.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(w.groupUpdates).toEqual([{ id: 'grp', data: { status: 'cancelled' } }])
  })

  it('groups.update que tira es best-effort: las reservas igual vencen y no hay error', async () => {
    const w = world({ reservations: [webPending({ id: 'r1', groupId: 'grp' }), webPending({ id: 'r2', groupId: 'grp' })] })
    w.deps.groups = { update: async () => { throw new Error('db down') } }
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 2, errors: [] })
    expect(w.reservations.map((r) => r.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('segunda corrida sobre el mismo estado → expired 0 y cancel no llamado', async () => {
    const w = world({ reservations: [webPending()] })
    await runPendingPaymentExpiry(w.deps, NOW)
    w.cancelCalls.length = 0
    const again = await runPendingPaymentExpiry(w.deps, NOW)
    expect(again).toMatchObject({ scanned: 0, expired: 0 })
    expect(w.cancelCalls).toHaveLength(0)
    expect(w.audits).toHaveLength(1)
    expect(w.emails).toHaveLength(1)
    expect(w.pushCalls).toHaveLength(1)
  })

  it('sin pushAvailability ni groups cableados (compat) → vence igual', async () => {
    const w = world({ reservations: [webPending({ groupId: 'grp' })] })
    delete w.deps.pushAvailability
    delete w.deps.groups
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 1, errors: [] })
    expect(w.reservations[0].status).toBe('cancelled')
  })

  it('sin roomId no se llama a pushAvailability', async () => {
    const w = world({ reservations: [webPending({ roomId: null })] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out.expired).toBe(1)
    expect(w.pushCalls).toHaveLength(0)
  })

  it('el correo es best-effort: si enqueue tira, la reserva igual venció y no hay error', async () => {
    const w = world({ reservations: [webPending()] })
    w.deps.email = { enqueue: async () => { throw new Error('smtp down') } }
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 1, errors: [] })
    expect(w.reservations[0].status).toBe('cancelled')
  })

  it('sin publicBaseUrl el link es relativo /book/<slug>', async () => {
    const w = world({ reservations: [webPending()] })
    w.deps.publicBaseUrl = ''
    await runPendingPaymentExpiry(w.deps, NOW)
    expect(w.emails[0].html).toContain('href="/book/hotel-a"')
  })
})

describe('expirePendingReservation (una reserva — webhook checkout.session.expired)', () => {
  it('vencida → { expired: true } y la reserva queda cancelled con push y audit', async () => {
    const w = world({ reservations: [webPending()] })
    const out = await expirePendingReservation(w.deps, 'r1', HOTEL, NOW)
    expect(out).toMatchObject({ expired: true, expiredCount: 1, errors: [] })
    expect(w.reservations[0].status).toBe('cancelled')
    expect(w.pushCalls).toEqual([{ hotelId: HOTEL, roomId: 'room-1' }])
    expect(w.audits).toHaveLength(1)
  })

  it('no existe / otro hotel → not_found', async () => {
    const w = world({ reservations: [webPending()] })
    expect(await expirePendingReservation(w.deps, 'nope', HOTEL, NOW)).toMatchObject({ expired: false, reason: 'not_found' })
    expect(await expirePendingReservation(w.deps, 'r1', 'hotel-b', NOW)).toMatchObject({ expired: false, reason: 'not_found' })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('confirmed → not_pending sin tocar nada', async () => {
    const w = world({ reservations: [webPending({ status: 'confirmed', deposit: 200 })] })
    const out = await expirePendingReservation(w.deps, 'r1', HOTEL, NOW)
    expect(out).toMatchObject({ expired: false, reason: 'not_pending' })
    expect(w.reservations[0]).toMatchObject({ status: 'confirmed', deposit: 200 })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('motivos: has_payment, not_due, no_deadline, has_deposit, not_web', async () => {
    const w = world({
      reservations: [
        webPending({ id: 'pay' }),
        webPending({ id: 'due', paymentDeadlineAt: minutesAhead(1) }),
        webPending({ id: 'nodl', paymentDeadlineAt: null }),
        webPending({ id: 'dep', deposit: 10 }),
        webPending({ id: 'panel', accessToken: null, source: 'direct' }),
      ],
      payments: [{ id: 'p1', reservationId: 'pay', status: 'completed', createdAt: hoursAgo(5) }],
    })
    expect((await expirePendingReservation(w.deps, 'pay', HOTEL, NOW)).reason).toBe('has_payment')
    expect((await expirePendingReservation(w.deps, 'due', HOTEL, NOW)).reason).toBe('not_due')
    expect((await expirePendingReservation(w.deps, 'nodl', HOTEL, NOW)).reason).toBe('no_deadline')
    expect((await expirePendingReservation(w.deps, 'dep', HOTEL, NOW)).reason).toBe('has_deposit')
    expect((await expirePendingReservation(w.deps, 'panel', HOTEL, NOW)).reason).toBe('not_web')
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('grupo: llamada sobre una hermana vence el grupo entero y marca el grupo', async () => {
    const w = world({
      reservations: [webPending({ id: 'r1', groupId: 'grp' }), webPending({ id: 'r2', groupId: 'grp' }), webPending({ id: 'r3', groupId: 'grp' })],
    })
    const out = await expirePendingReservation(w.deps, 'r2', HOTEL, NOW)
    expect(out).toMatchObject({ expired: true, expiredCount: 3 })
    expect(w.reservations.map((r) => r.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(w.groupUpdates).toEqual([{ id: 'grp', data: { status: 'cancelled' } }])
  })

  it('grupo con una hermana que no vence → group_not_due si la propia es elegible', async () => {
    const w = world({
      reservations: [webPending({ id: 'r1', groupId: 'grp' }), webPending({ id: 'r2', groupId: 'grp', paymentDeadlineAt: minutesAhead(5) })],
    })
    expect(await expirePendingReservation(w.deps, 'r1', HOTEL, NOW)).toMatchObject({ expired: false, reason: 'group_not_due', skippedCount: 2 })
    expect(await expirePendingReservation(w.deps, 'r2', HOTEL, NOW)).toMatchObject({ expired: false, reason: 'not_due' })
  })
})
