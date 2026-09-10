// anuncios/tests/audience-route.test.ts — audiencia de un anuncio (#106) a nivel de RUTA REAL.
//
// Monta `AnunciosModule` de verdad (Router + HotelAuth reales, guard de permisos real contra el
// mapa de src/shared/permissions.ts) sobre un ORM en memoria con estado, como hace
// admin/tests/extend-trial-route.test.ts. Lo que se afirma, de punta a punta por HTTP:
//   - super_admin: POST {audience:'all'} → 201 con audience persistida.
//   - audience:'hotel' sin hotelId → 400 y el error NOMBRA `hotelId` (el panel marca ese campo).
//   - hotel_admin que pide 'all' → 403 y NINGUNA fila escrita; el mismo usuario con 'hotel' → 201.
//   - list: un 'admins' del hotel lo ve el hotel_admin y NO lo ve el receptionist.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { AnunciosModule } from '../index'

/**
 * ORM en memoria con estado por modelo. A diferencia del fakeOrm genérico, `paginate` y `count`
 * respetan los filtros: el listado del módulo filtra por hotelId y el test cuenta filas reales.
 */
function memOrm(seed: Record<string, any[]> = {}) {
  const tables = new Map<string, any[]>()
  const rows = (m: string) => { if (!tables.has(m)) tables.set(m, []); return tables.get(m)! }
  for (const [m, list] of Object.entries(seed)) tables.set(m, list.map((r) => ({ ...r })))
  const match = (r: any, f: Record<string, unknown> = {}) => Object.entries(f).every(([k, v]) => r[k] === v)
  const orm: any = {
    define() { return orm },
    async findMany(m: string, f: any = {}) { return rows(m).filter((r) => match(r, f)) },
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
    async paginate(m: string, f: any = {}, opts: { limit?: number; offset?: number } = {}) {
      const all = rows(m).filter((r) => match(r, f))
      const limit = opts.limit ?? 20
      const offset = opts.offset ?? 0
      return { data: all.slice(offset, offset + limit), total: all.length, limit, offset }
    },
    transaction: async (fn: any) => fn(orm),
  }
  return { orm, rows }
}

function mount() {
  const router = new Router()
  const auth = makeAuth()
  const { orm, rows } = memOrm()
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const logger = fakeLogger()
  ;(AnunciosModule() as any).create({ logger, orm, cache, router, auth })

  const headersFor = (payload: Record<string, unknown>) => ({ authorization: `Bearer ${auth.createToken(payload as any)}` })
  // Sin fila en Roles → el guard cae al mapa por defecto: hotel_admin tiene dashboard:create,
  // receptionist sólo dashboard:view.
  const superAdmin = headersFor({ id: 'sa-1', role: 'super_admin', hotelId: 'platform', userType: 'admin' })
  const merchant = headersFor({ id: 'u-1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })
  const receptionist = headersFor({ id: 'u-2', role: 'receptionist', hotelId: 'h1', userType: 'merchant' })
  return { router, rows, superAdmin, merchant, receptionist }
}

const URL = '/api/anuncios'

describe('POST /api/anuncios — audience (#106)', () => {
  it('super_admin con audience:"all" → 201 y la fila queda con audience "all"', async () => {
    const { router, rows, superAdmin } = mount()
    const res = await router.resolve('POST', URL, { body: { title: 'Hola', audience: 'all' }, headers: superAdmin })
    expect(res.status).toBe(201)
    expect((res.body as any).audience).toBe('all')
    expect(rows('Announcements')).toHaveLength(1)
    expect(rows('Announcements')[0]!.audience).toBe('all')
  })

  it('super_admin con audience:"hotel" SIN hotelId → 400 y el error nombra hotelId, sin fila', async () => {
    const { router, rows, superAdmin } = mount()
    const res = await router.resolve('POST', URL, { body: { title: 'Hola', audience: 'hotel' }, headers: superAdmin })
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toContain('hotelId')
    expect((res.body as any).details?.fields?.hotelId).toBeDefined()
    expect(rows('Announcements')).toHaveLength(0)
  })

  it('audience fuera del enum → 400', async () => {
    const { router, rows, superAdmin } = mount()
    const res = await router.resolve('POST', URL, { body: { title: 'Hola', audience: 'everyone' }, headers: superAdmin })
    expect(res.status).toBe(400)
    expect(rows('Announcements')).toHaveLength(0)
  })

  it('hotel_admin con audience:"all" → 403 y el count de announcements no cambia', async () => {
    const { router, rows, merchant } = mount()
    const before = rows('Announcements').length
    const res = await router.resolve('POST', URL, { body: { title: 'Hola', audience: 'all', hotelId: 'h1' }, headers: merchant })
    expect(res.status).toBe(403)
    expect(rows('Announcements').length).toBe(before)
  })

  it('hotel_admin con audience:"admins" → 403 sin fila', async () => {
    const { router, rows, merchant } = mount()
    const res = await router.resolve('POST', URL, { body: { title: 'Hola', audience: 'admins', hotelId: 'h1' }, headers: merchant })
    expect(res.status).toBe(403)
    expect(rows('Announcements')).toHaveLength(0)
  })

  it('hotel_admin con audience:"hotel" y su hotelId → 201, acotado a su hotel', async () => {
    const { router, rows, merchant } = mount()
    const res = await router.resolve('POST', URL, { body: { title: 'Hola', audience: 'hotel', hotelId: 'h1' }, headers: merchant })
    expect(res.status).toBe(201)
    expect((res.body as any).audience).toBe('hotel')
    expect((res.body as any).hotelId).toBe('h1')
    expect(rows('Announcements')).toHaveLength(1)
    expect(rows('Announcements')[0]!.hotelId).toBe('h1')
  })
})

describe('GET /api/anuncios — "admins" sólo lo ven los administradores (#106)', () => {
  async function seedHotelAnnouncements(router: Router, superAdmin: Record<string, string>) {
    const admins = await router.resolve('POST', URL, { body: { title: 'Solo admins', hotelId: 'h1', audience: 'admins' }, headers: superAdmin })
    const hotel = await router.resolve('POST', URL, { body: { title: 'Para el hotel', hotelId: 'h1', audience: 'hotel' }, headers: superAdmin })
    expect(admins.status).toBe(201)
    expect(hotel.status).toBe(201)
    return { adminsId: (admins.body as any).id as string, hotelId: (hotel.body as any).id as string }
  }

  it('receptionist del hotel: ve el "hotel" y NO el "admins"', async () => {
    const { router, superAdmin, receptionist } = mount()
    const { adminsId, hotelId } = await seedHotelAnnouncements(router, superAdmin)

    const res = await router.resolve('GET', URL, { headers: receptionist })
    expect(res.status).toBe(200)
    const ids = (res.body as any).data.map((a: any) => a.id)
    expect(ids).toContain(hotelId)
    expect(ids).not.toContain(adminsId)
    expect((res.body as any).total).toBe(1)
  })

  it('hotel_admin del hotel: ve los dos, incluido el "admins"', async () => {
    const { router, superAdmin, merchant } = mount()
    const { adminsId, hotelId } = await seedHotelAnnouncements(router, superAdmin)

    const res = await router.resolve('GET', URL, { headers: merchant })
    expect(res.status).toBe(200)
    const ids = (res.body as any).data.map((a: any) => a.id)
    expect(ids).toContain(hotelId)
    expect(ids).toContain(adminsId)
    expect((res.body as any).total).toBe(2)
  })

  it('super_admin filtrando por hotelId: ve los dos', async () => {
    const { router, superAdmin } = mount()
    const { adminsId, hotelId } = await seedHotelAnnouncements(router, superAdmin)

    const res = await router.resolve('GET', URL, { query: { hotelId: 'h1' }, headers: superAdmin })
    expect(res.status).toBe(200)
    const ids = (res.body as any).data.map((a: any) => a.id)
    expect(ids).toContain(hotelId)
    expect(ids).toContain(adminsId)
  })
})
