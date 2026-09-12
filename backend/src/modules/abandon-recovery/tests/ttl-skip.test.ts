// abandon-recovery/tests/ttl-skip.test.ts — #266: no mandar el correo de recuperación si la
// reserva ya venció el plazo de pago (reservations.paymentDeadlineAt < now; null = no vence,
// mismo criterio que el cron de vencimiento), y el texto del correo dice el TTL real del hotel
// (booking_config.pendingTtlMinutes, NULL → 60).
//
//   • paymentDeadlineAt < now → skip (sin email, sin marcar flag)
//   • paymentDeadlineAt > now → email sale, html dice "60 minutos"
//   • status ≠ pending (defensivo) → skip
//   • sin paymentDeadlineAt (fila previa) → no vence → email sale
//   • sin fila de booking_config / columna null / sin dep → default 60 min en el texto
//
// Sin DB real: RepositoryAdapter mock + EmailService mock (mismos fakes que service.test.ts).
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AbandonRecoveryService } from '../service'
import type { AbandonRecoveryDeps } from '../service'
import type { AbandonSweepConfig } from '../types'
import { DEFAULT_PENDING_TTL_MINUTES } from '../types'

const log = silentLogger()

const MS_PER_MINUTE = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MINUTE

const CFG: AbandonSweepConfig = {
  minAgeMs: MS_PER_HOUR,          // 1h
  maxAgeMs: 4 * MS_PER_HOUR,      // 4h
  publicBaseUrl: 'https://example.com',
}

const NOW = new Date('2026-07-15T12:00:00Z')

/** ISO `offsetMs` respecto de NOW (negativo = pasado, positivo = futuro). */
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

/** Reserva pending web (accessToken + guest con email) creada hace 2h — dentro de la ventana 1h–4h. */
function pendingWebReservation(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', status: 'pending', abandonEmailSent: false,
    guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
    createdAt: at(-2 * MS_PER_HOUR),
    ...over,
  }
}

function setup(opts: { rows?: any[]; bookingConfig?: AbandonRecoveryDeps['bookingConfig'] } = {}) {
  const updates: any[] = []
  const captured: any[] = []
  const deps: AbandonRecoveryDeps = {
    reservations: { ...makeRepo({ rows: opts.rows ?? [pendingWebReservation()] }), update: async (id, data) => { updates.push({ id, data }); return {} } },
    guests: makeRepo({ byId: { g1: { id: 'g1', email: 'guest@example.com' } } }),
    hotels: makeRepo({ byId: { h1: { id: 'h1', slug: 'hotel-a' } } }),
    email: makeEmailSender(captured),
  }
  if (opts.bookingConfig !== undefined) deps.bookingConfig = opts.bookingConfig
  return { svc: new AbandonRecoveryService(deps, log, CFG), updates, captured }
}

const bookingConfigWith = (pendingTtlMinutes: number | null) => ({
  findMany: async () => [{ id: 'bc1', hotelId: 'h1', pendingTtlMinutes }],
})

describe('AbandonRecoveryService.runSweep — vencimiento del plazo de pago (#266)', () => {
  it('default exportado es 60 minutos (mismo que bookingengine DEFAULT_PENDING_TTL_MINUTES)', () => {
    expect(DEFAULT_PENDING_TTL_MINUTES).toBe(60)
  })

  it('paymentDeadlineAt < now → NO manda el email y NO marca el flag', async () => {
    const { svc, updates, captured } = setup({
      rows: [pendingWebReservation({ paymentDeadlineAt: at(-1 * MS_PER_MINUTE) })],
      bookingConfig: bookingConfigWith(60),
    })

    const result = await svc.runSweep(NOW)

    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.emailed).toBe(0)
    expect(result.errors).toHaveLength(0)
    expect(captured).toHaveLength(0)
    expect(updates).toHaveLength(0) // el flag abandonEmailSent queda intacto
  })

  it('paymentDeadlineAt > now → encola el email, marca el flag y el html dice "60 minutos"', async () => {
    const queries: any[] = []
    const { svc, updates, captured } = setup({
      rows: [pendingWebReservation({ paymentDeadlineAt: at(30 * MS_PER_MINUTE) })],
      bookingConfig: { findMany: async (q) => { queries.push(q); return [{ id: 'bc1', hotelId: 'h1', pendingTtlMinutes: 60 }] } },
    })

    const result = await svc.runSweep(NOW)

    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].to).toBe('guest@example.com')
    expect(captured[0].html).toContain('60 minutos')
    expect(captured[0].html).not.toContain('24 h')
    expect(updates).toEqual([{ id: 'r1', data: { abandonEmailSent: true } }])
    expect(queries).toEqual([{ hotelId: 'h1' }])
  })

  it('el texto del correo refleja el TTL real del hotel (90 → "90 minutos", 120 → "2 horas")', async () => {
    const a = setup({ rows: [pendingWebReservation({ paymentDeadlineAt: at(MS_PER_HOUR) })], bookingConfig: bookingConfigWith(90) })
    await a.svc.runSweep(NOW)
    expect(a.captured[0].html).toContain('90 minutos')

    const b = setup({ rows: [pendingWebReservation({ paymentDeadlineAt: at(MS_PER_HOUR) })], bookingConfig: bookingConfigWith(120) })
    await b.svc.runSweep(NOW)
    expect(b.captured[0].html).toContain('2 horas')
  })

  it('status ≠ pending (defensivo) → skip aunque el deadline sea futuro', async () => {
    const { svc, captured, updates } = setup({
      rows: [pendingWebReservation({ status: 'cancelled', paymentDeadlineAt: at(MS_PER_HOUR) })],
      bookingConfig: bookingConfigWith(60),
    })

    const result = await svc.runSweep(NOW)

    expect(result.skipped).toBe(1)
    expect(result.emailed).toBe(0)
    expect(captured).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('sin paymentDeadlineAt (fila previa a #266) → no vence → el email sale (mismo criterio que el cron de vencimiento)', async () => {
    const { svc, captured, updates } = setup({
      rows: [pendingWebReservation({ paymentDeadlineAt: null })],
      bookingConfig: bookingConfigWith(60),
    })

    const result = await svc.runSweep(NOW)

    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].html).toContain('60 minutos')
    expect(updates).toEqual([{ id: 'r1', data: { abandonEmailSent: true } }])
  })

  it('paymentDeadlineAt inválido (no parseable) → no vence → el email sale', async () => {
    const { svc, captured } = setup({
      rows: [pendingWebReservation({ paymentDeadlineAt: 'not-a-date' })],
      bookingConfig: bookingConfigWith(60),
    })

    const result = await svc.runSweep(NOW)

    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
  })

  it('sin fila de booking_config → default 60 min en el texto → el email sale', async () => {
    const { svc, captured } = setup({ bookingConfig: { findMany: async () => [] } })

    const result = await svc.runSweep(NOW)

    expect(result.skipped).toBe(0)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].html).toContain('60 minutos')
  })

  it('fila con pendingTtlMinutes null → default 60 → con deadline futuro el email sale y dice "60 minutos"', async () => {
    const { svc, captured } = setup({
      rows: [pendingWebReservation({ paymentDeadlineAt: at(10 * MS_PER_MINUTE) })],
      bookingConfig: bookingConfigWith(null),
    })

    const result = await svc.runSweep(NOW)

    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].html).toContain('60 minutos')
  })

  it('deps sin `bookingConfig` (undefined) → default 60 → con deadline futuro el email sale', async () => {
    const { svc, captured } = setup({ rows: [pendingWebReservation({ paymentDeadlineAt: at(10 * MS_PER_MINUTE) })] })

    const result = await svc.runSweep(NOW)

    expect(result.skipped).toBe(0)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].html).toContain('60 minutos')
  })

  it('cachea el TTL por hotel dentro del sweep (una query por hotelId)', async () => {
    let calls = 0
    const rows = [
      pendingWebReservation({ id: 'r1' }),
      pendingWebReservation({ id: 'r2' }),
    ]
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: makeRepo({ rows }),
      guests: makeRepo({ byId: { g1: { id: 'g1', email: 'guest@example.com' } } }),
      hotels: makeRepo({ byId: { h1: { id: 'h1', slug: 'hotel-a' } } }),
      email: makeEmailSender(captured),
      bookingConfig: { findMany: async () => { calls++; return [{ hotelId: 'h1', pendingTtlMinutes: 60 }] } },
    }, log, CFG)

    const result = await svc.runSweep(NOW)

    expect(calls).toBe(1)
    expect(result.emailed).toBe(2)
    expect(captured).toHaveLength(2)
    expect(captured[0].html).toContain('60 minutos')
  })
})
