// restaurant/tests/in-house.test.ts — #209 (REST-07): el POS busca "quién está alojado" por puerto.
//   1. `searchInHouse`: sin puerto (o puerto sin la búsqueda) falla CERRADO; el hotel viaja resuelto
//      (token → BD) y el término va recortado; tope de largo → 400.
//   2. `openOrder` room service: `roomId`/`guestId` salen de la RESERVA validada, no del body — ni para
//      completar lo que la reserva no tiene. Sin reserva (dine_in/takeaway) el body se valida contra el hotel.
//   3. `getOrder`/`listOrders`: "Hab. 204 · Pérez" solo en room service y solo en comandas vivas del listado,
//      y NUNCA se persiste (cero `update` sobre la comanda).
import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import type { Auth, RepositoryAdapter } from 'arckode-framework'
import { searchInHouse } from '../usecases/in-house'
import { openOrder, getOrder, listOrders, type OrdersDeps } from '../usecases/orders'
import { withRoomLabels } from '../usecases/order-labels'
import type { ReservationPort, InHouseReservation, InHouseSearchResult } from '../usecases/reservation-port'
import type { OrderDTO, CurrentUser } from '../types'

const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'waiter' }
const auth: Auth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth
const userRepo = { findById: async (id: string) => (id === 'u1' ? { id: 'u1', hotelId: 'h1' } : null) } as unknown as RepositoryAdapter<any>

function backed<T extends object>(store: any[]): RepositoryAdapter<T> {
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  return {
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    create: async (d: any) => { const row = { id: `gen-${store.length + 1}`, ...d }; store.push(row); return row },
    update: async (id: any, d: any) => { const cur = store.find((r) => r.id === id); if (!cur) return null; Object.assign(cur, d); return cur },
    count: async (q: any = {}) => store.filter((r) => match(r, q)).length,
  } as unknown as RepositoryAdapter<T>
}

const row: InHouseReservation = { id: 'r1', hotelId: 'h1', roomId: 'room-204', roomNumber: '204', guestId: 'g1', guestName: 'Juan Pérez', checkIn: '2026-09-10', checkOut: '2026-09-12', nights: 2, status: 'checked_in' }
const one: InHouseSearchResult = { data: [row], total: 1 }
const none: InHouseSearchResult = { data: [], total: 0 }

describe('#209 — searchInHouse (restaurant, por puerto)', () => {
  it('sin puerto → falla cerrado (400), nunca lista vacía', async () => {
    await expect(searchInHouse({ reservations: null, userRepo }, { q: '204' }, user)).rejects.toThrow('reservas no conectado')
    await expect(searchInHouse({ reservations: { findById: async () => null }, userRepo }, { q: '204' }, user)).rejects.toThrow('reservas no conectado')
  })

  it('el hotel viaja resuelto y explícito; el término recortado; `id` puntual pasa tal cual; devuelve {data,total}', async () => {
    const calls: any[] = []
    const port: ReservationPort = { findById: async () => null, searchInHouse: async (q, hotelId, u) => { calls.push({ q, hotelId, u }); return one } }
    const res = await searchInHouse({ reservations: port, userRepo }, { q: '  204 ' }, user)
    expect(res).toEqual({ data: [row], total: 1 })
    await searchInHouse({ reservations: port, userRepo }, { q: '', id: ' r1 ' }, user)
    await searchInHouse({ reservations: port, userRepo }, { id: 42 }, user)   // un id que no es string se ignora
    expect(calls).toEqual([
      { q: { q: '204', id: undefined }, hotelId: 'h1', u: { ...user, hotelId: 'h1' } },
      { q: { q: '', id: 'r1' }, hotelId: 'h1', u: { ...user, hotelId: 'h1' } },
      { q: { q: '', id: undefined }, hotelId: 'h1', u: { ...user, hotelId: 'h1' } },
    ])
  })

  it('token sin hotel → se lee de la BD; usuario sin hotel → 400', async () => {
    const calls: string[] = []
    const port: ReservationPort = { findById: async () => null, searchInHouse: async (_q, hotelId) => { calls.push(hotelId); return none } }
    await searchInHouse({ reservations: port, userRepo }, { q: '' }, { id: 'u1', role: 'waiter' })
    expect(calls).toEqual(['h1'])
    await expect(searchInHouse({ reservations: port, userRepo }, { q: '' }, { id: 'nadie', role: 'waiter' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('término más largo que el tope → 400 antes de tocar el puerto', async () => {
    let called = false
    const port: ReservationPort = { findById: async () => null, searchInHouse: async () => { called = true; return none } }
    await expect(searchInHouse({ reservations: port, userRepo }, { q: 'x'.repeat(61) }, user)).rejects.toBeInstanceOf(ValidationError)
    expect(called).toBe(false)
  })
})

function ordersDeps(orders: any[], extra: Partial<OrdersDeps> = {}): OrdersDeps {
  return {
    orders: backed<OrderDTO>(orders), lines: backed(orders.length ? [] : []), tables: backed([]), config: backed([]),
    userRepo, auth, sockets: {},
    reservations: { findById: async (id) => (id === 'r1' ? { id: 'r1', hotelId: 'h1', roomId: 'room-204', guestId: 'g1' } : null) },
    ...extra,
  }
}

describe('#209 — openOrder room service hereda habitación y huésped de la reserva', () => {
  it('sin roomId/guestId en el body, la comanda nace con los de la reserva', async () => {
    const store: any[] = []
    const order = await openOrder(ordersDeps(store), { type: 'room_service', reservationId: 'r1' }, user)
    expect(order.reservationId).toBe('r1')
    expect(order.roomId).toBe('room-204')
    expect(order.guestId).toBe('g1')
  })

  it('un roomId/guestId ajeno en el body NO pisa los de la reserva validada', async () => {
    const store: any[] = []
    const order = await openOrder(ordersDeps(store), { type: 'room_service', reservationId: 'r1', roomId: 'room-de-otro', guestId: 'g-de-otro' }, user)
    expect(order.roomId).toBe('room-204')
    expect(order.guestId).toBe('g1')
  })

  it('reserva SIN huésped: el guestId del body tampoco entra (la comanda queda sin huésped)', async () => {
    const store: any[] = []
    const deps = ordersDeps(store, { reservations: { findById: async () => ({ id: 'r1', hotelId: 'h1', roomId: 'room-204', guestId: null }) } })
    const order = await openOrder(deps, { type: 'room_service', reservationId: 'r1', guestId: 'g-de-otro' }, user)
    expect(order.roomId).toBe('room-204')
    expect(order.guestId).toBeUndefined()
  })

  it('dine_in/takeaway: un guestId/roomId del body se valida contra el hotel — ajeno → 400 y nada creado; sin repo → se descarta', async () => {
    const guests = backed([{ id: 'g1', hotelId: 'h1', name: 'Juan Pérez' }, { id: 'g-h2', hotelId: 'h2', name: 'Otro' }])
    const rooms = backed([{ id: 'room-204', hotelId: 'h1', number: '204' }])
    const store: any[] = []
    const deps = ordersDeps(store, { guests, rooms })
    await expect(openOrder(deps, { type: 'takeaway', guestId: 'g-h2' }, user)).rejects.toBeInstanceOf(ValidationError)
    await expect(openOrder(deps, { type: 'takeaway', guestId: 'inventado' }, user)).rejects.toBeInstanceOf(ValidationError)
    await expect(openOrder(deps, { type: 'takeaway', roomId: 'room-de-otro' }, user)).rejects.toBeInstanceOf(ValidationError)
    expect(store).toHaveLength(0)
    const ok = await openOrder(deps, { type: 'takeaway', guestId: 'g1', roomId: 'room-204' }, user)
    expect(ok.guestId).toBe('g1')
    expect(ok.roomId).toBe('room-204')
    const blind = await openOrder(ordersDeps([]), { type: 'takeaway', guestId: 'g-h2', roomId: 'room-de-otro' }, user)
    expect(blind.guestId).toBeUndefined()
    expect(blind.roomId).toBeUndefined()
  })
})

describe('#209 — "Hab. 204 · Pérez" en la respuesta', () => {
  const rooms = backed([{ id: 'room-204', hotelId: 'h1', number: '204' }, { id: 'room-h2', hotelId: 'h2', number: '204' }])
  const guests = backed([{ id: 'g1', hotelId: 'h1', name: 'Juan Pérez' }])
  const base = { hotelId: 'h1', subtotal: 0, tax: 0, tip: 0, total: 0, createdAt: '', updatedAt: '' }

  it('withRoomLabels: solo room service; una habitación de OTRO hotel no se resuelve; un huésped de OTRO hotel tampoco', async () => {
    const list: OrderDTO[] = [
      { ...base, id: 'o1', type: 'room_service', roomId: 'room-204', guestId: 'g1', status: 'open' } as OrderDTO,
      { ...base, id: 'o2', type: 'dine_in', roomId: 'room-204', status: 'open' } as OrderDTO,
      { ...base, id: 'o3', type: 'room_service', roomId: 'room-h2', guestId: 'g-h2', status: 'open' } as OrderDTO,
    ]
    const otherGuests = backed([{ id: 'g1', hotelId: 'h1', name: 'Juan Pérez' }, { id: 'g-h2', hotelId: 'h2', name: 'Ajeno' }])
    await withRoomLabels({ rooms, guests: otherGuests }, list)
    expect(list[0].roomNumber).toBe('204')
    expect(list[0].guestName).toBe('Juan Pérez')
    expect(list[1].roomNumber).toBeUndefined()
    expect(list[2].roomNumber).toBeUndefined()
    expect(list[2].guestName).toBeUndefined()
  })

  it('getOrder trae la etiqueta; listOrders solo en comandas vivas (la cerrada no paga la lectura); NUNCA se persiste', async () => {
    const store: any[] = [
      { ...base, id: 'o1', type: 'room_service', roomId: 'room-204', guestId: 'g1', status: 'sent', openedAt: '2026-09-11T10:00:00Z' },
      { ...base, id: 'o2', type: 'room_service', roomId: 'room-204', guestId: 'g1', status: 'charged', openedAt: '2026-09-11T09:00:00Z' },
    ]
    const writes: any[] = []
    const ordersRepo = backed<OrderDTO>(store)
    ordersRepo.update = (async (id: any, d: any) => { writes.push({ id, d }); return null }) as any
    ordersRepo.create = (async (d: any) => { writes.push({ create: d }); return d }) as any
    const deps = ordersDeps(store, { orders: ordersRepo, labels: { rooms, guests } })
    const one = await getOrder(deps, 'o1', user)
    expect(one.roomNumber).toBe('204')
    expect(one.guestName).toBe('Juan Pérez')
    const { data } = await listOrders(deps, undefined, user)
    expect(data.find((o) => o.id === 'o1')?.roomNumber).toBe('204')
    expect(data.find((o) => o.id === 'o2')?.roomNumber).toBeUndefined()
    expect(writes).toEqual([])
  })
})
