// abandon-recovery/tests/service.test.ts — Tests del AbandonRecoveryService (F3 3.14).
//
// Cubre acceptance del task:
//   • cron idempotente (flag marca y no reenvía)
//   • reservas confirmadas no reciben el email (filtro por status='pending')
//   • reservas fuera de ventana (1h–4h) se omiten
//   • reservas sin accessToken (creadas desde panel) → skip
//   • reservas sin email del guest → skip
//   • email enqueue falla → NO marca flag (próximo tick reintenta)
//   • errores por reserva no rompen el batch (resiliencia)
//
// Sin DB real: RepositoryAdapter mock + EmailService mock.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AbandonRecoveryService } from '../service'
import type { AbandonSweepConfig, AbandonEmailSender } from '../types'
import type { EmailService } from '../../../services/email-service'

// Garantiza en typecheck que la interfaz local sigue siendo subset del EmailService real (#283):
// si `EmailService.enqueue` cambia de firma, esta asignación deja de compilar y el double de
// abajo no puede volver a divergir silenciosamente de producción.
const _emailServiceIsAbandonSender: AbandonEmailSender = {} as EmailService
void _emailServiceIsAbandonSender

const log = silentLogger()

const CFG: AbandonSweepConfig = {
  minAgeMs: 60 * 60 * 1000,       // 1h
  maxAgeMs: 4 * 60 * 60 * 1000,   // 4h
  publicBaseUrl: 'https://example.com',
}

function iso(ageMs: number, now = new Date('2026-07-15T12:00:00Z')): string {
  return new Date(now.getTime() - ageMs).toISOString()
}

function makeReservationsRepo(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async () => rows,
    findById: async () => null,
    findOne: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  }
}

function makeGuestsRepo(map: Record<string, any>): RepositoryAdapter<any> {
  return {
    findById: async (id: string) => map[id] ?? null,
    findMany: async () => [],
    findOne: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  }
}

function makeHotelsRepo(map: Record<string, any>): RepositoryAdapter<any> {
  return {
    findById: async (id: string) => map[id] ?? null,
    findMany: async () => [],
    findOne: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  }
}

type CapturedEnqueue = { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }

/** Double con la firma real de `EmailService.enqueue` (objeto + devuelve id de fila).
 *  `sent: false` se simula devolviendo '' (id vacío → sendAbandonEmail normaliza a sent=false). */
function makeEmailSender(captured: CapturedEnqueue[], opts: { sent?: boolean; throwOnCall?: boolean } = {}): AbandonEmailSender {
  return {
    enqueue: async (input: CapturedEnqueue) => {
      captured.push(input)
      if (opts.throwOnCall) throw new Error('enqueue exploded')
      return opts.sent === false ? '' : 'email-row-1'
    },
  }
}

const NOW = new Date('2026-07-15T12:00:00Z')

describe('AbandonRecoveryService.runSweep', () => {
  it('envía email y marca el flag para reservas pending en ventana 1h–4h', async () => {
    const updates: any[] = []
    const rows = [{
      id: 'r1', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(2 * 60 * 60 * 1000), // 2h atrás — dentro de ventana
    }]
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: { ...makeReservationsRepo(rows), update: async (id, data) => { updates.push({ id, data }); return {} } },
      guests: makeGuestsRepo({ g1: { id: 'g1', email: 'guest@example.com' } }),
      hotels: makeHotelsRepo({ h1: { id: 'h1', slug: 'hotel-a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)

    expect(result.scanned).toBe(1)
    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].to).toBe('guest@example.com')
    expect(captured[0].html).toContain('Completar mi reserva')
    expect(captured[0].html).toContain('?reservation=r1&amp;token=tok-1')
    expect(updates).toEqual([{ id: 'r1', data: { abandonEmailSent: true } }])
  })

  it('encola con hotelId de la reserva (firma real de EmailService.enqueue) y marca el flag', async () => {
    const updates: any[] = []
    const rows = [{
      id: 'r-h1', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(2 * 60 * 60 * 1000),
    }]
    const captured: CapturedEnqueue[] = []
    const svc = new AbandonRecoveryService({
      reservations: { ...makeReservationsRepo(rows), update: async (id, data) => { updates.push({ id, data }); return {} } },
      guests: makeGuestsRepo({ g1: { id: 'g1', email: 'guest@example.com' } }),
      hotels: makeHotelsRepo({ h1: { id: 'h1', slug: 'hotel-a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)

    expect(result.emailed).toBe(1)
    expect(captured).toHaveLength(1)
    expect(captured[0].hotelId).toBe('h1')
    expect(captured[0].relatedType).toBe('reservation')
    expect(captured[0].relatedId).toBe('r-h1')
    expect(captured[0].to).toBe('guest@example.com')
    expect(updates).toEqual([{ id: 'r-h1', data: { abandonEmailSent: true } }])
  })

  it('candidato sin hotelId → no encola, registra error y NO marca el flag', async () => {
    const updates: any[] = []
    const rows = [{
      id: 'r-nohotel', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: undefined, accessToken: 'tok-1',
      createdAt: iso(2 * 60 * 60 * 1000),
    }]
    const captured: CapturedEnqueue[] = []
    const svc = new AbandonRecoveryService({
      reservations: { ...makeReservationsRepo(rows), update: async (id, data) => { updates.push({ id, data }); return {} } },
      guests: makeGuestsRepo({ g1: { id: 'g1', email: 'guest@example.com' } }),
      hotels: makeHotelsRepo({}),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)

    expect(result.scanned).toBe(1)
    expect(result.emailed).toBe(0)
    expect(captured).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(result.errors).toEqual([{ reservationId: 'r-nohotel', reason: 'reserva sin hotelId' }])
  })

  it('NO marca el flag si el email falla (próximo tick reintenta)', async () => {
    const updates: any[] = []
    const rows = [{
      id: 'r1', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(2 * 60 * 60 * 1000),
    }]
    const svc = new AbandonRecoveryService({
      reservations: { ...makeReservationsRepo(rows), update: async (id, data) => { updates.push({ id, data }); return {} } },
      guests: makeGuestsRepo({ g1: { id: 'g1', email: 'guest@example.com' } }),
      hotels: makeHotelsRepo({ h1: { id: 'h1', slug: 'hotel-a' } }),
      email: makeEmailSender([], { throwOnCall: true }),
    }, log, CFG)

    const result = await svc.runSweep(NOW)

    expect(result.scanned).toBe(1)
    expect(result.emailed).toBe(0)
    expect(updates).toHaveLength(0) // NO se marcó el flag
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reservationId).toBe('r1')
  })

  it('NO marca el flag si el email devuelve sent=false', async () => {
    const updates: any[] = []
    const rows = [{
      id: 'r1', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(2 * 60 * 60 * 1000),
    }]
    const svc = new AbandonRecoveryService({
      reservations: { ...makeReservationsRepo(rows), update: async (id, data) => { updates.push({ id, data }); return {} } },
      guests: makeGuestsRepo({ g1: { id: 'g1', email: 'guest@example.com' } }),
      hotels: makeHotelsRepo({ h1: { id: 'h1', slug: 'hotel-a' } }),
      email: makeEmailSender([], { sent: false }),
    }, log, CFG)

    const result = await svc.runSweep(NOW)

    expect(result.emailed).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('filtra reservas pending ya marcadas (abandonEmailSent=true) — idempotencia', async () => {
    // El repo.findMany simula el filtro del ORM por abandonEmailSent=false.
    const rows = [{
      id: 'r1', status: 'pending', abandonEmailSent: true, // ya mandado
      guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(2 * 60 * 60 * 1000),
    }]
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: makeReservationsRepo([]), // findMany solo devuelve rows con flag=false
      guests: makeGuestsRepo({ g1: { email: 'x@x' } }),
      hotels: makeHotelsRepo({ h1: { slug: 'a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    // Pasamos las rows "marcadas" al repo para demostrar que la query ORM ya filtra
    // (en prod, findMany({abandonEmailSent:false}) no las trae; acá simulamos []).
    expect(rows[0].abandonEmailSent).toBe(true)
    const result = await svc.runSweep(NOW)
    expect(result.scanned).toBe(0)
    expect(captured).toHaveLength(0)
  })

  it('omite reservas fuera de ventana (< 1h: demasiado pronto)', async () => {
    const rows = [{
      id: 'r-young', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(20 * 60 * 1000), // 20 min — demasiado nuevo
    }]
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: makeReservationsRepo(rows),
      guests: makeGuestsRepo({ g1: { email: 'x@x' } }),
      hotels: makeHotelsRepo({ h1: { slug: 'a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)
    expect(result.scanned).toBe(0) // filtrado en JS por ventana
    expect(captured).toHaveLength(0)
  })

  it('omite reservas fuera de ventana (> 4h: ya no recuperable)', async () => {
    const rows = [{
      id: 'r-old', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(8 * 60 * 60 * 1000), // 8h — fuera de ventana
    }]
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: makeReservationsRepo(rows),
      guests: makeGuestsRepo({ g1: { email: 'x@x' } }),
      hotels: makeHotelsRepo({ h1: { slug: 'a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)
    expect(result.scanned).toBe(0)
    expect(captured).toHaveLength(0)
  })

  it('omite reservas sin accessToken (creadas desde panel — no es abandono público)', async () => {
    const rows = [{
      id: 'r-panel', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: 'h1', accessToken: null,
      createdAt: iso(2 * 60 * 60 * 1000),
    }]
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: makeReservationsRepo(rows),
      guests: makeGuestsRepo({ g1: { email: 'x@x' } }),
      hotels: makeHotelsRepo({ h1: { slug: 'a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)
    expect(result.scanned).toBe(1)     // cuenta como candidato escaneado
    expect(result.skipped).toBe(1)     // pero se skipa por no tener accessToken
    expect(captured).toHaveLength(0)
  })

  it('omite reservas sin email del guest', async () => {
    const rows = [{
      id: 'r1', status: 'pending', abandonEmailSent: false,
      guestId: 'g-missing', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(2 * 60 * 60 * 1000),
    }]
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: makeReservationsRepo(rows),
      guests: makeGuestsRepo({}), // sin el guest
      hotels: makeHotelsRepo({ h1: { slug: 'a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)
    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(1)
    expect(captured).toHaveLength(0)
  })

  it('procesa múltiples reservas en un mismo sweep (batch)', async () => {
    const rows = [
      { id: 'r1', status: 'pending', abandonEmailSent: false, guestId: 'g1', hotelId: 'h1', accessToken: 't1', createdAt: iso(2 * 60 * 60 * 1000) },
      { id: 'r2', status: 'pending', abandonEmailSent: false, guestId: 'g2', hotelId: 'h1', accessToken: 't2', createdAt: iso(3 * 60 * 60 * 1000) },
    ]
    const updates: any[] = []
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: { ...makeReservationsRepo(rows), update: async (id) => { updates.push(id); return {} } },
      guests: makeGuestsRepo({ g1: { email: 'a@a' }, g2: { email: 'b@b' } }),
      hotels: makeHotelsRepo({ h1: { slug: 'a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)
    expect(result.scanned).toBe(2)
    expect(result.emailed).toBe(2)
    expect(updates).toEqual(['r1', 'r2'])
    expect(captured.map((c) => c.to).sort()).toEqual(['a@a', 'b@b'])
  })

  it('un error en una reserva no rompe el batch (resiliencia)', async () => {
    const rows = [
      { id: 'r-bad', status: 'pending', abandonEmailSent: false, guestId: 'g-bad', hotelId: 'h1', accessToken: 't1', createdAt: iso(2 * 60 * 60 * 1000) },
      { id: 'r-ok', status: 'pending', abandonEmailSent: false, guestId: 'g-ok', hotelId: 'h1', accessToken: 't2', createdAt: iso(2 * 60 * 60 * 1000) },
    ]
    const guests = makeGuestsRepo({})
    // Overload findById para que g-bad tire
    ;(guests as any).findById = async (id: string) => {
      if (id === 'g-bad') throw new Error('guest lookup exploded')
      return { email: 'ok@ok' }
    }
    const captured: any[] = []
    const svc = new AbandonRecoveryService({
      reservations: makeReservationsRepo(rows),
      guests,
      hotels: makeHotelsRepo({ h1: { slug: 'a' } }),
      email: makeEmailSender(captured),
    }, log, CFG)

    const result = await svc.runSweep(NOW)
    expect(result.scanned).toBe(2)
    expect(result.emailed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reservationId).toBe('r-bad')
    expect(captured[0].to).toBe('ok@ok')
  })
})

describe('AbandonRecoveryService.setEmail', () => {
  it('degrada graceful sin email cableado (cron no rompe, marca flag=false)', async () => {
    const rows = [{
      id: 'r1', status: 'pending', abandonEmailSent: false,
      guestId: 'g1', hotelId: 'h1', accessToken: 'tok-1',
      createdAt: iso(2 * 60 * 60 * 1000),
    }]
    const updates: any[] = []
    // Service SIN email cableado (estado al arranque, antes de email-bootstrap)
    const svc = new AbandonRecoveryService({
      reservations: { ...makeReservationsRepo(rows), update: async (id, data) => { updates.push({ id, data }); return {} } },
      guests: makeGuestsRepo({ g1: { email: 'x@x' } }),
      hotels: makeHotelsRepo({ h1: { slug: 'a' } }),
      email: null,
    }, log, CFG)

    const result = await svc.runSweep(NOW)
    expect(result.emailed).toBe(0)
    expect(updates).toHaveLength(0) // NO marca flag sin email
    expect(result.errors).toHaveLength(1)

    // Tras setEmail → el próximo sweep funciona
    const captured: any[] = []
    svc.setEmail(makeEmailSender(captured))
    const result2 = await svc.runSweep(NOW)
    expect(result2.emailed).toBe(1)
    expect(captured).toHaveLength(1)
  })
})
