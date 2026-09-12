import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { createNoShowCron } from '../usecases/no-show-cron'

// #262 REQ-HAC-07: con HAC-01 la reserva nace con roomId = null hasta el check-in. Un no-show es,
// por definición, una reserva que NUNCA llegó al check-in, así que el caso normal desde HAC-01 es
// que no tenga habitación: el cron completo (marca, liberación, TTLock, email) tiene que correr
// sin excepción y sin tocar `Rooms`, y seguir liberando la habitación de las que sí tienen una.
// (mark-no-shows.test.ts ya cubre `markNoShows` del endpoint; acá va `no-show-cron.ts` entero.)

const AYER = new Date(Date.now() - 48 * 3_600_000).toISOString().slice(0, 10)

function harness(reservas: any[]) {
  const updates: Array<{ t: string; id: string; data: any }> = []
  const created: Array<{ t: string; data: any }> = []
  const expired: string[] = []
  const enqueued: any[] = []
  const tables: Record<string, any[]> = {
    Guests: [{ id: 'g1', hotelId: 'h1', name: 'Ana', email: 'ana@test.com' }],
    Rooms: [{ id: 'room1', hotelId: 'h1', number: '101', status: 'reserved' }],
    Hotels: [{ id: 'h1', name: 'Hotel Sol' }],
  }
  const orm = {
    findMany: async (t: string, f: any) =>
      t === 'Reservations' ? reservas.filter(r => r.status === f.status) : (tables[t] ?? []),
    findById: async (t: string, id: string) => (tables[t] ?? []).find(r => r.id === id) ?? null,
    update: async (t: string, id: string, data: any) => { updates.push({ t, id, data }); return { id, ...data } },
    create: async (t: string, data: any) => { created.push({ t, data }); return { id: 'log-' + created.length, ...data } },
  }
  const emailSender: any = { enqueueNotification: async (p: any) => { enqueued.push(p); return 'q-' + enqueued.length } }
  const cron = createNoShowCron(orm, emailSender, silentLogger(), async (id: string) => { expired.push(id) })
  return { cron, updates, created, expired, enqueued }
}

/** El email de lifecycle es fire-and-forget dentro del cron: se espera a que se asiente. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

describe('#262 REQ-HAC-07 — no-show cron tolera roomId nulo', () => {
  it('reserva confirmed de ayer sin roomId → queda no_show, no toca Rooms, y TTLock + email no explotan', async () => {
    const h = harness([{ id: 'r1', status: 'confirmed', checkIn: AYER, checkOut: AYER, roomId: null, guestId: 'g1', hotelId: 'h1' }])

    const n = await h.cron()
    await settle()

    expect(n).toBe(1)
    expect(h.updates).toEqual([{ t: 'Reservations', id: 'r1', data: { status: 'no_show' } }])
    expect(h.updates.some(u => u.t === 'Rooms')).toBe(false)
    expect(h.expired).toEqual(['r1'])
    // Email de no_show encolado con room_number vacío (sin habitación) y registrado en message_logs.
    expect(h.enqueued).toHaveLength(1)
    expect(h.enqueued[0]).toMatchObject({ to: 'ana@test.com', event: 'no_show', relatedId: 'r1' })
    expect(h.enqueued[0].variables.room_number).toBe('')
    expect(h.created.find(c => c.t === 'MessageLogs')?.data).toMatchObject({ reservationId: 'r1', status: 'sent' })
  })

  it('en la misma corrida, la que tiene roomId room1 sí libera la habitación y la sin habitación no la corta', async () => {
    const h = harness([
      { id: 'r1', status: 'confirmed', checkIn: AYER, checkOut: AYER, roomId: null, guestId: 'g1', hotelId: 'h1' },
      { id: 'r2', status: 'confirmed', checkIn: AYER, checkOut: AYER, roomId: 'room1', guestId: 'g1', hotelId: 'h1' },
    ])

    const n = await h.cron()
    await settle()

    expect(n).toBe(2)
    expect(h.updates).toContainEqual({ t: 'Reservations', id: 'r1', data: { status: 'no_show' } })
    expect(h.updates).toContainEqual({ t: 'Reservations', id: 'r2', data: { status: 'no_show' } })
    expect(h.updates.filter(u => u.t === 'Rooms')).toEqual([{ t: 'Rooms', id: 'room1', data: { status: 'available' } }])
    expect(h.expired.sort()).toEqual(['r1', 'r2'])
    expect(h.enqueued.map(e => e.variables.room_number).sort()).toEqual(['', '101'])
  })

  it('sin roomId y sin guestId (reserva mínima) tampoco rompe: marca y sigue', async () => {
    const h = harness([{ id: 'r1', status: 'pending', checkIn: AYER, roomId: null, guestId: null, hotelId: 'h1' }])

    const n = await h.cron()
    await settle()

    expect(n).toBe(1)
    expect(h.updates).toEqual([{ t: 'Reservations', id: 'r1', data: { status: 'no_show' } }])
    expect(h.enqueued).toHaveLength(0)
  })
})
