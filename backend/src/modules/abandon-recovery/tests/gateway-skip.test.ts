// abandon-recovery/tests/gateway-skip.test.ts — #266: no mandar el correo de recuperación si
// el hotel no tiene pasarela de pago configurada (dep opcional `isGatewayConfigured`).
//
//   • isGatewayConfigured → false → skip (sin email, sin marcar flag), log "hotel sin pasarela"
//   • isGatewayConfigured → true → el email sale
//   • sin dep (undefined/null) → no se chequea → el email sale
//   • inyección post-init vía setGatewayCheck() (mismo patrón que setEmail)
//   • el check tira → error por reserva, sin romper el batch
//
// Sin DB real: RepositoryAdapter mock + EmailService mock (mismos fakes que ttl-skip.test.ts).
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AbandonRecoveryService } from '../service'
import type { AbandonRecoveryDeps } from '../service'
import type { AbandonSweepConfig } from '../types'

const log = silentLogger()

const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MINUTE

const CFG: AbandonSweepConfig = {
  minAgeMs: MS_PER_HOUR,
  maxAgeMs: 4 * MS_PER_HOUR,
  publicBaseUrl: 'https://example.com',
}

const NOW = new Date('2026-07-15T12:00:00Z')

function at(offsetMs: number, now = NOW): string {
  return new Date(now.getTime() + offsetMs).toISOString()
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

/** Reserva pending web vigente (deadline futuro), creada hace 2h — dentro de la ventana 1h–4h. */
function livePendingReservation(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', status: 'pending', abandonEmailSent: false,
    guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
    createdAt: at(-2 * MS_PER_HOUR),
    paymentDeadlineAt: at(30 * MS_PER_MINUTE),
    ...over,
  }
}

function setup(isGatewayConfigured: AbandonRecoveryDeps['isGatewayConfigured'], rows = [livePendingReservation()]) {
  const updates: any[] = []
  const captured: any[] = []
  const deps: AbandonRecoveryDeps = {
    reservations: { ...makeRepo({ rows }), update: async (id, data) => { updates.push({ id, data }); return {} } },
    guests: makeRepo({ byId: { g1: { id: 'g1', email: 'guest@example.com' } } }),
    hotels: makeRepo({ byId: { h1: { id: 'h1', slug: 'hotel-a' } } }),
    email: makeEmailSender(captured),
    bookingConfig: { findMany: async () => [{ id: 'bc1', hotelId: 'h1', pendingTtlMinutes: 60 }] },
  }
  if (isGatewayConfigured !== undefined) deps.isGatewayConfigured = isGatewayConfigured
  return { svc: new AbandonRecoveryService(deps, log, CFG), updates, captured }
}

describe('AbandonRecoveryService.runSweep — hotel sin pasarela de pago (#266)', () => {
  it('isGatewayConfigured → false ⇒ 0 encolados, flag intacto, contado como skipped', async () => {
    const asked: string[] = []
    const { svc, updates, captured } = setup(async (hotelId) => { asked.push(hotelId); return false })

    const result = await svc.runSweep(NOW)

    expect(asked).toEqual(['h1'])
    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.emailed).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(captured).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('isGatewayConfigured → true ⇒ encola el email y marca el flag', async () => {
    const { svc, updates, captured } = setup(async () => true)

    const result = await svc.runSweep(NOW)

    expect(result.skipped).toBe(0)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].to).toBe('guest@example.com')
    expect(captured[0].html).toContain('60 minutos')
    expect(updates).toEqual([{ id: 'r1', data: { abandonEmailSent: true } }])
  })

  it('sin dep (undefined) ⇒ no se chequea la pasarela ⇒ el email sale', async () => {
    const { svc, captured } = setup(undefined)

    const result = await svc.runSweep(NOW)

    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
  })

  it('dep null ⇒ no se chequea la pasarela ⇒ el email sale', async () => {
    const { svc, captured } = setup(null)

    const result = await svc.runSweep(NOW)

    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
  })

  it('setGatewayCheck() inyecta el check post-init (mismo patrón que setEmail)', async () => {
    const { svc, captured } = setup(undefined)
    svc.setGatewayCheck(async () => false)

    const result = await svc.runSweep(NOW)

    expect(result.skipped).toBe(1)
    expect(result.emailed).toBe(0)
    expect(captured).toHaveLength(0)
  })

  it('el check falla ⇒ error por reserva, no rompe el batch, no marca el flag', async () => {
    const rows = [
      livePendingReservation({ id: 'r1', hotelId: 'h-boom' }),
      livePendingReservation({ id: 'r2', hotelId: 'h1' }),
    ]
    const { svc, updates, captured } = setup(async (hotelId) => {
      if (hotelId === 'h-boom') throw new Error('payments down')
      return true
    }, rows)

    const result = await svc.runSweep(NOW)

    expect(result.scanned).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.emailed).toBe(1)
    expect(result.errors).toEqual([{ reservationId: 'r1', reason: 'gateway check: payments down' }])
    expect(captured).toHaveLength(1)
    expect(updates).toEqual([{ id: 'r2', data: { abandonEmailSent: true } }])
  })
})
