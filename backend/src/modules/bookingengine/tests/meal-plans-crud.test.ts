// bookingengine/tests/meal-plans-crud.test.ts — Admin CRUD de regímenes de alimentación (#360,
// catálogo abierto por hotel). Mismo patrón in-memory que upsells-crud.test.ts.
//
// Casos:
//  (1) create genera `code` slug del name y devuelve la fila con name
//  (2) create con name que colisiona en code → sufijo _2, _3
//  (3) update por id (patch parcial, code NO cambia)
//  (4) delete por id
//  (5) ownership de otro hotel rechazada en update y delete
//  (6) list siembra los 4 defaults UNA sola vez (mealPlansSeeded → true) y no re-siembra tras borrar
//  (7) list sin fila de booking_config siembra sin marcar; con bookingConfig ausente en deps también
//  (8) list rellena `name` de filas legacy sin name y ordena por sortOrder, createdAt
//  (9) name vacío / demasiado largo → ValidationError
// (10) price negativo / priceMode inválido / description larga → ValidationError
// (11) list filtra por hotelId (foreign queda afuera)
import { describe, it, expect } from 'bun:test'
import { ValidationError, NotFoundError } from 'arckode-framework'
import { list, create, update, remove, displayName, slugifyCode, DEFAULT_MEAL_PLANS, LEGACY_NAMES } from '../usecases/meal-plans-crud'
import type { MealPlanDTO, UpsellCurrentUser } from '../types'

const adminUser: UpsellCurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin', userType: 'merchant' }

function makeRepo<T extends { id: string }>(rows: T[] = [], prefix = 'mp') {
  let seq = rows.length
  return {
    rows,
    findMany: async (filter: any = {}) =>
      rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
    findOne: async (filter: any) =>
      rows.find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ?? null,
    create: async (data: any) => {
      seq += 1
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

interface MakeDepsOpts {
  rows?: MealPlanDTO[]
  /** `undefined` → sin repo de booking_config en deps; `[]` → repo sin fila para el hotel. */
  configRows?: any[]
  ownershipOk?: boolean
  /** hotelId que devuelve userRepo (para simular un admin de otro hotel). */
  meHotelId?: string
}

function makeDeps(opts: MakeDepsOpts = {}) {
  const mealPlans = makeRepo<MealPlanDTO>(opts.rows ?? [])
  const bookingConfig = opts.configRows ? makeRepo<any>(opts.configRows, 'bc') : undefined
  const ownershipOk = opts.ownershipOk ?? true
  const meHotelId = opts.meHotelId ?? adminUser.hotelId
  return {
    deps: {
      mealPlans: mealPlans as any,
      userRepo: { findOne: async () => ({ hotelId: meHotelId }) } as any,
      auth: {
        assertOwnership: (resourceHotelId: string, userHotelId: string, _r?: string, _s?: string) => {
          if (!ownershipOk || resourceHotelId !== userHotelId) throw new Error('forbidden: not owner')
        },
      } as any,
      bookingConfig: bookingConfig as any,
    },
    mealPlans,
    bookingConfig,
  }
}

function row(overrides: Partial<MealPlanDTO>): MealPlanDTO {
  return {
    id: 'mp_x', hotelId: 'h1', code: 'breakfast', name: 'Desayuno', description: '', sortOrder: 0,
    active: true, priceMode: 'included', price: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const seededConfig = () => [{ id: 'bc_1', hotelId: 'h1', mealPlansSeeded: true }]
const unseededConfig = () => [{ id: 'bc_1', hotelId: 'h1', mealPlansSeeded: false }]

describe('meal-plans-crud (#360) — create', () => {
  it('genera code slug del name y devuelve la fila con name (defaults: included, 0, activo)', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    const created = await create(deps, { name: '  Desayuno y cena  ' }, adminUser)
    expect(created.code).toBe('desayuno_y_cena')
    expect(created.name).toBe('Desayuno y cena')
    expect(created.hotelId).toBe('h1')
    expect(created.priceMode).toBe('included')
    expect(created.price).toBe(0)
    expect(created.active).toBe(true)
    expect(created.description).toBe('')
    expect(created.sortOrder).toBe(0)
  })

  it('slug: sin acentos, solo a-z0-9_, max 40', () => {
    expect(slugifyCode('Pensión completa')).toBe('pension_completa')
    expect(slugifyCode('Todo Incluido Premium (2 pax)')).toBe('todo_incluido_premium_2_pax')
    expect(slugifyCode('a'.repeat(60)).length).toBe(40)
    expect(slugifyCode('***')).toBe('regimen')
  })

  it('code en colisión recibe sufijo _2, _3', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    const a = await create(deps, { name: 'Desayuno' }, adminUser)
    const b = await create(deps, { name: 'desayuno' }, adminUser)
    const c = await create(deps, { name: 'Desayuno!' }, adminUser)
    expect(a.code).toBe('desayuno')
    expect(b.code).toBe('desayuno_2')
    expect(c.code).toBe('desayuno_3')
  })

  it('el sufijo no colisiona con un code legacy existente en el hotel', async () => {
    const legacy = row({ id: 'mp_1', code: 'breakfast', name: '' })
    const { deps } = makeDeps({ rows: [legacy], configRows: seededConfig() })
    const created = await create(deps, { name: 'Breakfast' }, adminUser)
    expect(created.code).toBe('breakfast_2')
  })

  it('persiste description, priceMode, price, active y sortOrder', async () => {
    const { deps, mealPlans } = makeDeps({ configRows: seededConfig() })
    const created = await create(deps, {
      name: 'Media pensión', description: 'Desayuno + cena', priceMode: 'per_person_per_night', price: 25.5, active: false, sortOrder: 7,
    }, adminUser)
    expect(created.priceMode).toBe('per_person_per_night')
    expect(created.price).toBe(25.5)
    expect(created.active).toBe(false)
    expect(created.sortOrder).toBe(7)
    expect(mealPlans.rows[0].description).toBe('Desayuno + cena')
  })

  it('name vacío → ValidationError', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    await expect(create(deps, { name: '' }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, { name: '   ' }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(create(deps, {} as any, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('name > 80 caracteres → ValidationError', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    await expect(create(deps, { name: 'x'.repeat(81) }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('description > 500 caracteres → ValidationError', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    await expect(create(deps, { name: 'ok', description: 'x'.repeat(501) }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('price negativo → ValidationError', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    await expect(create(deps, { name: 'ok', priceMode: 'per_person_per_night', price: -5 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('priceMode inválido → ValidationError', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    await expect(create(deps, { name: 'ok', priceMode: 'free' as any }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('price=0 pasa (con costo, pero temporalmente gratis)', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    const created = await create(deps, { name: 'ok', priceMode: 'per_person_per_night', price: 0 }, adminUser)
    expect(created.price).toBe(0)
  })

  it('sin hotel asignado → ValidationError', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    await expect(create(deps, { name: 'ok' }, { id: 'u9', role: 'hotel_admin' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('propaga el error de ownership (defense-in-depth)', async () => {
    const { deps } = makeDeps({ configRows: seededConfig(), ownershipOk: false })
    await expect(create(deps, { name: 'ok' }, adminUser)).rejects.toThrow(/forbidden: not owner/)
  })
})

describe('meal-plans-crud (#360) — update', () => {
  it('update por id: patch parcial, no pisa campos no enviados ni el code', async () => {
    const existing = row({ id: 'mp_1', code: 'half_board', name: 'Media pensión', priceMode: 'per_person_per_night', price: 30, active: false })
    const { deps } = makeDeps({ rows: [existing], configRows: seededConfig() })
    const updated = await update(deps, 'mp_1', { name: 'Desayuno y cena', active: true }, adminUser)
    expect(updated.name).toBe('Desayuno y cena')
    expect(updated.active).toBe(true)
    expect(updated.code).toBe('half_board') // el code es estable
    expect(updated.price).toBe(30) // no se tocó
    expect(updated.priceMode).toBe('per_person_per_night') // no se tocó
  })

  it('update de description, priceMode, price y sortOrder', async () => {
    const existing = row({ id: 'mp_1' })
    const { deps } = makeDeps({ rows: [existing], configRows: seededConfig() })
    const updated = await update(deps, 'mp_1', { description: 'Buffet', priceMode: 'per_person_per_night', price: 12, sortOrder: 3 }, adminUser)
    expect(updated.description).toBe('Buffet')
    expect(updated.priceMode).toBe('per_person_per_night')
    expect(updated.price).toBe(12)
    expect(updated.sortOrder).toBe(3)
  })

  it('id inexistente → NotFoundError', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    await expect(update(deps, 'nope', { active: true }, adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('name vacío → ValidationError; price negativo → ValidationError', async () => {
    const existing = row({ id: 'mp_1' })
    const { deps } = makeDeps({ rows: [existing], configRows: seededConfig() })
    await expect(update(deps, 'mp_1', { name: '  ' }, adminUser)).rejects.toBeInstanceOf(ValidationError)
    await expect(update(deps, 'mp_1', { price: -1 }, adminUser)).rejects.toBeInstanceOf(ValidationError)
  })

  it('ownership: fila de otro hotel → rechazada (IDOR)', async () => {
    const foreign = row({ id: 'mp_9', hotelId: 'h-OTRO' })
    const { deps, mealPlans } = makeDeps({ rows: [foreign], configRows: seededConfig() })
    await expect(update(deps, 'mp_9', { active: false }, adminUser)).rejects.toThrow(/forbidden: not owner/)
    expect(mealPlans.rows[0].active).toBe(true) // intacta
  })
})

describe('meal-plans-crud (#360) — delete', () => {
  it('delete por id borra la fila', async () => {
    const existing = row({ id: 'mp_1' })
    const { deps, mealPlans } = makeDeps({ rows: [existing], configRows: seededConfig() })
    const result = await remove(deps, 'mp_1', adminUser)
    expect(result).toEqual({ id: 'mp_1', deleted: true })
    expect(mealPlans.rows).toHaveLength(0)
  })

  it('id inexistente → NotFoundError', async () => {
    const { deps } = makeDeps({ configRows: seededConfig() })
    await expect(remove(deps, 'nope', adminUser)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('ownership: fila de otro hotel → rechazada (IDOR), la fila sigue', async () => {
    const foreign = row({ id: 'mp_9', hotelId: 'h-OTRO' })
    const { deps, mealPlans } = makeDeps({ rows: [foreign], configRows: seededConfig() })
    await expect(remove(deps, 'mp_9', adminUser)).rejects.toThrow(/forbidden: not owner/)
    expect(mealPlans.rows).toHaveLength(1)
  })
})

describe('meal-plans-crud (#360) — list + semilla', () => {
  it('siembra los 4 defaults una sola vez y marca mealPlansSeeded', async () => {
    const { deps, mealPlans, bookingConfig } = makeDeps({ configRows: unseededConfig() })
    const r = await list(deps, adminUser)
    expect(r.total).toBe(4)
    expect(r.data.map((m) => m.code)).toEqual(['room_only', 'breakfast', 'half_board', 'all_inclusive'])
    expect(r.data.map((m) => m.name)).toEqual(DEFAULT_MEAL_PLANS.map((d) => d.name))
    expect(r.data.map((m) => m.active)).toEqual([true, false, false, false])
    expect(r.data.every((m) => m.priceMode === 'included' && m.price === 0)).toBe(true)
    expect(r.data.map((m) => m.sortOrder)).toEqual([0, 1, 2, 3])
    expect(r.data.every((m) => m.hotelId === 'h1')).toBe(true)
    expect(mealPlans.rows).toHaveLength(4)
    expect(bookingConfig!.rows[0].mealPlansSeeded).toBe(true)

    // Segunda carga: no duplica.
    const again = await list(deps, adminUser)
    expect(again.total).toBe(4)
    expect(mealPlans.rows).toHaveLength(4)
  })

  it('siembra solo los defaults que faltan por code (filas legacy se respetan)', async () => {
    const legacy = row({ id: 'mp_1', code: 'breakfast', name: '', active: true, priceMode: 'per_person_per_night', price: 15 })
    const { deps, mealPlans } = makeDeps({ rows: [legacy], configRows: unseededConfig() })
    const r = await list(deps, adminUser)
    expect(r.total).toBe(4)
    expect(mealPlans.rows).toHaveLength(4)
    const breakfast = r.data.find((m) => m.code === 'breakfast')!
    expect(breakfast.id).toBe('mp_1') // la legacy, no una nueva
    expect(breakfast.price).toBe(15)
    expect(breakfast.name).toBe('Desayuno incluido') // rellenado desde LEGACY_NAMES
  })

  it('NO re-siembra tras borrar todo (mealPlansSeeded ya está en true)', async () => {
    const { deps, mealPlans } = makeDeps({ configRows: unseededConfig() })
    await list(deps, adminUser)
    for (const r of [...mealPlans.rows]) await remove(deps, r.id, adminUser)
    expect(mealPlans.rows).toHaveLength(0)
    const r = await list(deps, adminUser)
    expect(r.total).toBe(0)
    expect(r.data).toEqual([])
    expect(mealPlans.rows).toHaveLength(0)
  })

  it('con mealPlansSeeded ya en true y sin filas → lista vacía, no siembra', async () => {
    const { deps, mealPlans } = makeDeps({ configRows: seededConfig() })
    const r = await list(deps, adminUser)
    expect(r.total).toBe(0)
    expect(mealPlans.rows).toHaveLength(0)
  })

  it('sin fila de booking_config → siembra sin marcar; la próxima carga completa por code sin duplicar', async () => {
    const { deps, mealPlans, bookingConfig } = makeDeps({ configRows: [] })
    await list(deps, adminUser)
    expect(mealPlans.rows).toHaveLength(4)
    expect(bookingConfig!.rows).toHaveLength(0) // no se creó ni marcó nada
    const again = await list(deps, adminUser)
    expect(again.total).toBe(4)
    expect(mealPlans.rows).toHaveLength(4)
  })

  it('sin repo de booking_config en deps → siembra igual (compat), sin duplicar', async () => {
    const { deps, mealPlans } = makeDeps()
    await list(deps, adminUser)
    await list(deps, adminUser)
    expect(mealPlans.rows).toHaveLength(4)
  })

  it('rellena name de filas legacy sin name (y deja el code como fallback si no es legacy)', async () => {
    const rows = [
      row({ id: 'mp_1', code: 'all_inclusive', name: undefined as any, sortOrder: 0 }),
      row({ id: 'mp_2', code: 'half_board', name: '', sortOrder: 1 }),
      row({ id: 'mp_3', code: 'custom_x', name: '', sortOrder: 2 }),
    ]
    const { deps } = makeDeps({ rows, configRows: seededConfig() })
    const r = await list(deps, adminUser)
    expect(r.data.map((m) => m.name)).toEqual(['Todo incluido', 'Desayuno y cena', 'custom_x'])
  })

  it('ordena por sortOrder ASC y luego createdAt ASC', async () => {
    const rows = [
      row({ id: 'mp_1', code: 'c', name: 'C', sortOrder: 2, createdAt: '2026-01-03T00:00:00Z' }),
      row({ id: 'mp_2', code: 'b', name: 'B', sortOrder: 1, createdAt: '2026-01-02T00:00:00Z' }),
      row({ id: 'mp_3', code: 'a', name: 'A', sortOrder: 1, createdAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'mp_4', code: 'd', name: 'D', sortOrder: undefined as any, createdAt: '2026-01-04T00:00:00Z' }),
    ]
    const { deps } = makeDeps({ rows, configRows: seededConfig() })
    const r = await list(deps, adminUser)
    expect(r.data.map((m) => m.code)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('filtra por hotelId del user (foreign queda afuera)', async () => {
    const own = row({ id: 'mp_1', hotelId: 'h1', code: 'breakfast' })
    const foreign = row({ id: 'mp_2', hotelId: 'h-OTRO', code: 'breakfast' })
    const { deps } = makeDeps({ rows: [own, foreign], configRows: seededConfig() })
    const r = await list(deps, adminUser)
    expect(r.total).toBe(1)
    expect(r.data[0].hotelId).toBe('h1')
  })

  it('propaga el error de ownership (defense-in-depth)', async () => {
    const { deps } = makeDeps({ configRows: seededConfig(), ownershipOk: false })
    await expect(list(deps, adminUser)).rejects.toThrow(/forbidden: not owner/)
  })
})

describe('meal-plans-crud (#360) — displayName', () => {
  it('prefiere name; cae a LEGACY_NAMES; y al code pelado', () => {
    expect(displayName({ code: 'breakfast', name: 'Desayuno buffet' })).toBe('Desayuno buffet')
    expect(displayName({ code: 'breakfast', name: '' })).toBe(LEGACY_NAMES.breakfast)
    expect(displayName({ code: 'room_only' })).toBe('Solo alojamiento')
    expect(displayName({ code: 'custom_x', name: null })).toBe('custom_x')
  })
})
