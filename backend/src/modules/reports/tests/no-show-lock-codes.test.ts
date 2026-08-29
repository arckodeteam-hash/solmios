import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createNoShowCron } from '../usecases/no-show-cron'
import { ReportQueries } from '../usecases/report-queries'

// Un no-show conserva el PIN de la habitación hasta su endDate original. La habitación se
// libera y se puede revender, pero el que no se presentó todavía puede abrir la puerta.
// `reservas-ttlock` expira en checkout y cancelación; el no-show lo marca este cron, que no
// emitía ningún evento (hueco encontrado en producción 2026-08-29: código activo de una
// reserva `no_show`).

const AYER = new Date(Date.now() - 48 * 3_600_000).toISOString().slice(0, 10)
const MANANA = new Date(Date.now() + 48 * 3_600_000).toISOString().slice(0, 10)

function harness(reservas: any[]) {
  const updates: any[] = []
  const expired: string[] = []
  const orm = {
    findMany: async (t: string, f: any) =>
      t === 'Reservations' ? reservas.filter(r => r.status === f.status) : [],
    findById: async () => null,
    update: async (t: string, id: string, data: any) => { updates.push({ t, id, data }) },
  }
  const emailSender: any = { enqueueNotification: async () => '' }
  const cron = createNoShowCron(orm, emailSender, silentLogger(), async (id: string) => { expired.push(id) })
  return { cron, updates, expired }
}

describe('no-show y el código de la puerta', () => {
  it('expira el código de la reserva que se marca no-show', async () => {
    const h = harness([{ id: 'r1', status: 'confirmed', checkIn: AYER, roomId: 'room1', hotelId: 'h1' }])
    expect(await h.cron()).toBe(1)
    expect(h.expired).toEqual(['r1'])
  })

  it('no toca los códigos de reservas que todavía no vencieron', async () => {
    const h = harness([{ id: 'r1', status: 'confirmed', checkIn: MANANA, roomId: 'room1', hotelId: 'h1' }])
    expect(await h.cron()).toBe(0)
    expect(h.expired).toHaveLength(0)
  })

  it('sigue marcando el no-show y liberando la habitación', async () => {
    const h = harness([{ id: 'r1', status: 'pending', checkIn: AYER, roomId: 'room1', hotelId: 'h1' }])
    await h.cron()
    expect(h.updates.find(u => u.t === 'Reservations')?.data.status).toBe('no_show')
    expect(h.updates.find(u => u.t === 'Rooms')?.data.status).toBe('available')
  })

  it('si expirar el código falla, el no-show igual se registra', async () => {
    const updates: any[] = []
    const orm = {
      findMany: async (t: string, f: any) =>
        t === 'Reservations' && f.status === 'confirmed'
          ? [{ id: 'r1', status: 'confirmed', checkIn: AYER, roomId: 'room1', hotelId: 'h1' }] : [],
      findById: async () => null,
      update: async (t: string, id: string, data: any) => { updates.push({ t, id, data }) },
    }
    const cron = createNoShowCron(orm, { enqueueNotification: async () => '' } as any, silentLogger(),
      async () => { throw new Error('TTLock caído') })
    expect(await cron()).toBe(1)
    expect(updates.find(u => u.t === 'Reservations')?.data.status).toBe('no_show')
  })

  it('sin la dependencia (4º arg ausente) el cron sigue funcionando', async () => {
    const orm = {
      findMany: async (t: string, f: any) =>
        t === 'Reservations' && f.status === 'confirmed'
          ? [{ id: 'r1', status: 'confirmed', checkIn: AYER, roomId: 'room1', hotelId: 'h1' }] : [],
      findById: async () => null,
      update: async () => {},
    }
    const cron = createNoShowCron(orm, { enqueueNotification: async () => '' } as any, silentLogger())
    expect(await cron()).toBe(1)
  })
})

// El otro camino al no-show: el endpoint manual (`POST /api/night-audit/mark-no-shows`), que
// pasa por ReportQueries y NO por el cron. Tenía el mismo hueco.
describe('markNoShows manual y el código de la puerta', () => {
  const AYER_2 = new Date(Date.now() - 48 * 3_600_000).toISOString().slice(0, 10)

  function queriesHarness(reservas: any[], expirer?: (id: string) => Promise<void>) {
    const updates: any[] = []
    const orm = {
      findMany: async (t: string, f: any) =>
        t === 'Reservations' ? reservas.filter(r => r.status === f.status) : [],
      update: async (t: string, id: string, data: any) => { updates.push({ t, id, data }) },
    }
    const q = new ReportQueries(orm)
    if (expirer) q.setLockCodeExpirer(expirer)
    return { q, updates }
  }

  it('expira el código al marcar no-show desde el endpoint', async () => {
    const expired: string[] = []
    const h = queriesHarness(
      [{ id: 'r1', status: 'confirmed', checkIn: AYER_2, roomId: 'room1', hotelId: 'h1' }],
      async (id) => { expired.push(id) },
    )
    expect(await h.q.markNoShows('h1')).toBe(1)
    expect(expired).toEqual(['r1'])
  })

  it('sin expirer inyectado sigue marcando el no-show (no revienta)', async () => {
    const h = queriesHarness([{ id: 'r1', status: 'confirmed', checkIn: AYER_2, roomId: 'room1', hotelId: 'h1' }])
    expect(await h.q.markNoShows('h1')).toBe(1)
    expect(h.updates.find(u => u.t === 'Reservations')?.data.status).toBe('no_show')
  })

  it('si TTLock falla, el no-show y la liberación de la habitación se completan igual', async () => {
    const h = queriesHarness(
      [{ id: 'r1', status: 'confirmed', checkIn: AYER_2, roomId: 'room1', hotelId: 'h1' }],
      async () => { throw new Error('TTLock caído') },
    )
    expect(await h.q.markNoShows('h1')).toBe(1)
    expect(h.updates.find(u => u.t === 'Rooms')?.data.status).toBe('available')
  })
})
