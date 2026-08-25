// restaurant/tests/public-menu.test.ts — Carta pública de solo lectura (F7), SIN sesión. Cubre TODOS
// los scenarios de specs/menu-public/spec.md: allow-list explícita (ninguna clave prohibida se filtra,
// en ningún nivel del JSON), 404 genérico idéntico para hotel-inexistente y módulo-deshabilitado,
// rate-limit propio (120/5min, clave y límite NUNCA compartidos con /api/auth/login), ítem 86'd
// excluido del todo, ítem fuera de franja horaria visible con availableNow:false, ?lang= con fallback
// a español, y combo público con componentes {name, quantity} sin menuItemId crudo.
import { describe, it, expect, afterEach } from 'bun:test'
import { NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { publicMenu, type PublicMenuDeps } from '../usecases/public-menu'
import { rateLimit } from '../../../shared/middlewares/rate-limit'
import type { CategoryDTO, MenuItemDTO, ComboDTO, ComboItemDTO, StationDTO } from '../types'

// ─── Helpers (mismo patrón que availability.test.ts / i18n.test.ts) ───
function makeRepo<T extends object>(overrides: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (data: any) => ({ id: 'gen-id', ...data }),
    update: async (id: any, data: any) => ({ id, ...data }),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 100, offset: 0, pages: 0 }),
    ...overrides,
  } as RepositoryAdapter<T>
}
function backed<T extends object>(seed: any[] = []): RepositoryAdapter<T> {
  const store = [...seed]
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  return {
    ...makeRepo<any>(),
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
  } as RepositoryAdapter<T>
}

function baseDeps(overrides: Partial<{
  hotelsSeed: any[]; configSeed: any[]; plansSeed: any[]
  categoriesSeed: any[]; itemsSeed: any[]; combosSeed: any[]; comboItemsSeed: any[]
}> = {}): PublicMenuDeps {
  return {
    categories: backed<CategoryDTO>(overrides.categoriesSeed ?? []),
    items: backed<MenuItemDTO>(overrides.itemsSeed ?? []),
    stations: backed<StationDTO>([]),
    combos: backed<ComboDTO>(overrides.combosSeed ?? []),
    comboItems: backed<ComboItemDTO>(overrides.comboItemsSeed ?? []),
    userRepo: makeRepo<any>(),
    hotels: backed<any>(overrides.hotelsSeed ?? [{ id: 'h1', name: 'Hotel Test', plan: 'basico' }]),
    config: backed<any>(overrides.configSeed ?? []),
    plans: backed<any>(overrides.plansSeed ?? []),
    // Sin suscripción (hoteles legacy): el gate cae al espejo `hotel.plan`, como siempre.
    subscriptions: backed<any>([]),
  }
}

// Las 12 claves que el DTO público NUNCA debe exponer (specs/menu-public/spec.md).
const FORBIDDEN_KEYS = [
  'cost', 'margin', 'marginPercent', 'hasRecipe', 'complete', 'avgCost', 'currentStock',
  'stationId', 'stationName', 'sortOrder', 'taxRate', 'hotelId',
]

describe('F7 — allow-list: ninguna clave prohibida se filtra, en ningún nivel', () => {
  it('un ítem con receta costeada, estación y taxRate propios sale SOLO con los campos permitidos', async () => {
    const categoriesSeed = [{ id: 'cat1', hotelId: 'h1', name: 'Platos fuertes', stationId: 'st1', sortOrder: 1, active: 1 }]
    const itemsSeed = [{
      id: 'i1', hotelId: 'h1', categoryId: 'cat1', name: 'Salmón a la plancha', description: 'Con salsa de limón',
      price: 500, taxRate: 18, stationId: 'st1', stationName: 'Cocina', sortOrder: 3, available: 1,
      imageUrl: 'https://cdn/salmon.jpg', allergens: ['gluten'], featured: 1,
      // Campos que NUNCA deberían llegar al huésped si el usecase hiciera spread del DTO interno:
      hasRecipe: true, complete: true, cost: 200, margin: 300, marginPercent: 60, avgCost: 210, currentStock: 5,
    }]
    const combosSeed = [{ id: 'co1', hotelId: 'h1', name: 'Combo Familiar', description: 'Para 2', price: 800, taxRate: 18, available: 1, sortOrder: 2 }]
    const comboItemsSeed = [{ id: 'ci1', hotelId: 'h1', comboId: 'co1', menuItemId: 'i1', quantity: 2, sortOrder: 0 }]

    const result = await publicMenu(baseDeps({ categoriesSeed, itemsSeed, combosSeed, comboItemsSeed }), 'h1', undefined)
    const json = JSON.stringify(result)

    for (const key of FORBIDDEN_KEYS) {
      expect(json.includes(`"${key}"`)).toBe(false)
    }
    // El componente del combo es {name, quantity} — nunca el menuItemId crudo.
    expect(json.includes('"menuItemId"')).toBe(false)

    const item = result.categories[0].items[0]
    expect(item).toEqual({
      id: 'i1', name: 'Salmón a la plancha', description: 'Con salsa de limón', price: 500,
      imageUrl: 'https://cdn/salmon.jpg', allergens: ['gluten'], featured: 1,
      availableFrom: null, availableTo: null, availableNow: true,
    })
    expect(result.combos[0].components).toEqual([{ name: 'Salmón a la plancha', quantity: 2 }])
    expect(result.hotel).toEqual({ name: 'Hotel Test' })
  })

  it('el objeto raíz solo trae hotel.name — nada de ownerName/taxId/email/phone', async () => {
    const hotelsSeed = [{ id: 'h1', name: 'Hotel Test', plan: 'basico', ownerName: 'Juan', ownerTaxId: '123', email: 'x@x.com', phone: '809' }]
    const result = await publicMenu(baseDeps({ hotelsSeed }), 'h1', undefined)
    expect(Object.keys(result.hotel)).toEqual(['name'])
    expect(JSON.stringify(result.hotel).includes('ownerName')).toBe(false)
  })
})

describe('F7 — 404 genérico: hotel inexistente Y módulo deshabilitado dan la MISMA respuesta', () => {
  it('hotelId inexistente → NotFoundError 404 genérico', async () => {
    const deps = baseDeps({ hotelsSeed: [] })
    await expect(publicMenu(deps, 'no-existe', undefined)).rejects.toThrow('Carta no encontrada')
  })

  it('hotel existe pero restaurant=false para su hotel/plan → MISMO 404 genérico (anti-enumeración)', async () => {
    const deps = baseDeps({
      hotelsSeed: [{ id: 'h2', name: 'Hotel Sin Restaurante', plan: 'basico' }],
      configSeed: [{ id: 'c1', hotelId: 'platform', key: 'modules', value: { restaurant: false } }],
    })
    await expect(publicMenu(deps, 'h2', undefined)).rejects.toThrow('Carta no encontrada')
  })

  it('ambos casos son literalmente el mismo NotFoundError (mismo mensaje, mismo httpStatus)', async () => {
    const notFoundDeps = baseDeps({ hotelsSeed: [] })
    const disabledDeps = baseDeps({
      hotelsSeed: [{ id: 'h2', name: 'Hotel Sin Restaurante', plan: 'basico' }],
      configSeed: [{ id: 'c1', hotelId: 'platform', key: 'modules', value: { restaurant: false } }],
    })
    let err1: unknown; let err2: unknown
    try { await publicMenu(notFoundDeps, 'no-existe', undefined) } catch (e) { err1 = e }
    try { await publicMenu(disabledDeps, 'h2', undefined) } catch (e) { err2 = e }
    expect(err1).toBeInstanceOf(NotFoundError)
    expect(err2).toBeInstanceOf(NotFoundError)
    expect((err1 as NotFoundError).message).toBe((err2 as NotFoundError).message)
    expect((err1 as NotFoundError).httpStatus).toBe(404)
    expect((err2 as NotFoundError).httpStatus).toBe(404)
  })
})

describe('F7 — rate-limit PROPIO (120/5min, clave hotel+IP — NUNCA la de /api/auth/login)', () => {
  it('120 requests de la misma IP+hotel permiten, la 121ª bloquea con retryAfter', async () => {
    const hotelId = crypto.randomUUID()
    const ip = '203.0.113.5'
    const key = `public-menu:${hotelId}:${ip}`
    for (let i = 0; i < 120; i++) {
      expect((await rateLimit(key, { maxAttempts: 120, windowMs: 5 * 60_000 })).allowed).toBe(true)
    }
    const blocked = await rateLimit(key, { maxAttempts: 120, windowMs: 5 * 60_000 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('un hotel distinto con la misma IP tiene su propio cupo (bucket independiente por hotel+IP)', async () => {
    const ip = '198.51.100.9'
    const keyA = `public-menu:hotelA-${crypto.randomUUID()}:${ip}`
    const keyB = `public-menu:hotelB-${crypto.randomUUID()}:${ip}`
    for (let i = 0; i < 120; i++) await rateLimit(keyA, { maxAttempts: 120, windowMs: 5 * 60_000 })
    expect((await rateLimit(keyA, { maxAttempts: 120, windowMs: 5 * 60_000 })).allowed).toBe(false)
    expect((await rateLimit(keyB, { maxAttempts: 120, windowMs: 5 * 60_000 })).allowed).toBe(true)
  })
})

describe('F7 — ítems agotados vs. fuera de horario', () => {
  it('ítem available=0 (86d) NO aparece en absoluto, ni con flag', async () => {
    const categoriesSeed = [{ id: 'cat1', hotelId: 'h1', name: 'Platos' }]
    const itemsSeed = [{ id: 'i1', hotelId: 'h1', categoryId: 'cat1', name: 'Salmón', price: 500, available: 0 }]
    const result = await publicMenu(baseDeps({ categoriesSeed, itemsSeed }), 'h1', undefined)
    expect(result.categories[0].items).toHaveLength(0)
    expect(JSON.stringify(result).includes('Salmón')).toBe(false)
  })

  let restoreClock: (() => void) | null = null
  function mockClock(hour: number, minute: number): void {
    const RealDate = Date
    class FixedDate extends RealDate {
      constructor(...args: any[]) {
        if (args.length === 0) { super(); this.setHours(hour, minute, 0, 0) } else { super(...(args as [])) }
      }
      static now(): number { const d = new RealDate(); d.setHours(hour, minute, 0, 0); return d.getTime() }
    }
    // @ts-expect-error - override deliberado, test-only
    globalThis.Date = FixedDate
    restoreClock = () => { globalThis.Date = RealDate }
  }
  afterEach(() => { if (restoreClock) { restoreClock(); restoreClock = null } })

  it('ítem fuera de franja (Pancakes 07:00-11:00 a las 15:00) SÍ aparece, con availableNow:false y su franja visible', async () => {
    mockClock(15, 0)
    const categoriesSeed = [{ id: 'cat1', hotelId: 'h1', name: 'Desayuno' }]
    const itemsSeed = [{
      id: 'i1', hotelId: 'h1', categoryId: 'cat1', name: 'Pancakes', price: 100, available: 1,
      availableFrom: '07:00', availableTo: '11:00',
    }]
    const result = await publicMenu(baseDeps({ categoriesSeed, itemsSeed }), 'h1', undefined)
    const item = result.categories[0].items[0]
    expect(item.name).toBe('Pancakes')
    expect(item.availableNow).toBe(false)
    expect(item.availableFrom).toBe('07:00')
    expect(item.availableTo).toBe('11:00')
  })
})

describe('F7 — multi-idioma (?lang=) con fallback a español', () => {
  it('lang=en resuelve name/description por translations; sin traducción cae a español', async () => {
    const categoriesSeed = [{ id: 'cat1', hotelId: 'h1', name: 'Desayuno', translations: { en: { name: 'Breakfast' } } }]
    const itemsSeed = [
      { id: 'i1', hotelId: 'h1', categoryId: 'cat1', name: 'Pancakes', description: 'Con miel', price: 100, available: 1, translations: { en: { name: 'Pancakes EN', description: 'With honey' } } },
      { id: 'i2', hotelId: 'h1', categoryId: 'cat1', name: 'Agua', price: 30, available: 1 },
    ]
    const result = await publicMenu(baseDeps({ categoriesSeed, itemsSeed }), 'h1', 'en')
    expect(result.categories[0].name).toBe('Breakfast')
    const pancakes = result.categories[0].items.find((i) => i.id === 'i1')!
    expect(pancakes.name).toBe('Pancakes EN')
    expect(pancakes.description).toBe('With honey')
    const agua = result.categories[0].items.find((i) => i.id === 'i2')!
    expect(agua.name).toBe('Agua')   // sin traducción declarada → fallback español
  })
})

describe('F7 — combos públicos: componentes por nombre, no por id de costo', () => {
  it('un combo con 3 componentes lista {name, quantity}, nunca menuItemId', async () => {
    const categoriesSeed = [{ id: 'cat1', hotelId: 'h1', name: 'Carta' }]
    const itemsSeed = [
      { id: 'i1', hotelId: 'h1', categoryId: 'cat1', name: 'Hamburguesa', price: 300, available: 1 },
      { id: 'i2', hotelId: 'h1', categoryId: 'cat1', name: 'Papas', price: 100, available: 1 },
      { id: 'i3', hotelId: 'h1', categoryId: 'cat1', name: 'Refresco', price: 80, available: 1 },
    ]
    const combosSeed = [{ id: 'co1', hotelId: 'h1', name: 'Combo Familiar', price: 400, available: 1 }]
    const comboItemsSeed = [
      { id: 'ci1', hotelId: 'h1', comboId: 'co1', menuItemId: 'i1', quantity: 1 },
      { id: 'ci2', hotelId: 'h1', comboId: 'co1', menuItemId: 'i2', quantity: 2 },
      { id: 'ci3', hotelId: 'h1', comboId: 'co1', menuItemId: 'i3', quantity: 1 },
    ]
    const result = await publicMenu(baseDeps({ categoriesSeed, itemsSeed, combosSeed, comboItemsSeed }), 'h1', undefined)
    expect(result.combos[0].components).toEqual([
      { name: 'Hamburguesa', quantity: 1 }, { name: 'Papas', quantity: 2 }, { name: 'Refresco', quantity: 1 },
    ])
  })

  it('combo con available=0 (agotado) no aparece', async () => {
    const combosSeed = [{ id: 'co1', hotelId: 'h1', name: 'Combo Agotado', price: 400, available: 0 }]
    const comboItemsSeed = [{ id: 'ci1', hotelId: 'h1', comboId: 'co1', menuItemId: 'i1', quantity: 1 }]
    const result = await publicMenu(baseDeps({ combosSeed, comboItemsSeed }), 'h1', undefined)
    expect(result.combos).toHaveLength(0)
  })
})
