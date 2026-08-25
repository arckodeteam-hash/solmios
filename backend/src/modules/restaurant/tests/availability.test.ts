// restaurant/tests/availability.test.ts — Destacados y disponibilidad por horario (F6). Cubre TODOS
// los scenarios de specs/menu-featured-availability/spec.md: ítem destacado sin regla de negocio,
// franja normal dentro/fuera de horario, franja que cruza medianoche, addLine rechaza fuera de franja,
// snapshot ya vendido no se ve afectado retroactivamente, availableNow correcto en el DTO de listado.
import { describe, it, expect, afterEach } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import * as itemsCrud from '../usecases/items-crud'
import { isWithinAvailabilityWindow } from '../usecases/order-totals'
import { addLine, updateLine, type OrderLinesDeps } from '../usecases/order-lines'
import type { CategoryDTO, MenuItemDTO, StationDTO, OrderDTO, OrderItemDTO, ComboDTO, ComboItemDTO, CurrentUser } from '../types'

const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

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
function makeUserRepo(hotelId = 'h1'): RepositoryAdapter<any> {
  return { ...makeRepo<any>(), findById: async () => ({ id: 'u1', hotelId }) }
}
function backed<T extends object>(store: any[], seed: any[] = []): RepositoryAdapter<T> {
  store.push(...seed)
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  let n = 0
  return {
    ...makeRepo<any>(),
    create: async (d: any) => { const row = { id: `gen${++n}`, ...d }; store.push(row); return row },
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
    update: async (id: any, d: any) => { const r = store.find((x) => x.id === id); if (r) Object.assign(r, d); return r ?? null },
    delete: async (id: any) => { const i = store.findIndex((x) => x.id === id); if (i >= 0) { store.splice(i, 1); return true } return false },
  } as RepositoryAdapter<T>
}

function itemDeps(overrides: Partial<{ itemsStore: any[]; categoriesSeed: any[] }> = {}): itemsCrud.ItemsCrudDeps {
  return {
    items: backed<MenuItemDTO>(overrides.itemsStore ?? []),
    categories: backed<CategoryDTO>([], overrides.categoriesSeed ?? [{ id: 'cat1', hotelId: 'h1', name: 'Entradas' }]),
    stations: backed<StationDTO>([]),
    userRepo: makeUserRepo(),
    auth: strictAuth,
  }
}

function orderLinesDeps(overrides: Partial<{ itemsSeed: any[] }> = {}): { deps: OrderLinesDeps; linesStore: any[]; ordersStore: any[] } {
  const ordersStore: any[] = [{ id: 'o1', hotelId: 'h1', status: 'open', tip: 0, subtotal: 0, tax: 0, total: 0 }]
  const linesStore: any[] = []
  const itemsSeed = overrides.itemsSeed ?? [
    { id: 'A', hotelId: 'h1', name: 'Pancakes', price: 100, categoryId: 'cat1', available: 1 },
  ]
  const categoriesSeed = [{ id: 'cat1', hotelId: 'h1', name: 'Entradas' }]
  const items = backed<MenuItemDTO>([], itemsSeed)
  const categories = backed<CategoryDTO>([], categoriesSeed)
  const stations = backed<StationDTO>([])
  const config = makeRepo<any>({ findOne: async () => null })
  const hotels = makeRepo<any>({ findById: async () => ({ id: 'h1', taxRate: 0 }) })
  const deps: OrderLinesDeps = {
    orders: backed<OrderDTO>(ordersStore),
    lines: backed<OrderItemDTO>(linesStore),
    items, categories, stations, config, hotels,
    userRepo: makeUserRepo(), auth: strictAuth,
    combos: backed<ComboDTO>([]),
    comboItems: backed<ComboItemDTO>([]),
  }
  return { deps, linesStore, ordersStore }
}

// ─── Reloj fijo — isWithinAvailabilityWindow/addLine/listItems usan `new Date()` internamente (D10:
// hora del SERVIDOR, sin conversión a timezone). Se sobreescribe el reloj global SOLO durante el test
// para simular una hora exacta, y se restaura siempre en afterEach (aunque el test falle). ───
// `RealDate` se captura UNA vez al cargar el módulo, no dentro de mockClock: el test de "snapshot"
// llama mockClock DOS veces en el mismo test (10:55 → 20:00), y en la segunda el `const RealDate =
// Date` capturaba el Date YA parcheado — el afterEach restauraba a ese FixedDate y el reloj quedaba
// congelado para el resto de la suite (bun corre los archivos en un solo proceso): todo createdAt
// idéntico y desempates FIFO al azar en tests ajenos (flake de payment-requests RTC-8.3 en CI).
const RealDate = Date
let restoreClock: (() => void) | null = null
function mockClock(hour: number, minute: number): void {
  class FixedDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super()
        this.setHours(hour, minute, 0, 0)
      } else {
        // @ts-expect-error - passthrough variádico al constructor real de Date
        super(...args)
      }
    }
    static now(): number {
      const d = new RealDate()
      d.setHours(hour, minute, 0, 0)
      return d.getTime()
    }
  }
  // @ts-expect-error - override deliberado, test-only
  globalThis.Date = FixedDate
  restoreClock = () => { globalThis.Date = RealDate }
}
afterEach(() => {
  if (restoreClock) { restoreClock(); restoreClock = null }
})

describe('F6 — ítem destacado (sin regla de negocio)', () => {
  it('marcar featured:true persiste y se lee de vuelta, sin efecto en disponibilidad', async () => {
    const d = itemDeps()
    const created = await itemsCrud.createItem(d, { categoryId: 'cat1', name: 'Risotto de hongos', price: 250, featured: 1 }, user)
    expect(created.featured).toBe(1)
    const fetched = await itemsCrud.getItem(d, created.id, user)
    expect(fetched.featured).toBe(1)
    expect(fetched.availableNow).toBe(true)
  })

  it('sin featured en el body → default 0 (compat retro)', async () => {
    const d = itemDeps()
    const created = await itemsCrud.createItem(d, { categoryId: 'cat1', name: 'Agua', price: 30 }, user)
    expect(created.featured).toBe(0)
  })
})

describe('F6 — franja horaria: validación en createItem/updateItem (todo-o-nada)', () => {
  it('availableFrom sin availableTo → 400, no crea el ítem', async () => {
    const d = itemDeps()
    const before = await d.items.findMany({ hotelId: 'h1' })
    await expect(itemsCrud.createItem(d, {
      categoryId: 'cat1', name: 'Pancakes', price: 100, availableFrom: '07:00',
    }, user)).rejects.toThrow('availableFrom y availableTo deben venir juntos')
    const after = await d.items.findMany({ hotelId: 'h1' })
    expect(after.length).toBe(before.length)
  })

  it('availableTo sin availableFrom → 400', async () => {
    const d = itemDeps()
    await expect(itemsCrud.createItem(d, {
      categoryId: 'cat1', name: 'Pancakes', price: 100, availableTo: '11:00',
    }, user)).rejects.toThrow('availableFrom y availableTo deben venir juntos')
  })

  it('ambos con formato válido → 200, persisten', async () => {
    const d = itemDeps()
    const created = await itemsCrud.createItem(d, {
      categoryId: 'cat1', name: 'Pancakes', price: 100, availableFrom: '07:00', availableTo: '11:00',
    }, user)
    expect(created.availableFrom).toBe('07:00')
    expect(created.availableTo).toBe('11:00')
  })

  it('formato inválido (no HH:mm) → 400', async () => {
    const d = itemDeps()
    await expect(itemsCrud.createItem(d, {
      categoryId: 'cat1', name: 'Pancakes', price: 100, availableFrom: '7am', availableTo: '11:00',
    }, user)).rejects.toThrow('El horario debe tener formato HH:mm')
  })

  it('sin availableFrom/availableTo → sin restricción (compat retro total)', async () => {
    const d = itemDeps()
    const created = await itemsCrud.createItem(d, { categoryId: 'cat1', name: 'Agua', price: 30 }, user)
    expect(created.availableFrom).toBeUndefined()
    expect(created.availableTo).toBeUndefined()
  })

  it('updateItem: tocar solo availableFrom sin availableTo → 400, no actualiza el ítem', async () => {
    const d = itemDeps()
    const created = await itemsCrud.createItem(d, { categoryId: 'cat1', name: 'Pancakes', price: 100 }, user)
    await expect(itemsCrud.updateItem(d, created.id, { availableFrom: '07:00' }, user))
      .rejects.toThrow('availableFrom y availableTo deben venir juntos')
    const fetched = await itemsCrud.getItem(d, created.id, user)
    expect(fetched.availableFrom).toBeUndefined()
  })

  it('updateItem: enviar ambos vacíos ("") vuelve a "sin restricción"', async () => {
    const d = itemDeps()
    const created = await itemsCrud.createItem(d, {
      categoryId: 'cat1', name: 'Pancakes', price: 100, availableFrom: '07:00', availableTo: '11:00',
    }, user)
    const updated = await itemsCrud.updateItem(d, created.id, { availableFrom: '', availableTo: '' }, user)
    expect(updated.availableFrom).toBeNull()
    expect(updated.availableTo).toBeNull()
  })

  it('updateItem sin tocar availableFrom/availableTo no los modifica', async () => {
    const d = itemDeps()
    const created = await itemsCrud.createItem(d, {
      categoryId: 'cat1', name: 'Pancakes', price: 100, availableFrom: '07:00', availableTo: '11:00',
    }, user)
    const updated = await itemsCrud.updateItem(d, created.id, { price: 120 }, user)
    expect(updated.availableFrom).toBe('07:00')
    expect(updated.availableTo).toBe('11:00')
  })
})

describe('F6 — isWithinAvailabilityWindow (los 3 scenarios del spec)', () => {
  it('sin availableFrom/availableTo → siempre disponible', () => {
    expect(isWithinAvailabilityWindow({ availableFrom: undefined, availableTo: undefined }, new Date(2026, 0, 1, 14, 0))).toBe(true)
  })

  it('Pancakes 07:00-11:00 a las 14:00 → NO disponible', () => {
    const item = { availableFrom: '07:00', availableTo: '11:00' }
    expect(isWithinAvailabilityWindow(item, new Date(2026, 0, 1, 14, 0))).toBe(false)
  })

  it('Pancakes 07:00-11:00 a las 09:00 → disponible', () => {
    const item = { availableFrom: '07:00', availableTo: '11:00' }
    expect(isWithinAvailabilityWindow(item, new Date(2026, 0, 1, 9, 0))).toBe(true)
  })

  it('Pizza nocturna 22:00-02:00 (cruza medianoche) a las 00:30 → disponible', () => {
    const item = { availableFrom: '22:00', availableTo: '02:00' }
    expect(isWithinAvailabilityWindow(item, new Date(2026, 0, 1, 0, 30))).toBe(true)
  })

  it('Pizza nocturna 22:00-02:00 (cruza medianoche) a las 15:00 → NO disponible', () => {
    const item = { availableFrom: '22:00', availableTo: '02:00' }
    expect(isWithinAvailabilityWindow(item, new Date(2026, 0, 1, 15, 0))).toBe(false)
  })

  it('límites inclusive: exactamente availableFrom → disponible', () => {
    const item = { availableFrom: '07:00', availableTo: '11:00' }
    expect(isWithinAvailabilityWindow(item, new Date(2026, 0, 1, 7, 0))).toBe(true)
  })

  it('límites inclusive: exactamente availableTo → disponible', () => {
    const item = { availableFrom: '07:00', availableTo: '11:00' }
    expect(isWithinAvailabilityWindow(item, new Date(2026, 0, 1, 11, 0))).toBe(true)
  })
})

describe('F6 — addLine rechaza fuera de franja (mismo criterio que available=0)', () => {
  it('agregar "Pancakes" (07:00-11:00) a las 20:00 → 400, la línea NO se crea', async () => {
    mockClock(20, 0)
    const { deps, linesStore } = orderLinesDeps({
      itemsSeed: [{ id: 'A', hotelId: 'h1', name: 'Pancakes', price: 100, categoryId: 'cat1', available: 1, availableFrom: '07:00', availableTo: '11:00' }],
    })
    await expect(addLine(deps, 'o1', { menuItemId: 'A', quantity: 1 }, user))
      .rejects.toThrow('"Pancakes" no está disponible en este horario')
    expect(linesStore).toHaveLength(0)
  })

  it('agregar "Pancakes" (07:00-11:00) a las 09:00 → se crea sin error', async () => {
    mockClock(9, 0)
    const { deps, linesStore } = orderLinesDeps({
      itemsSeed: [{ id: 'A', hotelId: 'h1', name: 'Pancakes', price: 100, categoryId: 'cat1', available: 1, availableFrom: '07:00', availableTo: '11:00' }],
    })
    const line = await addLine(deps, 'o1', { menuItemId: 'A', quantity: 1 }, user)
    expect(line.name).toBe('Pancakes')
    expect(linesStore).toHaveLength(1)
  })

  it('ítem sin franja configurada se agrega sin importar la hora', async () => {
    mockClock(3, 0)
    const { deps, linesStore } = orderLinesDeps({
      itemsSeed: [{ id: 'A', hotelId: 'h1', name: 'Agua', price: 30, categoryId: 'cat1', available: 1 }],
    })
    await addLine(deps, 'o1', { menuItemId: 'A', quantity: 1 }, user)
    expect(linesStore).toHaveLength(1)
  })

  it('available=0 sigue rechazando ANTES de llegar al chequeo de franja (no se reemplaza el chequeo existente)', async () => {
    mockClock(9, 0)
    const { deps, linesStore } = orderLinesDeps({
      itemsSeed: [{ id: 'A', hotelId: 'h1', name: 'Pancakes', price: 100, categoryId: 'cat1', available: 0, availableFrom: '07:00', availableTo: '11:00' }],
    })
    await expect(addLine(deps, 'o1', { menuItemId: 'A', quantity: 1 }, user))
      .rejects.toThrow('"Pancakes" no está disponible')
    expect(linesStore).toHaveLength(0)
  })
})

describe('F6 — snapshot ya vendido no se ve afectado retroactivamente', () => {
  it('una línea creada dentro de franja sigue con su snapshot aunque el ítem salga de franja después (updateLine no re-evalúa)', async () => {
    mockClock(10, 55)
    const { deps, linesStore } = orderLinesDeps({
      itemsSeed: [{ id: 'A', hotelId: 'h1', name: 'Pancakes', price: 100, categoryId: 'cat1', available: 1, availableFrom: '07:00', availableTo: '11:00' }],
    })
    const line = await addLine(deps, 'o1', { menuItemId: 'A', quantity: 1 }, user)
    expect(line.name).toBe('Pancakes')

    // Da la hora 20:00 (bien fuera de franja) — la línea ya creada sigue existiendo con su snapshot,
    // updateLine (ej. cambiar cantidad, avance del KDS) NO vuelve a chequear disponibilidad.
    mockClock(20, 0)
    const updated = await updateLine(deps, 'o1', line.id, { quantity: 2 }, user)
    expect(updated.name).toBe('Pancakes')
    expect(updated.quantity).toBe(2)
    expect(linesStore).toHaveLength(1)
  })
})

describe('F6 — availableNow en el DTO de listado/detalle', () => {
  it('listItems: ítem fuera de franja actual trae availableNow:false, dentro de franja trae true', async () => {
    mockClock(20, 0)
    const d = itemDeps({
      itemsStore: [
        { id: 'A', hotelId: 'h1', categoryId: 'cat1', name: 'Pancakes', price: 100, available: 1, availableFrom: '07:00', availableTo: '11:00' },
        { id: 'B', hotelId: 'h1', categoryId: 'cat1', name: 'Pizza nocturna', price: 200, available: 1, availableFrom: '22:00', availableTo: '02:00' },
        { id: 'C', hotelId: 'h1', categoryId: 'cat1', name: 'Agua', price: 30, available: 1 },
      ],
    })
    const { data } = await itemsCrud.listItems(d, undefined, user)
    const byId = new Map(data.map((i) => [i.id, i]))
    expect(byId.get('A')?.availableNow).toBe(false)   // 20:00, fuera de 07:00-11:00
    expect(byId.get('B')?.availableNow).toBe(false)   // 20:00, fuera de 22:00-02:00
    expect(byId.get('C')?.availableNow).toBe(true)    // sin franja, siempre disponible
  })

  it('listItems: available=0 (agotado manual) → availableNow:false aunque esté en franja', async () => {
    mockClock(9, 0)
    const d = itemDeps({
      itemsStore: [
        { id: 'A', hotelId: 'h1', categoryId: 'cat1', name: 'Pancakes', price: 100, available: 0, availableFrom: '07:00', availableTo: '11:00' },
      ],
    })
    const { data } = await itemsCrud.listItems(d, undefined, user)
    expect(data[0].availableNow).toBe(false)
  })

  it('getItem: refleja availableNow igual que listItems', async () => {
    mockClock(9, 0)
    const d = itemDeps()
    const created = await itemsCrud.createItem(d, {
      categoryId: 'cat1', name: 'Pancakes', price: 100, availableFrom: '07:00', availableTo: '11:00',
    }, user)
    const fetched = await itemsCrud.getItem(d, created.id, user)
    expect(fetched.availableNow).toBe(true)
  })
})
