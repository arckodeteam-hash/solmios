// bookingengine/tests/stripe-expired-webhook.test.ts — #266 MR-01: `checkout.session.expired` cierra la reserva.
//
// Molde: stripe-reservations.test.ts. Cubre la rama nueva de `settle()`:
//   1. outcome `expired` sobre una reserva `pending` → llama al usecase de vencimiento inyectado
//      (`setExpirePending`, el MISMO que corre el cron) y la reserva queda `cancelled`.
//   2. outcome `expired` sobre una reserva `confirmed` (pagó por otro camino / eventos
//      reordenados) → no-op: sigue `confirmed`, `deposit` intacto, expirePending NO se llama.
//   3. Sin dep cableada → comportamiento previo (`{ type: 'expired' }` sin tocar nada).
//   4. Ownership: el webhook del Hotel B no vence una reserva del Hotel A.
//   5. El usecase real (`expirePendingReservation`) enchufado a `settle()` deja la fila
//      cancelled/payment_timeout y no vence si hay un pago completed.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { StripeUseCase } from '../usecases/stripe'
import type { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import type { PaymentGateway, PaymentOutcome } from '../../../services/payment-gateway/types'
import { expirePendingReservation, type PendingPaymentExpiryDeps } from '../../../shared/usecases/pending-payment-expiry'

const log: Logger = silentLogger()
const NOW = new Date('2026-09-11T12:00:00.000Z')
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

// ─── Mocks ────────────────────────────────────────────────

function makeMockGw(outcome: PaymentOutcome | null): PaymentGateway {
  return {
    provider: 'stripe',
    mode: 'test',
    capabilities: { refund: true, void: true, paymentLinks: true, confirmation: 'push' },
    createCharge: async () => ({ status: 'redirect', redirectUrl: 'https://stripe.example/c/cs_1', providerRef: 'cs_1' }),
    confirm: async () => outcome,
  } as PaymentGateway
}

function makeMockRegistry(gw: PaymentGateway | null): PaymentGatewayRegistry {
  return {
    isConfigured: async () => gw !== null,
    resolve: async () => gw,
    invalidate: () => {},
  } as unknown as PaymentGatewayRegistry
}

const matches = (f: Record<string, unknown>) => (row: any) => Object.entries(f).every(([k, v]) => row[k] === v)

function makeReservationsRepo(initial: any[] = []): { repo: RepositoryAdapter<any>; store: any[]; updates: any[] } {
  const store = initial.map((r) => ({ ...r }))
  const updates: Array<{ id: string; patch: any }> = []
  const repo: RepositoryAdapter<any> = {
    findMany: async (q: any = {}) => store.filter(matches(q)),
    findById: async (id: string) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find(matches(q ?? {})) ?? null,
    create: async (data: any) => { store.push(data); return data },
    update: async (id: string, patch: any) => {
      updates.push({ id, patch })
      const row = store.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row ?? null
    },
    delete: async () => true,
    count: async () => store.length,
    paginate: async () => ({ data: store.slice(), total: store.length, limit: 20, offset: 0, pages: 1 }),
  }
  return { repo, store, updates }
}

const EXPIRED_OUTCOME: PaymentOutcome = {
  eventId: 'evt_expired_1',
  providerRef: 'cs_expired_1',
  status: 'expired',
  amountMinor: 20000,
  currency: 'usd',
  reference: 'res-1',
}

const PENDING_RESERVATION = {
  id: 'res-1',
  hotelId: 'hotel-A',
  roomId: 'room-1',
  guestId: 'guest-1',
  checkIn: '2026-10-10',
  checkOut: '2026-10-12',
  totalAmount: 200,
  currency: 'USD',
  status: 'pending',
  depositStatus: 'unpaid',
  paymentMethod: '',
  deposit: 0,
  pendingAmount: 200,
  accessToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  paymentDeadlineAt: minutesAgo(1),
}

const CONFIRMED_RESERVATION = {
  ...PENDING_RESERVATION,
  status: 'confirmed',
  depositStatus: 'paid',
  paymentMethod: 'card',
  deposit: 200,
  pendingAmount: 0,
}

/** Dep fake: cancela directo en el repo y registra las llamadas. */
function fakeExpirePending(repo: RepositoryAdapter<any>) {
  const calls: Array<{ reservationId: string; hotelId: string }> = []
  const fn = async (reservationId: string, hotelId: string) => {
    calls.push({ reservationId, hotelId })
    await repo.update(reservationId, { status: 'cancelled', cancellationReason: 'payment_timeout' })
    return { expired: true }
  }
  return { fn, calls }
}

// ─── Tests ────────────────────────────────────────────────

describe('StripeUseCase — checkout.session.expired (#266)', () => {
  it('expired sobre pending → llama expirePending(reservationId, hotelId) y la reserva queda cancelled', async () => {
    const { repo, store } = makeReservationsRepo([PENDING_RESERVATION])
    const { fn, calls } = fakeExpirePending(repo)
    const stripe = new StripeUseCase(repo, log, makeMockRegistry(makeMockGw(EXPIRED_OUTCOME)), undefined, undefined, undefined, fn)

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(result).toEqual({ type: 'expired', reservationId: 'res-1', expired: true })
    expect(calls).toEqual([{ reservationId: 'res-1', hotelId: 'hotel-A' }])
    expect(store[0]).toMatchObject({ status: 'cancelled', cancellationReason: 'payment_timeout' })
  })

  it('setExpirePending (post-init) cablea lo mismo que el constructor', async () => {
    const { repo, store } = makeReservationsRepo([PENDING_RESERVATION])
    const { fn, calls } = fakeExpirePending(repo)
    const stripe = new StripeUseCase(repo, log, makeMockRegistry(makeMockGw(EXPIRED_OUTCOME)))
    stripe.setExpirePending(fn)

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(result?.expired).toBe(true)
    expect(calls).toHaveLength(1)
    expect(store[0].status).toBe('cancelled')
  })

  it('expired sobre confirmed → no-op: sigue confirmed, deposit intacto, expirePending NO llamado', async () => {
    const { repo, store, updates } = makeReservationsRepo([CONFIRMED_RESERVATION])
    const { fn, calls } = fakeExpirePending(repo)
    const stripe = new StripeUseCase(repo, log, makeMockRegistry(makeMockGw(EXPIRED_OUTCOME)), undefined, undefined, undefined, fn)

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(result).toEqual({ type: 'expired', reservationId: 'res-1', expired: false })
    expect(calls).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(store[0]).toMatchObject({ status: 'confirmed', deposit: 200, depositStatus: 'paid', pendingAmount: 0 })
  })

  it('sin dep cableada → comportamiento previo: { type: "expired" } y nada cambia', async () => {
    const { repo, store, updates } = makeReservationsRepo([PENDING_RESERVATION])
    const stripe = new StripeUseCase(repo, log, makeMockRegistry(makeMockGw(EXPIRED_OUTCOME)))

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(result).toEqual({ type: 'expired' })
    expect(updates).toHaveLength(0)
    expect(store[0].status).toBe('pending')
  })

  it('ownership: el webhook del Hotel B no vence la reserva del Hotel A', async () => {
    const { repo, store } = makeReservationsRepo([PENDING_RESERVATION])
    const { fn, calls } = fakeExpirePending(repo)
    const stripe = new StripeUseCase(repo, log, makeMockRegistry(makeMockGw(EXPIRED_OUTCOME)), undefined, undefined, undefined, fn)

    const result = await stripe.handleWebhook('hotel-B', 'raw', 'sig')

    expect(result).toBeNull()
    expect(calls).toHaveLength(0)
    expect(store[0].status).toBe('pending')
  })

  it('expired sin reference → { type: "expired" } sin llamar a nada', async () => {
    const { repo } = makeReservationsRepo([PENDING_RESERVATION])
    const { fn, calls } = fakeExpirePending(repo)
    const stripe = new StripeUseCase(repo, log, makeMockRegistry(makeMockGw({ ...EXPIRED_OUTCOME, reference: '' })), undefined, undefined, undefined, fn)

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(result).toEqual({ type: 'expired' })
    expect(calls).toHaveLength(0)
  })
})

describe('StripeUseCase — checkout.session.expired con el usecase REAL de vencimiento', () => {
  const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any

  function realDeps(repo: RepositoryAdapter<any>, payments: any[] = []) {
    const pushCalls: Array<{ hotelId: string; roomId: string }> = []
    const audits: any[] = []
    const deps: PendingPaymentExpiryDeps = {
      reservations: repo,
      payments: { findMany: async (q) => payments.filter(matches(q)) },
      paymentRequests: { findMany: async () => [] },
      guests: { findById: async () => null },
      hotels: { findById: async () => ({ id: 'hotel-A', slug: 'hotel-a', name: 'Hotel A' }) },
      cancel: async (id, hotelId) => {
        const r = await repo.findOne({ id, hotelId })
        if (!r) return { ok: false, message: 'not_found' }
        if (r.status === 'cancelled') return { ok: true, idempotent: true }
        await repo.update(id, { status: 'cancelled', cancellationReason: 'payment_timeout' })
        return { ok: true }
      },
      audit: { record: async (e) => { audits.push(e) } },
      email: null,
      publicBaseUrl: '',
      logger: noopLogger,
      pushAvailability: (hotelId, roomId) => { pushCalls.push({ hotelId, roomId }) },
    }
    return { deps, pushCalls, audits }
  }

  it('pending vencida → cancelled/payment_timeout, push de la habitación y audit expired_unpaid', async () => {
    const { repo, store } = makeReservationsRepo([PENDING_RESERVATION])
    const { deps, pushCalls, audits } = realDeps(repo)
    const stripe = new StripeUseCase(repo, log, makeMockRegistry(makeMockGw(EXPIRED_OUTCOME)))
    stripe.setExpirePending((id, hotelId) => expirePendingReservation(deps, id, hotelId, NOW))

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(result).toEqual({ type: 'expired', reservationId: 'res-1', expired: true })
    expect(store[0]).toMatchObject({ status: 'cancelled', cancellationReason: 'payment_timeout' })
    expect(pushCalls).toEqual([{ hotelId: 'hotel-A', roomId: 'room-1' }])
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'reservation.expired_unpaid', entityId: 'res-1' })
  })

  it('pending con un pago completed → expired:false (has_payment) y la reserva sigue pending', async () => {
    const { repo, store } = makeReservationsRepo([PENDING_RESERVATION])
    const { deps, pushCalls } = realDeps(repo, [{ id: 'p1', reservationId: 'res-1', status: 'completed', createdAt: minutesAgo(30) }])
    const stripe = new StripeUseCase(repo, log, makeMockRegistry(makeMockGw(EXPIRED_OUTCOME)))
    stripe.setExpirePending((id, hotelId) => expirePendingReservation(deps, id, hotelId, NOW))

    const result = await stripe.handleWebhook('hotel-A', 'raw', 'sig')

    expect(result).toEqual({ type: 'expired', reservationId: 'res-1', expired: false })
    expect(store[0].status).toBe('pending')
    expect(pushCalls).toHaveLength(0)
  })
})
