// restaurant/tests/orders-send-covers.test.ts — #210 (REST-08): re-envío parcial a cocina y comensales.
//
// Las dos reglas que cubre, ambas sobre `usecases/orders.ts`:
//  1. `POST /orders/:id/send` deja de ser "solo open→sent". Una comanda ya enviada acepta el re-envío
//     de las líneas que el mozo agregó después, es IDEMPOTENTE (sin líneas sin confirmar no hace nada
//     y devuelve 200, no 409) y estampa `sentAt` — el único dato que distingue una línea recién
//     cargada de una ya despachada, porque las dos siguen en `status:'new'`.
//  2. `covers` (comensales) se persiste SOLO en comandas `dine_in`, con default 1 y validación de
//     entero 1..200.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { openOrder, sendOrder, unsentLines, type OrdersDeps } from '../usecases/orders'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser } from '../types'

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
/** Repo respaldado por un store en memoria (mismo helper que service.test.ts). */
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

interface Wiring {
  orders?: RepositoryAdapter<OrderDTO>
  lines?: RepositoryAdapter<OrderItemDTO>
  tables?: RepositoryAdapter<TableDTO>
  config?: RepositoryAdapter<any>
  sockets?: OrdersDeps['sockets']
}
function deps(w: Wiring = {}): OrdersDeps {
  return {
    orders: w.orders ?? makeRepo<OrderDTO>(),
    lines: w.lines ?? makeRepo<OrderItemDTO>(),
    tables: w.tables ?? makeRepo<TableDTO>(),
    config: w.config ?? backed<any>([]),
    userRepo: { ...makeRepo<any>(), findById: async () => ({ id: 'u1', hotelId: 'h1' }) },
    auth: strictAuth,
    sockets: w.sockets ?? {},
  }
}

describe('#210 — sendOrder: primer envío', () => {
  it('open → sent estampa sentAt en todas las líneas nuevas y emite onOrderSent', async () => {
    const linesStore: any[] = []
    const emitted: OrderItemDTO[][] = []
    const orders = backed<OrderDTO>([], [{ id: 'o1', hotelId: 'h1', status: 'open' }])
    const lines = backed<OrderItemDTO>(linesStore, [
      { id: 'l1', hotelId: 'h1', orderId: 'o1', status: 'new' },
      { id: 'l2', hotelId: 'h1', orderId: 'o1', status: 'new' },
    ])
    const o = await sendOrder(deps({ orders, lines, sockets: { onOrderSent: async (_o, ls) => { emitted.push(ls) } } }), 'o1', user)
    expect(o.status).toBe('sent')
    expect(linesStore.every((l) => typeof l.sentAt === 'string')).toBe(true)
    expect(emitted[0].map((l) => l.id)).toEqual(['l1', 'l2'])
  })

  it('comanda vacía (o con todas las líneas canceladas) → ValidationError', async () => {
    const orders = backed<OrderDTO>([], [{ id: 'o1', hotelId: 'h1', status: 'open' }])
    await expect(sendOrder(deps({ orders, lines: backed<OrderItemDTO>([]) }), 'o1', user)).rejects.toThrow('no tiene líneas')
    const cancelled = backed<OrderItemDTO>([], [{ id: 'l1', hotelId: 'h1', orderId: 'o1', status: 'cancelled' }])
    await expect(sendOrder(deps({ orders, lines: cancelled }), 'o1', user)).rejects.toThrow('no tiene líneas')
  })
})

describe('#210 — sendOrder: re-envío parcial de las líneas agregadas después', () => {
  it('comanda sent con una línea sin confirmar: la estampa y emite SOLO esa', async () => {
    const linesStore: any[] = []
    const emitted: OrderItemDTO[][] = []
    const orders = backed<OrderDTO>([], [{ id: 'o1', hotelId: 'h1', status: 'sent' }])
    const lines = backed<OrderItemDTO>(linesStore, [
      { id: 'vieja', hotelId: 'h1', orderId: 'o1', status: 'preparing', sentAt: '2026-09-11T10:00:00.000Z' },
      { id: 'nueva', hotelId: 'h1', orderId: 'o1', status: 'new' },
    ])
    const o = await sendOrder(deps({ orders, lines, sockets: { onOrderSent: async (_o, ls) => { emitted.push(ls) } } }), 'o1', user)
    expect(o.status).toBe('sent')                                   // el estado de la comanda no cambia
    expect(emitted).toHaveLength(1)
    expect(emitted[0].map((l) => l.id)).toEqual(['nueva'])
    expect(linesStore.find((l) => l.id === 'nueva').sentAt).toBeTypeOf('string')
    expect(linesStore.find((l) => l.id === 'vieja').sentAt).toBe('2026-09-11T10:00:00.000Z')  // intacta
  })

  it('idempotente: sin líneas sin confirmar no emite nada y devuelve la comanda (no 409)', async () => {
    let emits = 0
    const orders = backed<OrderDTO>([], [{ id: 'o1', hotelId: 'h1', status: 'preparing' }])
    const lines = backed<OrderItemDTO>([], [
      { id: 'l1', hotelId: 'h1', orderId: 'o1', status: 'new', sentAt: '2026-09-11T10:00:00.000Z' },
    ])
    const d = deps({ orders, lines, sockets: { onOrderSent: async () => { emits++ } } })
    const o = await sendOrder(d, 'o1', user)
    expect(o.status).toBe('preparing')
    expect(emits).toBe(0)
  })

  it('el header del combo se estampa pero NO viaja a cocina; sí sus componentes', async () => {
    const linesStore: any[] = []
    const emitted: OrderItemDTO[][] = []
    const orders = backed<OrderDTO>([], [{ id: 'o1', hotelId: 'h1', status: 'ready' }])
    const lines = backed<OrderItemDTO>(linesStore, [
      { id: 'hdr', hotelId: 'h1', orderId: 'o1', status: 'new', kind: 'combo_header' },
      { id: 'cmp', hotelId: 'h1', orderId: 'o1', status: 'new', kind: 'combo_component', parentLineId: 'hdr' },
    ])
    await sendOrder(deps({ orders, lines, sockets: { onOrderSent: async (_o, ls) => { emitted.push(ls) } } }), 'o1', user)
    expect(emitted[0].map((l) => l.id)).toEqual(['cmp'])
    expect(linesStore.every((l) => typeof l.sentAt === 'string')).toBe(true)
  })

  it('una comanda ya cerrada (billed/paid/cancelled) no acepta envío → ConflictError', async () => {
    for (const status of ['billed', 'paid', 'charged', 'cancelled', 'processing_payment']) {
      const orders = backed<OrderDTO>([], [{ id: 'o1', hotelId: 'h1', status }])
      const lines = backed<OrderItemDTO>([], [{ id: 'l1', hotelId: 'h1', orderId: 'o1', status: 'new' }])
      await expect(sendOrder(deps({ orders, lines }), 'o1', user)).rejects.toThrow('no se puede enviar a cocina')
    }
  })

  it('IDOR: una comanda de otro hotel no se envía', async () => {
    const orders = backed<OrderDTO>([], [{ id: 'o1', hotelId: 'OTRO', status: 'open' }])
    await expect(sendOrder(deps({ orders }), 'o1', user)).rejects.toThrow('IDOR')
  })
})

describe('#210 — unsentLines: el discriminador es sentAt, no el status', () => {
  it('una línea enviada sigue en `new` y NO vuelve a contar como pendiente', () => {
    const rows = [
      { id: 'a', status: 'new' },
      { id: 'b', status: 'new', sentAt: '2026-09-11T10:00:00.000Z' },
      { id: 'c', status: 'preparing' },
      { id: 'd', status: 'cancelled' },
    ] as OrderItemDTO[]
    expect(unsentLines(rows).map((l) => l.id)).toEqual(['a'])
  })
})

describe('#210 — comensales (covers)', () => {
  function dineInDeps(ordersStore: any[]) {
    return deps({
      orders: backed<OrderDTO>(ordersStore),
      tables: backed<TableDTO>([], [{ id: 't1', hotelId: 'h1', name: 'Mesa 1', status: 'free' }]),
    })
  }

  it('dine_in sin covers → default 1', async () => {
    const store: any[] = []
    const o = await openOrder(dineInDeps(store), { type: 'dine_in', tableId: 't1' }, user)
    expect(o.covers).toBe(1)
  })

  it('dine_in con covers los persiste', async () => {
    const store: any[] = []
    const o = await openOrder(dineInDeps(store), { type: 'dine_in', tableId: 't1', covers: 4 }, user)
    expect(o.covers).toBe(4)
    expect(store[0].covers).toBe(4)
  })

  it('covers inválidos (0, decimal, > 200, no numérico) → ValidationError', async () => {
    for (const covers of [0, -3, 2.5, 201, Number.NaN]) {
      await expect(openOrder(dineInDeps([]), { type: 'dine_in', tableId: 't1', covers }, user))
        .rejects.toThrow('comensales')
    }
  })

  it('takeaway/room_service ignoran covers (el campo es del salón)', async () => {
    const takeaway = await openOrder(deps({ orders: backed<OrderDTO>([]) }), { type: 'takeaway', covers: 6 }, user)
    expect(takeaway.covers).toBeUndefined()
    const rs = await openOrder(deps({ orders: backed<OrderDTO>([]) }), { type: 'room_service', reservationId: 'r1', covers: 6 }, user)
    expect(rs.covers).toBeUndefined()
  })
})
