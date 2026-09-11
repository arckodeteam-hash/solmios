// bookingengine/tests/child-amenities-crud.test.ts — Amenidades para niños/bebés (REQ-01, #233).
//
// Cubre el CRUD admin (usecases/child-amenities-crud.ts) y el endpoint público
// (usecases/public-child-amenities.ts) a nivel usecase, con repos en memoria — mismo criterio
// que upsells-crud.test.ts y public-upsells.test.ts. La creación física de la tabla la prueba
// el gate de migración, no este test.
//
// Casos:
//  (1) create ok con price=0 (gratuita), trim de name, defaults active=true / sortOrder=0
//  (2) create rechaza name vacío (o solo espacios) y price negativo / no numérico
//  (3) update cambia price y active; rechaza name vacío y price negativo
//  (4) update/remove de otro hotel → NotFoundError (404, anti-enumeración); inexistente → 404
//  (5) list ordena por sortOrder ASC y luego name; filtra por hotelId del user
//  (6) público: solo activas, ordenadas, sin hotelId ni timestamps; hotel inexistente/pausado → 404
import { describe, it, expect } from 'bun:test'
import { ValidationError, NotFoundError } from 'arckode-framework'
import { list, create, update, remove } from '../usecases/child-amenities-crud'
import { getPublicChildAmenities } from '../usecases/public-child-amenities'
import type {
  ChildAmenityDTO, CreateChildAmenityDTO, UpdateChildAmenityDTO, UpsellCurrentUser,
} from '../types'

const adminUser: UpsellCurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin', userType: 'merchant' }

function makeRepo(rows: ChildAmenityDTO[] = []) {
  return {
    findMany: async (filter: any = {}) =>
      rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
    findOne: async (filter: any) =>
      rows.find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ?? null,
    create: async (data: any) => {
      const row = {
        id: `ca_${rows.length + 1}`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...data,
      } as ChildAmenityDTO
      rows.push(row)
      return row
    },
    update: async (id: string, patch: any) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx === -1) return null
      rows[idx] = { ...rows[idx], ...patch }
      return rows[idx]
    },
    delete: async (id: string) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx === -1) return false
      rows.splice(idx, 1)
      return true
    },
  }
}

function makeDeps(rows: ChildAmenityDTO[] = [], ownershipOk = true) {
  const childAmenities = makeRepo(rows) as any
  return {
    deps: {
      childAmenities,
      userRepo: { findOne: async () => ({ hotelId: adminUser.hotelId }) } as any,
      auth: {
        assertOwnership: (_rh: string, _uh: string, _r?: string, _s?: string) => {
          if (!ownershipOk) throw new Error('forbidden: not owner')
        },
      } as any,
    },
    childAmenities,
    rows,
  }
}

function row(overrides: Partial<ChildAmenityDTO>): ChildAmenityDTO {
  return {
    id: 'ca_x', hotelId: 'h1', name: 'Silla de comer', price: 5, active: true, sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('child-amenities-crud (REQ-01 #233)', () => {
  // create
  it('create ok con price=0 (gratuita) — trim de name + defaults active=true, sortOrder=0', async () => {
    const { deps } = makeDeps()
    const dto: CreateChildAmenityDTO = { name: '  Bañera para bebé  ', price: 0 }
    const a = await create(deps, dto, adminUser)
    expect(a.name).toBe('Bañera para bebé')
    expect(a.price).toBe(0)
    expect(a.active).toBe(true)
    expect(a.sortOrder).toBe(0)
    expect(a.hotelId).toBe('h1') // forzado desde el user, no del body
  })

  it('create respeta active=false y sortOrder explícitos', async () => {
    const { deps } = makeDeps()
    const a = await create(deps, { name: 'Calienta-biberones', price: 3, active: false, sortOrder: 4 }, adminUser)
    expect(a.active).toBe(false)
    expect(a.sortOrder).toBe(4)
  })

  it('create con name vacío o solo espacios → ValidationError', async () => {
    const { deps } = makeDeps()
    await expect(create(deps, { name: '', price: 1 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, { name: '   ', price: 1 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, { price: 1 } as any, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('create con price negativo o no numérico → ValidationError', async () => {
    const { deps } = makeDeps()
    await expect(create(deps, { name: 'X', price: -5 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, { name: 'X', price: 'abc' } as any, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, { name: 'X', price: Infinity }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('create sin hotel asignado → ValidationError', async () => {
    const { deps } = makeDeps()
    await expect(create(deps, { name: 'X', price: 1 }, { id: 'u2', hotelId: null })).rejects.toBeInstanceOf(ValidationError)
  })

  // update
  it('update cambia price y active (patch parcial, name intacto)', async () => {
    const existing = row({ id: 'ca_1', name: 'Silla de comer', price: 5, active: true })
    const { deps } = makeDeps([existing])
    const dto: UpdateChildAmenityDTO = { price: 12.5, active: false }
    const updated = await update(deps, 'ca_1', dto, adminUser)
    expect(updated.price).toBe(12.5)
    expect(updated.active).toBe(false)
    expect(updated.name).toBe('Silla de comer')
  })

  it('update con name vacío o price negativo → ValidationError', async () => {
    const existing = row({ id: 'ca_1' })
    const { deps } = makeDeps([existing])
    await expect(update(deps, 'ca_1', { name: '  ' }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(update(deps, 'ca_1', { price: -1 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('update de otro hotel → NotFoundError (404, no revela que existe)', async () => {
    const existing = row({ id: 'ca_1', hotelId: 'h-OTRO' })
    const { deps } = makeDeps([existing])
    await expect(update(deps, 'ca_1', { price: 30 }, adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('update inexistente → NotFoundError', async () => {
    const { deps } = makeDeps()
    await expect(update(deps, 'ca_nope', { price: 30 }, adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('update con ownership rechazado por auth → propaga el error', async () => {
    const existing = row({ id: 'ca_1' })
    const { deps } = makeDeps([existing], false)
    await expect(update(deps, 'ca_1', { price: 30 }, adminUser)).rejects.toThrow(/forbidden: not owner/)
  })

  // delete
  it('remove exitoso', async () => {
    const existing = row({ id: 'ca_del' })
    const { deps, rows } = makeDeps([existing])
    const r = await remove(deps, 'ca_del', adminUser)
    expect(r).toEqual({ id: 'ca_del', deleted: true })
    expect(rows).toHaveLength(0)
  })

  it('remove de otro hotel → NotFoundError y NO borra', async () => {
    const existing = row({ id: 'ca_1', hotelId: 'h-OTRO' })
    const { deps, rows } = makeDeps([existing])
    await expect(remove(deps, 'ca_1', adminUser)).rejects.toBeInstanceOf(NotFoundError)
    expect(rows).toHaveLength(1)
  })

  it('remove inexistente → NotFoundError', async () => {
    const { deps } = makeDeps()
    await expect(remove(deps, 'ca_nope', adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  // list
  it('list ordena por sortOrder ASC y luego name', async () => {
    const a = row({ id: 'ca_a', name: 'Zzz', sortOrder: 5 })
    const b = row({ id: 'ca_b', name: 'Bañera', sortOrder: 1 })
    const c = row({ id: 'ca_c', name: 'Andador', sortOrder: 1 })
    const d = row({ id: 'ca_d', name: 'Aaa', sortOrder: 3 })
    const { deps } = makeDeps([a, b, c, d])
    const r = await list(deps, adminUser)
    expect(r.total).toBe(4)
    expect(r.data.map((x) => x.id)).toEqual(['ca_c', 'ca_b', 'ca_d', 'ca_a'])
  })

  it('list filtra por hotelId del user (foreign queda afuera)', async () => {
    const own = row({ id: 'ca_1', hotelId: 'h1' })
    const foreign = row({ id: 'ca_2', hotelId: 'h-OTRO' })
    const { deps } = makeDeps([own, foreign])
    const r = await list(deps, adminUser)
    expect(r.total).toBe(1)
    expect(r.data[0].id).toBe('ca_1')
  })
})

// ─── Público ───────────────────────────────────────────────────────────────
const activeHotel = { id: 'h1', slug: 'caribe', onlineBookingStatus: 'active' }

const makePublicDeps = (hotel: any, rows: ChildAmenityDTO[]) => ({
  hotels: { findOne: async (f: any) => (hotel && hotel.slug === f.slug ? hotel : null) } as any,
  childAmenities: { findMany: async (f: any) => rows.filter((r) => r.hotelId === f.hotelId) } as any,
})

describe('getPublicChildAmenities (REQ-01 #233)', () => {
  it('filtra inactivas, ordena por sortOrder/name y NO expone hotelId ni timestamps', async () => {
    const deps = makePublicDeps(activeHotel, [
      row({ id: 'ca_3', name: 'Silla de comer', sortOrder: 2, price: 5 }),
      row({ id: 'ca_off', name: 'Inactiva', sortOrder: 0, active: false }),
      row({ id: 'ca_1', name: 'Bañera', sortOrder: 0, price: 0 }),
      row({ id: 'ca_2', name: 'Andador', sortOrder: 1 }),
      row({ id: 'ca_foreign', name: 'De otro hotel', hotelId: 'h-OTRO', sortOrder: 0 }),
    ])
    const res = await getPublicChildAmenities(deps, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body.map((a: any) => a.id)).toEqual(['ca_1', 'ca_2', 'ca_3'])
    expect(res.body[0]).toEqual({ id: 'ca_1', name: 'Bañera', price: 0, sortOrder: 0 })
    for (const item of res.body) {
      expect(Object.keys(item).sort()).toEqual(['id', 'name', 'price', 'sortOrder'])
      expect(item).not.toHaveProperty('hotelId')
      expect(item).not.toHaveProperty('createdAt')
      expect(item).not.toHaveProperty('updatedAt')
    }
  })

  it('hotel sin amenidades → 200 con array vacío', async () => {
    const res = await getPublicChildAmenities(makePublicDeps(activeHotel, []), 'caribe')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('hotel inexistente → 404', async () => {
    const res = await getPublicChildAmenities(makePublicDeps(activeHotel, [row({})]), 'no-existe')
    expect(res.status).toBe(404)
  })

  it('hotel con motor pausado → 404 (anti-enumeración)', async () => {
    const paused = { ...activeHotel, onlineBookingStatus: 'paused' }
    const res = await getPublicChildAmenities(makePublicDeps(paused, [row({})]), 'caribe')
    expect(res.status).toBe(404)
  })

  it('slug vacío → 404', async () => {
    const res = await getPublicChildAmenities(makePublicDeps(activeHotel, []), '')
    expect(res.status).toBe(404)
  })
})
