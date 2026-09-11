// restaurant/tests/split-concurrency-harness.ts — harness compartido por los tests split-concurrency-*.
//
// ORM REAL sobre SQLite in-memory (mismo esquema que split-payments.test.ts) con el UPDATE condicional
// real del ORM como `cas`: lo que se prueba es la carrera de verdad (Promise.all sobre la misma fila),
// no un mock que diga OK. Los puertos de dinero son un espejo FIEL de payments.createIdempotent +
// charge-card.ts: la referencia `pos:*` se reclama en UNA tabla compartida por cash/transfer/card,
// ANTES de hablar con Stripe — así se reproduce que una parte borrada deje su payment reclamado.
import { ORM, OrmRepository } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { Auth, RepositoryAdapter } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerRestaurantModels, RESTAURANT_ORDER_PAYMENTS_SEQ_INDEX_SQL } from '../model'
import type { SplitPaymentsDeps } from '../usecases/split-payments'
import type { OrdersDeps } from '../usecases/orders'
import type { OrderLinesDeps } from '../usecases/order-lines'
import { round2 } from '../../../shared/utils/money'
import type { OrderDTO, OrderItemDTO, OrderPaymentDTO, TableDTO, CurrentUser } from '../types'
import type { ReservationPort } from '../usecases/reservation-port'

export const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
export const sys: CurrentUser = { id: 'system', role: 'super_admin' }
export const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
export const userRepo = { findById: async () => ({ id: 'u1', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>
export const hotels = { findOne: async () => ({ id: 'h1', currency: 'DOP' }), findById: async () => ({ id: 'h1', currency: 'DOP' }) } as unknown as RepositoryAdapter<any>
export const reservations: ReservationPort = {
  findById: async (id) => (id === 'r1' ? { id, hotelId: 'h1', guestId: 'g1', roomId: 'room-1', status: 'checked_in' } : null),
}
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
export const card = (amount: number) => ({ method: 'card' as const, amount, successUrl: 'https://x/ok', cancelUrl: 'https://x/no' })
export const outcome = (r: PromiseSettledResult<unknown>): string => (r.status === 'rejected' ? `${r.reason?.constructor?.name}:${r.reason?.message}` : 'ok')

export interface PaymentRow { id: string; method: string; status: string; reference?: string; amount: number; type?: string }
export interface Money { payments: PaymentRow[]; charges: any[]; refunds: string[]; cards: PaymentRow[] }
export interface Harness {
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
export interface HarnessOpts {
  ports?: Partial<SplitPaymentsDeps['ports']>
  /** Stripe no configurado: charge-card.ts YA creó el payment `pending` con la referencia y recién ahí falla. */
  stripeFails?: boolean
  /** Latencia (ms) del cobro ENTERO en payments/folios (red hacia PG) — la parte no la tiene. */
  wholeLatencyMs?: number
  /** Cablea `findPaymentByReference` (espejo del conector) para conciliar un puerto que falló después de cobrar. */
  withLookup?: boolean
}

export async function withOrm(fn: (h: Harness) => Promise<void>, opts: HarnessOpts = {}): Promise<void> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false })
  await db.connect()
  const orm = new ORM(db)
  registerRestaurantModels(orm)
  await orm.migrate()
  await db.run(RESTAURANT_ORDER_PAYMENTS_SEQ_INDEX_SQL)
  const orders = new OrmRepository<OrderDTO>(orm, 'RestaurantOrders')
  const lines = new OrmRepository<OrderItemDTO>(orm, 'RestaurantOrderItems')
  const parts = new OrmRepository<OrderPaymentDTO>(orm, 'RestaurantOrderPayments')
  const tables = new OrmRepository<TableDTO>(orm, 'RestaurantTables')
  const money: Money = { payments: [], charges: [], refunds: [], cards: [] }
  const events: string[] = []
  const audits: string[] = []
  // Espejo de payments.createIdempotent: UNA tabla, la referencia pos:* se reclama una sola vez.
  const claim = (input: any, method: string, status: string): { row: PaymentRow; dup: boolean } => {
    const existing = money.payments.find((p) => p.reference === input.reference)
    if (existing) return { row: existing, dup: true }
    const row: PaymentRow = { id: `pay-${money.payments.length + 1}`, method, status, ...input }
    money.payments.push(row)
    return { row, dup: false }
  }
  const deps: SplitPaymentsDeps = {
    orders, lines, tables, hotels, userRepo, auth: strictAuth, orderPayments: parts, reservations,
    cas: orm,
    audit: { record: async (entry) => { audits.push(entry.action) } },
    sockets: {
      onOrderPaid: async () => { events.push('paid') },
      onOrderCharged: async () => { events.push('charged') },
      onOrderRefunded: async () => { events.push('refunded') },
    },
    ports: {
      recordPayment: async (input) => {
        if (!input.reference && opts.wholeLatencyMs) await sleep(opts.wholeLatencyMs)
        const { row } = claim(input, input.method, 'completed')
        return { paymentId: row.id }
      },
      chargeToFolio: async (input) => {
        if (!input.reference && opts.wholeLatencyMs) await sleep(opts.wholeLatencyMs)
        money.charges.push(input)
        return { folioId: 'folio-1' }
      },
      chargeCardPayment: async (input) => {
        const { row } = claim(input, 'card', 'pending')
        money.cards.push(row)
        if (opts.stripeFails) throw new ValidationError('El hotel no tiene pasarela de pago configurada')
        return { paymentId: row.id, checkoutUrl: 'https://checkout.stripe.test/' + row.id }
      },
      refundPayment: async ({ paymentId }) => { money.refunds.push(paymentId) },
      ...(opts.withLookup ? {
        findPaymentByReference: async ({ reference }) => {
          const p = money.payments.find((x) => x.reference === reference)
          return p ? { paymentId: p.id, status: p.status, method: p.method } : null
        },
      } : {}),
      ...opts.ports,
    },
  }
  try {
    await fn({ deps, orders, lines, parts, tables, money, events, audits, db })
  } finally {
    await db.close?.()
  }
}

/** Comanda `sent` en una mesa con líneas [neto, tasa%, nombre?]. `extra` pisa cualquier columna (p. ej. `amountPaid: null`). */
export async function seedOrder(h: Harness, items: Array<[number, number, string?]>, extra: Record<string, unknown> = {}): Promise<OrderDTO> {
  await h.tables.create({ hotelId: 'h1', name: '3', status: 'occupied' } as any).catch(() => null)
  const table = (await h.tables.findMany({ hotelId: 'h1' } as any))[0]
  const subtotal = round2(items.reduce((s, [net]) => s + net, 0))
  const tax = round2(items.reduce((s, [net, rate]) => s + (net * rate) / 100, 0))
  const order = await h.orders.create({ hotelId: 'h1', type: 'dine_in', status: 'sent', number: 'CMD-1', tableId: table?.id, tip: 0, subtotal, tax, total: round2(subtotal + tax), amountPaid: 0, amountReserved: 0, ...extra } as any)
  for (const [net, rate, name] of items) {
    await h.lines.create({ hotelId: 'h1', orderId: order.id, name: name ?? `Plato ${net}`, unitPrice: net, quantity: 1, lineTotal: net, taxRate: rate, status: 'new', kind: 'item' } as any)
  }
  return order as OrderDTO
}

/** Deja `amountPaid`/`amountReserved` en NULL como las filas anteriores a la columna (sin backfill). */
export async function nullifyAmounts(h: Harness, orderId: string): Promise<void> {
  await h.db.run('UPDATE restaurant_orders SET amountPaid = NULL, amountReserved = NULL WHERE id = ?', [orderId])
}

/** Deps de `cancelOrder` con el MISMO cas (el orm) — como en producción. `slowLinesMs` simula la latencia de leer las líneas. */
export function ordersDeps(h: Harness, slowLinesMs = 0): OrdersDeps {
  const lines = slowLinesMs
    ? { ...h.lines, findMany: async (w: any) => { await sleep(slowLinesMs); return h.lines.findMany(w) }, update: (i: any, d: any) => h.lines.update(i, d) } as unknown as OrdersDeps['lines']
    : h.lines
  return { orders: h.orders, lines, tables: h.tables, config: { findOne: async () => null } as any, counterCas: h.deps.cas, userRepo, auth: strictAuth, sockets: {}, audit: h.deps.audit, logger: h.deps.logger }
}

/** Deps de líneas con el MISMO cas (el orm): el lock de líneas (COR-A) es lo que se prueba en la carrera. El ítem `i1` vale 1. */
export function linesDeps(h: Harness): OrderLinesDeps {
  const item = { id: 'i1', hotelId: 'h1', name: 'X', price: 1, taxRate: 0 }
  return {
    orders: h.orders, lines: h.lines, items: { findById: async () => item, findOne: async () => item } as any,
    categories: { findOne: async () => null } as any, stations: { findMany: async () => [] } as any, config: { findOne: async () => null } as any,
    hotels, userRepo, auth: strictAuth, sockets: {}, cas: h.deps.cas, logger: h.deps.logger,
  }
}

export const sumAmounts = (rows: Array<{ amount: number }>): number => round2(rows.reduce((s, p) => s + Number(p.amount), 0))
