// funnel.test.ts — REQ-PIPE-10 (#151): embudo semanal con fixture (10 altas / 4 activadas / 1 pagando).
import { describe, it, expect } from 'bun:test'
import { buildFunnel, parseWeeks, isoWeekLabel, startOfIsoWeek, type FunnelDeps } from '../usecases/funnel'

// Miércoles 2026-09-09: la semana ISO en curso arranca el lunes 2026-09-07 (2026-W37).
const NOW = new Date('2026-09-09T15:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (d: number, h = 10) => new Date(NOW.getTime() - d * DAY + (h - 15) * 3600_000).toISOString()

function repo<T>(rows: T[], opts?: { byHotel?: (r: T) => string | undefined; orderKey?: keyof T }) {
  return {
    findMany: async (where: Record<string, unknown> = {}, o?: { limit?: number }) => {
      let out = rows
      if (where.hotelId !== undefined && opts?.byHotel) out = out.filter((r) => opts.byHotel!(r) === where.hotelId)
      if (opts?.orderKey) out = [...out].sort((a, b) => String(a[opts.orderKey!]).localeCompare(String(b[opts.orderKey!])))
      return o?.limit ? out.slice(0, o.limit) : out
    },
    count: async (where: Record<string, unknown> = {}) => (await repo(rows, opts).findMany(where)).length,
  } as unknown as FunnelDeps['subscriptions']
}

function fixture() {
  // 10 hoteles dados de alta esta semana (lunes 7 y martes 8 de septiembre).
  const hotels = Array.from({ length: 10 }, (_, i) => ({ id: `h${i}`, createdAt: at(i < 5 ? 2 : 1) }))
  const subs = hotels.map((h, i) => ({ id: `s${i}`, hotelId: h.id, status: i === 9 ? 'active' : 'trialing', createdAt: h.createdAt }))
  // 4 cargaron habitaciones dentro de los 7 días; uno (h4) recién a los 9 días → no cuenta.
  const rooms = [
    { id: 'r0', hotelId: 'h0', createdAt: at(1) },
    { id: 'r1', hotelId: 'h1', createdAt: at(0) },
    { id: 'r2', hotelId: 'h2', createdAt: at(1) },
    { id: 'r3', hotelId: 'h3', createdAt: at(0) },
    { id: 'r4', hotelId: 'h4', createdAt: new Date(Date.parse(at(2)) + 9 * DAY).toISOString() },
  ]
  const invoices = [{ id: 'i9', hotelId: 'h9', paidAt: at(0), status: 'paid' }]
  // Perdidos: dos esta semana (precio, sin motivo → other) y uno hace 3 semanas.
  const prospects = [
    { id: 'p1', hotelId: 'h5', lostAt: at(1), lostReason: 'price' },
    { id: 'p2', hotelId: 'h6', lostAt: at(0), lostReason: null },
    { id: 'p3', hotelId: 'old', lostAt: at(21), lostReason: 'no_response' },
  ]
  const deps: FunnelDeps = {
    subscriptions: repo(subs), hotels: repo(hotels), salesProspects: repo(prospects) as any,
    rooms: repo(rooms, { byHotel: (r) => r.hotelId, orderKey: 'createdAt' }),
    platformInvoices: repo(invoices), now: () => NOW,
  }
  return deps
}

describe('buildFunnel (#151)', () => {
  it('semana actual: 10 altas, 4 activadas, 1 pagando → 40% / 10%; 2 perdidos por motivo', async () => {
    const r = await buildFunnel(fixture(), 8)
    expect(r.weeks).toHaveLength(8)
    const cur = r.weeks[7]!
    expect(cur.week).toBe('2026-W37')
    expect(cur.registered).toBe(10)
    expect(cur.activated).toBe(4)
    expect(cur.paying).toBe(1)
    expect(cur.activationRate).toBe(40)
    expect(cur.payingRate).toBe(10)
    expect(cur.lost.price).toBe(1)
    expect(cur.lost.other).toBe(1)
    expect(cur.lostTotal).toBe(2)
    // El perdido de hace 3 semanas cae en su semana, no en la actual.
    expect(r.weeks[4]!.lost.no_response).toBe(1)
    expect(r.totals.registered).toBe(10)
    expect(r.totals.lostTotal).toBe(3)
    expect(r.totals.payingRate).toBe(10)
  })

  it('con 1 semana solo mira la actual y las anteriores no aparecen', async () => {
    const r = await buildFunnel(fixture(), 1)
    expect(r.weeks).toHaveLength(1)
    expect(r.weeks[0]!.registered).toBe(10)
    expect(r.totals.lostTotal).toBe(2)
  })

  it('semana sin altas → tasas 0, no NaN', async () => {
    const r = await buildFunnel(fixture(), 8)
    expect(r.weeks[0]!.activationRate).toBe(0)
    expect(r.weeks[0]!.payingRate).toBe(0)
  })

  it('un hotel sin suscripción no cuenta como registrado', async () => {
    const deps = fixture()
    const hotels = deps.hotels
    deps.hotels = { ...hotels, findMany: async () => [...(await hotels.findMany({})), { id: 'sin-sub', createdAt: at(0) }] } as any
    const r = await buildFunnel(deps, 1)
    expect(r.weeks[0]!.registered).toBe(10)
  })
})

describe('parseWeeks / semanas ISO', () => {
  it('default 8; 1..26 válidos; 0, 27, "abc", 2.5 → ValidationError', () => {
    expect(parseWeeks(undefined)).toBe(8)
    expect(parseWeeks('')).toBe(8)
    expect(parseWeeks('12')).toBe(12)
    expect(parseWeeks(26)).toBe(26)
    for (const bad of [0, 27, 'abc', 2.5, -1]) expect(() => parseWeeks(bad)).toThrow(/weeks/)
  })

  it('startOfIsoWeek y etiqueta: domingo pertenece a la semana que arrancó el lunes anterior', () => {
    expect(startOfIsoWeek(new Date('2026-09-13T23:00:00.000Z')).toISOString()).toBe('2026-09-07T00:00:00.000Z')
    expect(isoWeekLabel(new Date('2026-09-07T00:00:00.000Z'))).toBe('2026-W37')
    expect(isoWeekLabel(new Date('2025-12-29T00:00:00.000Z'))).toBe('2026-W01')
  })
})
