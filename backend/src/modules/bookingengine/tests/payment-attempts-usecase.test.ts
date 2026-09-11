// payment-attempts-usecase.test.ts — REQ-RWP-01 (#244): el motor de reservas deja UNA fila en
// `payment_attempts` por cada outcome autenticado de la pasarela (pago, rechazo, expiración) y
// por cada checkout abierto. Es historial, no dinero: el asiento en `payment_events` y el update
// de la reserva quedan exactamente como estaban.
//
//   (a) webhook `failed`   → fila 'failed' con failureCode/last4; la reserva sigue pending.
//   (b) webhook `expired`  → fila 'expired'.
//   (c) webhook `paid`     → fila 'paid' + asiento intacto (reserva confirmed, 1 payment_event).
//   (d) mismo webhook dos veces → 1 fila por eventId y `already_processed`.
//   (e) handleReturn CardNet rechazado → fila 'failed' con provider 'cardnet'.
//   (f) createCheckoutSession → fila 'checkout_created' con providerRef y amountMinor.
//   (g) sin store inyectado el usecase sigue funcionando.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { StripeUseCase } from '../usecases/stripe'
import type { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import type { PaymentGateway, PaymentOutcome } from '../../../services/payment-gateway/types'
import { PaymentEventStore } from '../../../services/payment-gateway/payment-events'
import type { PaymentEventRow } from '../../../services/payment-gateway/payment-events'
import { PaymentAttemptStore } from '../../../services/payment-gateway/payment-attempts'
import type { PaymentAttemptRow } from '../../../services/payment-gateway/payment-attempts'

const log: Logger = silentLogger()

// ─── Mocks ────────────────────────────────────────────────

/** Repo en memoria con PK: el segundo create con el mismo id tira UNIQUE, igual que SQLite. */
function memRepo<T extends { id: string }>(table: string): { repo: RepositoryAdapter<T>; rows: T[] } {
  const byId = new Map<string, T>()
  const repo = {
    findMany: async (q: any = {}) => [...byId.values()].filter((r: any) => Object.entries(q).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => byId.get(id) ?? null,
    findOne: async (q: any) => byId.get(q?.id) ?? null,
    create: async (d: any) => {
      if (byId.has(d.id)) {
        const e = new Error(`UNIQUE constraint failed: ${table}.id='${d.id}'`)
        ;(e as any).code = 'SQLITE_CONSTRAINT'
        throw e
      }
      byId.set(d.id, d)
      return d
    },
    update: async (id: string, patch: any) => { const cur = byId.get(id); if (!cur) return null; const next = { ...cur, ...patch }; byId.set(id, next); return next },
    delete: async (id: string) => byId.delete(id),
    count: async () => byId.size,
    paginate: async () => ({ data: [...byId.values()], total: byId.size, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<T>
  return { repo, get rows() { return [...byId.values()] } }
}

const PAID: PaymentOutcome = {
  eventId: 'evt_1', providerRef: 'cs_1', status: 'paid', amountMinor: 20000, currency: 'usd', reference: 'res-1',
}
const FAILED: PaymentOutcome = {
  ...PAID, eventId: 'evt_fail_1', status: 'failed',
  failureCode: 'card_declined', failureMessage: 'Your card was declined.', card: { brand: 'visa', last4: '0002' },
}
const EXPIRED: PaymentOutcome = { ...PAID, eventId: 'evt_exp_1', status: 'expired' }

function makeMockGw(opts: { outcome?: PaymentOutcome | null; provider?: PaymentGateway['provider']; confirmation?: 'push' | 'return' | 'pull' } = {}): PaymentGateway {
  return {
    provider: opts.provider ?? 'stripe',
    mode: 'test',
    capabilities: { refund: true, void: true, paymentLinks: true, confirmation: opts.confirmation ?? 'push' },
    createCharge: async () => ({ status: 'redirect', redirectUrl: 'https://x', providerRef: 'cs_1' }),
    confirm: async () => (opts.outcome === undefined ? PAID : opts.outcome),
  } as PaymentGateway
}

const registryOf = (gw: PaymentGateway | null): PaymentGatewayRegistry =>
  ({ isConfigured: async () => gw !== null, resolve: async () => gw, invalidate: () => {} }) as unknown as PaymentGatewayRegistry

const pending = () => ({
  id: 'res-1', hotelId: 'hotel-A', roomId: 'room-1', checkIn: '2026-08-10', checkOut: '2026-08-12',
  totalAmount: 200, currency: 'USD', status: 'pending', depositStatus: 'unpaid', paymentMethod: '',
  pendingAmount: 200, accessToken: 'tok',
})

function setup(gw: PaymentGateway, opts: { withAttempts?: boolean } = {}) {
  const reservations = memRepo<any>('reservations')
  const events = memRepo<PaymentEventRow>('payment_events')
  const attempts = memRepo<PaymentAttemptRow>('payment_attempts')
  const store = opts.withAttempts === false ? undefined : new PaymentAttemptStore(attempts.repo, log)
  const uc = new StripeUseCase(reservations.repo, log, registryOf(gw), new PaymentEventStore(events.repo, log), undefined, store)
  return { uc, reservations, events, attempts }
}

// ─── Tests ────────────────────────────────────────────────

describe('payment_attempts — handleWebhook (Stripe, push)', () => {
  it('(a) rechazo → fila failed con código y last4; la reserva sigue pending y payment_events vacío', async () => {
    const { uc, reservations, events, attempts } = setup(makeMockGw({ outcome: FAILED }))
    await reservations.repo.create(pending())

    const result = await uc.handleWebhook('hotel-A', '{}', 'sig')

    expect(result).toEqual({ type: 'failed' })
    expect(attempts.rows).toHaveLength(1)
    expect(attempts.rows[0]).toMatchObject({
      id: 'stripe:evt_fail_1', kind: 'failed', source: 'booking_engine', provider: 'stripe', mode: 'test',
      hotelId: 'hotel-A', reservationId: 'res-1', eventId: 'evt_fail_1', providerRef: 'cs_1',
      failureCode: 'card_declined', failureMessage: 'Your card was declined.', cardBrand: 'visa', cardLast4: '0002',
      amountMinor: 20000, currency: 'usd',
    })
    expect(attempts.rows[0].occurredAt).toBeTruthy()
    expect((await reservations.repo.findOne({ id: 'res-1' })).status).toBe('pending')
    expect(events.rows).toHaveLength(0)
  })

  it('(b) sesión vencida → fila expired, sin asiento', async () => {
    const { uc, reservations, events, attempts } = setup(makeMockGw({ outcome: EXPIRED }))
    await reservations.repo.create(pending())

    expect(await uc.handleWebhook('hotel-A', '{}', 'sig')).toEqual({ type: 'expired' })
    expect(attempts.rows).toHaveLength(1)
    expect(attempts.rows[0]).toMatchObject({ kind: 'expired', eventId: 'evt_exp_1', reservationId: 'res-1', provider: 'stripe' })
    expect((await reservations.repo.findOne({ id: 'res-1' })).status).toBe('pending')
    expect(events.rows).toHaveLength(0)
  })

  it('(c) pago → fila paid Y el asiento queda intacto (reserva confirmed, 1 payment_event)', async () => {
    const { uc, reservations, events, attempts } = setup(makeMockGw({ outcome: PAID }))
    await reservations.repo.create(pending())

    const result = await uc.handleWebhook('hotel-A', '{}', 'sig')

    expect(result?.type).toBe('reservation_confirmed')
    expect(attempts.rows).toHaveLength(1)
    expect(attempts.rows[0]).toMatchObject({ kind: 'paid', eventId: 'evt_1', providerRef: 'cs_1', reservationId: 'res-1', amountMinor: 20000 })
    const r = await reservations.repo.findOne({ id: 'res-1' })
    expect(r.status).toBe('confirmed')
    expect(r.depositStatus).toBe('paid')
    expect(r.deposit).toBe(200)
    expect(events.rows).toHaveLength(1)
  })

  it('(d) el mismo webhook dos veces → 1 fila por eventId y already_processed', async () => {
    const { uc, reservations, events, attempts } = setup(makeMockGw({ outcome: PAID }))
    await reservations.repo.create(pending())

    await uc.handleWebhook('hotel-A', '{}', 'sig')
    const again = await uc.handleWebhook('hotel-A', '{}', 'sig')

    expect(again?.type).toBe('already_processed')
    expect(attempts.rows.filter((a) => a.eventId === 'evt_1')).toHaveLength(1)
    expect(events.rows).toHaveLength(1)
  })

  it('firma inválida (confirm → null) no deja fila: no es un outcome autenticado', async () => {
    const { uc, reservations, attempts } = setup(makeMockGw({ outcome: null }))
    await reservations.repo.create(pending())
    expect(await uc.handleWebhook('hotel-A', '{}', 'sig')).toBeNull()
    expect(attempts.rows).toHaveLength(0)
  })
})

describe('payment_attempts — handleReturn (CardNet, pull)', () => {
  it('(e) ResponseCode de rechazo → fila failed con provider cardnet y failureCode 51', async () => {
    const gw = makeMockGw({
      provider: 'cardnet', confirmation: 'pull',
      outcome: { status: 'failed', failureCode: '51', failureMessage: 'Fondos insuficientes', eventId: 'sess-1', providerRef: 'sess-1', reference: 'res-1', amountMinor: 20000, currency: 'dop' },
    })
    const { uc, reservations, events, attempts } = setup(gw)
    await reservations.repo.create(pending())

    const result = await uc.handleReturn('hotel-A', 'cardnet', { SESSION: 'sess-1' })

    expect(result).toEqual({ type: 'failed' })
    expect(attempts.rows).toHaveLength(1)
    expect(attempts.rows[0]).toMatchObject({
      id: 'cardnet:sess-1', kind: 'failed', provider: 'cardnet', mode: 'test', source: 'booking_engine',
      reservationId: 'res-1', failureCode: '51', failureMessage: 'Fondos insuficientes', currency: 'dop',
    })
    expect((await reservations.repo.findOne({ id: 'res-1' })).status).toBe('pending')
    expect(events.rows).toHaveLength(0)
  })

  it('retorno por un proveedor que no es el del hotel → null y sin fila', async () => {
    const { uc, reservations, attempts } = setup(makeMockGw({ provider: 'azul', confirmation: 'return', outcome: FAILED }))
    await reservations.repo.create(pending())
    expect(await uc.handleReturn('hotel-A', 'cardnet', { SESSION: 'x' })).toBeNull()
    expect(attempts.rows).toHaveLength(0)
  })
})

describe('payment_attempts — createCheckoutSession', () => {
  it('(f) checkout abierto → fila checkout_created con providerRef y amountMinor en centavos', async () => {
    const { uc, reservations, attempts } = setup(makeMockGw())
    await reservations.repo.create(pending())

    const session = await uc.createCheckoutSession('res-1', 123.45, 'https://app/s', 'https://app/c')

    expect(session.id).toBe('cs_1')
    expect(attempts.rows).toHaveLength(1)
    expect(attempts.rows[0]).toMatchObject({
      kind: 'checkout_created', source: 'booking_engine', provider: 'stripe', mode: 'test',
      hotelId: 'hotel-A', reservationId: 'res-1', providerRef: 'cs_1', amountMinor: 12345, currency: 'USD',
    })
    expect(attempts.rows[0].eventId).toBeUndefined()
  })

  it('el checkout que la pasarela rechaza no deja fila (no hubo sesión que registrar)', async () => {
    const gw = makeMockGw()
    gw.createCharge = async () => ({ status: 'failed', reason: 'sin credenciales' })
    const { uc, reservations, attempts } = setup(gw)
    await reservations.repo.create(pending())
    expect(uc.createCheckoutSession('res-1', 100, 'https://app/s', 'https://app/c')).rejects.toThrow(/sin credenciales/)
    expect(attempts.rows).toHaveLength(0)
  })
})

describe('payment_attempts — usecase sin store', () => {
  it('(g) sin PaymentAttemptStore inyectado, checkout y webhook siguen funcionando', async () => {
    const { uc, reservations, events } = setup(makeMockGw({ outcome: PAID }), { withAttempts: false })
    await reservations.repo.create(pending())

    const session = await uc.createCheckoutSession('res-1', 200, 'https://app/s', 'https://app/c')
    expect(session.id).toBe('cs_1')
    const result = await uc.handleWebhook('hotel-A', '{}', 'sig')
    expect(result?.type).toBe('reservation_confirmed')
    expect(events.rows).toHaveLength(1)
  })

  it('un store cuyo repo falla no tumba el asiento (best-effort)', async () => {
    const broken = { create: async () => { throw new Error('disk full') } } as unknown as RepositoryAdapter<PaymentAttemptRow>
    const reservations = memRepo<any>('reservations')
    const events = memRepo<PaymentEventRow>('payment_events')
    const uc = new StripeUseCase(reservations.repo, log, registryOf(makeMockGw({ outcome: PAID })), new PaymentEventStore(events.repo, log), undefined, new PaymentAttemptStore(broken, log))
    await reservations.repo.create(pending())
    const result = await uc.handleWebhook('hotel-A', '{}', 'sig')
    expect(result?.type).toBe('reservation_confirmed')
    expect((await reservations.repo.findOne({ id: 'res-1' })).status).toBe('confirmed')
  })
})
