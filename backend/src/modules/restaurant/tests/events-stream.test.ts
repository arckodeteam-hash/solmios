// restaurant/tests/events-stream.test.ts — #211: canal en vivo (SSE) del restaurante.
//
// A nivel de RUTA REAL (router.resolve sobre el módulo montado, mismo esquema que permissions-routes):
//   - GET /api/restaurant/events sin token → 401 (y con un ticket inválido, también).
//   - el ticket de 60 s (`/events/ticket`) abre el stream sin header, y el JWT de sesión por header también.
//   - AISLAMIENTO: un stream abierto con token del hotel A NO recibe lo que se publica para el hotel B.
//   - el hub: heartbeat, vida máxima y closeAll terminan el generador y sueltan al suscriptor.
//   - el ticket del KDS resuelve "Terraza · Mesa 3" / "Hab. 204" y la estación guarda `alertMinutes`.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { fakeLogger, makeAuth, bearer, tokenFor } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { RestaurantModule } from '../index'
import { RestaurantEventHub } from '../usecases/events'

type Row = Record<string, any>

function mount() {
  const rows: Record<string, Row[]> = {
    Roles: [],
    Users: [
      { id: 'user-kitchen', hotelId: 'h1', role: 'kitchen', active: 1 },
      { id: 'user-hotel_admin', hotelId: 'h1', role: 'hotel_admin', active: 1 },
      { id: 'user-waiter', hotelId: 'h2', role: 'waiter', active: 1 },
    ],
    Hotels: [{ id: 'h1', name: 'Hotel Sol' }, { id: 'h2', name: 'Hotel Luna' }],
    Rooms: [{ id: 'room-204', hotelId: 'h1', number: '204' }],
    Plans: [], Subscriptions: [], Configuration: [], HotelModuleOverrides: [],
    RestaurantStations: [],
    RestaurantTables: [{ id: 't3', hotelId: 'h1', name: 'Mesa 3', zone: 'Terraza', status: 'occupied' }],
    RestaurantOrders: [
      { id: 'o-mesa', hotelId: 'h1', status: 'sent', type: 'dine_in', tableId: 't3', number: 'R-1', openedAt: '2026-09-11T10:00:00.000Z' },
      { id: 'o-room', hotelId: 'h1', status: 'sent', type: 'room_service', roomId: 'room-204', reservationId: 'r1', number: 'R-2', openedAt: '2026-09-11T10:01:00.000Z' },
      { id: 'o-take', hotelId: 'h1', status: 'sent', type: 'takeaway', number: 'R-3', openedAt: '2026-09-11T10:02:00.000Z' },
    ],
    RestaurantOrderItems: [
      { id: 'l1', hotelId: 'h1', orderId: 'o-mesa', kind: 'item', status: 'new', name: 'Pizza', quantity: 1, sentAt: '2026-09-11T10:05:00.000Z' },
      { id: 'l2', hotelId: 'h1', orderId: 'o-room', kind: 'item', status: 'preparing', name: 'Club', quantity: 1 },
      { id: 'l3', hotelId: 'h1', orderId: 'o-take', kind: 'item', status: 'new', name: 'Café', quantity: 2 },
    ],
  }
  const table = (t: string) => (rows[t] ??= [])
  const matches = (r: Row, f?: Row) => Object.entries(f ?? {}).every(([k, v]) => r[k] === v)
  const orm: any = {
    define() { return orm },
    findMany: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)),
    findById: async (t: string, id: string) => table(t).find((r) => r.id === id) ?? null,
    findOne: async (t: string, f?: Row) => table(t).find((r) => matches(r, f)) ?? null,
    create: async (t: string, d: Row) => { const row = { id: `gen-${table(t).length + 1}`, ...d }; table(t).push(row); return row },
    update: async (t: string, id: string, d: Row) => { const cur = table(t).find((r) => r.id === id); if (!cur) return null; Object.assign(cur, d); return cur },
    delete: async (t: string, id: string) => { const i = table(t).findIndex((r) => r.id === id); if (i >= 0) table(t).splice(i, 1); return i >= 0 },
    count: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)).length,
    paginate: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
  }
  const router = new Router()
  const auth = makeAuth()
  const service = (RestaurantModule() as any).create({ logger: fakeLogger(), orm, router, auth })
  return { router, auth, rows, service }
}

/** Lee `n` chunks del stream (cada uno es el JSON de un evento) y lo cierra. */
async function take(stream: AsyncGenerator<string>, n: number): Promise<any[]> {
  const out: any[] = []
  for await (const chunk of stream) {
    out.push(JSON.parse(chunk))
    if (out.length >= n) break
  }
  return out
}

describe('GET /api/restaurant/events — autenticación', () => {
  it('sin token → 401 y sin stream', async () => {
    const { router } = mount()
    const res = await router.resolve('GET', '/api/restaurant/events', { headers: {} })
    expect(res.status).toBe(401)
    expect(res.stream).toBeUndefined()
  })

  it('con ?ticket= inválido → 401', async () => {
    const { router } = mount()
    const res = await router.resolve('GET', '/api/restaurant/events', { headers: {}, query: { ticket: 'basura' } })
    expect(res.status).toBe(401)
  })

  it('el ticket de /events/ticket abre el stream sin header (EventSource no manda headers) y arranca con hello', async () => {
    const { router, auth } = mount()
    const t = await router.resolve('GET', '/api/restaurant/events/ticket', { headers: bearer(auth, 'kitchen', 'h1') })
    expect(t.status).toBe(200)
    const { ticket, expiresIn } = t.body as { ticket: string; expiresIn: number }
    expect(expiresIn).toBe(60)
    // El ticket conserva hotel y rol del JWT original.
    expect(auth.verifyToken(ticket)).toMatchObject({ id: 'user-kitchen', role: 'kitchen', hotelId: 'h1' })

    const res = await router.resolve('GET', '/api/restaurant/events', { headers: {}, query: { ticket } })
    expect(res.status).toBe(200)
    expect(res.headers?.['Content-Type']).toBe('text/event-stream')
    expect(res.headers?.['X-Accel-Buffering']).toBe('no')
    const [hello] = await take(res.stream!, 1)
    expect(hello.type).toBe('hello')
  })

  it('el JWT de sesión por header también abre el stream (el header gana sobre la query)', async () => {
    const { router, auth } = mount()
    const res = await router.resolve('GET', '/api/restaurant/events', { headers: bearer(auth, 'kitchen', 'h1'), query: { ticket: 'basura' } })
    expect(res.status).toBe(200)
    await res.stream!.return(undefined)
  })
})

describe('GET /api/restaurant/events — aislamiento por hotel', () => {
  it('un stream del hotel h1 recibe lo publicado para h1 y NUNCA lo de h2', async () => {
    const { router, auth, service } = mount()
    const h1 = await router.resolve('GET', '/api/restaurant/events', { headers: bearer(auth, 'kitchen', 'h1') })
    const h2 = await router.resolve('GET', '/api/restaurant/events', { headers: { authorization: `Bearer ${tokenFor(auth, 'waiter', 'h2')}` } })
    expect(h1.status).toBe(200)
    expect(h2.status).toBe(200)

    // Consumidores en paralelo: cada uno espera hello + 1 evento.
    const readH1 = take(h1.stream!, 2)
    const readH2 = take(h2.stream!, 2)
    await new Promise((r) => setTimeout(r, 5))   // que ambos generadores se suscriban al hub
    service.publishEvent('h2', { type: 'order.sent', orderId: 'o-h2' })
    service.publishEvent('h1', { type: 'order.sent', orderId: 'o-h1' })

    const gotH1 = await readH1
    const gotH2 = await readH2
    expect(gotH1.map((e) => e.type)).toEqual(['hello', 'order.sent'])
    expect(gotH1[1].orderId).toBe('o-h1')
    expect(gotH2[1].orderId).toBe('o-h2')
  })

  it('publicar para un hotel sin conexiones no rompe nada', () => {
    const { service } = mount()
    expect(() => service.publishEvent('h-nadie', { type: 'table.changed', tableId: 't' })).not.toThrow()
  })
})

describe('RestaurantEventHub — heartbeat, vida máxima y cierre', () => {
  it('manda ping por heartbeat y termina el stream al vencer la vida máxima', async () => {
    const hub = new RestaurantEventHub({ heartbeatMs: 5, maxLifetimeMs: 40 })
    const got: any[] = []
    for await (const chunk of hub.subscribe('h1')) got.push(JSON.parse(chunk))
    // Terminó solo (vida máxima), con hello + al menos un ping, y el suscriptor ya no está.
    expect(got[0].type).toBe('hello')
    expect(got.some((e) => e.type === 'ping')).toBe(true)
    expect(hub.size('h1')).toBe(0)
  })

  it('closeAll termina todos los streams (shutdown) y los eventos posteriores no llegan a nadie', async () => {
    const hub = new RestaurantEventHub({ heartbeatMs: 60_000, maxLifetimeMs: 60_000 })
    const a = hub.subscribe('h1')
    const b = hub.subscribe('h2')
    const readA = take(a, 5)
    const readB = take(b, 5)
    await new Promise((r) => setTimeout(r, 5))
    expect(hub.size('h1')).toBe(1)
    hub.publish('h1', { type: 'line.status', lineId: 'l1', status: 'ready' })
    hub.closeAll()
    const gotA = await readA
    const gotB = await readB
    expect(gotA.map((e) => e.type)).toEqual(['hello', 'line.status'])
    expect(gotB.map((e) => e.type)).toEqual(['hello'])
    expect(hub.size('h1')).toBe(0)
    expect(hub.size('h2')).toBe(0)
  })

  it('el consumidor que se va (return) suelta al suscriptor', async () => {
    const hub = new RestaurantEventHub({ heartbeatMs: 60_000, maxLifetimeMs: 60_000 })
    const s = hub.subscribe('h1')
    await s.next()   // hello → ya suscripto
    expect(hub.size('h1')).toBe(1)
    await s.return(undefined)
    expect(hub.size('h1')).toBe(0)
  })
})

describe('KDS — el ticket dice dónde va (#211)', () => {
  it('resuelve "Terraza · Mesa 3", "Hab. 204" y deja takeaway sin lugar', async () => {
    const { router, auth } = mount()
    const res = await router.resolve('GET', '/api/restaurant/kds', { headers: bearer(auth, 'kitchen', 'h1') })
    expect(res.status).toBe(200)
    const tickets = (res.body as { data: any[] }).data
    const byId = Object.fromEntries(tickets.map((t) => [t.order.id, t.order]))
    expect(byId['o-mesa']).toMatchObject({ tableName: 'Mesa 3', tableZone: 'Terraza' })
    expect(byId['o-room']).toMatchObject({ roomNumber: '204' })
    expect(byId['o-take'].tableName).toBeUndefined()
    expect(byId['o-take'].roomNumber).toBeUndefined()
    // sentAt de la línea viaja tal cual: el cronómetro del KDS arranca ahí.
    expect(tickets.find((t) => t.order.id === 'o-mesa').lines[0].sentAt).toBe('2026-09-11T10:05:00.000Z')
  })
})

describe('Estaciones — alertMinutes (#211)', () => {
  it('crear sin umbral → 10; con umbral → se guarda; fuera de rango → 400', async () => {
    const { router, auth, rows } = mount()
    const h = bearer(auth, 'hotel_admin', 'h1')
    const a = await router.resolve('POST', '/api/restaurant/stations', { headers: h, body: { name: 'Cocina' } })
    expect(a.status).toBe(201)
    expect((a.body as any).alertMinutes).toBe(10)
    const b = await router.resolve('POST', '/api/restaurant/stations', { headers: h, body: { name: 'Parrilla', alertMinutes: 25 } })
    expect(b.status).toBe(201)
    expect((b.body as any).alertMinutes).toBe(25)
    const c = await router.resolve('POST', '/api/restaurant/stations', { headers: h, body: { name: 'Bar', alertMinutes: 0 } })
    expect(c.status).toBe(400)
    const d = await router.resolve('PUT', `/api/restaurant/stations/${(a.body as any).id}`, { headers: h, body: { alertMinutes: 7 } })
    expect(d.status).toBe(200)
    expect(rows.RestaurantStations.find((s) => s.id === (a.body as any).id)?.alertMinutes).toBe(7)
  })
})
