// bookingengine/tests/pending-expiry-availability.test.ts — Integración 5.4 de #248 (REQ-RWP-05) + #266.
//
// Una reserva web `pending` bloquea la habitación en el motor público. Cuando pasa su fecha
// límite de pago (`paymentDeadlineAt`, #266), `runPendingPaymentExpiry` la cancela por el camino
// REAL de `reservas` (`cancelReservationBySystem` en modo `no-charge`) — no con un update
// directo — y con eso:
//   (a) el motor vuelve a ofrecer la habitación (una `cancelled` no ocupa),
//   (b) `onReservationCancelled` sale con `refundAmount: 0`, que es lo que los connectors
//       existentes escuchan para liberar disponibilidad/depósitos, y
//   (c) `pushAvailability(hotelId, roomId)` empuja la habitación liberada a las OTAs.
//
// Un solo world en memoria: el repo de reservas es el MISMO objeto para los tres usecases, así
// que lo que muta uno lo ve el siguiente sin ningún cableado extra.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { AvailabilityUseCase } from '../usecases/availability'
import { runPendingPaymentExpiry, type PendingPaymentExpiryDeps } from '../../../shared/usecases/pending-payment-expiry'
import { cancelReservationBySystem } from '../../reservas/usecases/cancel-system'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as unknown as CacheAdapter

const HOTEL = 'hotel-a'
const ROOM = 'room-1'
const NOW = new Date('2026-09-11T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()
const minutesAhead = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString()
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString().slice(0, 10)

const CHECK_IN = daysAhead(5)
const CHECK_OUT = daysAhead(7)

const matches = (f: Record<string, unknown>) => (row: any) => Object.entries(f).every(([k, v]) => row[k] === v)

/** Repo mínimo sobre un array: findMany filtra por igualdad, update MUTA la fila (estado compartido). */
function arrayRepo(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async (q: Record<string, unknown> = {}) => rows.filter(matches(q)),
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    findOne: async (q: Record<string, unknown> = {}) => rows.find(matches(q)) ?? null,
    update: async (id: string, patch: any) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, patch)
      return row
    },
  } as unknown as RepositoryAdapter<any>
}

function world(reservationOver: Record<string, any> = {}, payments: any[] = []) {
  const Reservations: any[] = [{
    id: 'r1', hotelId: HOTEL, roomId: ROOM, guestId: 'g1', status: 'pending', source: 'direct',
    accessToken: 'tok-1', createdAt: hoursAgo(2), paymentDeadlineAt: minutesAgo(1),
    checkIn: CHECK_IN, checkOut: CHECK_OUT, deposit: 0, ...reservationOver,
  }]
  const Rooms = [{ id: ROOM, hotelId: HOTEL, type: 'double', capacity: 2, surfaceArea: 22, basePrice: 80, status: 'available' }]
  const Hotels = [{ id: HOTEL, name: 'Hotel A', slug: 'hotel-a' }]
  const Payments: any[] = payments
  const PaymentRequests: any[] = []

  const reservationsRepo = arrayRepo(Reservations)
  const socketCalls: any[] = []
  const audits: any[] = []
  const emails: any[] = []
  const pushCalls: Array<{ hotelId: string; roomId: string }> = []

  const cancelDeps = {
    repo: reservationsRepo,
    policyRepo: { findMany: async () => { throw new Error('no debe consultar política') } } as any,
    logger: noopLogger,
    cache: noopCache,
    sockets: { onReservationCancelled: async (d: any) => { socketCalls.push(d) } },
    releaseChargeSessions: async () => {},
  }

  const expiryDeps: PendingPaymentExpiryDeps = {
    reservations: reservationsRepo,
    payments: arrayRepo(Payments),
    paymentRequests: arrayRepo(PaymentRequests),
    guests: { findById: async (id) => (id === 'g1' ? { id: 'g1', email: 'guest@example.com' } : null) },
    hotels: arrayRepo(Hotels),
    // Camino REAL de cancelación: cancelReservationBySystem en modo no-charge, sobre el mismo repo.
    cancel: (id, hotelId) => cancelReservationBySystem(cancelDeps, id, { hotelId, reason: 'payment_timeout', penaltyMode: 'no-charge' }),
    audit: { record: async (e) => { audits.push(e) } },
    email: { enqueue: async (to, subject, html, opts) => { emails.push({ to, subject, html, opts }); return { sent: true } } },
    publicBaseUrl: 'https://solmios.test',
    logger: noopLogger,
    pushAvailability: (hotelId, roomId) => { pushCalls.push({ hotelId, roomId }) },
  }

  const availability = new AvailabilityUseCase(noopCache, arrayRepo(Rooms), reservationsRepo, arrayRepo(Hotels))

  return { Reservations, availability, expiryDeps, socketCalls, audits, emails, pushCalls }
}

const query = { hotelId: HOTEL, checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2 } as any
const availableDoubles = (r: any) => r.roomTypes.find((t: any) => t.roomType === 'double')?.available ?? 0

describe('#248 5.4 — vencimiento de reserva web sin pago libera la habitación en el motor público', () => {
  it('pending bloquea → expiry cancela por cancelBySystem (no-charge) → disponible; socket con refundAmount 0', async () => {
    const w = world()

    // 1. Antes: la pending web ocupa room-1 → el motor no la ofrece.
    const before = await w.availability.check(query)
    expect(before.roomTypes.map((t) => t.roomType)).not.toContain('double')
    expect(availableDoubles(before)).toBe(0)

    // 2. Corre el expiry: vence 1, la reserva queda cancelada con snapshot no-charge.
    const out = await runPendingPaymentExpiry(w.expiryDeps, NOW)
    expect(out).toMatchObject({ scanned: 1, expired: 1, errors: [] })

    const r1 = w.Reservations[0]
    expect(r1).toMatchObject({
      id: 'r1', status: 'cancelled', cancellationReason: 'payment_timeout', refundAmount: 0, cancellationFee: 0,
    })
    expect(r1.cancelledAt).toBeTruthy()
    expect(r1.policyApplied?.policyId).toBe('payment_timeout')

    // La liberación pasa por el evento del camino de cancelación existente, no por un update directo.
    expect(w.socketCalls).toHaveLength(1)
    expect(w.socketCalls[0]).toMatchObject({ reservationId: 'r1', hotelId: HOTEL, refundAmount: 0 })

    // #266: la habitación liberada se empuja a las OTAs.
    expect(w.pushCalls).toEqual([{ hotelId: HOTEL, roomId: ROOM }])

    // Side-effects del expiry sobre el mismo mundo: auditoría + correo al huésped.
    expect(w.audits).toHaveLength(1)
    expect(w.audits[0]).toMatchObject({ action: 'reservation.expired_unpaid', entityId: 'r1', hotelId: HOTEL })
    expect(w.emails).toHaveLength(1)
    expect(w.emails[0].to).toBe('guest@example.com')

    // 3. Después: room-1 vuelve a estar disponible para esas mismas fechas.
    const after = await w.availability.check(query)
    expect(availableDoubles(after)).toBe(1)

    // 4. Segunda corrida: nada nuevo vence y el socket NO se re-emite (idempotencia real).
    const again = await runPendingPaymentExpiry(w.expiryDeps, NOW)
    expect(again.expired).toBe(0)
    expect(w.socketCalls).toHaveLength(1)
    expect(w.pushCalls).toHaveLength(1)
    expect(availableDoubles(await w.availability.check(query))).toBe(1)
  })

  it('deadline en now+1min → sigue pending y la habitación sigue bloqueada', async () => {
    const w = world({ paymentDeadlineAt: minutesAhead(1) })
    const out = await runPendingPaymentExpiry(w.expiryDeps, NOW)
    expect(out).toMatchObject({ scanned: 1, expired: 0, skipped: 1 })
    expect(w.Reservations[0].status).toBe('pending')
    expect(w.socketCalls).toHaveLength(0)
    expect(w.pushCalls).toHaveLength(0)
    expect(availableDoubles(await w.availability.check(query))).toBe(0)
  })

  it('paymentDeadlineAt null (reserva anterior a #266) → nunca vence', async () => {
    const w = world({ paymentDeadlineAt: null, createdAt: hoursAgo(100) })
    const out = await runPendingPaymentExpiry(w.expiryDeps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 1 })
    expect(w.Reservations[0].status).toBe('pending')
    expect(availableDoubles(await w.availability.check(query))).toBe(0)
  })

  it('con payments completed → intacta', async () => {
    const w = world({}, [{ id: 'p1', reservationId: 'r1', status: 'completed', createdAt: hoursAgo(1) }])
    const out = await runPendingPaymentExpiry(w.expiryDeps, NOW)
    expect(out).toMatchObject({ expired: 0, skipped: 1 })
    expect(w.Reservations[0].status).toBe('pending')
    expect(w.socketCalls).toHaveLength(0)
  })

  it('sin accessToken (creada desde el panel) → intacta', async () => {
    const w = world({ accessToken: null })
    const out = await runPendingPaymentExpiry(w.expiryDeps, NOW)
    expect(out).toMatchObject({ scanned: 0, expired: 0 })
    expect(w.Reservations[0].status).toBe('pending')
    expect(availableDoubles(await w.availability.check(query))).toBe(0)
  })
})
