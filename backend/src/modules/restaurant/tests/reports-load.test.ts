// restaurant/tests/reports-load.test.ts — #213: el cierre de 90 días con 5.000 comandas responde en <1 s.
//
// Contra el ORM REAL (SQLite in-memory, patrón de anuncios/tests/difusion.e2e.test.ts), no contra un
// doble: lo que se mide es la estrategia de consulta — findMany({hotelId,status}) por estado terminal +
// líneas por comanda (índice orderId) — y el agregado en memoria. También prueba que `cancelReason`
// está declarado en el modelo (anti-patrón ORM: un campo no declarado se descarta en silencio).
import { describe, it, expect } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerRestaurantModels, RestaurantOrderModel } from '../model'
import { dailyReport, type ReportsDeps } from '../usecases/reports'
import type { OrderDTO, OrderItemDTO, CurrentUser } from '../types'

const TZ = 'America/Santo_Domingo'
const ORDERS = 5_000
const DAYS = 90
const FROM = '2026-06-14'
const TO = '2026-09-11'
const NOW = new Date('2026-09-11T23:00:00.000Z')

async function seed(): Promise<{ deps: ReportsDeps; close: () => Promise<void>; expected: { total: number; tips: number; sold: number; cancelled: number } }> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false })
  await db.connect()
  const orm = new ORM(db)
  registerRestaurantModels(orm)
  orm.define('Hotels', { table: 'hotels', fields: { id: { type: 'string', required: true }, currency: { type: 'string' }, timezone: { type: 'string' } }, timestamps: true })
  await orm.migrate()
  const orders = new OrmRepository<OrderDTO>(orm, 'RestaurantOrders')
  const lines = new OrmRepository<OrderItemDTO>(orm, 'RestaurantOrderItems')
  const hotels = new OrmRepository<any>(orm, 'Hotels')
  await hotels.create({ id: 'h1', currency: 'DOP', timezone: TZ } as any)
  await hotels.create({ id: 'h2', currency: 'USD', timezone: TZ } as any)

  const methods = ['cash', 'card', 'transfer'] as const
  const paymentMethods: Record<string, string> = {}
  const expected = { total: 0, tips: 0, sold: 0, cancelled: 0 }
  const start = Date.parse(`${FROM}T12:00:00.000-04:00`)
  // Un INSERT por fila dentro de una transacción (es seed de test, no el camino de producción).
  await orm.transaction(async (tx: any) => {
    const txOrders = new OrmRepository<OrderDTO>(tx, 'RestaurantOrders')
    const txLines = new OrmRepository<OrderItemDTO>(tx, 'RestaurantOrderItems')
    for (let i = 0; i < ORDERS; i++) {
      const day = i % DAYS
      const closedAt = new Date(start + day * 86_400_000 + (i % 10) * 3_600_000).toISOString()
      const kind = i % 20 === 0 ? 'cancelled' : i % 7 === 0 ? 'charged' : 'paid'
      const hotelId = i % 50 === 0 ? 'h2' : 'h1'   // 2% de ruido de otro hotel
      const subtotal = 100 + (i % 5) * 10
      const tax = subtotal * 0.18
      const tip = kind === 'paid' && i % 3 === 0 ? 10 : 0
      const method = methods[i % 3]
      const paymentId = kind === 'paid' ? `p-${i}` : undefined
      if (paymentId) paymentMethods[paymentId] = method
      const id = `o-${i}`
      await txOrders.create({
        id, hotelId, number: `CMD-${i}`, type: i % 4 === 0 ? 'room_service' : 'dine_in', status: kind,
        subtotal, tax, tip, total: subtotal + tax + tip, settlement: kind === 'paid' ? 'payment' : kind === 'charged' ? 'folio' : undefined,
        paymentId, closedAt, openedAt: closedAt, covers: 2, cancelReason: kind === 'cancelled' ? 'Cliente se fue' : undefined,
      } as any)
      for (let k = 0; k < 3; k++) {
        await txLines.create({
          id: `${id}-l${k}`, hotelId, orderId: id, menuItemId: `mi-${(i + k) % 40}`, name: `Plato ${(i + k) % 40}`,
          unitPrice: 20, quantity: 1 + (k % 2), taxRate: 18, lineTotal: 20 * (1 + (k % 2)),
          status: kind === 'cancelled' ? 'voided' : 'served', voidReason: kind === 'cancelled' ? 'Cliente se fue' : undefined,
          stationId: k === 2 ? 'st-bar' : 'st-cocina', stationName: k === 2 ? 'Bar' : 'Cocina', kind: 'item',
        } as any)
      }
      if (hotelId === 'h1') {
        if (kind === 'cancelled') expected.cancelled += 1
        else { expected.sold += 1; expected.total += subtotal + tax; expected.tips += tip }
      }
    }
  })

  const deps: ReportsDeps = {
    orders, lines, hotels,
    ports: { paymentMethod: async (id) => paymentMethods[id] ?? null },
  }
  return { deps, close: async () => { await db.close?.() }, expected }
}

describe('cierre de 90 días con 5.000 comandas (ORM real, SQLite in-memory)', () => {
  it('responde en <1 s, cuadra con el seed y no mezcla el hotel vecino', async () => {
    const { deps, close, expected } = await seed()
    try {
      const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
      const t0 = performance.now()
      const r = await dailyReport(deps, { from: FROM, to: TO }, user, NOW)
      const ms = performance.now() - t0
      // eslint-disable-next-line no-console
      console.log(`[#213] cierre 90 días / ${ORDERS} comandas: ${ms.toFixed(0)} ms`)
      expect(ms).toBeLessThan(1_000)
      expect(r.sales.orders).toBe(expected.sold)
      expect(r.voided.orders).toBe(expected.cancelled)
      expect(r.sales.total).toBeCloseTo(expected.total, 2)
      expect(r.sales.tips).toBeCloseTo(expected.tips, 2)
      expect(r.byDay).toHaveLength(DAYS)
      expect(r.byMethod.other.orders).toBe(0)
      expect(r.byMethod.cash.orders + r.byMethod.card.orders + r.byMethod.transfer.orders + r.byMethod.folio.orders).toBe(expected.sold)
      expect(r.topItemsByQuantity).toHaveLength(10)
      expect(r.byStation.map((s) => s.stationName).sort()).toEqual(['Bar', 'Cocina'])
      expect(r.voided.rows.every((v) => v.reason === 'Cliente se fue')).toBe(true)

      // IDOR con el ORM real: el hotel vecino solo ve lo suyo.
      const other = await dailyReport(deps, { from: FROM, to: TO }, { id: 'u2', hotelId: 'h2', role: 'hotel_admin' }, NOW)
      expect(other.sales.orders + other.voided.orders).toBe(ORDERS / 50)
      expect(other.currency).toBe('USD')
    } finally {
      await close()
    }
  }, 30_000)

  it('cancelReason está declarado en el modelo (si no, el ORM lo descarta en silencio)', () => {
    expect(RestaurantOrderModel.fields.cancelReason?.type).toBe('text')
  })
})
