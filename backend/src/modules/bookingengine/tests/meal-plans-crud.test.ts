// bookingengine/tests/meal-plans-crud.test.ts — Admin CRUD de regímenes de alimentación
// (tasks.md 2.2/2.4 → #361 catálogo abierto).
//
// Antes: enum fijo de 3 códigos con `upsert(code)`. Ahora: catálogo abierto por hotel. Casos:
//  (1) list con catálogo vacío siembra los 4 ejemplos UNA sola vez (marcador en configuration)
//  (2) la segunda llamada no duplica; si se borra uno y se vuelve a listar NO reaparece
//  (3) ensureSeeded rellena name/description de filas viejas por code (sin crear duplicados)
//  (4) list filtra por hotelId y ordena legacy primero, después por createdAt
//  (5) create genera code slug único (dos "Media pensión" → media_pension y media_pension_2)
//  (6) create deriva priceMode por precio (>0 → per_person_per_night, 0 → included)
//  (7) create valida name obligatorio / demasiado largo y price negativo / priceMode inválido
//  (8) update no cambia code aunque cambie el nombre; permite activar/desactivar
//  (9) remove borra la fila; ownership de otro hotel rechaza
import { describe, it, expect } from 'bun:test'
import { ValidationError, NotFoundError } from 'arckode-framework'
import {
  list, create, update, remove, ensureSeeded, slugifyMealPlanName,
  DEFAULT_MEAL_PLANS, MEAL_PLANS_SEEDED_KEY,
} from '../usecases/meal-plans-crud'
import type { MealPlanDTO, UpsellCurrentUser } from '../types'

const adminUser: UpsellCurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin', userType: 'merchant' }

function makeRepo<T extends { id: string }>(rows: T[] = [], prefix = 'row') {
  let seq = rows.length
  return {
    rows,
    findMany: async (filter: any = {}) =>
      rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
    findOne: async (filter: any) =>
      rows.find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ?? null,
    create: async (data: any) => {
      seq++
      const ts = `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`
      const row = { id: `${prefix}_${seq}`, createdAt: ts, updatedAt: ts, ...data } as T
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

function makeDeps(rows: MealPlanDTO[] = [], opts: { ownershipOk?: boolean; seeded?: boolean } = {}) {
  const mealPlans = makeRepo<MealPlanDTO>(rows, 'mp')
  const configuration = makeRepo<any>(
    opts.seeded ? [{ id: 'cfg_1', hotelId: 'h1', key: MEAL_PLANS_SEEDED_KEY, value: { seeded: true } }] : [],
    'cfg',
  )
  return {
    deps: {
      mealPlans: mealPlans as any,
      configuration: configuration as any,
      userRepo: { findOne: async () => ({ hotelId: adminUser.hotelId }) } as any,
      auth: {
        assertOwnership: (_rh: string, _uh: string, _r?: string, _s?: string) => {
          if (opts.ownershipOk === false) throw new Error('forbidden: not owner')
        },
      } as any,
    },
    mealPlans,
    configuration,
  }
}

function row(overrides: Partial<MealPlanDTO>): MealPlanDTO {
  return {
    id: 'mp_x', hotelId: 'h1', code: 'breakfast', name: 'Desayuno', description: null,
    active: true, priceMode: 'included', price: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('meal-plans-crud (#361) — seeds', () => {
  it('list con catálogo vacío siembra los 4 ejemplos y deja el marcador', async () => {
    const { deps, configuration } = makeDeps()
    const r = await list(deps, adminUser)
    expect(r.total).toBe(4)
    expect(r.data.map((m) => m.code)).toEqual(['room_only', 'breakfast', 'half_board', 'all_inclusive'])
    expect(r.data.map((m) => m.name)).toEqual(DEFAULT_MEAL_PLANS.map((d) => d.name))
    expect(r.data.find((m) => m.code === 'room_only')!.description).toBe('Sin comidas incluidas')
    expect(r.data.every((m) => m.active === true && m.priceMode === 'included' && m.price === 0)).toBe(true)
    expect(r.data.every((m) => m.hotelId === 'h1')).toBe(true)
    expect(configuration.rows).toHaveLength(1)
    expect(configuration.rows[0]).toMatchObject({ hotelId: 'h1', key: MEAL_PLANS_SEEDED_KEY, value: { seeded: true } })
  })

  it('la segunda llamada no duplica', async () => {
    const { deps, mealPlans, configuration } = makeDeps()
    await list(deps, adminUser)
    const r = await list(deps, adminUser)
    expect(r.total).toBe(4)
    expect(mealPlans.rows).toHaveLength(4)
    expect(configuration.rows).toHaveLength(1)
  })

  it('si se borra un ejemplo y se vuelve a listar, NO reaparece', async () => {
    const { deps } = makeDeps()
    const first = await list(deps, adminUser)
    const breakfast = first.data.find((m) => m.code === 'breakfast')!
    await remove(deps, breakfast.id, adminUser)
    const r = await list(deps, adminUser)
    expect(r.total).toBe(3)
    expect(r.data.map((m) => m.code)).toEqual(['room_only', 'half_board', 'all_inclusive'])
  })

  it('con el marcador puesto, un catálogo vacío queda vacío (no se re-siembra)', async () => {
    const { deps } = makeDeps([], { seeded: true })
    const r = await list(deps, adminUser)
    expect(r.total).toBe(0)
    expect(r.data).toEqual([])
  })

  it('ensureSeeded rellena name/description de filas viejas por code y crea sólo las que faltan', async () => {
    const legacy = row({ id: 'mp_old', code: 'all_inclusive', name: '' as any, description: null, active: true, priceMode: 'per_person_per_night', price: 45 })
    const { deps, mealPlans } = makeDeps([legacy])
    await ensureSeeded(deps, 'h1')
    expect(mealPlans.rows).toHaveLength(4)
    const ai = mealPlans.rows.find((m) => m.code === 'all_inclusive')!
    expect(ai.id).toBe('mp_old') // no se duplicó
    expect(ai.name).toBe('Todo incluido')
    expect(ai.price).toBe(45) // precio/modo viejos se conservan
    expect(ai.priceMode).toBe('per_person_per_night')
  })

  it('ensureSeeded NO pisa el nombre de una fila que ya lo tiene', async () => {
    const named = row({ id: 'mp_named', code: 'breakfast', name: 'Desayuno buffet' })
    const { deps, mealPlans } = makeDeps([named])
    await ensureSeeded(deps, 'h1')
    expect(mealPlans.rows.find((m) => m.code === 'breakfast')!.name).toBe('Desayuno buffet')
  })
})

describe('meal-plans-crud (#361) — list', () => {
  it('filtra por hotelId del user (foreign queda afuera)', async () => {
    const own = row({ id: 'mp_1', hotelId: 'h1', code: 'brunch', name: 'Brunch' })
    const foreign = row({ id: 'mp_2', hotelId: 'h-OTRO', code: 'brunch', name: 'Brunch' })
    const { deps } = makeDeps([own, foreign], { seeded: true })
    const r = await list(deps, adminUser)
    expect(r.total).toBe(1)
    expect(r.data[0].hotelId).toBe('h1')
  })

  it('ordena los códigos históricos primero y el resto por createdAt', async () => {
    const rows = [
      row({ id: 'mp_1', code: 'brunch', name: 'Brunch', createdAt: '2026-01-03T00:00:00Z' }),
      row({ id: 'mp_2', code: 'all_inclusive', name: 'Todo incluido', createdAt: '2026-01-05T00:00:00Z' }),
      row({ id: 'mp_3', code: 'cena_gourmet', name: 'Cena gourmet', createdAt: '2026-01-02T00:00:00Z' }),
      row({ id: 'mp_4', code: 'room_only', name: 'Solo alojamiento', createdAt: '2026-01-09T00:00:00Z' }),
    ]
    const { deps } = makeDeps(rows, { seeded: true })
    const r = await list(deps, adminUser)
    expect(r.data.map((m) => m.code)).toEqual(['room_only', 'all_inclusive', 'cena_gourmet', 'brunch'])
  })

  it('ya NO rellena códigos ausentes: devuelve sólo las filas reales', async () => {
    const { deps } = makeDeps([row({ id: 'mp_1', code: 'brunch', name: 'Brunch' })], { seeded: true })
    const r = await list(deps, adminUser)
    expect(r.data.map((m) => m.code)).toEqual(['brunch'])
  })
})

describe('meal-plans-crud (#361) — create', () => {
  it('genera code slug del nombre (minúsculas, sin acentos, _ como separador)', async () => {
    const { deps } = makeDeps([], { seeded: true })
    const created = await create(deps, { name: '  Media pensión  ' }, adminUser)
    expect(created.code).toBe('media_pension')
    expect(created.name).toBe('Media pensión')
    expect(created.hotelId).toBe('h1')
    expect(created.active).toBe(true) // default al crear
    expect(created.description).toBeNull()
  })

  it('dos "Media pensión" → media_pension y media_pension_2 (único por hotel)', async () => {
    const { deps } = makeDeps([], { seeded: true })
    const a = await create(deps, { name: 'Media pensión' }, adminUser)
    const b = await create(deps, { name: 'Media Pensión' }, adminUser)
    const c = await create(deps, { name: 'media-pension!' }, adminUser)
    expect(a.code).toBe('media_pension')
    expect(b.code).toBe('media_pension_2')
    expect(c.code).toBe('media_pension_3')
  })

  it('el slug se corta a 40 caracteres y el sufijo de unicidad no lo excede', () => {
    const long = 'Régimen súper completo con desayuno almuerzo cena y snacks toda la noche'
    const slug = slugifyMealPlanName(long)
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/)
  })

  it('deriva priceMode por precio: price > 0 → per_person_per_night', async () => {
    const { deps } = makeDeps([], { seeded: true })
    const created = await create(deps, { name: 'Desayuno buffet', price: 12 }, adminUser)
    expect(created.priceMode).toBe('per_person_per_night')
    expect(created.price).toBe(12)
  })

  it('deriva priceMode por precio: sin precio / 0 → included', async () => {
    const { deps } = makeDeps([], { seeded: true })
    const a = await create(deps, { name: 'Solo alojamiento' }, adminUser)
    const b = await create(deps, { name: 'Café de bienvenida', price: 0 }, adminUser)
    expect(a.priceMode).toBe('included')
    expect(a.price).toBe(0)
    expect(b.priceMode).toBe('included')
  })

  it('respeta priceMode explícito aunque el precio lo contradiga', async () => {
    const { deps } = makeDeps([], { seeded: true })
    const created = await create(deps, { name: 'Cena', price: 0, priceMode: 'per_person_per_night' }, adminUser)
    expect(created.priceMode).toBe('per_person_per_night')
  })

  it('normaliza description: trim, vacío → null', async () => {
    const { deps } = makeDeps([], { seeded: true })
    const a = await create(deps, { name: 'A', description: '  Con jugo y café  ' }, adminUser)
    const b = await create(deps, { name: 'B', description: '   ' }, adminUser)
    expect(a.description).toBe('Con jugo y café')
    expect(b.description).toBeNull()
  })

  it('name obligatorio → ValidationError', async () => {
    const { deps } = makeDeps([], { seeded: true })
    await expect(create(deps, { name: '' }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, { name: '   ' }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, {} as any, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('name > 80 y description > 300 → ValidationError', async () => {
    const { deps } = makeDeps([], { seeded: true })
    await expect(create(deps, { name: 'x'.repeat(81) }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, { name: 'ok', description: 'x'.repeat(301) }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('price negativo o no finito → ValidationError', async () => {
    const { deps } = makeDeps([], { seeded: true })
    await expect(create(deps, { name: 'Cena', price: -5 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, { name: 'Cena', price: Number.NaN }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('priceMode inválido → ValidationError', async () => {
    const { deps } = makeDeps([], { seeded: true })
    await expect(create(deps, { name: 'Cena', priceMode: 'free' as any }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('propaga el error de ownership (defense-in-depth)', async () => {
    const { deps } = makeDeps([], { seeded: true, ownershipOk: false })
    await expect(create(deps, { name: 'Cena' }, adminUser)).rejects.toThrow(/forbidden: not owner/)
  })
})

describe('meal-plans-crud (#361) — update', () => {
  it('cambiar el nombre NO cambia el code (identidad persistida en las reservas)', async () => {
    const existing = row({ id: 'mp_1', code: 'half_board', name: 'Desayuno y cena' })
    const { deps } = makeDeps([existing], { seeded: true })
    const updated = await update(deps, 'mp_1', { name: 'Media pensión premium' }, adminUser)
    expect(updated.code).toBe('half_board')
    expect(updated.name).toBe('Media pensión premium')
  })

  it('permite activar/desactivar sin tocar el resto (patch parcial)', async () => {
    const existing = row({ id: 'mp_1', code: 'half_board', active: true, priceMode: 'per_person_per_night', price: 30 })
    const { deps } = makeDeps([existing], { seeded: true })
    const off = await update(deps, 'mp_1', { active: false }, adminUser)
    expect(off.active).toBe(false)
    expect(off.price).toBe(30)
    expect(off.priceMode).toBe('per_person_per_night')
    const on = await update(deps, 'mp_1', { active: true }, adminUser)
    expect(on.active).toBe(true)
  })

  it('cambiar el precio sin priceMode re-deriva el modo', async () => {
    const existing = row({ id: 'mp_1', code: 'breakfast', priceMode: 'included', price: 0 })
    const { deps } = makeDeps([existing], { seeded: true })
    const paid = await update(deps, 'mp_1', { price: 15 }, adminUser)
    expect(paid.priceMode).toBe('per_person_per_night')
    const free = await update(deps, 'mp_1', { price: 0 }, adminUser)
    expect(free.priceMode).toBe('included')
  })

  it('description "" → null; name vacío o price negativo → ValidationError', async () => {
    const existing = row({ id: 'mp_1', description: 'algo' })
    const { deps } = makeDeps([existing], { seeded: true })
    const cleared = await update(deps, 'mp_1', { description: '' }, adminUser)
    expect(cleared.description).toBeNull()
    await expect(update(deps, 'mp_1', { name: '  ' }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(update(deps, 'mp_1', { price: -1 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('id inexistente → NotFoundError', async () => {
    const { deps } = makeDeps([], { seeded: true })
    await expect(update(deps, 'nope', { active: true }, adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('régimen de otro hotel → rechaza por ownership (IDOR)', async () => {
    const foreign = row({ id: 'mp_f', hotelId: 'h-OTRO' })
    const { deps, mealPlans } = makeDeps([foreign], { seeded: true, ownershipOk: false })
    await expect(update(deps, 'mp_f', { active: false }, adminUser)).rejects.toThrow(/forbidden: not owner/)
    expect(mealPlans.rows[0].active).toBe(true) // no se tocó
  })
})

describe('meal-plans-crud (#361) — remove', () => {
  it('borra la fila (hard delete)', async () => {
    const existing = row({ id: 'mp_1', code: 'brunch', name: 'Brunch' })
    const { deps, mealPlans } = makeDeps([existing], { seeded: true })
    const r = await remove(deps, 'mp_1', adminUser)
    expect(r).toEqual({ id: 'mp_1', deleted: true })
    expect(mealPlans.rows).toHaveLength(0)
  })

  it('id inexistente → NotFoundError', async () => {
    const { deps } = makeDeps([], { seeded: true })
    await expect(remove(deps, 'nope', adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('régimen de otro hotel → rechaza por ownership y NO borra', async () => {
    const foreign = row({ id: 'mp_f', hotelId: 'h-OTRO' })
    const { deps, mealPlans } = makeDeps([foreign], { seeded: true, ownershipOk: false })
    await expect(remove(deps, 'mp_f', adminUser)).rejects.toThrow(/forbidden: not owner/)
    expect(mealPlans.rows).toHaveLength(1)
  })
})
