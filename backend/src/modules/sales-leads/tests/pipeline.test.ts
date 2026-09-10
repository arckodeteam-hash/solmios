// sales-leads/tests/pipeline.test.ts — buildPipeline con repos en memoria (REQ-PIPE-01/02).
//
// Cubre lo que el issue #144 pide verificable: las 6 etapas, los dos ejemplos de calor del spec
// (warm=4, hot=7), el orden (vencido → calor → daysLeft) y el whatsappUrl en E.164.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { buildPipeline, comparePipelineRows, daysLeftOf, heatOf, heatScoreOf, stageOfHotel, whatsappUrlFor } from '../usecases/pipeline'
import type { SalesPipelineRow } from '../types'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString()

function memRepo<T extends Record<string, any>>(rows: T[] = []): RepositoryAdapter<T> {
  const match = (r: T, f: Record<string, unknown> = {}) => Object.entries(f).every(([k, v]) => r[k] === v)
  return {
    async findMany(filters: any = {}, opts: any = {}) {
      let out = rows.filter((r) => match(r, filters))
      // orderBy/limit como el ORM real: sin esto `lastActivityAt` saldría de la primera fila insertada.
      const order = opts.orderBy ? (Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy]) : []
      if (order.length) {
        out = [...out].sort((a, b) => {
          for (const { field, dir } of order) {
            const av = String(a[field] ?? ''), bv = String(b[field] ?? '')
            if (av !== bv) return (av < bv ? -1 : 1) * (dir === 'DESC' ? -1 : 1)
          }
          return 0
        })
      }
      if (opts.limit !== undefined) out = out.slice(0, opts.limit)
      if (opts.select) return out.map((r) => Object.fromEntries(opts.select.map((k: string) => [k, r[k]])) as T)
      return out
    },
    async findOne(filters: any) { return rows.find((r) => match(r, filters)) ?? null },
    async findById(id: string) { return rows.find((r) => r.id === id) ?? null },
    async create(data: any) { const row = { id: crypto.randomUUID(), ...data }; rows.push(row); return row },
    async update(id: string, data: any) { const i = rows.findIndex((r) => r.id === id); if (i < 0) return null; rows[i] = { ...rows[i], ...data }; return rows[i] },
    async delete(id: string) { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return i >= 0 },
    async count(filters: any = {}) { return rows.filter((r) => match(r, filters)).length },
    async paginate() { return { data: rows, total: rows.length, limit: rows.length, offset: 0 } },
  } as unknown as RepositoryAdapter<T>
}

type Fixture = {
  hotels?: any[]; subscriptions?: any[]; rooms?: any[]; rates?: any[]; channels?: any[]
  reservations?: any[]; audit?: any[]; leads?: any[]; prospects?: any[]
}

function deps(f: Fixture) {
  return {
    subscriptions: memRepo(f.subscriptions ?? []),
    hotels: memRepo(f.hotels ?? []),
    rooms: memRepo(f.rooms ?? []),
    roomRates: memRepo(f.rates ?? []),
    channelConfig: memRepo(f.channels ?? []),
    reservations: memRepo(f.reservations ?? []),
    auditlog: memRepo(f.audit ?? []),
    users: memRepo([]),
    salesLeads: memRepo<any>(f.leads ?? []),
    salesProspects: memRepo<any>(f.prospects ?? []),
    now: () => NOW,
  }
}

const hotel = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Hotel ${id}`, ownerName: `Dueño ${id}`, email: `${id}@test.com`, phone: '809-555-0000',
  country: 'DO', createdAt: iso(-10), ...extra,
})
const sub = (hotelId: string, status: string, trialEndsAt: string | null) => ({
  id: `sub-${hotelId}`, hotelId, status, trialEndsAt, planId: 'plan-starter', createdAt: iso(-10),
})
const many = (hotelId: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${hotelId}-${i}`, hotelId }))

describe('sales-pipeline — las 6 etapas', () => {
  it('contact: sales_lead sin hotel con ese email → hotelId null, signals null', async () => {
    const r = await buildPipeline(deps({
      leads: [{ id: 'l1', fullName: 'Ana', email: 'ana@x.com', phone: null, hotelName: 'Posada Ana', message: 'Quiero info', planInterest: 'ultra', createdAt: iso(-1) }],
    }))
    expect(r.total).toBe(1)
    const row = r.data[0]
    expect(row).toMatchObject({ key: 'lead:l1', stage: 'contact', hotelId: null, leadId: 'l1', signals: null, heat: 'cold', ownerName: 'Ana', hotelName: 'Posada Ana', message: 'Quiero info', planId: 'ultra' })
  })

  it('un lead cuyo email ya es de un hotel registrado NO duplica la fila del hotel', async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('h1', { email: 'Ana@X.com' })],
      subscriptions: [sub('h1', 'trialing', iso(5))],
      leads: [{ id: 'l1', fullName: 'Ana', email: 'ana@x.com', createdAt: iso(-1) }],
    }))
    expect(r.data.map((x) => x.key)).toEqual(['hotel:h1'])
  })

  it('registered: trialing vigente y 0 habitaciones', async () => {
    const r = await buildPipeline(deps({ hotels: [hotel('h1')], subscriptions: [sub('h1', 'trialing', iso(5))] }))
    expect(r.data[0].stage).toBe('registered')
    expect(r.data[0].signals).toEqual({ rooms: 0, rates: 0, channels: 0, reservations: 0, lastActivityAt: null })
  })

  it('activated: trialing vigente con habitaciones; trialEndsAt mañana → daysLeft 1, signals.rooms 12', async () => {
    const r = await buildPipeline(deps({ hotels: [hotel('h1')], subscriptions: [sub('h1', 'trialing', iso(1))], rooms: many('h1', 12) }))
    expect(r.data[0]).toMatchObject({ stage: 'activated', daysLeft: 1 })
    expect(r.data[0].signals?.rooms).toBe(12)
  })

  it('paying: subscription active (daysLeft null sin trialEndsAt)', async () => {
    const r = await buildPipeline(deps({ hotels: [hotel('h1')], subscriptions: [sub('h1', 'active', null)] }))
    expect(r.data[0]).toMatchObject({ stage: 'paying', daysLeft: null, subscriptionStatus: 'active' })
  })

  it('expired: trialing con trialEndsAt pasado, sin lostAt (daysLeft negativo)', async () => {
    const r = await buildPipeline(deps({ hotels: [hotel('h1')], subscriptions: [sub('h1', 'trialing', iso(-3))], rooms: many('h1', 4) }))
    expect(r.data[0]).toMatchObject({ stage: 'expired', daysLeft: -3 })
  })

  it('expired: status expired de la suscripción también', () => {
    expect(stageOfHotel({ status: 'expired', trialEndsAt: iso(-30) }, 5, null, NOW)).toBe('expired')
    expect(stageOfHotel({ status: 'canceled', trialEndsAt: null }, 5, null, NOW)).toBe('expired')
  })

  it('lost: sales_prospects.lostAt manda sobre cualquier estado', async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('h1')],
      subscriptions: [sub('h1', 'trialing', iso(5))],
      rooms: many('h1', 3),
      prospects: [{ id: 'p1', hotelId: 'h1', leadId: null, lostAt: iso(-1), lostReason: 'price', nextStepNote: 'x' }],
    }))
    expect(r.data[0]).toMatchObject({ stage: 'lost', lostReason: 'price', nextStepNote: 'x' })
    expect(r.data[0].lostAt).toBe(iso(-1))
  })

  it('lost también para un lead de contacto con lostAt', async () => {
    const r = await buildPipeline(deps({
      leads: [{ id: 'l1', fullName: 'Ana', email: 'ana@x.com', createdAt: iso(-1) }],
      prospects: [{ id: 'p1', hotelId: null, leadId: 'l1', lostAt: iso(0), lostReason: 'not_a_fit' }],
    }))
    expect(r.data[0].stage).toBe('lost')
  })

  // REG-1: el status que el admin le puso al lead en /admin/leads no puede contradecir al pipeline.
  it('lead con status lost (sin prospecto) → lost; new/contacted → contact; expone leadStatus', async () => {
    const r = await buildPipeline(deps({
      leads: [
        { id: 'l-lost', fullName: 'Ana', email: 'ana@x.com', status: 'lost', createdAt: iso(-1) },
        { id: 'l-new', fullName: 'Bea', email: 'bea@x.com', status: 'new', createdAt: iso(-1) },
        { id: 'l-contacted', fullName: 'Caro', email: 'caro@x.com', status: 'contacted', createdAt: iso(-1) },
      ],
    }))
    const by = Object.fromEntries(r.data.map((x) => [x.key, x]))
    expect(by['lead:l-lost']).toMatchObject({ stage: 'lost', leadStatus: 'lost' })
    expect(by['lead:l-new']).toMatchObject({ stage: 'contact', leadStatus: 'new' })
    expect(by['lead:l-contacted']).toMatchObject({ stage: 'contact', leadStatus: 'contacted' })
  })

  it('lead con status won (sin hotel todavía) sigue en contact; un hotel expone leadStatus null', async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('h1')], subscriptions: [sub('h1', 'active', null)],
      leads: [{ id: 'l-won', fullName: 'Dan', email: 'dan@x.com', status: 'won', createdAt: iso(-1) }],
    }))
    const by = Object.fromEntries(r.data.map((x) => [x.key, x]))
    expect(by['lead:l-won']).toMatchObject({ stage: 'contact', leadStatus: 'won' })
    expect(by['hotel:h1'].leadStatus).toBeNull()
  })

  it('un hotel sin suscripción (demo / anterior al módulo) no entra al embudo', async () => {
    const r = await buildPipeline(deps({ hotels: [hotel('demo')], subscriptions: [] }))
    expect(r.total).toBe(0)
  })

  it('con dos suscripciones del mismo hotel manda la más nueva', async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('h1')],
      subscriptions: [
        { ...sub('h1', 'trialing', iso(-20)), id: 'old', createdAt: iso(-40) },
        { ...sub('h1', 'active', null), id: 'new', createdAt: iso(-2) },
      ],
    }))
    expect(r.data[0].stage).toBe('paying')
  })
})

describe('sales-pipeline — calor (REQ-PIPE-02)', () => {
  it('10 hab / 0 tarifas / 0 canales / 0 reservas / actividad hace 1 día → warm (4)', async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('h1')], subscriptions: [sub('h1', 'trialing', iso(5))],
      rooms: many('h1', 10), audit: [{ id: 'a1', hotelId: 'h1', createdAt: iso(-1) }],
    }))
    expect(r.data[0].heatScore).toBe(4)
    expect(r.data[0].heat).toBe('warm')
    expect(r.data[0].signals?.lastActivityAt).toBe(iso(-1))
  })

  it('habitaciones + tarifas + 1 reserva, sin actividad en 10 días → hot (7)', async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('h1')], subscriptions: [sub('h1', 'trialing', iso(5))],
      rooms: many('h1', 3), rates: many('h1', 2), reservations: many('h1', 1),
      audit: [{ id: 'a1', hotelId: 'h1', createdAt: iso(-10) }],
    }))
    expect(r.data[0].heatScore).toBe(7)
    expect(r.data[0].heat).toBe('hot')
  })

  it('sin ninguna señal → cold (0); canal conectado solo → warm (3); todo → hot (12)', () => {
    const base = { rooms: 0, rates: 0, channels: 0, reservations: 0, lastActivityAt: null }
    expect(heatOf(heatScoreOf(base, NOW))).toBe('cold')
    expect(heatScoreOf({ ...base, channels: 1 }, NOW)).toBe(3)
    expect(heatOf(3)).toBe('warm')
    expect(heatScoreOf({ rooms: 1, rates: 1, channels: 1, reservations: 1, lastActivityAt: iso(-2) }, NOW)).toBe(12)
    expect(heatScoreOf({ rooms: 1, rates: 1, channels: 1, reservations: 1, lastActivityAt: iso(-4) }, NOW)).toBe(10)
  })

  it('lastActivityAt es el MAX de audit_log del hotel, no el primero', async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('h1')], subscriptions: [sub('h1', 'trialing', iso(5))],
      audit: [
        { id: 'a1', hotelId: 'h1', createdAt: iso(-8) },
        { id: 'a2', hotelId: 'h1', createdAt: iso(-1) },
        { id: 'a3', hotelId: 'h1', createdAt: iso(-5) },
        { id: 'a4', hotelId: 'otro', createdAt: iso(0) },
      ],
    }))
    expect(r.data[0].signals?.lastActivityAt).toBe(iso(-1))
  })
})

describe('sales-pipeline — orden (vencido → calor → daysLeft)', () => {
  it('nextStepAt vencido primero, después calor desc, después daysLeft asc', async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('cold-far'), hotel('hot'), hotel('cold-near'), hotel('overdue'), hotel('warm')],
      subscriptions: [
        sub('cold-far', 'trialing', iso(10)),
        sub('hot', 'trialing', iso(8)),
        sub('cold-near', 'trialing', iso(2)),
        sub('overdue', 'trialing', iso(9)),
        sub('warm', 'trialing', iso(1)),
      ],
      rooms: [...many('hot', 2), ...many('warm', 1)],
      rates: many('hot', 1),
      channels: many('hot', 1),
      audit: [{ id: 'a1', hotelId: 'warm', createdAt: iso(-1) }],
      prospects: [
        { id: 'p1', hotelId: 'overdue', leadId: null, nextStepAt: iso(-1) },
        { id: 'p2', hotelId: 'hot', leadId: null, nextStepAt: iso(3) }, // futuro: no cuenta como vencido
      ],
    }))
    expect(r.data.map((x) => x.hotelId)).toEqual(['overdue', 'hot', 'warm', 'cold-near', 'cold-far'])
  })

  it('dos vencidos: el más viejo primero; sin trial (daysLeft null) al final de su grupo', () => {
    const row = (p: Partial<SalesPipelineRow>): SalesPipelineRow => ({
      key: p.key ?? 'k', hotelId: null, leadId: null, hotelName: null, ownerName: null, email: null, phone: null,
      whatsappUrl: null, stage: 'registered', leadStatus: null, subscriptionStatus: null, planId: null, trialEndsAt: null,
      daysLeft: null, signals: null, heatScore: 0, heat: 'cold', message: null, registeredAt: null,
      nextStepAt: null, nextStepNote: null, assignedTo: null, contactedAt: null, lostAt: null, lostReason: null, notes: null,
      ...p,
    })
    const rows = [
      row({ key: 'a', nextStepAt: iso(-1) }),
      row({ key: 'b', nextStepAt: iso(-5) }),
      row({ key: 'c', daysLeft: null, heat: 'cold' }),
      row({ key: 'd', daysLeft: 3, heat: 'cold' }),
    ].sort(comparePipelineRows(NOW))
    expect(rows.map((x) => x.key)).toEqual(['b', 'a', 'd', 'c'])
  })
})

describe('sales-pipeline — whatsappUrl y daysLeft', () => {
  it("phone '809-555-0000' → https://wa.me/18095550000; sin teléfono → null", async () => {
    const r = await buildPipeline(deps({
      hotels: [hotel('h1', { phone: '809-555-0000', country: null }), hotel('h2', { phone: null })],
      subscriptions: [sub('h1', 'trialing', iso(5)), sub('h2', 'trialing', iso(6))],
    }))
    const byId = Object.fromEntries(r.data.map((x) => [x.hotelId, x]))
    expect(byId.h1.whatsappUrl).toBe('https://wa.me/18095550000')
    expect(byId.h2.whatsappUrl).toBeNull()
  })

  it('con país del hotel manda el prefijo del hotel; +prefijo explícito se respeta', () => {
    expect(whatsappUrlFor('55 1234 5678', 'MX')).toBe('https://wa.me/525512345678')
    expect(whatsappUrlFor('+34 600 000 000', 'DO')).toBe('https://wa.me/34600000000')
    expect(whatsappUrlFor('sin teléfono', 'DO')).toBeNull()
  })

  it('daysLeft: mañana 1, ayer -1, sin fecha null, fecha inválida null', () => {
    expect(daysLeftOf(iso(1), NOW)).toBe(1)
    expect(daysLeftOf(iso(-1), NOW)).toBe(-1)
    expect(daysLeftOf(null, NOW)).toBeNull()
    expect(daysLeftOf('nope', NOW)).toBeNull()
  })
})

describe('sales-pipeline — consultas acotadas por hotel (COR-2)', () => {
  /** Envuelve un repo y anota cada findMany/count con sus filtros y opciones. */
  function spy<T extends Record<string, any>>(repo: RepositoryAdapter<T>, calls: Array<{ op: string; filters: any; opts?: any }>) {
    return {
      ...repo,
      async findMany(filters: any = {}, opts: any = {}) { calls.push({ op: 'findMany', filters, opts }); return repo.findMany(filters, opts) },
      async count(filters: any = {}) { calls.push({ op: 'count', filters }); return repo.count(filters) },
    } as RepositoryAdapter<T>
  }

  it('rooms/rates/channels/reservations van por count({hotelId}); audit_log por findMany({hotelId}) con limit 1 — nunca la tabla entera', async () => {
    const calls: Record<string, Array<{ op: string; filters: any; opts?: any }>> = { rooms: [], rates: [], channels: [], reservations: [], audit: [] }
    const d = deps({
      hotels: [hotel('h1'), hotel('h2'), hotel('demo')],
      // `demo` no tiene suscripción: no está en el embudo y NO se le piden señales.
      subscriptions: [sub('h1', 'trialing', iso(5)), sub('h2', 'active', null)],
      rooms: [...many('h1', 2), ...many('otro', 50)],
      reservations: [...many('h2', 3), ...many('otro', 500)],
      audit: [{ id: 'a1', hotelId: 'h1', createdAt: iso(-1) }, ...many('otro', 100).map((r, i) => ({ ...r, createdAt: iso(-i) }))],
    })
    const r = await buildPipeline({
      ...d,
      rooms: spy(d.rooms, calls.rooms), roomRates: spy(d.roomRates, calls.rates), channelConfig: spy(d.channelConfig, calls.channels),
      reservations: spy(d.reservations, calls.reservations), auditlog: spy(d.auditlog, calls.audit),
    })

    for (const table of ['rooms', 'rates', 'channels', 'reservations'] as const) {
      expect(calls[table].length).toBeGreaterThan(0)
      for (const c of calls[table]) {
        expect(c.op).toBe('count')
        expect(typeof c.filters.hotelId).toBe('string')
        expect(['h1', 'h2']).toContain(c.filters.hotelId)
      }
    }
    expect(calls.audit.length).toBeGreaterThan(0)
    for (const c of calls.audit) {
      expect(c.op).toBe('findMany')
      expect(['h1', 'h2']).toContain(c.filters.hotelId)
      expect(c.opts.limit).toBe(1)
      expect(c.opts.orderBy).toEqual({ field: 'createdAt', dir: 'DESC' })
    }
    // Y el resultado sigue siendo el correcto.
    const byId = Object.fromEntries(r.data.map((x) => [x.hotelId, x]))
    expect(byId.h1.signals).toEqual({ rooms: 2, rates: 0, channels: 0, reservations: 0, lastActivityAt: iso(-1) })
    expect(byId.h2.signals).toEqual({ rooms: 0, rates: 0, channels: 0, reservations: 3, lastActivityAt: null })
    expect(byId.demo).toBeUndefined()
  })
})
