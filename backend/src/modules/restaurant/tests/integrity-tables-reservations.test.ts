// restaurant/tests/integrity-tables-reservations.test.ts — #208 (REST-06):
//   1. una mesa con comanda viva no se borra (409); con comanda terminal, sí.
//   2. la reserva de un room service y de un cargo a habitación tiene que existir Y ser del hotel de la
//      comanda (404 en ambos casos, sin abrir folio ni comanda) — vía `ReservationPort`, nunca
//      `findById` suelto. Sin puerto cableado se falla cerrado.
import { describe, it, expect } from 'bun:test'
import { ConflictError, NotFoundError } from 'arckode-framework'
import type { Auth, RepositoryAdapter } from 'arckode-framework'
import { deleteTable, type TablesCrudDeps } from '../usecases/tables-crud'
import { openOrder, type OrdersDeps } from '../usecases/orders'
import { chargeToRoom, type SettlementDeps } from '../usecases/settlement'
import type { ReservationPort } from '../usecases/reservation-port'
import type { OrderDTO, TableDTO, CurrentUser } from '../types'

const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
const userRepo = { findById: async () => ({ id: 'u1', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>

function backed<T extends object>(store: any[]): RepositoryAdapter<T> {
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  return {
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    create: async (d: any) => { const row = { id: `gen-${store.length + 1}`, ...d }; store.push(row); return row },
    update: async (id: any, d: any) => { const cur = store.find((r) => r.id === id); if (!cur) return null; Object.assign(cur, d); return cur },
    delete: async (id: any) => { const i = store.findIndex((r) => r.id === id); if (i >= 0) store.splice(i, 1); return i >= 0 },
    count: async (q: any = {}) => store.filter((r) => match(r, q)).length,
    paginate: async () => ({ data: [], total: 0, limit: 100, offset: 0, pages: 0 }),
  } as RepositoryAdapter<T>
}

// ─── 1. Mesas ────────────────────────────────────────────────────────────────
describe('#208 — deleteTable: mesa con comanda', () => {
  function tableDeps(orderStatus: OrderDTO['status'] | null) {
    const tables: any[] = [{ id: 't1', hotelId: 'h1', name: 'Mesa 1', status: 'occupied' }]
    const orders: any[] = orderStatus ? [{ id: 'o1', hotelId: 'h1', tableId: 't1', number: 'CMD-2026-0007', status: orderStatus }] : []
    const deps: TablesCrudDeps = { tables: backed<TableDTO>(tables), userRepo, auth: strictAuth, orders: backed<OrderDTO>(orders) }
    return { deps, tables }
  }

  for (const status of ['open', 'sent', 'billed', 'processing_payment'] as OrderDTO['status'][]) {
    it(`comanda ${status} → 409 y la mesa sigue`, async () => {
      const { deps, tables } = tableDeps(status)
      let err: unknown
      try { await deleteTable(deps, 't1', user) } catch (e) { err = e }
      expect(err).toBeInstanceOf(ConflictError)
      expect((err as ConflictError).httpStatus).toBe(409)
      expect((err as Error).message).toContain('CMD-2026-0007')
      expect(tables).toHaveLength(1)
    })
  }

  for (const status of ['paid', 'charged', 'cancelled', 'refunded'] as OrderDTO['status'][]) {
    it(`comanda ${status} (terminal) → se borra`, async () => {
      const { deps, tables } = tableDeps(status)
      await deleteTable(deps, 't1', user)
      expect(tables).toHaveLength(0)
    })
  }

  it('sin comandas → se borra', async () => {
    const { deps, tables } = tableDeps(null)
    await deleteTable(deps, 't1', user)
    expect(tables).toHaveLength(0)
  })

  it('sin repo de comandas cableado → falla CERRADO (400) y la mesa sigue — nunca se salta el chequeo', async () => {
    const tables: any[] = [{ id: 't1', hotelId: 'h1', name: 'Mesa 1', status: 'free' }]
    await expect(deleteTable({ tables: backed<TableDTO>(tables), userRepo, auth: strictAuth }, 't1', user)).rejects.toThrow('Comandas no configuradas')
    expect(tables).toHaveLength(1)
  })

  it('una comanda abierta de OTRA mesa no bloquea', async () => {
    const tables: any[] = [{ id: 't1', hotelId: 'h1', name: 'Mesa 1', status: 'free' }]
    const orders: any[] = [{ id: 'o1', hotelId: 'h1', tableId: 't2', status: 'open' }]
    await deleteTable({ tables: backed<TableDTO>(tables), userRepo, auth: strictAuth, orders: backed<OrderDTO>(orders) }, 't1', user)
    expect(tables).toHaveLength(0)
  })
})

// ─── 2. Reservas ─────────────────────────────────────────────────────────────
/** Reservas de dos hoteles: r-mine es de h1, r-foreign de h2. */
const reservationsPort: ReservationPort = {
  findById: async (id) => {
    if (id === 'r-mine') return { id, hotelId: 'h1', guestId: 'g1', roomId: 'room-1' }
    if (id === 'r-foreign') return { id, hotelId: 'h2', guestId: 'g2', roomId: 'room-2' }
    return null
  },
}

describe('#208 — openOrder room_service: la reserva es del hotel', () => {
  function ordersDeps(port: ReservationPort | null | undefined) {
    const orders: any[] = []
    const deps: OrdersDeps = {
      orders: backed<OrderDTO>(orders), lines: backed<any>([]), tables: backed<TableDTO>([]), config: backed<any>([]),
      userRepo, auth: strictAuth, sockets: {}, reservations: port,
    }
    return { deps, orders }
  }

  it('reserva de OTRO hotel → 404 y no se crea la comanda', async () => {
    const { deps, orders } = ordersDeps(reservationsPort)
    let err: unknown
    try { await openOrder(deps, { type: 'room_service', reservationId: 'r-foreign' }, user) } catch (e) { err = e }
    expect(err).toBeInstanceOf(NotFoundError)
    expect((err as NotFoundError).httpStatus).toBe(404)
    expect(orders).toHaveLength(0)
  })

  it('reserva inexistente → el MISMO 404 (no se confirma que exista en otro hotel)', async () => {
    const { deps } = ordersDeps(reservationsPort)
    let foreign: unknown; let missing: unknown
    try { await openOrder(deps, { type: 'room_service', reservationId: 'r-foreign' }, user) } catch (e) { foreign = e }
    try { await openOrder(deps, { type: 'room_service', reservationId: 'nope' }, user) } catch (e) { missing = e }
    expect((foreign as Error).message).toBe((missing as Error).message)
  })

  it('reserva del hotel → se abre la comanda con esa reserva', async () => {
    const { deps, orders } = ordersDeps(reservationsPort)
    const o = await openOrder(deps, { type: 'room_service', reservationId: 'r-mine' }, user)
    expect(o.reservationId).toBe('r-mine')
    expect(orders).toHaveLength(1)
  })

  it('sin puerto cableado → falla cerrado (400) y no se crea la comanda', async () => {
    const { deps, orders } = ordersDeps(null)
    await expect(openOrder(deps, { type: 'room_service', reservationId: 'r-mine' }, user)).rejects.toThrow('no disponible')
    expect(orders).toHaveLength(0)
  })

  it('takeaway/dine_in no consultan el puerto', async () => {
    let calls = 0
    const spy: ReservationPort = { findById: async () => { calls++; return null } }
    const { deps } = ordersDeps(spy)
    await openOrder(deps, { type: 'takeaway' }, user)
    expect(calls).toBe(0)
  })
})

describe('#208 — chargeToRoom: la reserva es del hotel y se valida ANTES de tocar el folio', () => {
  function settlementDeps(orderReservationId: string | undefined, port: ReservationPort | null | undefined) {
    const orders: any[] = [{ id: 'o1', hotelId: 'h1', number: 'CMD-2026-0001', status: 'served', tableId: 't1', tip: 0, subtotal: 0, tax: 0, total: 0, reservationId: orderReservationId }]
    const lines: any[] = [{ id: 'l1', hotelId: 'h1', orderId: 'o1', unitPrice: 10, quantity: 2, taxRate: 18, lineTotal: 20, status: 'served' }]
    const tables: any[] = [{ id: 't1', hotelId: 'h1', name: 'M1', status: 'occupied' }]
    const charged: any[] = []
    const deps: SettlementDeps = {
      orders: backed<OrderDTO>(orders), lines: backed<any>(lines), tables: backed<TableDTO>(tables),
      hotels: backed<any>([{ id: 'h1', currency: 'DOP' }]), userRepo, auth: strictAuth, sockets: {},
      ports: { chargeToFolio: async (i: any) => { charged.push(i); return { folioId: 'f1' } } },
      reservations: port,
    }
    return { deps, orders, tables, charged }
  }

  it('reservationId del body de OTRO hotel → 404, ningún cargo al folio, la comanda sigue served y la mesa ocupada', async () => {
    const { deps, orders, tables, charged } = settlementDeps(undefined, reservationsPort)
    let err: unknown
    try { await chargeToRoom(deps, 'o1', { reservationId: 'r-foreign' }, user) } catch (e) { err = e }
    expect(err).toBeInstanceOf(NotFoundError)
    expect((err as NotFoundError).httpStatus).toBe(404)
    expect(charged).toHaveLength(0)
    expect(orders[0].status).toBe('served')
    expect(orders[0].folioId).toBeUndefined()
    expect(tables[0].status).toBe('occupied')
  })

  it('la reserva guardada en la comanda también se valida (no solo la del body)', async () => {
    const { deps, charged } = settlementDeps('r-foreign', reservationsPort)
    await expect(chargeToRoom(deps, 'o1', {}, user)).rejects.toThrow('Reserva no encontrada')
    expect(charged).toHaveLength(0)
  })

  it('reserva del hotel → carga al folio y la comanda queda charged', async () => {
    const { deps, orders, charged } = settlementDeps(undefined, reservationsPort)
    const o = await chargeToRoom(deps, 'o1', { reservationId: 'r-mine' }, user)
    expect(o.status).toBe('charged')
    expect(charged).toHaveLength(1)
    expect(charged[0].reservationId).toBe('r-mine')
    expect(orders[0].folioId).toBe('f1')
  })

  it('sin puerto cableado → falla cerrado y no se toca el folio', async () => {
    const { deps, charged } = settlementDeps('r-mine', null)
    await expect(chargeToRoom(deps, 'o1', {}, user)).rejects.toThrow('no disponible')
    expect(charged).toHaveLength(0)
  })

  it('el puerto recibe el hotel de la COMANDA (BD), no el del token: un token viejo sin hotelId también carga', async () => {
    const seen: Array<string | null | undefined> = []
    const port: ReservationPort = {
      findById: async (id, u) => { seen.push(u.hotelId); return reservationsPort.findById(id, u) },
    }
    const { deps, charged } = settlementDeps('r-mine', port)
    const legacyToken: CurrentUser = { id: 'u1', role: 'hotel_admin' } // hotel-auth.ts sigue aceptando tokens sin hotelId
    await chargeToRoom(deps, 'o1', {}, legacyToken)
    expect(seen).toEqual(['h1'])
    expect(charged).toHaveLength(1)
  })
})
