// restaurant/tests/split-payments.test.ts — #214 (REST-12): dividir cuenta / pagos parciales.
//
// ORM REAL sobre SQLite in-memory (mismo harness que integrity-delete-item / order-number-dedupe): las
// partes, la comanda y sus líneas viven en la base, con el MISMO `CREATE UNIQUE INDEX (orderId, seq)`
// que migrate-db.ts. Los puertos de dinero (payments/folios) son dobles que REGISTRAN qué recibieron
// — lo que importa es qué referencia, monto y método salió hacia `payments`, no un mock que diga OK.
//
//   - partes iguales con centavo: 100 / 3 → 33.33 / 33.33 / 33.34, suma exacta
//   - por líneas: cada línea en UNA parte, la última absorbe el redondeo, nada queda afuera
//   - efectivo 40 + tarjeta 60 sobre 100: saldo 60 y `billed` en el medio, `paid` al final, dos payments
//     con `pos:<orderId>:1` / `pos:<orderId>:2`, inventario (onOrderPaid) UNA sola vez
//   - sobrepago: 70 sobre saldo 60 → 400 y NADA llega a payments
//   - idempotencia: reintento de la misma parte no crea otra referencia; el UNIQUE (orderId, seq) frena dos
//     partes concurrentes con el mismo n
//   - mezcla: 50 a la habitación (folio recibe el NETO de 50) + 50 efectivo → settlement 'split'
//   - refund parcial: solo esa parte vuelve, `partially_refunded`, sin onOrderRefunded; todas → `refunded`
//   - con una parte cobrada: payOrder/chargeToRoom (cobro entero), cancelar y tocar líneas dan 409
//   - con un Checkout de tarjeta abierto por UNA parte (`amountReserved > 0`): lo mismo — cobrar entero,
//     cancelar y tocar líneas dan 409, y el webhook que confirma después NO encuentra una comanda ajena
//   - dos partes CONCURRENTES (Promise.all) de 100 sobre saldo 100: entra UNA, la otra 400, un solo payment
//   - el webhook sobre una comanda ya cerrada por otro camino no repite mesa/socket; sobre una cancelada
//     devuelve el cobro solo (refund automático + auditoría)
//   - Checkout abierto y la parte no se pudo anotar: NO se borra (la sesión de Stripe sigue viva)
import { describe, it, expect } from 'bun:test'
import { ORM, OrmRepository, ConflictError, ValidationError } from 'arckode-framework'
import type { Auth, RepositoryAdapter } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerRestaurantModels, RESTAURANT_ORDER_PAYMENTS_SEQ_INDEX_SQL } from '../model'
import {
  addOrderPayment, listOrderPayments, splitPreview, splitEqual, amountForLines, refundOrderPayment,
  settleOrderPayment, expireOrderPayment, type SplitPaymentsDeps,
} from '../usecases/split-payments'
import { payOrder, chargeToRoom } from '../usecases/settlement'
import { cancelOrder, type OrdersDeps } from '../usecases/orders'
import { addLine, type OrderLinesDeps } from '../usecases/order-lines'
import { round2 } from '../../../shared/utils/money'
import { computeOrderTotals } from '../usecases/order-totals'
import type { OrderDTO, OrderItemDTO, OrderPaymentDTO, TableDTO, CurrentUser } from '../types'
import type { ReservationPort } from '../usecases/reservation-port'
const REASON = { reason: 'cobrado por error' }
/** Sin descuentos (#215): el bruto de cada línea es su neto + impuesto congelado. */
const NO_DISCOUNT = { tip: 0 }

const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const sys: CurrentUser = { id: 'system', role: 'super_admin' }
const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
const userRepo = { findById: async () => ({ id: 'u1', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>
const hotels = { findOne: async () => ({ id: 'h1', currency: 'DOP' }), findById: async () => ({ id: 'h1', currency: 'DOP' }) } as unknown as RepositoryAdapter<any>
const reservations: ReservationPort = {
  findById: async (id) => (id === 'r1' ? { id, hotelId: 'h1', guestId: 'g1', roomId: 'room-1', status: 'checked_in' } : null),
}
interface Money { payments: any[]; charges: any[]; refunds: string[]; cards: any[] }
interface Harness {
  deps: SplitPaymentsDeps
  orders: OrmRepository<OrderDTO>
  lines: OrmRepository<OrderItemDTO>
  parts: OrmRepository<OrderPaymentDTO>
  tables: OrmRepository<TableDTO>
  money: Money
  events: string[]
  audits: string[]
  db: SqliteAdapter
}

async function withOrm(fn: (h: Harness) => Promise<void>, opts: { ports?: Partial<SplitPaymentsDeps['ports']> } = {}): Promise<void> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false })
  await db.connect()
  const orm = new ORM(db)
  registerRestaurantModels(orm)
  await orm.migrate()
  // El MISMO índice que crea migrate-db.ts (importado, no copiado): es el que arbitra la carrera por `seq`.
  await db.run(RESTAURANT_ORDER_PAYMENTS_SEQ_INDEX_SQL)
  const orders = new OrmRepository<OrderDTO>(orm, 'RestaurantOrders')
  const lines = new OrmRepository<OrderItemDTO>(orm, 'RestaurantOrderItems')
  const parts = new OrmRepository<OrderPaymentDTO>(orm, 'RestaurantOrderPayments')
  const tables = new OrmRepository<TableDTO>(orm, 'RestaurantTables')
  const money: Money = { payments: [], charges: [], refunds: [], cards: [] }
  const events: string[] = []
  const audits: string[] = []
  const deps: SplitPaymentsDeps = {
    orders, lines, tables, hotels, userRepo, auth: strictAuth, orderPayments: parts, reservations,
    // El UPDATE condicional real del ORM (mismo `counterCas` que cablea index.ts): es lo que se prueba en la carrera.
    cas: orm,
    audit: { record: async (entry) => { audits.push(entry.action) } },
    sockets: {
      onOrderPaid: async () => { events.push('paid') },
      onOrderCharged: async () => { events.push('charged') },
      onOrderRefunded: async () => { events.push('refunded') },
    },
    ports: {
      // Espejo del conector: la referencia por parte se usa tal cual y un reintento devuelve el mismo payment.
      recordPayment: async (input) => {
        const existing = money.payments.find((p) => p.reference === input.reference)
        if (existing) return { paymentId: existing.id }
        const row = { id: `pay-${money.payments.length + 1}`, ...input }
        money.payments.push(row)
        return { paymentId: row.id }
      },
      chargeToFolio: async (input) => { money.charges.push(input); return { folioId: 'folio-1' } },
      chargeCardPayment: async (input) => { const row = { id: `card-${money.cards.length + 1}`, ...input }; money.cards.push(row); return { paymentId: row.id, checkoutUrl: 'https://checkout.stripe.test/' + row.id } },
      refundPayment: async ({ paymentId }) => { money.refunds.push(paymentId) },
      ...opts.ports,
    },
  }
  try {
    await fn({ deps, orders, lines, parts, tables, money, events, audits, db })
  } finally {
    await db.close?.()
  }
}

/** Comanda `sent` en la mesa t1 con líneas [neto, tasa%]. Devuelve la comanda persistida. */
async function seedOrder(h: Harness, items: Array<[number, number, string?]>, extra: Partial<OrderDTO> = {}): Promise<OrderDTO> {
  await h.tables.create({ hotelId: 'h1', name: '3', status: 'occupied' } as any).catch(() => null)
  const table = (await h.tables.findMany({ hotelId: 'h1' } as any))[0]
  // Totales como los deja el server tras cada cambio de línea (recomputeTotals): neto + impuesto por tasa congelada.
  const subtotal = round2(items.reduce((s, [net]) => s + net, 0))
  const tax = round2(items.reduce((s, [net, rate]) => s + (net * rate) / 100, 0))
  const order = await h.orders.create({ hotelId: 'h1', type: 'dine_in', status: 'sent', number: 'CMD-1', tableId: table?.id, tip: 0, subtotal, tax, total: round2(subtotal + tax), amountPaid: 0, amountReserved: 0, ...extra } as any)
  for (const [net, rate, name] of items) {
    await h.lines.create({ hotelId: 'h1', orderId: order.id, name: name ?? `Plato ${net}`, unitPrice: net, quantity: 1, lineTotal: net, taxRate: rate, status: 'new', kind: 'item' } as any)
  }
  return order as OrderDTO
}

// ─── Puro ─────────────────────────────────────────────────────────────────────
describe('#214 — splitEqual: partes iguales con centavo', () => {
  it('100 en 3 → 33.33 / 33.33 / 33.34 y la suma es exactamente 100', () => {
    const parts = splitEqual(100, 3)
    expect(parts).toEqual([33.33, 33.33, 33.34])
    expect(round2(parts.reduce((a, b) => a + b, 0))).toBe(100)
  })
  it('el resto de centavos SIEMPRE va a la última parte (10 en 4 → 2.5 ×4; 0.05 en 2 → 0.02 / 0.03)', () => {
    expect(splitEqual(10, 4)).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(splitEqual(0.05, 2)).toEqual([0.02, 0.03])
    expect(splitEqual(118, 7).reduce((a, b) => a + b, 0)).toBeCloseTo(118, 2)
  })
  it('partes fuera de rango → 400', () => {
    expect(() => splitEqual(100, 0)).toThrow(ValidationError)
    expect(() => splitEqual(100, 1.5)).toThrow(ValidationError)
    expect(() => splitEqual(100, 51)).toThrow(ValidationError)
  })
})

describe('#214 — amountForLines: por líneas, sin duplicar ni dejar afuera', () => {
  const lines = [
    { id: 'a', name: 'A', lineTotal: 33.33, taxRate: 18, status: 'new', kind: 'item' },
    { id: 'b', name: 'B', lineTotal: 33.33, taxRate: 18, status: 'new', kind: 'item' },
    { id: 'c', name: 'C', lineTotal: 33.34, taxRate: 18, status: 'new', kind: 'item' },
    { id: 'v', name: 'Anulada', lineTotal: 50, taxRate: 18, status: 'voided', kind: 'item' },
    { id: 'comp', name: 'Componente', lineTotal: 0, taxRate: 18, status: 'new', kind: 'combo_component', parentLineId: 'a' },
  ] as unknown as OrderItemDTO[]
  const outstanding = 118   // 100 neto + 18 impuesto

  it('una selección parcial vale el bruto de sus líneas; la que completa la cuenta vale el saldo exacto', () => {
    const first = amountForLines(NO_DISCOUNT, lines, [], ['a'], outstanding)
    expect(first).toBe(39.33)   // 33.33 × 1.18 = 39.3294 → 39.33
    const p1 = { lineIds: ['a'], status: 'completed' } as unknown as OrderPaymentDTO
    const second = amountForLines(NO_DISCOUNT, lines, [p1], ['b'], round2(outstanding - first))
    expect(second).toBe(39.33)
    const p2 = { lineIds: ['b'], status: 'completed' } as unknown as OrderPaymentDTO
    const last = amountForLines(NO_DISCOUNT, lines, [p1, p2], ['c'], round2(outstanding - first - second))
    expect(last).toBe(39.34)   // absorbe el centavo: 33.34 × 1.18 = 39.3412, pero el saldo es 39.34
    expect(round2(first + second + last)).toBe(118)
  })
  it('una línea ya en otra parte → 409; una anulada → 409 (COR-A: conflicto con el estado, no pedido mal armado); un componente de combo, una inexistente o vacío → 400', () => {
    const p1 = { lineIds: ['a'], status: 'completed' } as unknown as OrderPaymentDTO
    expect(() => amountForLines(NO_DISCOUNT, lines, [p1], ['a', 'b'], 118)).toThrow(ConflictError)
    expect(() => amountForLines(NO_DISCOUNT, lines, [], ['v'], 118)).toThrow(ConflictError)
    expect(() => amountForLines(NO_DISCOUNT, lines, [], ['comp'], 118)).toThrow(ValidationError)
    expect(() => amountForLines(NO_DISCOUNT, lines, [], ['nope'], 118)).toThrow(ValidationError)
    expect(() => amountForLines(NO_DISCOUNT, lines, [], [], 118)).toThrow(ValidationError)
  })
  it('#215: el bruto de una línea respeta su descuento y el de la comanda (prorrateado), y la suma de todas sigue siendo el saldo', () => {
    // A con cortesía (100 %), B con 50 %, C sin descuento; descuento de comanda 10 % sobre la base descontada.
    // `discountAmount` de cada línea es el que recomputeTotals persiste (computeOrderTotals); el saldo sale de ahí.
    const raw = [
      { id: 'a', name: 'A', lineTotal: 33.33, discountType: 'percent', discountValue: 100, taxRate: 18, status: 'new', kind: 'item' },
      { id: 'b', name: 'B', lineTotal: 33.33, discountType: 'percent', discountValue: 50, taxRate: 18, status: 'new', kind: 'item' },
      { id: 'c', name: 'C', lineTotal: 33.34, taxRate: 18, status: 'new', kind: 'item' },
    ] as unknown as OrderItemDTO[]
    const order = { tip: 0, discountType: 'percent' as const, discountValue: 10 }
    const totals = computeOrderTotals(raw, order)
    const discounted = raw.map((l) => ({ ...l, discountAmount: totals.lineDiscounts.get(l.id) ?? 0 })) as OrderItemDTO[]
    const due = round2(totals.subtotal + totals.tax)
    expect(due).toBe(53.1)                                                    // base 50 − 10 % = 45 neto + 8.1 impuesto
    expect(amountForLines(order, discounted, [], ['a'], due)).toBe(0)        // la cortesía no cobra nada
    const b = amountForLines(order, discounted, [], ['b'], due)
    expect(b).toBe(17.69)                                                     // 16.66 × 0.9 × 1.18
    const c = amountForLines(order, discounted, [{ lineIds: ['b'], status: 'completed' } as unknown as OrderPaymentDTO], ['c'], round2(due - b))
    expect(c).toBe(35.41)                                                     // absorbe el redondeo: el saldo exacto
    expect(round2(b + c)).toBe(due)
    // Sin descuento de comanda, el factor es 1: la línea B vale su neto descontado + impuesto.
    expect(amountForLines(NO_DISCOUNT, discounted, [], ['b'], 59)).toBe(19.66)
  })
  it('una parte `reversed` (devuelta con la comanda abierta, COR-C) libera sus líneas', () => {
    const reversed = { lineIds: ['a'], status: 'reversed' } as unknown as OrderPaymentDTO
    expect(amountForLines(NO_DISCOUNT, lines, [reversed], ['a'], 118)).toBe(39.33)
  })
  it('una parte EXPIRADA libera sus líneas', () => {
    const expired = { lineIds: ['a'], status: 'expired' } as unknown as OrderPaymentDTO
    expect(amountForLines(NO_DISCOUNT, lines, [expired], ['a'], 118)).toBe(39.33)
  })
})

// ─── Con ORM real ─────────────────────────────────────────────────────────────
describe('#214 — addOrderPayment: efectivo 40 + tarjeta 60 sobre 100', () => {
  it('saldo 60 y `billed` en el medio; `paid` al final con dos payments `pos:<id>:1` y `pos:<id>:2`; inventario UNA vez', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const r1 = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)
      expect(r1.part.status).toBe('completed')
      expect(r1.part.seq).toBe(1)
      expect(r1.balance).toEqual({ due: 100, paid: 40, pending: 0, outstanding: 60, tips: 0 })
      expect(r1.order.status).toBe('sent')   // el estado de cocina no cambia: la cuenta sigue abierta
      expect(Number(r1.order.amountPaid)).toBe(40)
      expect(h.events).toEqual([])           // nada se descontó todavía

      // Tarjeta por el saldo: Checkout de Stripe por 60, parte `pending`, saldo reservado.
      const r2 = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 60, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      expect(r2.checkoutUrl).toContain('checkout.stripe.test')
      expect(r2.part.status).toBe('pending')
      expect(r2.balance.pending).toBe(60)
      expect(h.money.cards[0].reference).toBe(`pos:${order.id}:2`)
      expect(h.money.cards[0].metadata.orderPaymentId).toBe(r2.part.id)
      // Con el Checkout abierto no se puede meter otra parte por ese saldo (400, nada en payments).
      await expect(addOrderPayment(h.deps, order.id, { method: 'cash', amount: 1 }, user)).rejects.toThrow(ValidationError)
      expect(h.money.payments).toHaveLength(1)

      // Webhook: Stripe confirmó → parte completed, comanda paid, mesa libre, UN onOrderPaid.
      await settleOrderPayment(h.deps, r2.part.id, 'card-1', sys)
      const final = (await h.orders.findById(order.id)) as OrderDTO
      expect(final.status).toBe('paid')
      expect(final.settlement).toBe('payment')
      expect(Number(final.amountPaid)).toBe(100)
      expect(final.closedAt).toBeTruthy()
      expect((await h.tables.findById(order.tableId!))?.status).toBe('free')
      expect(h.events).toEqual(['paid'])
      expect(h.money.payments.map((p) => p.reference)).toEqual([`pos:${order.id}:1`])
      expect(h.money.payments[0].amount).toBe(40)
      expect(h.money.payments[0].method).toBe('cash')
      const listed = await listOrderPayments(h.deps, order.id, user)
      expect(listed.parts.map((p) => [p.seq, p.method, p.amount, p.status])).toEqual([[1, 'cash', 40, 'completed'], [2, 'card', 60, 'completed']])
      expect(listed.balance.outstanding).toBe(0)
      // Reintento del webhook: idempotente, no repite el socket.
      await settleOrderPayment(h.deps, r2.part.id, 'card-1', sys)
      expect(h.events).toEqual(['paid'])
    })
  })

  it('Checkout expirado: la parte queda `expired`, libera el saldo y su `seq` no se reutiliza', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const r = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 100, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      await expireOrderPayment(h.deps, r.part.id, sys)
      expect((await listOrderPayments(h.deps, order.id, user)).balance).toEqual({ due: 100, paid: 0, pending: 0, outstanding: 100, tips: 0 })
      const again = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 100 }, user)
      expect(again.part.seq).toBe(2)
      expect(h.money.payments[0].reference).toBe(`pos:${order.id}:2`)
      expect(again.order.status).toBe('paid')
    })
  })

  it('la propina va POR PARTE: payment = monto + propina, la comanda acumula `tip` y el saldo no la incluye', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 18]])   // due 118
      const r1 = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 59, tip: 10 }, user)
      expect(h.money.payments[0].amount).toBe(69)
      expect(r1.balance).toEqual({ due: 118, paid: 59, pending: 0, outstanding: 59, tips: 10 })
      expect(Number(r1.order.tip)).toBe(10)
      expect(Number(r1.order.total)).toBe(128)
      const r2 = await addOrderPayment(h.deps, order.id, { method: 'transfer', amount: 59, tip: 5 }, user)
      expect(r2.order.status).toBe('paid')
      expect(Number(r2.order.tip)).toBe(15)
      expect(Number(r2.order.total)).toBe(133)
    })
  })
})

describe('#214 — sobrepago', () => {
  it('70 sobre saldo 60 → 400 "supera el saldo" y NADA llega a payments ni queda una parte', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)
      let err: unknown
      try { await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 70 }, user) } catch (e) { err = e }
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).httpStatus).toBe(400)
      expect((err as Error).message).toContain('supera el saldo')
      expect(h.money.payments).toHaveLength(1)
      expect(await h.parts.findMany({ orderId: order.id } as any)).toHaveLength(1)
      // Un centavo de más también; el saldo exacto pasa.
      await expect(addOrderPayment(h.deps, order.id, { method: 'cash', amount: 60.02 }, user)).rejects.toThrow('supera el saldo')
      const ok = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 60 }, user)
      expect(ok.order.status).toBe('paid')
    })
  })
  it('monto ≤ 0, método inválido, propina negativa → 400', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      await expect(addOrderPayment(h.deps, order.id, { method: 'cash', amount: 0 }, user)).rejects.toThrow(ValidationError)
      await expect(addOrderPayment(h.deps, order.id, { method: 'cheque' as any, amount: 10 }, user)).rejects.toThrow(ValidationError)
      await expect(addOrderPayment(h.deps, order.id, { method: 'cash', amount: 10, tip: -1 }, user)).rejects.toThrow(ValidationError)
      expect(h.money.payments).toHaveLength(0)
    })
  })
})

describe('#214 — idempotencia por referencia y carrera por `seq`', () => {
  it('si el payment se registró pero la parte no se pudo cerrar, el reintento pide la MISMA referencia y payments no duplica', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      // 1ª llamada: payments responde pero "se cae" la actualización de la parte → la parte se borra (rollback local).
      const original = h.parts.update.bind(h.parts)
      let boom = true
      h.parts.update = (async (id: string, d: any) => { if (boom && d.status === 'completed') throw new Error('db down'); return original(id, d) }) as any
      await expect(addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)).rejects.toThrow('db down')
      boom = false
      expect(h.money.payments).toHaveLength(1)   // el dinero YA entró con pos:<id>:1
      // La parte quedó `pending` (sin paymentId): su saldo sigue reservado, y otro pedido DISTINTO se frena (409).
      expect((await listOrderPayments(h.deps, order.id, user)).balance).toEqual({ due: 100, paid: 0, pending: 40, outstanding: 100, tips: 0 })
      expect(Number(((await h.orders.findById(order.id)) as OrderDTO).amountReserved)).toBe(40)
      await expect(addOrderPayment(h.deps, order.id, { method: 'cash', amount: 30 }, user)).rejects.toThrow(ConflictError)
      expect(h.money.payments).toHaveLength(1)
      // Reintento del MISMO pedido: retoma seq 1 → misma referencia → mismo payment, no un segundo cobro.
      const r = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)
      expect(r.part.seq).toBe(1)
      expect(r.part.paymentId).toBe('pay-1')
      expect(r.part.status).toBe('completed')
      expect(h.money.payments).toHaveLength(1)
      expect(r.balance.outstanding).toBe(60)
      expect(Number(r.order.amountReserved)).toBe(0)   // la reserva pasó a cobrado
    })
  })

  it('dos partes que reclaman el mismo `seq` a la vez: el UNIQUE (orderId, seq) frena a la segunda, que toma el siguiente', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      // Simula la carrera: la segunda llamada "vio" 0 partes pero al insertar ya existe seq=1.
      let injected = false
      const originalFindMany = h.parts.findMany.bind(h.parts)
      h.parts.findMany = (async (q: any) => {
        const rows = await originalFindMany(q)
        if (!injected) { injected = true; await h.parts.create({ hotelId: 'h1', orderId: order.id, seq: 1, method: 'cash', amount: 30, tip: 0, status: 'completed', paymentId: 'pay-x' } as any); return rows }
        return rows
      }) as any
      const r = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 30 }, user)
      expect(r.part.seq).toBe(2)
      expect(h.money.payments[0].reference).toBe(`pos:${order.id}:2`)
      const seqs = (await originalFindMany({ orderId: order.id } as any)).map((p: any) => Number(p.seq)).sort()
      expect(seqs).toEqual([1, 2])
    })
  })

  it('el índice UNIQUE (orderId, seq) existe de verdad: insertar dos veces seq=1 falla', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      await h.parts.create({ hotelId: 'h1', orderId: order.id, seq: 1, method: 'cash', amount: 1, tip: 0, status: 'completed' } as any)
      await expect(h.parts.create({ hotelId: 'h1', orderId: order.id, seq: 1, method: 'cash', amount: 1, tip: 0, status: 'completed' } as any)).rejects.toThrow(/unique/i)
    })
  })
})

describe('#214 — mezcla: 50 a la habitación + 50 efectivo', () => {
  it('el folio recibe el NETO de 50, el efectivo 50 completo; settlement "split", paid, un solo onOrderPaid con la porción directa', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 18]])   // due 118
      const room = await addOrderPayment(h.deps, order.id, { method: 'room', amount: 59, reservationId: 'r1' }, user)
      expect(room.part.method).toBe('room')
      expect(room.part.folioId).toBe('folio-1')
      expect(h.money.charges).toHaveLength(1)
      expect(h.money.charges[0].amount).toBe(50)   // 59 bruto → 50 neto; el folio aplica su impuesto
      expect(h.money.charges[0].reference).toBe(`pos:${order.id}:1`)
      expect(h.money.charges[0].reservationId).toBe('r1')
      expect(room.balance.outstanding).toBe(59)

      let paidView: any = null
      h.deps.sockets.onOrderPaid = async (o) => { h.events.push('paid'); paidView = o }
      const cash = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 59 }, user)
      expect(cash.order.status).toBe('paid')
      expect(cash.order.settlement).toBe('split')
      expect(cash.order.folioId).toBe('folio-1')
      expect(h.events).toEqual(['paid'])
      // La porción que viaja a contabilidad es SOLO la directa (la del folio ya la devenga folios-accounting).
      expect(paidView.total).toBe(59)
      expect(paidView.tax).toBe(9)
      expect(paidView.subtotal).toBe(50)
      expect(h.money.payments[0].amount).toBe(59)
    })
  })
  it('parte `room` con propina, sin reserva, o con reserva de otro hotel → rechazada sin tocar el folio', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      await expect(addOrderPayment(h.deps, order.id, { method: 'room', amount: 50, tip: 5, reservationId: 'r1' }, user)).rejects.toThrow('propina')
      await expect(addOrderPayment(h.deps, order.id, { method: 'room', amount: 50 }, user)).rejects.toThrow(ValidationError)
      await expect(addOrderPayment(h.deps, order.id, { method: 'room', amount: 50, reservationId: 'r-nope' }, user)).rejects.toThrow()
      expect(h.money.charges).toHaveLength(0)
      expect(await h.parts.findMany({ orderId: order.id } as any)).toHaveLength(0)
    })
  })
  it('todo a habitaciones → exactamente como chargeToRoom: `charged` + settlement "folio" + onOrderCharged (no onOrderPaid)', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      await addOrderPayment(h.deps, order.id, { method: 'room', amount: 50, reservationId: 'r1' }, user)
      const r = await addOrderPayment(h.deps, order.id, { method: 'room', amount: 50, reservationId: 'r1' }, user)
      expect(r.order.status).toBe('charged')
      expect(r.order.settlement).toBe('folio')
      expect(r.order.folioId).toBe('folio-1')
      expect(h.events).toEqual(['charged'])
      expect((await h.tables.findById(order.tableId!))?.status).toBe('free')
    })
  })
})

describe('#214 — dividir por líneas (ORM real)', () => {
  it('cada comensal paga sus líneas; la última parte absorbe el centavo y la comanda queda paid', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[33.33, 18, 'A'], [33.33, 18, 'B'], [33.34, 18, 'C']])
      const [a, b, c] = (await h.lines.findMany({ orderId: order.id } as any)).sort((x: any, y: any) => x.name.localeCompare(y.name))
      const r1 = await addOrderPayment(h.deps, order.id, { method: 'cash', lineIds: [a.id] }, user)
      expect(r1.part.amount).toBe(39.33)
      expect(r1.part.lineIds).toEqual([a.id])
      // La misma línea otra vez → 409, sin cobro.
      await expect(addOrderPayment(h.deps, order.id, { method: 'cash', lineIds: [a.id] }, user)).rejects.toThrow(ConflictError)
      // Monto que no coincide con las líneas → 400.
      await expect(addOrderPayment(h.deps, order.id, { method: 'cash', lineIds: [b.id], amount: 10 }, user)).rejects.toThrow('suman')
      const r2 = await addOrderPayment(h.deps, order.id, { method: 'cash', lineIds: [b.id], amount: 39.33 }, user)
      expect(r2.part.amount).toBe(39.33)
      const r3 = await addOrderPayment(h.deps, order.id, { method: 'cash', lineIds: [c.id] }, user)
      expect(r3.part.amount).toBe(39.34)
      expect(r3.order.status).toBe('paid')
      expect(r3.balance.outstanding).toBe(0)
      expect(h.money.payments).toHaveLength(3)
      expect(round2(h.money.payments.reduce((s, p) => s + p.amount, 0))).toBe(118)
    })
  })
  it('splitPreview: 3 partes iguales del saldo restante', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      expect(await splitPreview(h.deps, order.id, 3, user)).toEqual({ due: 100, outstanding: 100, parts: [33.33, 33.33, 33.34] })
      await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 10 }, user)
      expect((await splitPreview(h.deps, order.id, 2, user)).parts).toEqual([45, 45])
    })
  })
})

describe('#214 — refund parcial', () => {
  it('sin motivo → 400, la parte sigue cobrada y el puerto no se toca; con motivo, una parte en EFECTIVO se devuelve y el motivo queda en la parte y en el audit', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const cash = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)
      await expect(refundOrderPayment(h.deps, order.id, cash.part.id, { reason: '  ' }, user)).rejects.toThrow('motivo')
      expect(h.money.refunds).toEqual([])
      expect((await h.parts.findById(cash.part.id))?.status).toBe('completed')
      const done = await refundOrderPayment(h.deps, order.id, cash.part.id, { reason: 'cobrado a la mesa equivocada' }, user)
      expect(done.status).toBe('reversed')
      expect(done.refundReason).toBe('cobrado a la mesa equivocada')
      expect(h.money.refunds).toEqual(['pay-1'])
      expect(h.audits).toContain('restaurant.order.part_refunded')
    })
  })

  it('devolver la parte con tarjeta: solo ese payment vuelve, el efectivo sigue cobrado, `partially_refunded`, sin onOrderRefunded', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const cash = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)
      const card = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 60, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      await settleOrderPayment(h.deps, card.part.id, 'card-1', sys)
      const refunded = await refundOrderPayment(h.deps, order.id, card.part.id, REASON, user)
      expect(refunded.status).toBe('refunded')
      expect(h.money.refunds).toEqual(['card-1'])
      const after = (await h.orders.findById(order.id)) as OrderDTO
      expect(after.status).toBe('partially_refunded')
      expect(h.events).toEqual(['paid'])   // el inventario NO se repone por una devolución parcial
      const listed = await listOrderPayments(h.deps, order.id, user)
      expect(listed.parts.find((p) => p.id === cash.part.id)?.status).toBe('completed')
      // Idempotente: segunda devolución de la misma parte no vuelve a llamar al gateway.
      await refundOrderPayment(h.deps, order.id, card.part.id, REASON, user)
      expect(h.money.refunds).toHaveLength(1)
      // Devolver la otra parte (el doble de payments acepta cualquiera): todas devueltas → `refunded` + onOrderRefunded.
      await refundOrderPayment(h.deps, order.id, cash.part.id, REASON, user)
      expect(((await h.orders.findById(order.id)) as OrderDTO).status).toBe('refunded')
      expect(h.events).toEqual(['paid', 'refunded'])
    })
  })
  it('una parte pending, una a habitación o una de otra comanda → no se devuelve', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const room = await addOrderPayment(h.deps, order.id, { method: 'room', amount: 40, reservationId: 'r1' }, user)
      const card = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 60, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      await expect(refundOrderPayment(h.deps, order.id, card.part.id, REASON, user)).rejects.toThrow(ConflictError)
      await expect(refundOrderPayment(h.deps, order.id, room.part.id, REASON, user)).rejects.toThrow(ConflictError)
      await expect(refundOrderPayment(h.deps, 'otra', room.part.id, REASON, user)).rejects.toThrow()
      expect(h.money.refunds).toHaveLength(0)
    })
  })
})

describe('#214 — con una parte cobrada, el resto del circuito se frena', () => {
  it('payOrder / chargeToRoom (cobro entero) → 409; cancelar → 409; agregar línea → 409', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]], { reservationId: 'r1' })
      await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)
      await expect(payOrder(h.deps, order.id, { method: 'cash' }, user)).rejects.toThrow(ConflictError)
      await expect(chargeToRoom(h.deps, order.id, {}, user)).rejects.toThrow(ConflictError)
      expect(h.money.payments).toHaveLength(1)
      expect(h.money.charges).toHaveLength(0)
      const ordersDeps = { orders: h.orders, lines: h.lines, tables: h.tables, config: { findOne: async () => null } as any, userRepo, auth: strictAuth, sockets: {} } as unknown as OrdersDeps
      await expect(cancelOrder(ordersDeps, order.id, 'se fue', user)).rejects.toThrow(ConflictError)
      const linesDeps = { orders: h.orders, lines: h.lines, items: { findById: async () => ({ id: 'i1', hotelId: 'h1', name: 'X', price: 1 }) } as any, categories: { findOne: async () => null } as any, stations: { findMany: async () => [] } as any, config: { findOne: async () => null } as any, hotels, userRepo, auth: strictAuth, sockets: {} } as unknown as OrderLinesDeps
      await expect(addLine(linesDeps, order.id, { menuItemId: 'i1', quantity: 1 }, user)).rejects.toThrow(ConflictError)
      expect(((await h.orders.findById(order.id)) as OrderDTO).status).toBe('sent')
    })
  })
  it('comanda cancelada u `open` → no admite partes; una ya `paid` → 409', async () => {
    await withOrm(async (h) => {
      const cancelled = await seedOrder(h, [[100, 0]], { status: 'cancelled' })
      await expect(addOrderPayment(h.deps, cancelled.id, { method: 'cash', amount: 10 }, user)).rejects.toThrow(ConflictError)
      const open = await seedOrder(h, [[100, 0]], { status: 'open' })
      await expect(addOrderPayment(h.deps, open.id, { method: 'cash', amount: 10 }, user)).rejects.toThrow(ConflictError)
      const paid = await seedOrder(h, [[100, 0]], { status: 'paid', settlement: 'payment' })
      await expect(addOrderPayment(h.deps, paid.id, { method: 'cash', amount: 10 }, user)).rejects.toThrow(ConflictError)
      expect(h.money.payments).toHaveLength(0)
    })
  })
})

// ─── Auditoría T-REST-12: INT-1 / COR-3 / COR-4 ──────────────────────────────
describe('#214 — COR-3: dos partes CONCURRENTES sobre el mismo saldo', () => {
  it('Promise.all de dos partes de 100 sobre saldo 100: entra UNA, la otra 400 "supera el saldo", un solo payment', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const results = await Promise.allSettled([
        addOrderPayment(h.deps, order.id, { method: 'cash', amount: 100 }, user),
        addOrderPayment(h.deps, order.id, { method: 'transfer', amount: 100 }, user),
      ])
      const ok = results.filter((r) => r.status === 'fulfilled')
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(ok).toHaveLength(1)
      expect(failed).toHaveLength(1)
      expect(failed[0].reason).toBeInstanceOf(ValidationError)
      expect(String(failed[0].reason.message)).toContain('supera el saldo')
      // Un solo cobro llegó a payments; la comanda quedó paid con 100 (no 200) y sin reserva colgada.
      expect(h.money.payments).toHaveLength(1)
      const final = (await h.orders.findById(order.id)) as OrderDTO
      expect(final.status).toBe('paid')
      expect(Number(final.amountPaid)).toBe(100)
      expect(Number(final.amountReserved)).toBe(0)
      expect(await h.parts.findMany({ orderId: order.id } as any)).toHaveLength(1)
      expect(h.events).toEqual(['paid'])
    })
  })

  it('dos partes concurrentes que SÍ caben (60 + 40 sobre 100): entran las dos, un solo onOrderPaid, reserva en 0', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const [a, b] = await Promise.all([
        addOrderPayment(h.deps, order.id, { method: 'cash', amount: 60 }, user),
        addOrderPayment(h.deps, order.id, { method: 'transfer', amount: 40 }, user),
      ])
      expect([a.part.seq, b.part.seq].sort()).toEqual([1, 2])
      expect(h.money.payments.map((p) => p.reference).sort()).toEqual([`pos:${order.id}:1`, `pos:${order.id}:2`])
      const final = (await h.orders.findById(order.id)) as OrderDTO
      expect(final.status).toBe('paid')
      expect(Number(final.amountPaid)).toBe(100)
      expect(Number(final.amountReserved)).toBe(0)
      expect(h.events).toEqual(['paid'])   // el inventario descuenta UNA vez aunque las dos cerraran a la vez
    })
  })

  it('comanda anterior a la columna (amountPaid/amountReserved en NULL): la primera parte igual reserva y cobra', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      await h.db.run('UPDATE restaurant_orders SET amountPaid = NULL, amountReserved = NULL WHERE id = ?', [order.id])
      const r = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 30 }, user)
      expect(r.part.status).toBe('completed')
      const after = (await h.orders.findById(order.id)) as OrderDTO
      expect(Number(after.amountPaid)).toBe(30)
      expect(Number(after.amountReserved)).toBe(0)
    })
  })
})

describe('#214 — INT-1: un Checkout de tarjeta abierto por UNA parte es "processing_payment" de la comanda', () => {
  it('con la parte pending: payOrder / chargeToRoom / cancelar / agregar línea dan 409 — nada llega a payments ni al folio', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]], { reservationId: 'r1' })
      const r = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 100, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      expect(r.part.status).toBe('pending')
      const mid = (await h.orders.findById(order.id)) as OrderDTO
      expect(Number(mid.amountReserved)).toBe(100)
      expect(Number(mid.amountPaid)).toBe(0)
      await expect(payOrder(h.deps, order.id, { method: 'cash' }, user)).rejects.toThrow(ConflictError)
      await expect(chargeToRoom(h.deps, order.id, {}, user)).rejects.toThrow(ConflictError)
      const ordersDeps = { orders: h.orders, lines: h.lines, tables: h.tables, config: { findOne: async () => null } as any, userRepo, auth: strictAuth, sockets: {} } as unknown as OrdersDeps
      await expect(cancelOrder(ordersDeps, order.id, 'se fue', user)).rejects.toThrow(ConflictError)
      const linesDeps = { orders: h.orders, lines: h.lines, items: { findById: async () => ({ id: 'i1', hotelId: 'h1', name: 'X', price: 1 }) } as any, categories: { findOne: async () => null } as any, stations: { findMany: async () => [] } as any, config: { findOne: async () => null } as any, hotels, userRepo, auth: strictAuth, sockets: {} } as unknown as OrderLinesDeps
      await expect(addLine(linesDeps, order.id, { menuItemId: 'i1', quantity: 1 }, user)).rejects.toThrow(ConflictError)
      expect(h.money.payments).toHaveLength(0)
      expect(h.money.charges).toHaveLength(0)
      expect(((await h.orders.findById(order.id)) as OrderDTO).status).toBe('sent')
      // Stripe confirma → UNA comanda paid, UN payment (la sesión), UN onOrderPaid.
      await settleOrderPayment(h.deps, r.part.id, 'card-1', sys)
      const final = (await h.orders.findById(order.id)) as OrderDTO
      expect(final.status).toBe('paid')
      expect(Number(final.amountReserved)).toBe(0)
      expect(h.events).toEqual(['paid'])
      // Y una vez vencida/expirada, el circuito se destraba: la reserva vuelve a 0.
      const other = await seedOrder(h, [[50, 0]])
      const c = await addOrderPayment(h.deps, other.id, { method: 'card', amount: 50, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      await expect(cancelOrder(ordersDeps, other.id, 'se fue', user)).rejects.toThrow(ConflictError)
      await expireOrderPayment(h.deps, c.part.id, sys)
      expect(Number(((await h.orders.findById(other.id)) as OrderDTO).amountReserved)).toBe(0)
      const cancelled = await cancelOrder(ordersDeps, other.id, 'se fue', user)
      expect(cancelled.status).toBe('cancelled')
    })
  })

  it('el webhook confirma una parte de una comanda CANCELADA (fila sin los guards): se devuelve sola, se audita y no libera mesa ni descuenta inventario', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const r = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 100, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      // Cancelación "por fuera" de los guards (dato viejo / a mano): la comanda queda cancelled con la parte pending.
      await h.orders.update(order.id, { status: 'cancelled' } as any)
      await h.tables.update(order.tableId!, { status: 'occupied' } as any)
      const part = await settleOrderPayment(h.deps, r.part.id, 'card-1', sys)
      expect(part.status).toBe('refunded')
      expect(h.money.refunds).toEqual(['card-1'])
      expect(h.audits).toContain('restaurant.order.part_refunded_after_cancel')
      const final = (await h.orders.findById(order.id)) as OrderDTO
      expect(final.status).toBe('cancelled')
      expect(Number(final.amountReserved)).toBe(0)
      expect(h.events).toEqual([])   // ni onOrderPaid ni onOrderCharged: no hubo venta
      expect((await h.tables.findById(order.tableId!))?.status).toBe('occupied')   // no toca la mesa
    })
  })

  it('…y si el refund automático no está disponible: la parte queda cobrada, se audita `orphan_payment` y la comanda sigue cancelada', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const r = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 100, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      await h.orders.update(order.id, { status: 'cancelled' } as any)
      const part = await settleOrderPayment(h.deps, r.part.id, 'card-1', sys)
      expect(part.status).toBe('completed')
      expect(part.paymentId).toBe('card-1')
      expect(h.money.refunds).toHaveLength(0)
      expect(h.audits).toContain('restaurant.order.orphan_payment')
      expect(((await h.orders.findById(order.id)) as OrderDTO).status).toBe('cancelled')
      expect(h.events).toEqual([])
    }, { ports: { refundPayment: undefined } })
  })

  it('el webhook confirma una parte de una comanda que YA se cerró por otro camino: anota la parte, libera la reserva y NO repite mesa/socket', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const cash = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)
      expect(cash.order.status).toBe('sent')
      const card = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 60, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      // Cierre "por fuera" (dato a mano): la comanda ya está paid y la mesa ya se ocupó de nuevo.
      await h.orders.update(order.id, { status: 'paid', settlement: 'payment', closedAt: new Date().toISOString() } as any)
      await h.tables.update(order.tableId!, { status: 'occupied' } as any)
      const part = await settleOrderPayment(h.deps, card.part.id, 'card-1', sys)
      expect(part.status).toBe('completed')
      const final = (await h.orders.findById(order.id)) as OrderDTO
      expect(final.status).toBe('paid')
      expect(Number(final.amountPaid)).toBe(100)
      expect(Number(final.amountReserved)).toBe(0)
      expect(h.events).toEqual([])   // el cierre de esta comanda no lo hizo split-payments: no emite de nuevo
      expect((await h.tables.findById(order.tableId!))?.status).toBe('occupied')
    })
  })
})

describe('#214 — COR-4: el Checkout ya existe y la parte no se pudo anotar', () => {
  it('NO se borra la parte (la sesión de Stripe sigue viva): el cajero recibe el checkoutUrl y el webhook la confirma por su id', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const original = h.parts.update.bind(h.parts)
      let boom = true
      h.parts.update = (async (id: string, d: any) => { if (boom && d.paymentId && !d.status) throw new Error('db down'); return original(id, d) }) as any
      const r = await addOrderPayment(h.deps, order.id, { method: 'card', amount: 100, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)
      boom = false
      expect(r.checkoutUrl).toContain('checkout.stripe.test')
      expect(h.money.cards).toHaveLength(1)
      // La parte sigue ahí, pending, reservando el saldo — no se borró.
      const rows = await h.parts.findMany({ orderId: order.id } as any)
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pending')
      expect(Number(((await h.orders.findById(order.id)) as OrderDTO).amountReserved)).toBe(100)
      // El webhook llega con metadata.orderPaymentId → la encuentra y cierra la comanda.
      const done = await settleOrderPayment(h.deps, r.part.id, 'card-1', sys)
      expect(done.status).toBe('completed')
      expect(done.paymentId).toBe('card-1')
      expect(((await h.orders.findById(order.id)) as OrderDTO).status).toBe('paid')
    })
  })

  it('si el PUERTO falla (no hay sesión): la parte queda `failed`, su `seq` se quema y el saldo vuelve a estar disponible', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      await expect(addOrderPayment(h.deps, order.id, { method: 'card', amount: 100, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' }, user)).rejects.toThrow('stripe caído')
      // COR-2: NO se borra — charge-card.ts pudo haber reclamado `pos:<id>:1` en payments antes de fallar; la
      // siguiente parte toma el 2 (ver split-concurrency-3.test.ts).
      const parts = await h.parts.findMany({ orderId: order.id } as any)
      expect(parts.map((p) => [p.seq, p.status])).toEqual([[1, 'failed']])
      expect(parts[0].failReason).toContain('stripe caído')
      expect(Number(((await h.orders.findById(order.id)) as OrderDTO).amountReserved)).toBe(0)
      const ok = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 100 }, user)
      expect(ok.part.seq).toBe(2)
      expect(h.money.payments[0].reference).toBe(`pos:${order.id}:2`)
      expect(ok.order.status).toBe('paid')
    }, { ports: { chargeCardPayment: async () => { throw new Error('stripe caído') } } })
  })
})

// ─── COR-C: una parte cobrada por error sobre una comanda ABIERTA se puede deshacer ──────────────
// Antes `refundOrderPayment` exigía `paid`/`partially_refunded`: con la comanda abierta, cancelar y
// cobrar entero rebotaban por `hasPaidParts`, y la única salida era cobrar el resto para recién ahí
// devolver. Ahora la parte queda `reversed`: la plata vuelve (asiento `refund` en payments), el saldo
// se reabre (CAS sobre amountPaid), sus líneas se liberan y la comanda sigue viva.
describe('#214 COR-C — devolver una parte con la comanda abierta', () => {
  it('la parte queda `reversed`, el saldo se reabre, sus líneas se liberan, sin onOrderRefunded, con auditoría', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[60, 0, 'A'], [40, 0, 'B']])
      const a = (await h.lines.findMany({ orderId: order.id } as any)).find((l) => l.name === 'A')!
      const first = await addOrderPayment(h.deps, order.id, { method: 'cash', lineIds: [a.id], tip: 5 }, user)
      expect(Number(first.order.amountPaid)).toBe(60)
      const undone = await refundOrderPayment(h.deps, order.id, first.part.id, REASON, user)
      expect(undone.status).toBe('reversed')
      expect(h.money.refunds).toEqual(['pay-1'])
      const after = (await h.orders.findById(order.id)) as OrderDTO
      expect(after.status).toBe('sent')
      expect(Number(after.amountPaid)).toBe(0)
      expect(Number(after.amountReserved)).toBe(0)
      expect(Number(after.tip)).toBe(0)
      expect(h.events).toEqual([])
      expect(h.audits).toContain('restaurant.order.part_refunded')
      const listed = await listOrderPayments(h.deps, order.id, user)
      expect(listed.balance).toMatchObject({ due: 100, paid: 0, pending: 0, outstanding: 100, tips: 0 })
      // La línea A vuelve a estar libre: se cobra de nuevo, y el resto cierra la comanda.
      const again = await addOrderPayment(h.deps, order.id, { method: 'transfer', lineIds: [a.id] }, user)
      expect(again.part.seq).toBe(2)
      expect(again.part.amount).toBe(60)
      const rest = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 40 }, user)
      expect(rest.order.status).toBe('paid')
      expect(Number(rest.order.amountPaid)).toBe(100)
      expect(h.events).toEqual(['paid'])
      // Una parte `reversed` no se vuelve a devolver ni cuenta como cobrada.
      await expect(refundOrderPayment(h.deps, order.id, first.part.id, REASON, user)).rejects.toThrow(ConflictError)
      expect(h.money.refunds).toEqual(['pay-1'])
    })
  })
  it('deshecha la única parte, la comanda se puede cancelar (y antes no)', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const part = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 30 }, user)
      const ordersDeps = { orders: h.orders, lines: h.lines, tables: h.tables, config: { findOne: async () => null } as any, counterCas: h.deps.cas, userRepo, auth: strictAuth, sockets: {} } as unknown as OrdersDeps
      await expect(cancelOrder(ordersDeps, order.id, 'se fue', user)).rejects.toThrow(ConflictError)
      await refundOrderPayment(h.deps, order.id, part.part.id, REASON, user)
      const cancelled = await cancelOrder(ordersDeps, order.id, 'se fue sin pagar', user)
      expect(cancelled.status).toBe('cancelled')
      expect(h.money.refunds).toEqual(['pay-1'])
    })
  })
  it('si el puerto de refund falla, la parte sigue `completed` y el saldo no se toca', async () => {
    await withOrm(async (h) => {
      const order = await seedOrder(h, [[100, 0]])
      const part = await addOrderPayment(h.deps, order.id, { method: 'cash', amount: 30 }, user)
      await expect(refundOrderPayment(h.deps, order.id, part.part.id, REASON, user)).rejects.toThrow('payments caído')
      expect((await h.parts.findById(part.part.id))?.status).toBe('completed')
      expect(Number(((await h.orders.findById(order.id)) as OrderDTO).amountPaid)).toBe(30)
    }, { ports: { refundPayment: async () => { throw new Error('payments caído') } } })
  })
})
