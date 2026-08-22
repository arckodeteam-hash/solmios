// bookingengine/tests/meal-plans-crud.test.ts — Admin config de regímenes de alimentación
// (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes).
//
// A diferencia de upsells-crud.test.ts: acá NO hay altas/bajas libres — `MEAL_PLAN_CODES` es
// un enum fijo de 3 elementos. Casos:
//  (1) list sin filas configuradas → devuelve los 3 códigos con defaults (nunca vacío)
//  (2) list mezcla filas existentes con defaults para las que faltan
//  (3) list filtra por hotelId (foreign queda afuera)
//  (4) upsert crea la fila si no existía
//  (5) upsert actualiza (patch parcial) si ya existía
//  (6) upsert con code inválido → ValidationError
//  (7) upsert con priceMode inválido → ValidationError
//  (8) upsert con price negativo → ValidationError
//  (9) upsert propaga el error de ownership (defense-in-depth, mismo patrón que upsells)
import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import { list, upsert, MEAL_PLAN_CODES } from '../usecases/meal-plans-crud'
import type { MealPlanDTO, UpsellCurrentUser } from '../types'

const adminUser: UpsellCurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin', userType: 'merchant' }

function makeRepo(rows: MealPlanDTO[] = []) {
  return {
    findMany: async (filter: any = {}) =>
      rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
    findOne: async (filter: any) =>
      rows.find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ?? null,
    create: async (data: any) => {
      const row = { id: `mp_${rows.length + 1}`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...data } as MealPlanDTO
      rows.push(row)
      return row
    },
    update: async (id: string, patch: any) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx === -1) return null
      rows[idx] = { ...rows[idx], ...patch }
      return rows[idx]
    },
  }
}

function makeDeps(rows: MealPlanDTO[] = [], ownershipOk = true) {
  const mealPlans = makeRepo(rows) as any
  return {
    deps: {
      mealPlans,
      userRepo: { findOne: async () => ({ hotelId: adminUser.hotelId }) } as any,
      auth: {
        assertOwnership: (_rh: string, _uh: string, _r?: string, _s?: string) => {
          if (!ownershipOk) throw new Error('forbidden: not owner')
        },
      } as any,
    },
    mealPlans,
  }
}

function row(overrides: Partial<MealPlanDTO>): MealPlanDTO {
  return {
    id: 'mp_x', hotelId: 'h1', code: 'breakfast', active: true, priceMode: 'included', price: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('meal-plans-crud (tasks.md 2.2/2.4)', () => {
  // list
  it('sin filas configuradas → devuelve los 3 códigos con defaults (nunca vacío)', async () => {
    const { deps } = makeDeps()
    const r = await list(deps, adminUser)
    expect(r.total).toBe(3)
    expect(r.data.map((m) => m.code)).toEqual(MEAL_PLAN_CODES)
    expect(r.data.every((m) => m.active === false && m.priceMode === 'included' && m.price === 0)).toBe(true)
  })

  it('mezcla filas existentes con defaults para los códigos que faltan', async () => {
    const configured = row({ id: 'mp_1', code: 'all_inclusive', active: true, priceMode: 'per_person_per_night', price: 45 })
    const { deps } = makeDeps([configured])
    const r = await list(deps, adminUser)
    expect(r.total).toBe(3)
    const allInclusive = r.data.find((m) => m.code === 'all_inclusive')!
    expect(allInclusive.active).toBe(true)
    expect(allInclusive.price).toBe(45)
    const breakfast = r.data.find((m) => m.code === 'breakfast')!
    expect(breakfast.active).toBe(false) // default, sin fila propia
  })

  it('lista filtra por hotelId del user (foreign queda afuera)', async () => {
    const own = row({ id: 'mp_1', hotelId: 'h1', code: 'breakfast', active: true })
    const foreign = row({ id: 'mp_2', hotelId: 'h-OTRO', code: 'breakfast', active: true })
    const { deps } = makeDeps([own, foreign])
    const r = await list(deps, adminUser)
    const breakfast = r.data.find((m) => m.code === 'breakfast')!
    expect(breakfast.hotelId).toBe('h1')
  })

  // upsert
  it('upsert crea la fila si no existía', async () => {
    const { deps } = makeDeps()
    const updated = await upsert(deps, 'breakfast', { active: true, priceMode: 'per_person_per_night', price: 12 }, adminUser)
    expect(updated.code).toBe('breakfast')
    expect(updated.active).toBe(true)
    expect(updated.price).toBe(12)
  })

  it('upsert actualiza (patch parcial) si ya existía — no pisa campos no enviados', async () => {
    const existing = row({ id: 'mp_1', code: 'half_board', active: false, priceMode: 'per_person_per_night', price: 30 })
    const { deps } = makeDeps([existing])
    const updated = await upsert(deps, 'half_board', { active: true }, adminUser)
    expect(updated.active).toBe(true)
    expect(updated.price).toBe(30) // no se tocó
    expect(updated.priceMode).toBe('per_person_per_night') // no se tocó
  })

  it('upsert con code inválido → ValidationError', async () => {
    const { deps } = makeDeps()
    await expect(upsert(deps, 'full_board', { active: true }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('upsert con priceMode inválido → ValidationError', async () => {
    const { deps } = makeDeps()
    await expect(upsert(deps, 'breakfast', { priceMode: 'free' as any }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('upsert con price negativo → ValidationError', async () => {
    const { deps } = makeDeps()
    await expect(upsert(deps, 'breakfast', { priceMode: 'per_person_per_night', price: -5 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('upsert con price=0 pasa (con costo, pero temporalmente gratis)', async () => {
    const { deps } = makeDeps()
    const updated = await upsert(deps, 'breakfast', { priceMode: 'per_person_per_night', price: 0 }, adminUser)
    expect(updated.price).toBe(0)
  })

  it('upsert propaga el error de ownership (defense-in-depth)', async () => {
    const { deps } = makeDeps([], false)
    await expect(upsert(deps, 'breakfast', { active: true }, adminUser)).rejects.toThrow(/forbidden: not owner/)
  })
})
