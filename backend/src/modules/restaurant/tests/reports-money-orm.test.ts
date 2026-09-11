// restaurant/tests/reports-money-orm.test.ts — #213 (auditoría): la plata del cierre sale de `payments`.
//
// Recorrido sintético contra el ORM REAL (SQLite in-memory) con los usecases reales de los dos módulos:
//   1. el POS cobra en efectivo (`payOrder`) y confirma un cobro con tarjeta (`settlePaidOrder`) — los
//      payments los crea `PaymentCrudUseCase.create` con `businessDate` en la zona del hotel;
//   2. alguien devuelve el cobro con tarjeta DESDE PAYMENTS (`refundPayment`, lo que hace
//      POST /api/payments/:id/refund) sin tocar la comanda, que sigue `paid`;
//   3. el cierre del día resta esa devolución de "tarjeta" y de la propina, y la lista como reembolso.
// También: `refundOrder` (la vía del POS) no pisa `closedAt`/`businessDate` y guarda `refundedAt`.
import { describe, it, expect } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerRestaurantModels } from '../model'
import { registerPaymentsModels } from '../../payments/model'
import { FolioChargesModel } from '../../folios/model'
import { PaymentCrudUseCase } from '../../payments/usecases/payment-crud'
import { refundPayment } from '../../payments/usecases/refund'
import { payOrder, settlePaidOrder, refundOrder, type SettlementDeps } from '../usecases/settlement'
import { dailyReport, todayIn, type ReportsDeps } from '../usecases/reports'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser } from '../types'
const REASON = { reason: 'cliente insatisfecho' }

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

  const orders = new OrmRepository<OrderDTO>(orm, 'RestaurantOrders')
  const lines = new OrmRepository<OrderItemDTO>(orm, 'RestaurantOrderItems')
  const tables = new OrmRepository<TableDTO>(orm, 'RestaurantTables')
  const hotels = new OrmRepository<any>(orm, 'Hotels')
  const users = new OrmRepository<any>(orm, 'Users')
  const payments = new OrmRepository<any>(orm, 'Payment')
  const folioCharges = new OrmRepository<any>(orm, 'FolioCharges')
  await hotels.create({ id: 'h1', currency: 'DOP', timezone: TZ } as any)
  await users.create({ id: 'u1', hotelId: 'h1' } as any)

  // payments REAL: crud con la zona del hotel (businessDate) + refund con una pasarela doble.
  const crud = new PaymentCrudUseCase(payments, silent, undefined, undefined, undefined, undefined, undefined, undefined, hotels)
  const stripe = { isConfigured: async () => true, refund: async () => ({ id: 're_1' }) } as any
  const refundViaPayments = (paymentId: string, amount?: number) =>
    refundPayment({ crud, stripe, createPayment: (dto) => crud.create(dto) }, paymentId, amount, { id: 'u-caja', role: 'hotel_admin' })

  // Puertos del POS con el MISMO asiento que connectors/restaurante-payments.ts.
  const settlement: SettlementDeps = {
    orders, lines, tables, hotels, userRepo: users, auth, sockets: {},
    ports: {
      recordPayment: async (input) => {
        const p = await crud.create({
          hotelId: input.hotelId, type: 'charge', method: input.method as any, status: 'completed', amount: input.amount,
          currency: input.currency, description: input.description, reference: 'pos:' + input.orderId,
          metadata: { source: 'restaurant', orderId: input.orderId },
        })
        return { paymentId: p.id }
      },
      refundPayment: async ({ paymentId }) => { await refundViaPayments(paymentId) },
    },
  }
  const report: ReportsDeps = {
    orders, lines, hotels,
    ports: {
      paymentsOfDay: (hotelId, businessDate) => crud.ofBusinessDate(hotelId, businessDate),
      folioCharge: async (hotelId, reference) => (await folioCharges.findMany({ hotelId, reference } as any))[0] ?? null,
    },
  }

  const newOrder = (id: string, patch: Partial<OrderDTO>) => orders.create({
    id, hotelId: 'h1', number: `CMD-${id}`, type: 'dine_in', status: 'billed', subtotal: 0, tax: 0, tip: 0, total: 0, openedAt: new Date().toISOString(), ...patch,
  } as any)
  const addLine = (id: string, orderId: string, name: string, unitPrice: number, quantity: number) => lines.create({
    id, hotelId: 'h1', orderId, menuItemId: `mi-${name}`, name, unitPrice, quantity, taxRate: 0, lineTotal: unitPrice * quantity, status: 'served', kind: 'item',
  } as any)

  return { orders, payments, crud, settlement, report, newOrder, addLine, refundViaPayments, close: () => db.close?.() }
}

describe('cierre del día con ORM real: la plata sale de payments y un refund hecho por payments RESTA', () => {
  it('efectivo 100 + tarjeta 200 (+20 propina) → refund por payments sin tocar la comanda → tarjeta 0, propina 0, reembolsado 220', async () => {
    const s = await setup()
    try {
      const today = todayIn(TZ)
      // 1. Efectivo: payOrder real → payment completed con businessDate de hoy; comanda `paid` con businessDate.
      await s.newOrder('o-cash', { covers: 2, subtotal: 100, tax: 0, total: 100 })   // los totales de la fila son los que cobra payOrder (#214 COR-A)
      await s.addLine('l1', 'o-cash', 'Pizza', 50, 2)
      const cash = await payOrder(s.settlement, 'o-cash', { method: 'cash' }, user)
      expect(cash.status).toBe('paid')
      expect(cash.businessDate).toBe(today)
      expect(cash.closedAt).toBeTruthy()

      // 2. Tarjeta: el Checkout ya confirmó (payment completed con cargo de Stripe) → settlePaidOrder real.
      const cardPayment = await s.crud.create({
        hotelId: 'h1', type: 'charge', method: 'card', status: 'completed', amount: 220, currency: 'DOP',
        reference: 'pos:o-card', stripePaymentId: 'pi_1', metadata: { source: 'restaurant', orderId: 'o-card' },
      })
      expect(cardPayment.businessDate).toBe(today)
      await s.newOrder('o-card', { status: 'processing_payment', subtotal: 200, tax: 0, tip: 20, total: 220, paymentId: cardPayment.id, covers: 3 })
      await s.addLine('l2', 'o-card', 'Vino', 50, 4)
      const card = await settlePaidOrder(s.settlement, 'o-card', cardPayment.id, user)
      expect(card.status).toBe('paid')
      expect(card.businessDate).toBe(today)

      const before = await dailyReport(s.report, { date: today }, user)
      expect(before.byMethod.cash).toEqual({ amount: 100, orders: 1 })
      expect(before.byMethod.card).toEqual({ amount: 200, orders: 1 })
      expect(before.sales.tips).toBe(20)
      expect(before.sales.total).toBe(300)
      expect(before.sales.collected).toBe(320)
      expect(before.refunded).toEqual({ orders: 0, amount: 0 })

      // 3. Devolución DESDE PAYMENTS (POST /api/payments/:id/refund): la comanda no se entera.
      const refundDoc = await s.refundViaPayments(cardPayment.id)
      expect(refundDoc.type).toBe('refund')
      expect(refundDoc.status).toBe('completed')
      expect(refundDoc.businessDate).toBe(today)
      expect(refundDoc.metadata).toMatchObject({ source: 'restaurant', orderId: 'o-card', refundOf: cardPayment.id })
      expect((await s.orders.findById('o-card'))!.status).toBe('paid')   // sin tocar
      expect((await s.payments.findById(cardPayment.id)).status).toBe('refunded')

      const after = await dailyReport(s.report, { date: today }, user)
      expect(after.byMethod.cash).toEqual({ amount: 100, orders: 1 })
      expect(after.byMethod.card).toEqual({ amount: 0, orders: 1 })   // 200 − 200
      expect(after.sales.tips).toBe(0)                                  // 20 − 20
      expect(after.sales.total).toBe(100)
      expect(after.sales.subtotal + after.sales.tax).toBe(after.sales.total)
      expect(after.sales.collected).toBe(100)
      expect(after.sales.orders).toBe(2)                                // la comanda vendida sigue contando
      expect(after.refunded).toEqual({ orders: 1, amount: 220 })
      expect(after.voided.rows.filter((r) => r.kind === 'refund')).toHaveLength(1)
      expect(after.voided.rows[0]).toMatchObject({ kind: 'refund', orderNumber: 'CMD-o-card', amount: 220, by: 'u-caja' })
      expect(after.byDay).toEqual([{ date: today, orders: 2, amount: 100, tips: 0 }])
      // El top de ítems sigue saliendo de las comandas.
      expect(after.topItemsByQuantity.map((i) => i.name)).toEqual(['Vino', 'Pizza'])
    } finally {
      await s.close()
    }
  })

  it('refundOrder (vía del POS) no pisa closedAt/businessDate: guarda refundedAt y la venta queda en su día', async () => {
    const s = await setup()
    try {
      const cardPayment = await s.crud.create({
        hotelId: 'h1', type: 'charge', method: 'card', status: 'completed', amount: 220, currency: 'DOP',
        reference: 'pos:o-card', stripePaymentId: 'pi_1', metadata: { source: 'restaurant', orderId: 'o-card' },
      })
      // Vendida AYER (según la comanda y el payment); se devuelve HOY.
      const yesterday = new Date(Date.now() - 86_400_000)
      const yDate = todayIn(TZ, yesterday)
      await s.newOrder('o-card', { status: 'paid', settlement: 'payment', subtotal: 200, tax: 0, tip: 20, total: 220, paymentId: cardPayment.id, closedAt: yesterday.toISOString(), businessDate: yDate })
      await s.payments.update(cardPayment.id, { businessDate: yDate, processedAt: yesterday.toISOString() } as any)

      const refunded = await refundOrder(s.settlement, 'o-card', REASON, user)
      expect(refunded.status).toBe('refunded')
      expect(refunded.closedAt).toBe(yesterday.toISOString())
      expect(refunded.businessDate).toBe(yDate)
      expect(refunded.refundedAt).toBeTruthy()
      expect(Date.parse(refunded.refundedAt as string)).toBeGreaterThan(yesterday.getTime())

      const today = todayIn(TZ)
      const saleDay = await dailyReport(s.report, { date: yDate }, user)
      expect(saleDay.byMethod.card).toEqual({ amount: 200, orders: 1 })
      expect(saleDay.sales.tips).toBe(20)
      expect(saleDay.refunded).toEqual({ orders: 0, amount: 0 })

      const refundDay = await dailyReport(s.report, { date: today }, user)
      expect(refundDay.sales.orders).toBe(0)
      expect(refundDay.byMethod.card).toEqual({ amount: -200, orders: 0 })
      expect(refundDay.refunded).toEqual({ orders: 1, amount: 220 })
      expect(refundDay.empty).toBe(false)

      const range = await dailyReport(s.report, { from: yDate, to: today }, user)
      expect(range.byMethod.card).toEqual({ amount: 0, orders: 1 })
      expect(range.sales.tips).toBe(0)
      expect(range.refunded).toEqual({ orders: 1, amount: 220 })
    } finally {
      await s.close()
    }
  })
})
