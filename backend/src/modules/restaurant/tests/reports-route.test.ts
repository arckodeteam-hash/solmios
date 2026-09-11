// restaurant/tests/reports-route.test.ts — #213: GET /api/restaurant/reports/daily por la ruta REAL.
// Permiso `reports:view` (hotel_admin y receptionist sí; waiter y kitchen no), fechas inválidas → 400,
// y el conector de payments (restaurante-payments) alimenta el método real de cada cobro.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { fakeLogger, makeAuth, bearer } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { RestaurantModule } from '../index'
import { restauranteReportsPaymentsConnector } from '../../../connectors/restaurante-reports-payments'

type Row = Record<string, any>

function mount() {
  const rows: Record<string, Row[]> = {
    Roles: [],
    Users: [
      { id: 'user-waiter', hotelId: 'h1', role: 'waiter', active: 1 },
      { id: 'user-kitchen', hotelId: 'h1', role: 'kitchen', active: 1 },
      { id: 'user-hotel_admin', hotelId: 'h1', role: 'hotel_admin', active: 1 },
      { id: 'user-receptionist', hotelId: 'h1', role: 'receptionist', active: 1 },
    ],
    Hotels: [{ id: 'h1', name: 'Hotel Sol', currency: 'DOP', timezone: 'America/Santo_Domingo' }],
    Plans: [], Subscriptions: [], Configuration: [], HotelModuleOverrides: [],
    RestaurantOrders: [
      { id: 'o-cash', hotelId: 'h1', number: 'CMD-1', type: 'dine_in', status: 'paid', settlement: 'payment', paymentId: 'p-cash', tip: 0, subtotal: 100, tax: 0, total: 100, closedAt: '2026-09-11T16:00:00.000Z' },
      { id: 'o-card', hotelId: 'h1', number: 'CMD-2', type: 'dine_in', status: 'paid', settlement: 'payment', paymentId: 'p-card', tip: 20, subtotal: 200, tax: 0, total: 220, closedAt: '2026-09-11T17:00:00.000Z' },
      { id: 'o-folio', hotelId: 'h1', number: 'CMD-3', type: 'room_service', status: 'charged', settlement: 'folio', folioId: 'f1', tip: 0, subtotal: 150, tax: 0, total: 150, closedAt: '2026-09-11T18:00:00.000Z' },
      // Otro hotel, mismo día: nunca debe aparecer.
      { id: 'o-h2', hotelId: 'h2', number: 'CMD-9', type: 'dine_in', status: 'paid', settlement: 'payment', paymentId: 'p-h2', tip: 0, subtotal: 999, tax: 0, total: 999, closedAt: '2026-09-11T18:00:00.000Z' },
    ],
    RestaurantOrderItems: [
      { id: 'l1', hotelId: 'h1', orderId: 'o-cash', kind: 'item', status: 'served', name: 'Pizza', unitPrice: 100, quantity: 1, lineTotal: 100, taxRate: 0 },
      { id: 'l2', hotelId: 'h1', orderId: 'o-card', kind: 'item', status: 'served', name: 'Pizza', unitPrice: 100, quantity: 2, lineTotal: 200, taxRate: 0 },
      { id: 'l3', hotelId: 'h1', orderId: 'o-folio', kind: 'item', status: 'served', name: 'Desayuno', unitPrice: 150, quantity: 1, lineTotal: 150, taxRate: 0 },
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

  // Conector REAL restaurante-reports-payments con un módulo payments doble: getPayment devuelve el método.
  const payments: Record<string, Row> = {
    'p-cash': { id: 'p-cash', hotelId: 'h1', method: 'cash' },
    'p-card': { id: 'p-card', hotelId: 'h1', method: 'card' },
    'p-h2': { id: 'p-h2', hotelId: 'h2', method: 'cash' },
  }
  const asked: string[] = []
  const paymentsModule = {
    getPayment: async (id: string) => { asked.push(id); const p = payments[id]; if (!p) throw new Error('Payment not found'); return p },
  }
  restauranteReportsPaymentsConnector({ resolveModule: (name: string) => (name === 'restaurant' ? service : paymentsModule) } as any)
  return { router, auth, asked }
}

const headers = (auth: ReturnType<typeof makeAuth>, role: string) => bearer(auth, role, 'h1')

describe('GET /api/restaurant/reports/daily — permiso reports:view', () => {
  it('waiter y kitchen → 403 (no es una pantalla operativa: es el consolidado de plata)', async () => {
    for (const role of ['waiter', 'kitchen']) {
      const { router, auth } = mount()
      const res = await router.resolve('GET', '/api/restaurant/reports/daily', { headers: headers(auth, role), query: { date: '2026-09-11' } })
      expect(res.status, role).toBe(403)
    }
  })

  it('hotel_admin y receptionist → 200 con las cifras del criterio y el método real desde payments', async () => {
    for (const role of ['hotel_admin', 'receptionist']) {
      const { router, auth, asked } = mount()
      const res = await router.resolve('GET', '/api/restaurant/reports/daily', { headers: headers(auth, role), query: { date: '2026-09-11' } })
      expect(res.status, role).toBe(200)
      const body: any = res.body
      expect(body.sales.total).toBe(450)
      expect(body.sales.tips).toBe(20)
      expect(body.sales.orders).toBe(3)
      expect(body.sales.averageTicket).toBe(150)
      expect(body.byMethod.cash.amount).toBe(100)
      expect(body.byMethod.card.amount).toBe(200)
      expect(body.byMethod.transfer.amount).toBe(0)
      expect(body.byMethod.folio.amount).toBe(150)
      expect(body.currency).toBe('DOP')
      // Solo se preguntó por los cobros directos del hotel; la comanda de h2 no entró ni al puerto.
      expect(asked.sort()).toEqual(['p-card', 'p-cash'])
    }
  })

  it('fecha inválida → 400; from > to → 400', async () => {
    const { router, auth } = mount()
    const bad = await router.resolve('GET', '/api/restaurant/reports/daily', { headers: headers(auth, 'hotel_admin'), query: { date: 'ayer' } })
    expect(bad.status).toBe(400)
    const inv = await router.resolve('GET', '/api/restaurant/reports/daily', { headers: headers(auth, 'hotel_admin'), query: { from: '2026-09-12', to: '2026-09-11' } })
    expect(inv.status).toBe(400)
  })

  it('sin sesión → 401', async () => {
    const { router } = mount()
    const res = await router.resolve('GET', '/api/restaurant/reports/daily', {})
    expect(res.status).toBe(401)
  })
})
