// payment-attempts.test.ts — la bitácora de outcomes es best-effort y nunca lanza.

import { describe, it, expect, mock } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import {
  PaymentAttemptStore,
  type PaymentAttemptRow,
  type OutcomeDetails,
} from '../../../services/payment-gateway/payment-attempts'

const log = silentLogger()
const NOW = '2026-07-15T00:00:00.000Z'

/** Repo en memoria que impone la PK única, igual que la base real. */
function memRepo() {
  const rows = new Map<string, PaymentAttemptRow>()
  return {
    rows,
    create: async (d: any) => {
      if (rows.has(d.id)) throw new Error('UNIQUE constraint failed: payment_attempts.id')
      rows.set(d.id, d)
      return d
    },
    delete: async (id: string) => { rows.delete(id) },
    findById: async (id: string) => rows.get(id) ?? null,
    findMany: async (filters: Record<string, unknown> = {}) =>
      [...rows.values()].filter((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v)),
    update: async () => {},
    count: async () => rows.size,
  } as any
}

/** Logger que traga todo pero deja espiar `warn`. */
function spyLogger() {
  const warn = mock(() => {})
  const noop = () => {}
  return { warn, logger: { debug: noop, info: noop, warn, error: noop } as any }
}

function store() {
  const repo = memRepo()
  return { st: new PaymentAttemptStore(repo, log, () => NOW), repo }
}

function outcome(over: Partial<OutcomeDetails> = {}): OutcomeDetails {
  return {
    eventId: 'evt_1',
    providerRef: 'pi_1',
    status: 'paid',
    amountMinor: 5000,
    currency: 'USD',
    reference: 'res-1',
    ...over,
  }
}

describe('PaymentAttemptStore — bitácora best-effort', () => {
  it('el mismo eventId dos veces → una sola fila, sin lanzar', async () => {
    const { st, repo } = store()
    await st.recordOutcome('h1', 'booking_engine', 'stripe', 'test', 'res-1', outcome())
    await st.recordOutcome('h1', 'booking_engine', 'stripe', 'test', 'res-1', outcome())
    expect(repo.rows.size).toBe(1)
    expect(repo.rows.has('stripe:evt_1')).toBe(true)
  })

  it('un error real de base → resuelve sin lanzar y avisa con logger.warn', async () => {
    const repo = memRepo()
    repo.create = async () => { throw new Error('connection refused') }
    const { warn, logger } = spyLogger()
    const st = new PaymentAttemptStore(repo, logger, () => NOW)

    await expect(st.recordOutcome('h1', 'booking_engine', 'stripe', 'test', 'res-1', outcome())).resolves.toBeUndefined()
    await expect(st.recordCheckout({
      hotelId: 'h1', reservationId: 'res-1', source: 'booking_engine', provider: 'stripe', mode: 'test',
      providerRef: 'cs_1', amountMinor: 5000, currency: 'USD',
    })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('un duplicado NO se reporta como warn', async () => {
    const { warn, logger } = spyLogger()
    const st = new PaymentAttemptStore(memRepo(), logger, () => NOW)
    await st.recordOutcome('h1', 'booking_engine', 'stripe', 'test', 'res-1', outcome())
    await st.recordOutcome('h1', 'booking_engine', 'stripe', 'test', 'res-1', outcome())
    expect(warn).not.toHaveBeenCalled()
  })

  it('recordCheckout guarda checkout_created con id distinto en cada llamada', async () => {
    const { st, repo } = store()
    const input = {
      hotelId: 'h1', reservationId: 'res-1', source: 'booking_engine' as const, provider: 'stripe',
      mode: 'test' as const, providerRef: 'cs_1', amountMinor: 5000, currency: 'USD',
    }
    await st.recordCheckout(input)
    await st.recordCheckout(input)
    expect(repo.rows.size).toBe(2)
    const rows = [...repo.rows.values()] as PaymentAttemptRow[]
    expect(rows.every((r) => r.kind === 'checkout_created')).toBe(true)
    expect(rows[0].id).not.toBe(rows[1].id)
    expect(rows[0]).toMatchObject({
      hotelId: 'h1', reservationId: 'res-1', source: 'booking_engine', provider: 'stripe', mode: 'test',
      providerRef: 'cs_1', amountMinor: 5000, currency: 'USD', occurredAt: NOW,
    })
  })

  it('recordOutcome mapea failureCode/card/receiptUrl a columnas y NO guarda raw', async () => {
    const { st, repo } = store()
    await st.recordOutcome('h1', 'booking_engine', 'stripe', 'live', 'res-1', outcome({
      eventId: 'evt_fail',
      status: 'failed',
      failureCode: 'card_declined',
      failureMessage: 'Your card was declined.',
      card: { brand: 'visa', last4: '0002' },
      receiptUrl: 'https://pay.stripe.com/receipts/x',
      occurredAt: '2026-07-14T23:59:00.000Z',
      raw: { pan: '4000000000000002', secreto: 'no-debe-persistir' },
    }))
    const row = repo.rows.get('stripe:evt_fail') as PaymentAttemptRow
    expect(row).toMatchObject({
      hotelId: 'h1', source: 'booking_engine', provider: 'stripe', mode: 'live', reservationId: 'res-1',
      eventId: 'evt_fail', providerRef: 'pi_1', kind: 'failed', amountMinor: 5000, currency: 'USD',
      failureCode: 'card_declined', failureMessage: 'Your card was declined.',
      cardBrand: 'visa', cardLast4: '0002', receiptUrl: 'https://pay.stripe.com/receipts/x',
      occurredAt: '2026-07-14T23:59:00.000Z',
    })
    expect('raw' in row).toBe(false)
    expect(JSON.stringify(row)).not.toContain('4000000000000002')
  })

  it('recordOutcome sin eventId usa id aleatorio y occurredAt = ahora', async () => {
    const { st, repo } = store()
    await st.recordOutcome('h1', 'pos', 'cardnet', 'test', null, outcome({ eventId: '' }))
    await st.recordOutcome('h1', 'pos', 'cardnet', 'test', null, outcome({ eventId: '' }))
    expect(repo.rows.size).toBe(2)
    const row = [...repo.rows.values()][0] as PaymentAttemptRow
    expect(row.eventId).toBeUndefined()
    expect(row.reservationId).toBeUndefined()
    expect(row.occurredAt).toBe(NOW)
  })

  it('listByReservation devuelve solo las filas de ese hotel+reserva', async () => {
    const { st } = store()
    await st.recordOutcome('h1', 'booking_engine', 'stripe', 'test', 'res-1', outcome({ eventId: 'a' }))
    await st.recordOutcome('h1', 'booking_engine', 'stripe', 'test', 'res-2', outcome({ eventId: 'b' }))
    await st.recordOutcome('h2', 'booking_engine', 'stripe', 'test', 'res-1', outcome({ eventId: 'c' }))
    const rows = await st.listByReservation('h1', 'res-1')
    expect(rows.map((r) => r.id)).toEqual(['stripe:a'])
  })

  it('listByReservation ante error de base devuelve [] y avisa', async () => {
    const repo = memRepo()
    repo.findMany = async () => { throw new Error('connection refused') }
    const { warn, logger } = spyLogger()
    const st = new PaymentAttemptStore(repo, logger, () => NOW)
    expect(await st.listByReservation('h1', 'res-1')).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
