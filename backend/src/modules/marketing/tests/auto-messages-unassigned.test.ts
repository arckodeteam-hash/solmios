// marketing/tests/auto-messages-unassigned.test.ts — #262 REQ-HAC-07: con HAC-01 la reserva nace con
// roomId = null hasta el check-in. El cron de auto-mensajes + triggerAutoMessages tienen que correr
// igual y resolver {room_number} como 'por asignar' en vez de dejar el hueco vacío.
import { describe, it, expect } from 'bun:test'
import { createAutoMessagesCron } from '../usecases/auto-messages-cron'
import { triggerAutoMessages, ROOM_PENDING_LABEL } from '../usecases/trigger-auto-messages'

const TODAY = new Date('2026-08-10T12:00:00.000Z')
const RealDate = Date

function withFixedNow(fn: () => Promise<void>) {
  return async () => {
    class FixedDate extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) super(TODAY.getTime()); else super(args[0])
      }
    }
    global.Date = FixedDate as unknown as DateConstructor
    try { await fn() } finally { global.Date = RealDate }
  }
}

function makeOrm(tables: Record<string, any[]>) {
  return {
    findMany: async (table: string, filters: any) => {
      const rows = tables[table] || []
      return rows.filter((r) => Object.entries(filters || {}).every(([k, v]) => r[k] === v))
    },
  }
}

const BODY = 'Hola {guest_name}, tu habitación {room_number}'

function render(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ''))
}

/** Harness: cron real + triggerAutoMessages real sobre repos in-memory y un emailSender espía. */
function setup(tables: Record<string, any[]>) {
  const orm = makeOrm(tables)
  const repoOf = (table: string) => ({
    findMany: async (f: any) => orm.findMany(table, f),
    findById: async (id: string) => (tables[table] || []).find((r) => r.id === id) ?? null,
  })
  const sent: Array<{ to: string; body: string; variables: Record<string, string | number> }> = []
  const logs: any[] = []
  const ctx = {
    triggerDeps: {
      emailSender: {
        enqueueNotification: async (p: any) => {
          const msg = (tables.AutoMessages || []).find((m) => m.id === p.relatedId)
          sent.push({ to: p.to, body: render(msg?.emailBody || '', p.variables), variables: p.variables })
          return 'q-' + sent.length
        },
      },
      guestRepo: repoOf('Guests'),
      roomRepo: repoOf('Rooms'),
      hotelRepo: repoOf('Hotels'),
    } as any,
    autoMsgRepo: repoOf('AutoMessages') as any,
    logRepo: { findMany: async () => logs } as any,
    logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
    sockets: {},
    createMessageLog: async (dto: any) => { logs.push(dto); return dto },
  }
  const cron = createAutoMessagesCron(orm, { triggerAutoMessages: (p: any) => triggerAutoMessages(ctx, p) })
  return { cron, sent, logs }
}

const base = {
  Hotels: [{ id: 'h1', name: 'Hotel Sol' }],
  Guests: [{ id: 'g1', hotelId: 'h1', name: 'Ana', email: 'ana@test.com' }],
  Rooms: [{ id: 'rm1', hotelId: 'h1', number: '204', type: 'doble' }],
  AutoMessages: [
    { id: 'am1', hotelId: 'h1', triggerEvent: 'checkin_day', event: 'checkin_welcome', emailBody: BODY, isActive: 1 },
  ],
}

describe('#262 REQ-HAC-07 — auto-mensajes tolera roomId nulo', () => {
  it('reserva confirmed de hoy sin habitación: corre sin excepción y {room_number} sale como "por asignar"', withFixedNow(async () => {
    const { cron, sent, logs } = setup({
      ...base,
      Reservations: [
        { id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: null, checkIn: '2026-08-10', checkOut: '2026-08-12', status: 'confirmed' },
      ],
    })

    await cron()

    expect(ROOM_PENDING_LABEL).toBe('por asignar')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('ana@test.com')
    expect(sent[0]!.variables.room_number).toBe('por asignar')
    expect(sent[0]!.body).toBe('Hola Ana, tu habitación por asignar')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ reservationId: 'r1', status: 'sent', response: 'auto:checkin_day:am1' })
  }))

  it('roomId apuntando a una habitación que ya no existe también resuelve "por asignar"', withFixedNow(async () => {
    const { cron, sent } = setup({
      ...base,
      Reservations: [
        { id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'rm-borrada', checkIn: '2026-08-10', checkOut: '2026-08-12', status: 'confirmed' },
      ],
    })

    await cron()

    expect(sent).toHaveLength(1)
    expect(sent[0]!.variables.room_number).toBe('por asignar')
  }))

  it('con roomId existente sigue poniendo el número de la habitación', withFixedNow(async () => {
    const { cron, sent } = setup({
      ...base,
      Reservations: [
        { id: 'r2', hotelId: 'h1', guestId: 'g1', roomId: 'rm1', checkIn: '2026-08-10', checkOut: '2026-08-12', status: 'confirmed' },
      ],
    })

    await cron()

    expect(sent).toHaveLength(1)
    expect(sent[0]!.variables.room_number).toBe('204')
    expect(sent[0]!.variables.room_type).toBe('doble')
    expect(sent[0]!.body).toBe('Hola Ana, tu habitación 204')
  }))
})
