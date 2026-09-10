// sales-leads/tests/sales-pipeline-routes.test.ts — GET/PUT /api/admin/sales-pipeline a nivel de
// RUTA REAL (Router + HotelAuth reales, ORM en memoria con estado) — REQ-PIPE-01/03, issue #144.
//
// Lo que se afirma: (a) el guard de plataforma corta a un merchant en GET y PUT; (b) el GET trae
// `whatsappUrl` en E.164; (c) el PUT es parcial (no borra lo que no vino), `lostReason` sin
// `lostAt` sella `lostAt`, un motivo fuera del enum es 400, y cada cambio deja fila en `audit_log`
// con `hotelId='platform'`.
import { describe, it, expect, beforeEach } from 'bun:test'
import { Router } from 'arckode-framework'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { SalesLeadsModule } from '../index'

const NOW = new Date('2026-09-10T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const iso = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString()

/** ORM en memoria con estado por modelo: lo mínimo que usa OrmRepository. */
function memOrm(seed: Record<string, any[]> = {}) {
  const tables = new Map<string, any[]>()
  const rows = (m: string) => { if (!tables.has(m)) tables.set(m, []); return tables.get(m)! }
  for (const [m, list] of Object.entries(seed)) tables.set(m, list.map((r) => ({ ...r })))
  const match = (r: any, f: Record<string, unknown> = {}) => Object.entries(f).every(([k, v]) => r[k] === v)
  const orm: any = {
    define() { return orm },
    async findMany(m: string, f: any = {}, opts: any = {}) {
      let out = rows(m).filter((r) => match(r, f))
      const order = opts?.orderBy ? (Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy]) : []
      if (order.length) {
        out = [...out].sort((a, b) => {
          for (const { field, dir } of order) {
            const av = String(a[field] ?? ''), bv = String(b[field] ?? '')
            if (av !== bv) return (av < bv ? -1 : 1) * (dir === 'DESC' ? -1 : 1)
          }
          return 0
        })
      }
      if (opts?.limit !== undefined) out = out.slice(0, opts.limit)
      if (opts?.select) return out.map((r) => Object.fromEntries(opts.select.map((k: string) => [k, r[k]])))
      return out
    },
    async findOne(m: string, f: any) { return rows(m).find((r) => match(r, f)) ?? null },
    async findById(m: string, id: string) { return rows(m).find((r) => r.id === id) ?? null },
    async create(m: string, data: any) {
      const row = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data }
      rows(m).push(row)
      return row
    },
    async update(m: string, id: string, data: any) {
      const list = rows(m)
      const i = list.findIndex((r) => r.id === id)
      if (i < 0) return null
      list[i] = { ...list[i], ...data, updatedAt: new Date().toISOString() }
      return list[i]
    },
    async delete(m: string, id: string) { const list = rows(m); const i = list.findIndex((r) => r.id === id); if (i >= 0) list.splice(i, 1); return i >= 0 },
    async count(m: string, f: any = {}) { return rows(m).filter((r) => match(r, f)).length },
    async paginate(m: string) { return { data: rows(m), total: rows(m).length, limit: 20, offset: 0 } },
    transaction: async (fn: any) => fn(orm),
  }
  return { orm, rows }
}

function mount(seed: Record<string, any[]>) {
  const router = new Router()
  const auth = makeAuth()
  const { orm, rows } = memOrm(seed)
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const mod = SalesLeadsModule() as any
  mod.create({ logger: fakeLogger(), orm, cache, router, auth })
  const headersFor = (role: string, userType: string) => ({
    authorization: `Bearer ${auth.createToken({ id: `user-${role}`, role, hotelId: 'platform', userType })}`,
  })
  return { router, rows, headersFor }
}

const SEED = {
  Hotels: [
    { id: 'h1', name: 'Hotel Uno', ownerName: 'Ana', email: 'ana@uno.com', phone: '809-555-0000', country: 'DO', createdAt: iso(-5) },
    { id: 'h2', name: 'Hotel Dos', ownerName: 'Beto', email: 'beto@dos.com', phone: null, country: 'DO', createdAt: iso(-5) },
  ],
  Subscriptions: [
    { id: 's1', hotelId: 'h1', status: 'trialing', trialEndsAt: iso(5), planId: 'plan-starter', createdAt: iso(-5) },
    { id: 's2', hotelId: 'h2', status: 'trialing', trialEndsAt: iso(3), planId: 'plan-starter', createdAt: iso(-5) },
  ],
  Rooms: [{ id: 'r1', hotelId: 'h1' }],
  RoomRates: [], Canales: [], Reservations: [], Auditlog: [],
  SalesLeads: [{ id: 'l1', fullName: 'Carla', email: 'carla@tres.com', phone: null, status: 'new', createdAt: iso(-1) }],
  SalesProspects: [],
  Users: [
    { id: 'adm-1', name: 'Vendedora Uno', email: 'uno@plataforma.com', password: 'NO-DEBE-SALIR-1', userType: 'admin', role: 'super_admin', hotelId: 'platform', active: 1 },
    { id: 'adm-2', name: 'Vendedor Dos', email: 'dos@plataforma.com', password: 'NO-DEBE-SALIR-2', userType: 'admin', role: 'super_admin', hotelId: 'platform', active: 1 },
    { id: 'adm-off', name: 'Ex vendedor', email: 'ex@plataforma.com', password: 'NO-DEBE-SALIR-3', userType: 'admin', role: 'super_admin', hotelId: 'platform', active: 0 },
    { id: 'mer-1', name: 'Dueño Hotel Uno', email: 'ana@uno.com', password: 'NO-DEBE-SALIR-4', userType: 'merchant', role: 'hotel_admin', hotelId: 'h1', active: 1 },
  ],
}

describe('GET /api/admin/sales-pipeline — guard de plataforma', () => {
  const { router, headersFor } = mount(SEED)

  it('merchant (hotel_admin) → 403', async () => {
    const res = await router.resolve('GET', '/api/admin/sales-pipeline', { headers: headersFor('hotel_admin', 'merchant') })
    expect(res.status).toBe(403)
  })

  it('super_admin con userType merchant → 401 (requireUserType admin)', async () => {
    const res = await router.resolve('GET', '/api/admin/sales-pipeline', { headers: headersFor('super_admin', 'merchant') })
    expect(res.status).toBe(401)
  })

  it('sin token → 401', async () => {
    const res = await router.resolve('GET', '/api/admin/sales-pipeline')
    expect(res.status).toBe(401)
  })

  it('super_admin (admin) → 200 con hoteles + lead de contacto y whatsappUrl en E.164', async () => {
    const res = await router.resolve('GET', '/api/admin/sales-pipeline', { headers: headersFor('super_admin', 'admin') })
    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.total).toBe(3)
    const byKey = Object.fromEntries(body.data.map((r: any) => [r.key, r]))
    expect(byKey['hotel:h1']).toMatchObject({ stage: 'activated', whatsappUrl: 'https://wa.me/18095550000', heat: 'cold' })
    expect(byKey['hotel:h1'].signals.rooms).toBe(1)
    expect(byKey['hotel:h2']).toMatchObject({ stage: 'registered', whatsappUrl: null })
    expect(byKey['lead:l1']).toMatchObject({ stage: 'contact', hotelId: null, leadId: 'l1', whatsappUrl: null })
  })
})

describe('PUT /api/admin/sales-pipeline/:key', () => {
  let ctx: ReturnType<typeof mount>
  beforeEach(() => { ctx = mount(SEED) })

  it('merchant → 403', async () => {
    const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: ctx.headersFor('hotel_admin', 'merchant'), body: { notes: 'x' },
    })
    expect(res.status).toBe(403)
  })

  it('upsert: crea la fila en el primer PUT y el GET siguiente trae los valores', async () => {
    const admin = ctx.headersFor('super_admin', 'admin')
    const put = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: admin, body: { nextStepAt: '2026-09-12', nextStepNote: 'Llamar 10am' },
    })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ hotelId: 'h1', leadId: null, nextStepAt: '2026-09-12', nextStepNote: 'Llamar 10am' })
    expect(ctx.rows('SalesProspects')).toHaveLength(1)

    const get = await ctx.router.resolve('GET', '/api/admin/sales-pipeline', { headers: admin })
    const row = (get.body as any).data.find((r: any) => r.key === 'hotel:h1')
    expect(row).toMatchObject({ nextStepAt: '2026-09-12', nextStepNote: 'Llamar 10am' })
  })

  it('con nextStepAt ya vencido el hotel aparece primero en el GET', async () => {
    const admin = ctx.headersFor('super_admin', 'admin')
    // Sin vencimiento el orden es h2 (cold, 3 días) → h1 (cold, 5 días) → lead: h1 va segundo.
    const before = await ctx.router.resolve('GET', '/api/admin/sales-pipeline', { headers: admin })
    expect((before.body as any).data.map((r: any) => r.key)).toEqual(['hotel:h2', 'hotel:h1', 'lead:l1'])

    await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', { headers: admin, body: { nextStepAt: '2026-09-01' } })
    const get = await ctx.router.resolve('GET', '/api/admin/sales-pipeline', { headers: admin })
    expect((get.body as any).data.map((r: any) => r.key)).toEqual(['hotel:h1', 'hotel:h2', 'lead:l1'])
  })

  it('PUT parcial no borra los otros campos', async () => {
    const admin = ctx.headersFor('super_admin', 'admin')
    await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: admin, body: { nextStepAt: '2026-09-12', nextStepNote: 'Llamar 10am', assignedTo: 'adm-1', notes: 'línea 1\nlínea 2' },
    })
    const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: admin, body: { contactedAt: iso(0) },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      nextStepAt: '2026-09-12', nextStepNote: 'Llamar 10am', assignedTo: 'adm-1', notes: 'línea 1\nlínea 2', contactedAt: iso(0),
    })
    expect(ctx.rows('SalesProspects')).toHaveLength(1) // sigue siendo UNA fila (upsert, no insert)
  })

  it('null explícito limpia el campo (y solo ese)', async () => {
    const admin = ctx.headersFor('super_admin', 'admin')
    await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: admin, body: { nextStepAt: '2026-09-12', nextStepNote: 'Llamar 10am' },
    })
    const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: admin, body: { nextStepAt: null },
    })
    expect((res.body as any).nextStepAt).toBeNull()
    expect((res.body as any).nextStepNote).toBe('Llamar 10am')
  })

  it('lostReason sin lostAt setea lostAt; el GET lo muestra como lost', async () => {
    const admin = ctx.headersFor('super_admin', 'admin')
    const before = Date.now()
    const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: admin, body: { lostReason: 'price' },
    })
    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.lostReason).toBe('price')
    expect(typeof body.lostAt).toBe('string')
    expect(Date.parse(body.lostAt)).toBeGreaterThanOrEqual(before)

    const get = await ctx.router.resolve('GET', '/api/admin/sales-pipeline', { headers: admin })
    expect((get.body as any).data.find((r: any) => r.key === 'hotel:h1').stage).toBe('lost')
  })

  it('lostReason con lostAt explícito respeta la fecha enviada', async () => {
    const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: ctx.headersFor('super_admin', 'admin'), body: { lostReason: 'other', lostAt: '2026-09-01' },
    })
    expect(res.body).toMatchObject({ lostReason: 'other', lostAt: '2026-09-01' })
  })

  it('motivo fuera del enum → 400', async () => {
    const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: ctx.headersFor('super_admin', 'admin'), body: { lostReason: 'se_fue' },
    })
    expect(res.status).toBe(400)
    expect(ctx.rows('SalesProspects')).toHaveLength(0)
  })

  it('fecha inválida → 400; key mal formada → 400; hotel inexistente → 404', async () => {
    const admin = ctx.headersFor('super_admin', 'admin')
    expect((await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', { headers: admin, body: { nextStepAt: 'mañana' } })).status).toBe(400)
    expect((await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/h1', { headers: admin, body: { notes: 'x' } })).status).toBe(400)
    expect((await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:nope', { headers: admin, body: { notes: 'x' } })).status).toBe(404)
    expect((await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/lead:nope', { headers: admin, body: { notes: 'x' } })).status).toBe(404)
  })

  it('lead:<id> crea la fila con leadId (hotelId null)', async () => {
    const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/lead:l1', {
      headers: ctx.headersFor('super_admin', 'admin'), body: { contactedAt: iso(0) },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ hotelId: null, leadId: 'l1', contactedAt: iso(0) })
  })

  it('queda fila en audit_log con hotelId=platform, el usuario y lo que cambió', async () => {
    await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: ctx.headersFor('super_admin', 'admin'), body: { lostReason: 'price' },
    })
    const audit = ctx.rows('Auditlog')
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      hotelId: 'platform', userId: 'user-super_admin', action: 'sales_prospect.update',
      entity: 'sales_prospect', entityId: 'hotel:h1',
    })
    const detail = JSON.parse(audit[0].detail)
    expect(detail.lostReason).toBe('price')
    expect(typeof detail.lostAt).toBe('string')
  })

  it('un PUT rechazado (400) NO deja fila en audit_log', async () => {
    await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
      headers: ctx.headersFor('super_admin', 'admin'), body: { lostReason: 'se_fue' },
    })
    expect(ctx.rows('Auditlog')).toHaveLength(0)
  })

  // SEC-3/FE-3: `assignedTo` guarda `users.id` de un admin de la plataforma, no texto libre.
  describe('assignedTo apunta a un users.id con userType=admin', () => {
    it('id inexistente → 400 y no crea la fila', async () => {
      const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
        headers: ctx.headersFor('super_admin', 'admin'), body: { assignedTo: 'Juan Pérez' },
      })
      expect(res.status).toBe(400)
      expect(ctx.rows('SalesProspects')).toHaveLength(0)
      expect(ctx.rows('Auditlog')).toHaveLength(0)
    })

    it('id de un merchant (no admin) → 400', async () => {
      const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
        headers: ctx.headersFor('super_admin', 'admin'), body: { assignedTo: 'mer-1' },
      })
      expect(res.status).toBe(400)
      expect(ctx.rows('SalesProspects')).toHaveLength(0)
    })

    it('id de un admin desactivado → 400', async () => {
      const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', {
        headers: ctx.headersFor('super_admin', 'admin'), body: { assignedTo: 'adm-off' },
      })
      expect(res.status).toBe(400)
    })

    it('id de un admin activo → 200 y queda guardado; null lo limpia', async () => {
      const admin = ctx.headersFor('super_admin', 'admin')
      const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', { headers: admin, body: { assignedTo: 'adm-2' } })
      expect(res.status).toBe(200)
      expect((res.body as any).assignedTo).toBe('adm-2')
      const clear = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', { headers: admin, body: { assignedTo: null } })
      expect(clear.status).toBe(200)
      expect((clear.body as any).assignedTo).toBeNull()
    })

    // COR-5: un `<select>` vacío manda ''; "sin asignar" se persiste como null, nunca como ''.
    it("assignedTo '' se guarda como null (no como cadena vacía)", async () => {
      const admin = ctx.headersFor('super_admin', 'admin')
      const res = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', { headers: admin, body: { assignedTo: 'adm-2' } })
      expect(res.status).toBe(200)
      const clear = await ctx.router.resolve('PUT', '/api/admin/sales-pipeline/hotel:h1', { headers: admin, body: { assignedTo: '' } })
      expect(clear.status).toBe(200)
      expect((clear.body as any).assignedTo).toBeNull()
      const stored = ctx.rows('SalesProspects').find((r: any) => r.hotelId === 'h1') as any
      expect(stored.assignedTo).toBeNull()
    })
  })
})

describe('GET /api/admin/sales-pipeline/assignees', () => {
  const { router, headersFor } = mount(SEED)

  it('merchant → 403', async () => {
    const res = await router.resolve('GET', '/api/admin/sales-pipeline/assignees', { headers: headersFor('hotel_admin', 'merchant') })
    expect(res.status).toBe(403)
  })

  it('sin token → 401', async () => {
    const res = await router.resolve('GET', '/api/admin/sales-pipeline/assignees')
    expect(res.status).toBe(401)
  })

  it('admin → { data: [{id,name,email}] } EXACTO, ordenado por nombre: solo admins activos, nunca password ni otros campos', async () => {
    const res = await router.resolve('GET', '/api/admin/sales-pipeline/assignees', { headers: headersFor('super_admin', 'admin') })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      data: [
        { id: 'adm-2', name: 'Vendedor Dos', email: 'dos@plataforma.com' },
        { id: 'adm-1', name: 'Vendedora Uno', email: 'uno@plataforma.com' },
      ],
    })
    for (const u of (res.body as any).data) expect(Object.keys(u).sort()).toEqual(['email', 'id', 'name'])
    expect(JSON.stringify(res.body)).not.toContain('NO-DEBE-SALIR')
  })
})

describe('GET /api/admin/sales-pipeline/funnel (#151)', () => {
  const { router, headersFor } = mount(SEED)

  it('merchant → 403; sin token → 401', async () => {
    expect((await router.resolve('GET', '/api/admin/sales-pipeline/funnel', { headers: headersFor('hotel_admin', 'merchant') })).status).toBe(403)
    expect((await router.resolve('GET', '/api/admin/sales-pipeline/funnel')).status).toBe(401)
  })

  it('weeks fuera de 1..26 → 400 (0, 27, abc)', async () => {
    for (const w of ['0', '27', 'abc']) {
      const res = await router.resolve('GET', '/api/admin/sales-pipeline/funnel', { headers: headersFor('super_admin', 'admin'), query: { weeks: w } })
      expect(res.status).toBe(400)
    }
  })

  it('admin → 200 con N semanas ISO, totales y tasas numéricas', async () => {
    const res = await router.resolve('GET', '/api/admin/sales-pipeline/funnel', { headers: headersFor('super_admin', 'admin'), query: { weeks: '4' } })
    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.weeksCount).toBe(4)
    expect(body.weeks).toHaveLength(4)
    expect(body.weeks[0].week).toMatch(/^\d{4}-W\d{2}$/)
    expect(typeof body.totals.activationRate).toBe('number')
    expect(body.totals.registered).toBeGreaterThanOrEqual(0)
  })
})
