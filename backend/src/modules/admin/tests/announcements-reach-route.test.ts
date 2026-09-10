// admin/tests/announcements-reach-route.test.ts — ANN-5 (#109) a nivel de RUTA REAL.
//
// Monta `admin` de verdad (Router + HotelAuth reales, ORM en memoria) y pega a
// `GET /api/admin/announcements/reach`. Lo que se afirma: un `merchant` (aunque sea hotel_admin)
// recibe 403; un `super_admin` recibe 200 con hotels/users/lastAnnouncement salidos de la base,
// y el payload NO trae ninguna de las cifras que antes estaban escritas a mano en el HTML
// (24 hoteles, 89 usuarios, 72% apertura, 18% clicks) ni la métrica de clicks que ya no existe.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { AdminModule } from '../index'

/** ORM en memoria de solo lectura con filtro por igualdad (mismo criterio que extend-trial-route). */
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
    async create(m: string, data: any) { const row = { id: crypto.randomUUID(), ...data }; rows(m).push(row); return row },
    async update(m: string, id: string, data: any) {
      const list = rows(m); const i = list.findIndex((r) => r.id === id)
      if (i < 0) return null
      list[i] = { ...list[i], ...data }
      return list[i]
    },
    async delete(m: string, id: string) { const list = rows(m); const i = list.findIndex((r) => r.id === id); if (i >= 0) list.splice(i, 1); return i >= 0 },
    async count(m: string, f: any = {}) { return rows(m).filter((r) => match(r, f)).length },
    async paginate(m: string) { return { data: rows(m), total: rows(m).length, limit: 20, offset: 0 } },
    transaction: async (fn: any) => fn(orm),
  }
  return { orm, rows }
}

function mount(seed: Record<string, any[]> = {}) {
  const router = new Router()
  const auth = makeAuth()
  const { orm } = memOrm(seed)
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  ;(AdminModule() as any).create({ logger: fakeLogger(), orm, cache, router, auth })

  const superAdmin = { authorization: `Bearer ${auth.createToken({ id: 'sa-1', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}` }
  const merchant = { authorization: `Bearer ${auth.createToken({ id: 'u-1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })}` }
  return { router, superAdmin, merchant }
}

const URL = '/api/admin/announcements/reach'

// Lo que decía el HTML antes de ANN-5. Si alguna de estas cadenas aparece en el payload, la
// tarjeta volvió a ser decoración.
const DECORACION_VIEJA = ['24', '89', '72', '18', 'click', 'clickRate']

const SEED = {
  Hotels: [{ id: 'h1', name: 'Hotel Sol' }, { id: 'h2', name: 'Hotel Luna' }],
  Users: [
    { id: 'u1', hotelId: 'h1', role: 'hotel_admin', active: 1 },
    { id: 'u2', hotelId: 'h1', role: 'receptionist', active: 1 },
    { id: 'u3', hotelId: 'h2', role: 'hotel_admin', active: 1 },
    { id: 'u4', hotelId: 'h2', role: 'receptionist', active: 0 }, // dado de baja: no cuenta
  ],
  Announcements: [
    { id: 'a-1', title: 'Difundido', audience: 'all', hotelId: null, createdAt: '2026-06-01T00:00:00Z' },
  ],
  AnnouncementReads: [
    { announcementId: 'a-1', userId: 'u1', seenAt: '2026-06-02T00:00:00Z', dismissedAt: null },
  ],
}

describe('GET /api/admin/announcements/reach — ANN-5 (#109)', () => {
  it('merchant → 403', async () => {
    const { router, merchant } = mount(SEED)
    const res = await router.resolve('GET', URL, { headers: merchant })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain('lastAnnouncement')
  })

  it('sin token → 401', async () => {
    const { router } = mount(SEED)
    const res = await router.resolve('GET', URL, { headers: {} })
    expect(res.status).toBe(401)
  })

  it('super_admin → 200 y el payload no trae claves fijas', async () => {
    const { router, superAdmin } = mount(SEED)
    const res = await router.resolve('GET', URL, { headers: superAdmin })
    expect(res.status).toBe(200)

    const body = (res.body as any).data ?? res.body
    // Los números salen de lo sembrado, no de una constante.
    expect(typeof body.hotels).toBe('number')
    expect(typeof body.users).toBe('number')
    expect(body.hotels).toBe(2)
    expect(body.users).toBe(3)
    expect(body.lastAnnouncement).toEqual({ id: 'a-1', title: 'Difundido', recipients: 3, seenCount: 1, openRate: 33 })

    // Ni la decoración vieja ni la métrica de clicks que ya no existe.
    const raw = JSON.stringify(body)
    for (const fijo of DECORACION_VIEJA) expect(raw).not.toContain(fijo)
    expect(Object.keys(body).sort()).toEqual(['hotels', 'lastAnnouncement', 'users'])
    expect(body).not.toHaveProperty('clickRate')
  })

  it('super_admin con base vacía → 200, hotels 0, users 0 y lastAnnouncement null', async () => {
    const { router, superAdmin } = mount()
    const res = await router.resolve('GET', URL, { headers: superAdmin })
    expect(res.status).toBe(200)
    const body = (res.body as any).data ?? res.body
    expect(body.hotels).toBe(0)
    expect(body.users).toBe(0)
    expect(body.lastAnnouncement).toBeNull()
  })
})
