// shared/usecases/tests/pending-payment-expiry.test.ts — Vencimiento de reservas web sin pago (#248).
//
// World en memoria: arrays por tabla + puertos fake. `cancel` marca `cancelled` en el array
// (idempotente si ya estaba) para que una segunda corrida vea el estado que dejó la primera.
import { describe, it, expect } from 'bun:test'
import { runPendingPaymentExpiry, type PendingPaymentExpiryDeps } from '../pending-payment-expiry'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const HOTEL = 'hotel-a'
const NOW = new Date('2026-09-11T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

const matches = (f: Record<string, unknown>) => (row: any) => Object.entries(f).every(([k, v]) => row[k] === v)

interface World {
  reservations: any[]
  bookingConfig: any[]
  payments: any[]
  paymentRequests: any[]
  cancelCalls: Array<{ id: string; hotelId: string }>
  audits: any[]
  emails: Array<{ to: string; subject: string; html: string }>
  deps: PendingPaymentExpiryDeps
}

function world(over: Partial<Pick<World, 'reservations' | 'bookingConfig' | 'payments' | 'paymentRequests'>> = {}): World {
  const w: World = {
    reservations: over.reservations ?? [],
    bookingConfig: over.bookingConfig ?? [{ hotelId: HOTEL, pendingPaymentTtlHours: 24 }],
    payments: over.payments ?? [],
    paymentRequests: over.paymentRequests ?? [],
    cancelCalls: [], audits: [], emails: [],
    deps: null as any,
  }
  w.deps = {
    reservations: { findMany: async (q) => w.reservations.filter(matches(q)) },
    bookingConfig: { findMany: async (q) => w.bookingConfig.filter(matches(q)) },
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
      return { ok: true, idempotent: false }
    },
    audit: { record: async (e) => { w.audits.push(e) } },
    email: { enqueue: async (to, subject, html, opts) => { w.emails.push({ to, subject, html, opts }); return { sent: true } } },
    publicBaseUrl: 'https://solmios.test',
    logger: noopLogger,
  }
  return w
}

const webPending = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, guestId: 'g1', status: 'pending', accessToken: 'tok-1', createdAt: hoursAgo(30), ...over,
})

describe('runPendingPaymentExpiry', () => {
  it('feliz: pending web de 30 h con TTL 24 → cancel, audit expired_unpaid y correo al huésped', async () => {
    const w = world({ reservations: [webPending()] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)

    expect(out).toMatchObject({ scanned: 1, expired: 1, skipped: 0, errors: [] })
    expect(w.cancelCalls).toEqual([{ id: 'r1', hotelId: HOTEL }])
    expect(w.reservations[0].status).toBe('cancelled')
    expect(w.audits).toHaveLength(1)
    expect(w.audits[0]).toMatchObject({ hotelId: HOTEL, action: 'reservation.expired_unpaid', entity: 'reservation', entityId: 'r1' })
    expect(w.audits[0].detail).toContain('TTL 24 h')
    expect(w.emails).toHaveLength(1)
    expect(w.emails[0].to).toBe('guest@example.com')
    expect(w.emails[0].subject).toContain('venció')
    expect(w.emails[0].html).toContain('https://solmios.test/book/hotel-a')
    expect(w.emails[0].opts).toEqual({ hotelId: 'hotel-a', reservationId: 'r1' })
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

  it('un pago completed (aunque viejo) → NO vence', async () => {
    const w = world({
      reservations: [webPending()],
      payments: [{ id: 'p1', reservationId: 'r1', status: 'completed', createdAt: hoursAgo(29), processedAt: hoursAgo(29) }],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('TTL 0 en el hotel → nunca vence, aunque tenga 100 h', async () => {
    const w = world({
      reservations: [webPending({ createdAt: hoursAgo(100) })],
      bookingConfig: [{ hotelId: HOTEL, pendingPaymentTtlHours: 0 }],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 1, expired: 0, skipped: 1 })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('grupo entero o nada: dos hermanas viejas, una con pago completed → ninguna vence', async () => {
    const w = world({
      reservations: [webPending({ id: 'r1', groupId: 'grp' }), webPending({ id: 'r2', groupId: 'grp' })],
      payments: [{ id: 'p1', reservationId: 'r2', status: 'completed', createdAt: hoursAgo(29) }],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out.expired).toBe(0)
    expect(w.cancelCalls).toHaveLength(0)
    expect(w.reservations.map((r) => r.status)).toEqual(['pending', 'pending'])
  })

  it('grupo entero elegible → vencen todas las hermanas (una sola pasada por grupo)', async () => {
    const w = world({
      reservations: [webPending({ id: 'r1', groupId: 'grp' }), webPending({ id: 'r2', groupId: 'grp' })],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out.expired).toBe(2)
    expect(w.cancelCalls.map((c) => c.id).sort()).toEqual(['r1', 'r2'])
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
  })

  it('pending sin accessToken y source direct (creada desde el panel) → NO vence', async () => {
    const w = world({ reservations: [webPending({ accessToken: null, source: 'direct' })] })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 0, expired: 0 })
    expect(w.cancelCalls).toHaveLength(0)
  })

  it('sin config del hotel → default 24 h: la de 20 h no vence, la de 30 h sí', async () => {
    const w = world({
      reservations: [webPending({ id: 'young', createdAt: hoursAgo(20) }), webPending({ id: 'old', createdAt: hoursAgo(30) })],
      bookingConfig: [],
    })
    const out = await runPendingPaymentExpiry(w.deps, NOW)
    expect(out).toMatchObject({ scanned: 2, expired: 1, skipped: 1 })
    expect(w.cancelCalls).toEqual([{ id: 'old', hotelId: HOTEL }])
    expect(w.reservations.find((r) => r.id === 'young')!.status).toBe('pending')
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
