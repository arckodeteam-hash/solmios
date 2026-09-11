// abandon-recovery/tests/ttl-skip.test.ts — #248: no mandar el correo de recuperación si la
// reserva ya pasó el TTL de pago del hotel (booking_config.pendingPaymentTtlHours).
//
//   • TTL 1h y reserva de 2h → skip (sin email, sin marcar flag)
//   • TTL 0 (nunca vence) → email sale
//   • sin fila de booking_config → default 24h → email sale
//   • deps sin `bookingConfig` → default 24h → email sale
//
// Sin DB real: RepositoryAdapter mock + EmailService mock (mismos fakes que service.test.ts).
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AbandonRecoveryService } from '../service'
import type { AbandonRecoveryDeps } from '../service'
import type { AbandonSweepConfig } from '../types'
import { DEFAULT_PENDING_PAYMENT_TTL_HOURS } from '../types'

const log = silentLogger()

const CFG: AbandonSweepConfig = {
  minAgeMs: 60 * 60 * 1000,       // 1h
  maxAgeMs: 4 * 60 * 60 * 1000,   // 4h
  publicBaseUrl: 'https://example.com',
}

const NOW = new Date('2026-07-15T12:00:00Z')

function iso(ageMs: number, now = NOW): string {
  return new Date(now.getTime() - ageMs).toISOString()
}

function makeRepo(opts: { rows?: any[]; byId?: Record<string, any> } = {}): RepositoryAdapter<any> {
  return {
    findMany: async () => opts.rows ?? [],
    findById: async (id: string) => opts.byId?.[id] ?? null,
    findOne: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  }
}

function makeEmailSender(captured: { to: string; subject: string; html: string }[]) {
  return {
    enqueue: async (to: string, subject: string, html: string) => {
      captured.push({ to, subject, html })
      return { sent: true }
    },
  }
}

/** Reserva pending web (accessToken + guest con email) creada hace 2h — dentro de la ventana 1h–4h. */
function pendingWebReservation() {
  return {
    id: 'r1', status: 'pending', abandonEmailSent: false,
    guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
    createdAt: iso(2 * 60 * 60 * 1000),
  }
}

function setup(bookingConfig: AbandonRecoveryDeps['bookingConfig']) {
  const updates: any[] = []
  const captured: any[] = []
  const deps: AbandonRecoveryDeps = {
    reservations: { ...makeRepo({ rows: [pendingWebReservation()] }), update: async (id, data) => { updates.push({ id, data }); return {} } },
    guests: makeRepo({ byId: { g1: { id: 'g1', email: 'guest@example.com' } } }),
    hotels: makeRepo({ byId: { h1: { id: 'h1', slug: 'hotel-a' } } }),
    email: makeEmailSender(captured),
  }
  if (bookingConfig !== undefined) deps.bookingConfig = bookingConfig
  return { svc: new AbandonRecoveryService(deps, log, CFG), updates, captured }
}

describe('AbandonRecoveryService.runSweep — TTL de pago del hotel (#248)', () => {
  it('default exportado es 24h (mismo que bookingengine)', () => {
    expect(DEFAULT_PENDING_PAYMENT_TTL_HOURS).toBe(24)
  })

  it('NO manda el email si la reserva ya pasó el TTL (TTL 1h, reserva de 2h) y NO marca el flag', async () => {
    const queries: any[] = []
    const { svc, updates, captured } = setup({
      findMany: async (q) => { queries.push(q); return [{ id: 'bc1', hotelId: 'h1', pendingPaymentTtlHours: 1 }] },
    })

    const result = await svc.runSweep(NOW)

    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.emailed).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(captured).toHaveLength(0)
    expect(updates).toHaveLength(0) // el flag abandonEmailSent queda intacto
    expect(queries).toEqual([{ hotelId: 'h1' }])
  })

  it('TTL 0 (nunca vence) → el email sale', async () => {
    const { svc, updates, captured } = setup({
      findMany: async () => [{ id: 'bc1', hotelId: 'h1', pendingPaymentTtlHours: 0 }],
    })

    const result = await svc.runSweep(NOW)

    expect(result.skipped).toBe(0)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].to).toBe('guest@example.com')
    expect(updates).toEqual([{ id: 'r1', data: { abandonEmailSent: true } }])
  })

  it('sin fila de booking_config → default 24h → el email sale', async () => {
    const { svc, captured } = setup({ findMany: async () => [] })

    const result = await svc.runSweep(NOW)

    expect(result.skipped).toBe(0)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
  })

  it('fila previa a #248 (pendingPaymentTtlHours null) → default 24h → el email sale', async () => {
    const { svc, captured } = setup({
      findMany: async () => [{ id: 'bc1', hotelId: 'h1', pendingPaymentTtlHours: null }],
    })

    const result = await svc.runSweep(NOW)

    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
  })

  it('deps sin `bookingConfig` (undefined) → default 24h → el email sale', async () => {
    const { svc, captured } = setup(undefined)

    const result = await svc.runSweep(NOW)

    expect(result.skipped).toBe(0)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
  })

  it('cachea el TTL por hotel dentro del sweep (una query por hotelId)', async () => {
    let calls = 0
    const rows = [
      { ...pendingWebReservation(), id: 'r1' },
      { ...pendingWebReservation(), id: 'r2' },
    ]
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: makeRepo({ rows }),
      guests: makeRepo({ byId: { g1: { id: 'g1', email: 'guest@example.com' } } }),
      hotels: makeRepo({ byId: { h1: { id: 'h1', slug: 'hotel-a' } } }),
      email: makeEmailSender(captured),
      bookingConfig: { findMany: async () => { calls++; return [{ hotelId: 'h1', pendingPaymentTtlHours: 1 }] } },
    }, log, CFG)

    const result = await svc.runSweep(NOW)

    expect(calls).toBe(1)
    expect(result.skipped).toBe(2)
    expect(captured).toHaveLength(0)
  })
})
