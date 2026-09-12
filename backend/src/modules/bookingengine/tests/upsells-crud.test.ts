// bookingengine/tests/upsells-crud.test.ts — Admin CRUD de upsells (F2 2.3).
//
// Aceptancia (tasks.md 2.3): "RUN_MIGRATE crea tabla upsells; admin puede CRUD upsells."
// (La creación física de la tabla la prueba el gate de migración, no este test — acá
// mockeamos los repos para cubrir la lógica de usecase.)
//
// Casos:
//  (1) create valida kind + price
//  (2) create normaliza name (trim) y default active=true, sortOrder=0
//  (3) update con kind inválido → ValidationError
//  (4) update de hotel ajeno → error ownership
//  (5) update inexistente → NotFoundError
//  (6) delete exitoso + ownership
//  (7) list ordena por sortOrder ASC
//  (8) MR-10 (#275): create/update aceptan `per_night` y `per_person_per_night`
import { describe, it, expect } from 'bun:test'
import { ValidationError, NotFoundError } from 'arckode-framework'
import {
  list, create, update, remove,
} from '../usecases/upsells-crud'
import type { UpsellDTO, CreateUpsellDTO, UpdateUpsellDTO, UpsellCurrentUser } from '../types'

const adminUser: UpsellCurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin', userType: 'merchant' }

function makeRepo(rows: UpsellDTO[] = []) {
  return {
    findMany: async (filter: any = {}) =>
      rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
    findOne: async (filter: any) =>
      rows.find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ?? null,
    create: async (data: any) => {
      const row = { id: `up_${rows.length + 1}`, ...data } as UpsellDTO
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

function makeDeps(rows: UpsellDTO[] = [], ownershipOk = true) {
  const upsells = makeRepo(rows) as any
  return {
    deps: {
      upsells,
      userRepo: { findOne: async () => ({ hotelId: adminUser.hotelId }) } as any,
      auth: {
        assertOwnership: (_rh: string, _uh: string, _r?: string, _s?: string) => {
          if (!ownershipOk) throw new Error('forbidden: not owner')
        },
      } as any,
    },
    upsells,
  }
}

function row(overrides: Partial<UpsellDTO>): UpsellDTO {
  return {
    id: 'up_x', hotelId: 'h1', name: 'Desayuno', description: 'Buffet completo',
    price: 15, kind: 'per_person', active: true, sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('upsells-crud (F2 2.3)', () => {
  // create
  it('create exitoso — normaliza name + defaults', async () => {
    const { deps } = makeDeps()
    const dto: CreateUpsellDTO = { name: '  Late checkout  ', price: 20, kind: 'per_stay' }
    const up = await create(deps, dto, adminUser)
    expect(up.name).toBe('Late checkout') // trim
    expect(up.active).toBe(true) // default
    expect(up.sortOrder).toBe(0) // default
    expect(up.kind).toBe('per_stay')
  })

  it('create acepta los kinds de MR-10 (#275): per_night y per_person_per_night', async () => {
    const { deps } = makeDeps()
    const a = await create(deps, { name: 'Parking', price: 15, kind: 'per_night' }, adminUser)
    expect(a.kind).toBe('per_night')
    const b = await create(deps, { name: 'Desayuno', price: 10, kind: 'per_person_per_night' }, adminUser)
    expect(b.kind).toBe('per_person_per_night')
  })

  it('create con kind inválido → ValidationError', async () => {
    const { deps } = makeDeps()
    const dto = { name: 'X', price: 10, kind: 'por_dia' } as any
    await expect(create(deps, dto, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('create con price negativo → ValidationError', async () => {
    const { deps } = makeDeps()
    const dto: CreateUpsellDTO = { name: 'X', price: -5, kind: 'per_room' }
    await expect(create(deps, dto, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('create con price=0 pasa (gratis como beneficio)', async () => {
    const { deps } = makeDeps()
    const dto: CreateUpsellDTO = { name: 'Welcome drink', price: 0, kind: 'per_stay' }
    const up = await create(deps, dto, adminUser)
    expect(up.price).toBe(0)
  })

  // update
  it('update exitoso persiste patch', async () => {
    const existing = row({ id: 'up_1', name: 'Old' })
    const { deps } = makeDeps([existing])
    const dto: UpdateUpsellDTO = { name: 'New', price: 25 }
    const updated = await update(deps, 'up_1', dto, adminUser)
    expect(updated.name).toBe('New')
    expect(updated.price).toBe(25)
  })

  it('update a per_person_per_night persiste el kind (MR-10 #275)', async () => {
    const existing = row({ id: 'up_1', kind: 'per_person' })
    const { deps } = makeDeps([existing])
    const updated = await update(deps, 'up_1', { kind: 'per_person_per_night' }, adminUser)
    expect(updated.kind).toBe('per_person_per_night')
  })

  it('update con kind inválido → ValidationError', async () => {
    const existing = row({ id: 'up_1' })
    const { deps } = makeDeps([existing])
    const dto = { kind: 'invalid' } as any
    await expect(update(deps, 'up_1', dto, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('update de hotel ajeno → error ownership', async () => {
    const existing = row({ id: 'up_1', hotelId: 'h-OTRO' })
    const { deps } = makeDeps([existing], false)
    await expect(update(deps, 'up_1', { price: 30 }, adminUser)).rejects.toThrow(/forbidden: not owner/)
  })

  it('update inexistente → NotFoundError', async () => {
    const { deps } = makeDeps()
    await expect(update(deps, 'up_nope', { price: 30 }, adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  // delete
  it('delete exitoso', async () => {
    const existing = row({ id: 'up_del' })
    const { deps } = makeDeps([existing])
    const r = await remove(deps, 'up_del', adminUser)
    expect(r.deleted).toBe(true)
    expect(r.id).toBe('up_del')
  })

  it('delete inexistente → NotFoundError', async () => {
    const { deps } = makeDeps()
    await expect(remove(deps, 'up_nope', adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  // list
  it('lista ordena por sortOrder ASC (estable por createdAt)', async () => {
    const a = row({ id: 'up_a', sortOrder: 5, createdAt: '2026-01-01T00:00:00Z' })
    const b = row({ id: 'up_b', sortOrder: 1, createdAt: '2026-01-01T00:00:00Z' })
    const c = row({ id: 'up_c', sortOrder: 3, createdAt: '2026-01-02T00:00:00Z' })
    const { deps } = makeDeps([a, b, c])
    const r = await list(deps, adminUser)
    expect(r.total).toBe(3)
    expect(r.data.map((x) => x.id)).toEqual(['up_b', 'up_c', 'up_a'])
  })

  it('lista filtra por hotelId del user (foreign queda afuera)', async () => {
    const own = row({ id: 'up_1', hotelId: 'h1' })
    const foreign = row({ id: 'up_2', hotelId: 'h-OTRO' })
    const { deps } = makeDeps([own, foreign])
    const r = await list(deps, adminUser)
    expect(r.total).toBe(1)
    expect(r.data[0].id).toBe('up_1')
  })
})
