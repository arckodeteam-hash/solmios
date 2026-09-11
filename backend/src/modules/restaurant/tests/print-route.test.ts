// restaurant/tests/print-route.test.ts — #216: `GET /api/restaurant/orders/:id/print` por la ruta REAL
// (router.resolve sobre el módulo montado con un ORM fake), igual que permissions-routes.test.ts.
//
// Qué cubre: el guard deja pasar `restaurant:view` O `restaurant:pay` y el usecase exige el permiso por
// documento — el mozo (view+pay) imprime los tres; cocina (view/edit, sin pay) precuenta y cocina pero NO el
// ticket (403); un cajero con SOLO `pay` imprime ticket y precuenta no; hotel_admin todo. Sin token 401. Un token de OTRO
// hotel sobre la comanda → 403 (IDOR) sin una línea del HTML. El pago del ticket entra por el conector
// REAL `restauranteReportsPaymentsConnector` → `payments.paymentOfHotel(hotelId, paymentId)`.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import type { ConnectorContext } from 'arckode-framework'
import { fakeLogger, makeAuth, bearer } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { RestaurantModule } from '../index'
import { restauranteReportsPaymentsConnector } from '../../../connectors/restaurante-reports-payments'

type Row = Record<string, any>
const SENT = '2026-09-11T18:35:00.000Z'

function mount(roleRows: Row[] = []) {
  const rows: Record<string, Row[]> = {
    Roles: roleRows,
    Users: [
      { id: 'user-waiter', hotelId: 'h1', role: 'waiter', active: 1, name: 'Carlos Mozo' },
      { id: 'user-kitchen', hotelId: 'h1', role: 'kitchen', active: 1 },
      { id: 'user-hotel_admin', hotelId: 'h1', role: 'hotel_admin', active: 1 },
      { id: 'user-cajero', hotelId: 'h1', role: 'cajero', active: 1 },
      // IDOR: receptionist (tiene restaurant:view) cuya fila de `users` vive en OTRO hotel.
      { id: 'user-receptionist', hotelId: 'h2', role: 'receptionist', active: 1 },
    ],
    Hotels: [{ id: 'h1', name: 'Hotel Sol', address: 'Calle 1', ownerTaxId: 'RNC-1', currency: 'DOP', taxRate: 18, taxName: 'ITBIS' }, { id: 'h2', name: 'Otro', currency: 'USD' }],
    Plans: [], Subscriptions: [], Configuration: [], HotelModuleOverrides: [],
    RestaurantTables: [{ id: 't1', hotelId: 'h1', name: '3', zone: 'Terraza', status: 'occupied' }],
    RestaurantOrders: [
      { id: 'o-sent', hotelId: 'h1', number: 'CMD-1', type: 'dine_in', status: 'sent', tableId: 't1', waiterId: 'user-waiter', covers: 2, subtotal: 200, tax: 36, tip: 0, total: 236, openedAt: SENT },
      { id: 'o-paid', hotelId: 'h1', number: 'CMD-2', type: 'takeaway', status: 'paid', settlement: 'payment', paymentId: 'pay-1', subtotal: 100, tax: 18, tip: 0, total: 118, openedAt: SENT, closedAt: SENT },
    ],
    RestaurantOrderItems: [
      { id: 'l1', hotelId: 'h1', orderId: 'o-sent', kind: 'item', name: 'Pizza', quantity: 2, unitPrice: 100, lineTotal: 200, taxRate: 18, status: 'new', stationId: 's1', stationName: 'Cocina', sentAt: SENT },
      { id: 'l2', hotelId: 'h1', orderId: 'o-sent', kind: 'item', name: 'Anulada', quantity: 1, unitPrice: 500, lineTotal: 500, taxRate: 18, status: 'voided', stationId: 's1', stationName: 'Cocina', sentAt: SENT },
      { id: 'l3', hotelId: 'h1', orderId: 'o-paid', kind: 'item', name: 'Sandwich', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, status: 'served', sentAt: SENT },
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
    delete: async () => true,
    count: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)).length,
    paginate: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
  }
  const router = new Router()
  const auth = makeAuth()
  const service = (RestaurantModule() as any).create({ logger: fakeLogger(), orm, router, auth })

  // Conector REAL restaurant → payments sobre un `payments` doble que registra qué le pidieron.
  const paymentCalls: string[] = []
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'restaurant') return service
      if (name === 'payments') return {
        paymentsOfBusinessDate: async () => [],
        paymentOfHotel: async (hotelId: string, id: string) => {
          paymentCalls.push(`${hotelId}/${id}`)
          return id === 'pay-1' && hotelId === 'h1' ? { id: 'pay-1', hotelId: 'h1', type: 'charge', method: 'transfer', status: 'completed', amount: 118, processedAt: SENT, metadata: {} } : null
        },
      }
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  restauranteReportsPaymentsConnector(ctx)
  return { router, auth, paymentCalls }
}

const headers = (auth: ReturnType<typeof makeAuth>, role: string, hotelId = 'h1') => bearer(auth, role, hotelId)
const html = (res: any): string => String(res.body)

describe('#216 — GET /api/restaurant/orders/:id/print por la ruta real', () => {
  it('waiter (view + pay): precuenta y cocina 200 (HTML con la mesa, sin la línea anulada); ticket 200', async () => {
    const { router, auth } = mount()
    const pre = await router.resolve('GET', '/api/restaurant/orders/o-sent/print', { headers: headers(auth, 'waiter'), query: { doc: 'precuenta' } })
    expect(pre.status).toBe(200)
    expect(pre.headers?.['content-type']).toContain('text/html')
    expect(html(pre)).toContain('PRECUENTA')
    expect(html(pre)).toContain('Terraza · Mesa 3')
    expect(html(pre)).toContain('2× Pizza')
    expect(html(pre)).toContain('RD$236.00')
    expect(html(pre)).not.toContain('Anulada')

    const kit = await router.resolve('GET', '/api/restaurant/orders/o-sent/print', { headers: headers(auth, 'waiter'), query: { doc: 'kitchen', station: 's1' } })
    expect(kit.status).toBe(200)
    expect(html(kit)).toContain('2× Pizza')
    expect(html(kit)).not.toContain('RD$')

    const tk = await router.resolve('GET', '/api/restaurant/orders/o-paid/print', { headers: headers(auth, 'waiter'), query: { doc: 'ticket' } })
    expect(tk.status).toBe(200)
    expect(html(tk)).toContain('TICKET')
  })

  it('kitchen (view/edit): comanda de cocina 200, ticket 403', async () => {
    const { router, auth } = mount()
    const kit = await router.resolve('GET', '/api/restaurant/orders/o-sent/print', { headers: headers(auth, 'kitchen'), query: { doc: 'kitchen' } })
    expect(kit.status).toBe(200)
    const tk = await router.resolve('GET', '/api/restaurant/orders/o-paid/print', { headers: headers(auth, 'kitchen'), query: { doc: 'ticket' } })
    expect(tk.status).toBe(403)
  })

  it('cajero con SOLO restaurant:pay (fila de roles del hotel): ticket 200 con el método del pago (conector real → payments.paymentOfHotel), precuenta 403', async () => {
    const { router, auth, paymentCalls } = mount([{ id: 'r-cajero', hotelId: 'h1', name: 'cajero', permissions: ['restaurant:pay'] }])
    const tk = await router.resolve('GET', '/api/restaurant/orders/o-paid/print', { headers: headers(auth, 'cajero'), query: { doc: 'ticket' } })
    expect(tk.status).toBe(200)
    expect(paymentCalls).toEqual(['h1/pay-1'])
    expect(html(tk)).toContain('TICKET')
    expect(html(tk)).toContain('Transferencia')
    expect(html(tk)).toContain('RD$118.00')
    const pre = await router.resolve('GET', '/api/restaurant/orders/o-sent/print', { headers: headers(auth, 'cajero'), query: { doc: 'precuenta' } })
    expect(pre.status).toBe(403)
  })

  it('hotel_admin: los tres 200; doc inválido 400; sin token 401', async () => {
    const { router, auth } = mount()
    for (const [id, doc] of [['o-sent', 'precuenta'], ['o-sent', 'kitchen'], ['o-paid', 'ticket']]) {
      const res = await router.resolve('GET', `/api/restaurant/orders/${id}/print`, { headers: headers(auth, 'hotel_admin'), query: { doc } })
      expect(res.status).toBe(200)
    }
    const bad = await router.resolve('GET', '/api/restaurant/orders/o-sent/print', { headers: headers(auth, 'hotel_admin'), query: { doc: 'pdf' } })
    expect(bad.status).toBe(400)
    const anon = await router.resolve('GET', '/api/restaurant/orders/o-sent/print', { query: { doc: 'precuenta' } })
    expect(anon.status).toBe(401)
  })

  it('IDOR: usuario de OTRO hotel (con restaurant:view) sobre la comanda → 403 y ni una línea del HTML', async () => {
    const { router, auth } = mount()
    const res = await router.resolve('GET', '/api/restaurant/orders/o-sent/print', { headers: headers(auth, 'receptionist', 'h2'), query: { doc: 'precuenta' } })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain('Pizza')
    expect(JSON.stringify(res.body)).not.toContain('<!DOCTYPE')
  })
})
