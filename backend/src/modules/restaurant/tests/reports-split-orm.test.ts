// restaurant/tests/reports-split-orm.test.ts — #282 (H1): el cierre del día con una cuenta DIVIDIDA (#214).
//
// Antes, `saleFromPayment` trataba cada parte como el pago completo de la comanda: impuesto 0 (`net −
// min(net, subtotal)`), sólo la primera parte entraba en `salesByOrder` y el resto iba a "huérfanos"
// (fuera de byType/byHour). Recorrido sintético contra el ORM REAL (SQLite in-memory) con los usecases
// reales: `addOrderPayment` crea las partes y los payments (uno por parte, `metadata.orderPaymentId`)
// vía `PaymentCrudUseCase`; `dailyReport` los agrupa por comanda.
import { describe, it, expect } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerRestaurantModels, RESTAURANT_ORDER_PAYMENTS_SEQ_INDEX_SQL } from '../model'
import { registerPaymentsModels } from '../../payments/model'
import { FolioChargesModel } from '../../folios/model'
import { PaymentCrudUseCase } from '../../payments/usecases/payment-crud'
import { refundDirectPayment } from '../../payments/usecases/refund-direct'
import { addOrderPayment, refundOrderPayment, type SplitPaymentsDeps } from '../usecases/split-payments'
import { dailyReport, todayIn, type ReportsDeps } from '../usecases/reports'
import type { OrderDTO, OrderItemDTO, OrderPaymentDTO, TableDTO, CurrentUser } from '../types'

const TZ = 'America/Santo_Domingo'
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent } } as any
const auth = {
  assertOwnership(resourceHotel: string, userHotel: string, role: string, superRole: string) {
    if (resourceHotel !== userHotel && role !== superRole) throw new Error('IDOR')
  },
} as any

async function setup() {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false })
  await db.connect()
  const orm = new ORM(db)
  registerRestaurantModels(orm)
  registerPaymentsModels(orm)
  orm.define('FolioCharges', FolioChargesModel)
  orm.define('Hotels', { table: 'hotels', fields: { id: { type: 'string', required: true }, currency: { type: 'string' }, timezone: { type: 'string' } }, timestamps: true })
  orm.define('Users', { table: 'users', fields: { id: { type: 'string', required: true }, hotelId: { type: 'string' } }, timestamps: true })
  await orm.migrate()
  await db.run(RESTAURANT_ORDER_PAYMENTS_SEQ_INDEX_SQL)

  const orders = new OrmRepository<OrderDTO>(orm, 'RestaurantOrders')
  const lines = new OrmRepository<OrderItemDTO>(orm, 'RestaurantOrderItems')
  const parts = new OrmRepository<OrderPaymentDTO>(orm, 'RestaurantOrderPayments')
  const tables = new OrmRepository<TableDTO>(orm, 'RestaurantTables')
  const hotels = new OrmRepository<any>(orm, 'Hotels')
  const users = new OrmRepository<any>(orm, 'Users')
  const payments = new OrmRepository<any>(orm, 'Payment')
  const folioCharges = new OrmRepository<any>(orm, 'FolioCharges')
  await hotels.create({ id: 'h1', currency: 'DOP', timezone: TZ } as any)
  await users.create({ id: 'u1', hotelId: 'h1' } as any)

  const crud = new PaymentCrudUseCase(payments, silent, undefined, undefined, undefined, undefined, undefined, undefined, hotels)
  // Efectivo/transferencia se devuelven sin pasarela (`payments.refundPaymentByMethod` → refund-direct.ts).
  const refundViaPayments = (paymentId: string) =>
    refundDirectPayment({ crud, createPayment: (dto) => crud.create(dto) }, paymentId, { id: 'u-caja', role: 'hotel_admin' })

  // Puertos con el MISMO asiento que connectors/restaurante-payments.ts (referencia y metadata por parte).
  const split: SplitPaymentsDeps = {
    orders, lines, tables, hotels, userRepo: users, auth, sockets: {}, orderPayments: parts, cas: orm,
    ports: {
      recordPayment: async (input) => {
        const p = await crud.create({
          hotelId: input.hotelId, type: 'charge', method: input.method as any, status: 'completed', amount: input.amount,
          currency: input.currency, description: input.description, reference: input.reference ?? 'pos:' + input.orderId,
          metadata: { source: 'restaurant', orderId: input.orderId, ...(input.metadata ?? {}) },
        })
        return { paymentId: p.id }
      },
      refundPayment: async ({ paymentId }) => { await refundViaPayments(paymentId) },
      findPaymentByReference: async ({ hotelId, reference }) => {
        const row = (await payments.findMany({ hotelId, reference } as any))[0]
        return row ? { paymentId: row.id, status: row.status, method: row.method } : null
      },
    },
  }
  const report: ReportsDeps = {
    orders, lines, hotels, orderPayments: parts,
    ports: {
      paymentsOfDay: (hotelId, businessDate) => crud.ofBusinessDate(hotelId, businessDate),
      folioCharge: async (hotelId, reference) => (await folioCharges.findMany({ hotelId, reference } as any))[0] ?? null,
    },
  }
  return { orders, parts, payments, split, report, close: () => db.close?.() }
}

/** Comanda de 46.02: 39 neto + 18 % (7.02), lista para cobrar. */
async function billedOrder(s: Awaited<ReturnType<typeof setup>>, id: string) {
  await s.orders.create({
    id, hotelId: 'h1', number: `CMD-${id}`, type: 'dine_in', status: 'billed', covers: 2,
    subtotal: 39, tax: 7.02, tip: 0, total: 46.02, amountPaid: 0, amountReserved: 0, openedAt: new Date().toISOString(),
  } as any)
}

describe('cierre del día con una cuenta dividida (#282): la comanda aporta sus totales UNA vez, las partes reparten por método', () => {
  it('46.02 en 2 partes (efectivo + transferencia) → subtotal 39, tax 7.02, cash 23.01 / transfer 23.01, dine_in 46.02 una vez', async () => {
    const s = await setup()
    try {
      const today = todayIn(TZ)
      await billedOrder(s, 'o-split')
      const first = await addOrderPayment(s.split, 'o-split', { method: 'cash', amount: 23.01 }, user)
      expect(first.part.status).toBe('completed')
      expect(first.order.status).toBe('billed')
      const second = await addOrderPayment(s.split, 'o-split', { method: 'transfer', amount: 23.01 }, user)
      expect(second.order.status).toBe('paid')
      expect(second.order.businessDate).toBe(today)
      expect(second.balance.outstanding).toBe(0)
      const rows = await s.payments.findMany({ hotelId: 'h1' })
      expect(rows).toHaveLength(2)
      expect(rows.map((p: any) => p.metadata?.orderPaymentId).filter(Boolean)).toHaveLength(2)

      const r = await dailyReport(s.report, { date: today }, user)
      expect(r.sales.orders).toBe(1)
      expect(r.sales.subtotal).toBe(39)
      expect(r.sales.tax).toBe(7.02)
      expect(r.sales.total).toBe(46.02)
      expect(r.sales.tips).toBe(0)
      expect(r.sales.collected).toBe(46.02)
      expect(r.sales.averageTicket).toBe(46.02)
      expect(r.byMethod.cash).toEqual({ amount: 23.01, orders: 1 })
      expect(r.byMethod.transfer).toEqual({ amount: 23.01, orders: 1 })
      expect(r.byMethod.other).toEqual({ amount: 0, orders: 0 })
      expect(r.byType.dine_in).toEqual({ amount: 46.02, orders: 1 })   // una sola vez, no 23.01 ni 92.04
      expect(r.byHour.reduce((sum, h) => sum + h.amount, 0)).toBe(46.02)
      expect(r.byDay).toEqual([{ date: today, orders: 1, amount: 46.02, tips: 0 }])
      expect(r.refunded).toEqual({ orders: 0, amount: 0 })
      expect(r.voided.rows).toHaveLength(0)
      expect(r.empty).toBe(false)
    } finally {
      await s.close()
    }
  })

  it('propina por parte: 23.01 + 2 en efectivo y 23.01 por transferencia → tips 2, cash 23.01 (sin la propina), transfer 23.01', async () => {
    const s = await setup()
    try {
      const today = todayIn(TZ)
      await billedOrder(s, 'o-tip')
      await addOrderPayment(s.split, 'o-tip', { method: 'cash', amount: 23.01, tip: 2 }, user)
      const done = await addOrderPayment(s.split, 'o-tip', { method: 'transfer', amount: 23.01 }, user)
      expect(done.order.status).toBe('paid')
      expect(done.order.tip).toBe(2)

      const r = await dailyReport(s.report, { date: today }, user)
      expect(r.sales.subtotal).toBe(39)
      expect(r.sales.tax).toBe(7.02)
      expect(r.sales.tips).toBe(2)
      expect(r.sales.collected).toBe(48.02)
      expect(r.byMethod.cash).toEqual({ amount: 23.01, orders: 1 })
      expect(r.byMethod.transfer).toEqual({ amount: 23.01, orders: 1 })
      expect(r.byDay).toEqual([{ date: today, orders: 1, amount: 46.02, tips: 2 }])
    } finally {
      await s.close()
    }
  })

  it('devolver una parte tras liquidar resta de SU método y de la propina de esa parte', async () => {
    const s = await setup()
    try {
      const today = todayIn(TZ)
      await billedOrder(s, 'o-ref')
      const cashPart = await addOrderPayment(s.split, 'o-ref', { method: 'cash', amount: 23.01, tip: 2 }, user)
      await addOrderPayment(s.split, 'o-ref', { method: 'transfer', amount: 23.01 }, user)
      const refunded = await refundOrderPayment(s.split, 'o-ref', cashPart.part.id, { reason: 'plato frío' }, user)
      expect(refunded.status).toBe('refunded')
      expect((await s.orders.findById('o-ref'))!.status).toBe('partially_refunded')   // sigue siendo una venta del día

      const r = await dailyReport(s.report, { date: today }, user)
      expect(r.byMethod.cash.amount).toBe(0)                 // 23.01 − 23.01
      expect(r.byMethod.transfer).toEqual({ amount: 23.01, orders: 1 })
      expect(r.sales.tips).toBe(0)                           // 2 − 2
      expect(r.sales.total).toBe(23.01)
      expect(r.sales.subtotal + r.sales.tax).toBeCloseTo(r.sales.total, 2)
      expect(r.sales.orders).toBe(1)
      expect(r.refunded).toEqual({ orders: 1, amount: 25.01 })
      expect(r.voided.rows.filter((v) => v.kind === 'refund')).toHaveLength(1)
    } finally {
      await s.close()
    }
  })
})
