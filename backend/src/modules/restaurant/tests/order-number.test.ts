// restaurant/tests/order-number.test.ts — Numerador de comandas bajo concurrencia (#206, REST-04).
//
// El contador vive en `configuration(key='restaurant_order_counter_{hotelId}_{year}')`. El viejo
// read-modify-write dejaba que dos tablets leyeran el mismo valor y abrieran dos `CMD-2026-0007`.
// Los repos falsos de acá CEDEN el event loop entre lectura y escritura (como lo hace un driver
// real) y el fake de `restaurant_orders` aplica el UNIQUE (hotelId, number) que crea migrate-db.ts,
// así que la carrera se reproduce de verdad: sin CAS, 20 aperturas paralelas colisionan.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { openOrder, type OrdersDeps } from '../usecases/orders'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser } from '../types'

const passAuth: Auth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const yieldTick = () => new Promise<void>((r) => setTimeout(r, 0))

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

const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])

/** `configuration` falso: cede el loop en cada operación y expone `updateMany` con semántica CAS. */
function fakeConfig(store: any[]) {
  let n = 0
  const repo = {
    ...makeRepo<any>(),
    findOne: async (q: any) => { await yieldTick(); return store.find((r) => match(r, q)) ?? null },
    create: async (d: any) => {
      await yieldTick()
      if (store.some((r) => r.hotelId === d.hotelId && r.key === d.key)) throw new Error('UNIQUE constraint failed: configuration.hotelId, configuration.key')
      const row = { id: `cfg${++n}`, ...d }; store.push(row); return row
    },
    update: async (id: any, d: any) => { await yieldTick(); const r = store.find((x) => x.id === id); if (r) Object.assign(r, d); return r ?? null },
  } as RepositoryAdapter<any>
  const atomic = {
    updateMany: async (_model: string, filters: Record<string, unknown>, changes: Record<string, unknown>) => {
      await yieldTick()
      const rows = store.filter((r) => match(r, filters))   // WHERE id = ? AND value = ? (atómico en el motor)
      for (const r of rows) Object.assign(r, changes)
      return rows.length
    },
  }
  return { repo, atomic }
}

/** `restaurant_orders` falso con el UNIQUE (hotelId, number) de migrate-db.ts. */
function fakeOrders(store: any[]): RepositoryAdapter<OrderDTO> {
  let n = 0
  return {
    ...makeRepo<any>(),
    findMany: async (q: any = {}) => { await yieldTick(); return store.filter((r) => match(r, q)) },
    create: async (d: any) => {
      await yieldTick()
      if (store.some((r) => r.hotelId === d.hotelId && r.number === d.number)) {
        throw new Error('UNIQUE constraint failed: restaurant_orders.hotelId, restaurant_orders.number')
      }
      const row = { id: `o${++n}`, ...d }; store.push(row); return row
    },
  } as RepositoryAdapter<OrderDTO>
}

function deps(configStore: any[], ordersStore: any[]): OrdersDeps {
  const { repo, atomic } = fakeConfig(configStore)
  return {
    orders: fakeOrders(ordersStore),
    lines: makeRepo<OrderItemDTO>(),
    tables: makeRepo<TableDTO>(),
    config: repo,
    counterCas: atomic,
    userRepo: makeRepo<any>(),
    auth: passAuth,
    sockets: {},
  }
}

const seqOf = (number: string | undefined) => Number(String(number ?? '').split('-')[2])

describe('nextOrderNumber — 20 aperturas en paralelo (#206)', () => {
  it('20 openOrder concurrentes del mismo hotel → 20 números distintos y consecutivos 0001..0020', async () => {
    const configStore: any[] = []
    const ordersStore: any[] = []
    const d = deps(configStore, ordersStore)
    const opened = await Promise.all(Array.from({ length: 20 }, () => openOrder(d, { type: 'takeaway' }, user)))

    const year = new Date().getFullYear()
    for (const o of opened) expect(o.number).toMatch(new RegExp(`^CMD-${year}-\\d{4}$`))
    const seqs = opened.map((o) => seqOf(o.number)).sort((a, b) => a - b)
    expect(new Set(seqs).size).toBe(20)
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(ordersStore.length).toBe(20)
    // El contador quedó en 20: la próxima comanda es la 0021, sin agujeros.
    const counter = configStore.find((r) => r.key === `restaurant_order_counter_h1_${year}`)
    expect(counter.value).toBe(20)
  })

  it('el contador es por hotel: dos hoteles emiten su CMD-0001 sin chocar', async () => {
    const configStore: any[] = []
    const ordersStore: any[] = []
    const d = deps(configStore, ordersStore)
    const [a, b] = await Promise.all([
      openOrder(d, { type: 'takeaway' }, user),
      openOrder(d, { type: 'takeaway' }, { id: 'u2', hotelId: 'h2', role: 'hotel_admin' }),
    ])
    expect(seqOf(a.number)).toBe(1)
    expect(seqOf(b.number)).toBe(1)
  })
})
