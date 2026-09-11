// restaurant/usecases/reports.ts — Cierre del día del restaurante (#213, epic #202).
//
// Hasta acá el único "reporte" del POS era el cierre de turno de caja, que SOLO ve efectivo: lo
// cobrado con tarjeta, por transferencia o cargado a la habitación no consolidaba en ningún lado y el
// dueño no podía responder "¿cuánto vendió el restaurante ayer y por qué medio?".
//
// DE DÓNDE SALE CADA NÚMERO (auditoría de #213 — `payments` es la ÚNICA fuente de verdad del dinero):
// - Ventas por método, propinas, reembolsos → `payments` del hotel del día (`businessDate`), sólo las
//   filas con `metadata.source === 'restaurant'`. Un cobro (`type:'charge'`, `completed` o `refunded`)
//   suma bajo su `method` real; una devolución (`type:'refund'`, `completed`) RESTA bajo el suyo — también
//   la hecha desde /api/payments/:id/refund sin tocar la comanda (hereda el origen en `metadata`).
// - Cargo a habitación → el cargo del POS en el folio (`folio_charges` por `'pos:'+orderId`): neto +
//   el impuesto que aplicó el folio, que puede diferir del ticket. Una vez, nunca desde la comanda.
// - Propina: el POS cobra el bruto (subtotal + impuesto + propina) en UN payment; la propina no viaja
//   aparte. Criterio: `neto = payment.amount − comanda.tip`, `propina = comanda.tip`. En una devolución,
//   primero se devuelve la venta y sólo lo que excede el neto sale de la propina; subtotal/impuesto se
//   descuentan en la proporción de la comanda. Así `total = subtotal + tax` siempre cierra.
// - Las comandas aportan lo que no es plata: cantidad, tipo, comensales, franja horaria, anuladas con
//   motivo, líneas anuladas, top de ítems y estaciones.
// - Descuentos y cortesías (#215) → `restaurant_order_items.discount*` (línea) + `restaurant_orders.discount*`
//   (comanda) de las comandas VENDIDAS del día: lo que se dejó de cobrar, cuántos hubo y cada uno con
//   motivo, usuario (nombre resuelto contra `users`, regla del CLAUDE.md) y comanda. Una cortesía es un
//   descuento que se lleva TODA su base (100 % o un monto igual al bruto). Salen de las mismas consultas
//   que el resto (comandas por día + líneas por comanda), no de una tercera; los nombres se piden una
//   vez por usuario distinto.
//
// Consultas acotadas: el ORM sólo arma igualdades (`buildWhere`), así que el día vive como VALOR en
// `businessDate` ('YYYY-MM-DD' en la zona del hotel) tanto en `restaurant_orders` como en `payments`.
// Un día = una consulta de comandas + una de pagos; un rango = N días. Las líneas y el cargo al folio se
// piden POR COMANDA del rango. Nada trae el histórico del hotel.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, CurrentUser, OrderType } from '../types'
import { round2 } from '../../../shared/utils/money'
import { hotelTimezone } from '../../../shared/utils/hotel-schedule'
import { localDateHour } from '../../../shared/utils/business-date'
import { isLineActive } from './order-totals'

export { localDateHour }

// ─── Puertos ───
/** Lo que el reporte necesita de un `payment` (espejo parcial de payments/types.ts, sin importar el módulo). */
export interface ReportPayment {
  id: string
  type: string
  method: string
  status: string
  amount: number
  metadata?: Record<string, any> | null
  processedAt?: string | null
  createdAt?: string
  createdBy?: string
}
/** Lo que el reporte necesita del cargo del POS en el folio. */
export interface ReportFolioCharge { amount: number; taxes: number; total: number }

export interface ReportPorts {
  /**
   * Pagos del hotel de un día contable (`payments.businessDate`). Lo provee el conector
   * restaurante-reports-payments; el usecase filtra `metadata.source === 'restaurant'`. Sin puerto,
   * el cierre no tiene plata: ventas por método en cero (las comandas siguen contando).
   */
  paymentsOfDay?: (hotelId: string, businessDate: string) => Promise<ReportPayment[]>
  /**
   * Cargo del POS en el folio por su referencia (`'pos:' + orderId`). Lo provee el conector
   * restaurante-reports-folios. Null si no existe. Sin puerto, el cargo a habitación vale cero.
   */
  folioCharge?: (hotelId: string, reference: string) => Promise<ReportFolioCharge | null>
  /**
   * #216 — UN pago del hotel por id, para el ticket impreso (método, monto, referencia). Mismo conector
   * que `paymentsOfDay`; acotado al hotel de la comanda (null si no es de ese hotel). Sin puerto, el
   * ticket muestra el total pagado sin desglose de método.
   */
  paymentById?: (hotelId: string, paymentId: string) => Promise<ReportPayment | null>
}

export interface ReportsDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  hotels: RepositoryAdapter<any>
  /** #215: `users` para resolver el nombre de quien aplicó cada descuento (`discountBy` = users.id). Opcional por retrocompat con tests de #213. */
  users?: RepositoryAdapter<any>
  ports: ReportPorts
}

export interface DailyReportQuery { date?: string; from?: string; to?: string }

// ─── Contrato de salida (espejo en frontend/src/services/Restaurant.service.ts) ───
export type SalesMethod = 'cash' | 'card' | 'transfer' | 'folio' | 'other'
export const SALES_METHODS: SalesMethod[] = ['cash', 'card', 'transfer', 'folio', 'other']

export interface MethodTotals { amount: number; orders: number }
export interface ItemTotals { menuItemId: string | null; name: string; quantity: number; amount: number }
export interface StationTotals { stationId: string | null; stationName: string; quantity: number; amount: number }
export interface HourTotals { hour: number; orders: number; amount: number }
export interface DayTotals { date: string; orders: number; amount: number; tips: number }
export interface VoidRow {
  kind: 'order' | 'line' | 'refund'
  orderId: string
  orderNumber: string | null
  name: string
  quantity: number
  amount: number
  reason: string | null
  at: string | null
  by: string | null
}

/** #215 — un descuento aplicado (de línea o de toda la comanda) en una comanda vendida del rango. */
export interface DiscountRow {
  kind: 'line' | 'order'
  orderId: string
  orderNumber: string | null
  /** Nombre de la línea, o "Comanda completa" si el descuento es de la comanda. */
  name: string
  quantity: number
  /** Bruto sobre el que se aplicó (neto sin impuesto). */
  base: number
  /** Lo que efectivamente se dejó de cobrar (neto sin impuesto). */
  amount: number
  /** amount / base, en %. 100 = cortesía. */
  percent: number
  /** true si el descuento se llevó toda la base (invitación de la casa). */
  courtesy: boolean
  reason: string | null
  at: string | null
  /** users.id de quien lo aplicó. */
  by: string | null
  /** Nombre resuelto contra `users`; null si no se pudo resolver. */
  byName: string | null
}

export interface RestaurantDailyReport {
  from: string
  to: string
  timezone: string
  currency: string
  /** true si no hubo ventas, anulaciones ni reembolsos en el rango: la UI muestra estado vacío, no ceros. */
  empty: boolean
  sales: {
    /** Ventas netas sin propina (cobros + cargos a folio − devoluciones). Siempre = subtotal + tax. */
    total: number
    subtotal: number
    tax: number
    /** Propinas cobradas menos las devueltas. */
    tips: number
    /** total + tips: lo que efectivamente quedó (cobro directo + cargos a folio − devoluciones). */
    collected: number
    orders: number
    averageTicket: number
    /** Comensales de las comandas `dine_in` vendidas que tienen el dato (#210). */
    covers: number
    averagePerCover: number
  }
  byMethod: Record<SalesMethod, MethodTotals>
  byType: Record<OrderType, MethodTotals>
  voided: { orders: number; lines: number; amount: number; rows: VoidRow[] }
  /** Devoluciones del período (por fecha de la devolución). `amount` es la plata que salió, propina incluida. */
  refunded: { orders: number; amount: number }
  /**
   * #215 — descuentos y cortesías de las comandas vendidas del rango. `amount` es el total descontado
   * (neto), `count` cuántos descuentos se aplicaron (líneas + comandas), `orders` en cuántas comandas,
   * `courtesies` el subconjunto al 100 %. `rows` trae todos con motivo y usuario; la UI destaca las cortesías.
   */
  discounts: { orders: number; count: number; amount: number; courtesies: { count: number; amount: number }; rows: DiscountRow[] }
  topItemsByQuantity: ItemTotals[]
  topItemsByAmount: ItemTotals[]
  byStation: StationTotals[]
  byHour: HourTotals[]
  byDay: DayTotals[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Tope del rango: un año. Más que eso no es un cierre, es un export contable. */
export const MAX_RANGE_DAYS = 366
export const TOP_ITEMS = 10
/** Comandas vendidas: cobradas, cargadas a folio o cobradas y después devueltas (la venta queda en su día). */
const SOLD_STATUSES: OrderDTO['status'][] = ['paid', 'charged', 'refunded']
/** Concurrencia al pedir líneas/cargos por comanda y días: acotada para no abrir miles de consultas a la vez en PG. */
const CONCURRENCY = 25
const RESTAURANT_SOURCE = 'restaurant'
const posReference = (orderId: string): string => `pos:${orderId}`

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** Hoy en la zona del hotel. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateHour(now, timeZone)!.date
}

/** Normaliza y valida `date` / `from`+`to`. Sin nada → hoy (en la zona del hotel). */
export function resolveRange(query: DailyReportQuery | undefined, timeZone: string, now: Date = new Date()): { from: string; to: string } {
  const date = String(query?.date ?? '').trim()
  let from = String(query?.from ?? '').trim()
  let to = String(query?.to ?? '').trim()
  if (date) { from = date; to = date }
  if (!from && !to) { from = todayIn(timeZone, now); to = from }
  if (!from) from = to
  if (!to) to = from
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new ValidationError('Fecha inválida: usá YYYY-MM-DD')
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new ValidationError('Fecha inválida')
  if (from > to) throw new ValidationError('`from` no puede ser posterior a `to`')
  const span = daysBetween(from, to) + 1
  if (span > MAX_RANGE_DAYS) throw new ValidationError(`El rango no puede superar ${MAX_RANGE_DAYS} días`)
  return { from, to }
}

/** Monto bruto de una línea (neto + su impuesto congelado), ANTES de descuentos: lo que se pidió a valor de carta. */
function lineGross(l: OrderItemDTO): number {
  const net = Number(l.lineTotal || 0)
  return net + (net * Number(l.taxRate || 0)) / 100
}

/** Las líneas que cuentan como "un plato": nunca los componentes de un combo (van en 0, el header lleva el precio). */
const isSellable = (l: OrderItemDTO): boolean => l.kind !== 'combo_component'

/** `Promise.all` por tandas de CONCURRENCY. */
async function inChunks<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))))
  }
  return out
}

/** Un descuento "se llevó toda la base" cuando lo descontado no deja nada que cobrar (100 % o un monto ≥ bruto). */
const COURTESY_EPSILON = 0.005
const isCourtesy = (base: number, amount: number): boolean => base > 0 && amount >= base - COURTESY_EPSILON

/** Nombres de usuario por id, una lectura por id distinto (`findOne`, no `findById`: no es un id que venga de afuera). */
async function userNames(deps: ReportsDeps, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const distinct = [...new Set(ids.filter(Boolean))]
  if (!deps.users || !distinct.length) return out
  const rows = await inChunks(distinct, (id) => deps.users!.findOne({ id }) as Promise<any>)
  distinct.forEach((id, idx) => { const name = String(rows[idx]?.name ?? '').trim(); if (name) out.set(id, name) })
  return out
}

async function linesOf(deps: ReportsDeps, orders: OrderDTO[]): Promise<Map<string, OrderItemDTO[]>> {
  const results = await inChunks(orders, (o) => deps.lines.findMany({ orderId: o.id }) as Promise<OrderItemDTO[]>)
  return new Map(orders.map((o, idx) => [o.id, results[idx] ?? []]))
}

function emptyMethods(): Record<SalesMethod, MethodTotals> {
  return { cash: { amount: 0, orders: 0 }, card: { amount: 0, orders: 0 }, transfer: { amount: 0, orders: 0 }, folio: { amount: 0, orders: 0 }, other: { amount: 0, orders: 0 } }
}

function methodOf(paymentMethod: string | undefined): SalesMethod {
  return paymentMethod === 'cash' || paymentMethod === 'card' || paymentMethod === 'transfer' ? paymentMethod : 'other'
}

const isRestaurantPayment = (p: ReportPayment): boolean => p?.metadata?.source === RESTAURANT_SOURCE
const isCharge = (p: ReportPayment): boolean => p.type === 'charge' && (p.status === 'completed' || p.status === 'refunded')
const isRefund = (p: ReportPayment): boolean => p.type === 'refund' && p.status === 'completed'

/** Una venta descompuesta en plata: neto (= subtotal + tax), propina y método. */
interface Sale { net: number; subtotal: number; tax: number; tip: number; method: SalesMethod }

/** Cobro directo: el payment trae el bruto; la propina se descompone con la de la comanda (ver cabecera). */
function saleFromPayment(p: ReportPayment, order: OrderDTO | undefined): Sale {
  const amount = Number(p.amount || 0)
  const tip = Math.min(amount, Math.max(0, Number(order?.tip || 0)))
  const net = amount - tip
  const subtotal = Math.min(net, Math.max(0, Number(order?.subtotal || 0)))
  return { net, subtotal, tax: order ? net - subtotal : 0, tip, method: methodOf(p.method) }
}

/** Cargo a habitación: lo que asentó el folio (neto + su impuesto). */
function saleFromFolioCharge(c: ReportFolioCharge): Sale {
  const subtotal = Number(c.amount || 0), tax = Number(c.taxes || 0)
  return { net: Number(c.total ?? subtotal + tax), subtotal, tax, tip: 0, method: 'folio' }
}

/** Devolución: primero sale de la venta, lo que excede el neto sale de la propina; subtotal/impuesto en la proporción de la comanda. */
function refundBreakdown(p: ReportPayment, order: OrderDTO | undefined): Sale {
  const amount = Number(p.amount || 0)
  const orderNet = Math.max(0, Number(order?.total || 0) - Number(order?.tip || 0))
  const tip = order ? Math.max(0, amount - orderNet) : 0
  const net = amount - tip
  const base = Number(order?.subtotal || 0) + Number(order?.tax || 0)
  const tax = base > 0 ? (net * Number(order?.tax || 0)) / base : 0
  return { net, subtotal: net - tax, tax, tip, method: methodOf(p.method) }
}

/** La comanda de un pago (por `metadata.orderId`): del rango si está, si no una lectura acotada por id + hotel. */
async function orderOfPayment(deps: ReportsDeps, hotelId: string, p: ReportPayment, known: Map<string, OrderDTO>): Promise<OrderDTO | undefined> {
  const orderId = String(p.metadata?.orderId ?? '')
  if (!orderId) return undefined
  const cached = known.get(orderId)
  if (cached) return cached
  const found = (await deps.orders.findOne({ id: orderId, hotelId })) as OrderDTO | null
  if (found) known.set(orderId, found)
  return found ?? undefined
}

/**
 * Cierre del día (o del rango) del restaurante para el hotel del usuario.
 * `now` es inyectable para que "hoy" sea determinista en tests.
 */
export async function dailyReport(deps: ReportsDeps, query: DailyReportQuery | undefined, user: CurrentUser, now: Date = new Date()): Promise<RestaurantDailyReport> {
  const hotelId = hotelFor(user)
  // findOne (no findById): el hotel es el del token, no un id que viene de afuera.
  const hotel = await deps.hotels.findOne({ id: hotelId })
  const timezone = hotelTimezone(hotel)
  const currency = String((hotel as any)?.currency || 'USD')
  const { from, to } = resolveRange(query, timezone, now)
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d)

  // Un día = una consulta de comandas + una de pagos, siempre por hotelId (ver cabecera).
  const perDay = await inChunks(days, async (businessDate) => ({
    businessDate,
    orders: ((await deps.orders.findMany({ hotelId, businessDate })) as OrderDTO[]).filter((o) => o.hotelId === hotelId),
    payments: deps.ports.paymentsOfDay ? (await deps.ports.paymentsOfDay(hotelId, businessDate)).filter(isRestaurantPayment) : [],
  }))
  const dayOfOrder = new Map<string, string>()
  const closed: OrderDTO[] = []
  for (const d of perDay) for (const o of d.orders) { dayOfOrder.set(o.id, d.businessDate); closed.push(o) }
  const sold = closed.filter((o) => SOLD_STATUSES.includes(o.status))
  const cancelled = closed.filter((o) => o.status === 'cancelled')
  const known = new Map<string, OrderDTO>(closed.map((o) => [o.id, o]))

  const lines = await linesOf(deps, [...sold, ...cancelled])

  // ─── Plata: cobros directos (payments) y cargos a habitación (folio), por comanda ───
  const salesByOrder = new Map<string, Sale>()
  const orphanSales: Array<{ sale: Sale; businessDate: string }> = []   // cobros del restaurante sin comanda en el rango
  for (const d of perDay) {
    for (const p of d.payments.filter(isCharge)) {
      const order = await orderOfPayment(deps, hotelId, p, known)
      const sale = saleFromPayment(p, order)
      if (order && dayOfOrder.has(order.id) && !salesByOrder.has(order.id)) salesByOrder.set(order.id, sale)
      else orphanSales.push({ sale, businessDate: d.businessDate })
    }
  }
  const folioOrders = sold.filter((o) => o.settlement === 'folio' || o.status === 'charged')
  const folioCharges = deps.ports.folioCharge
    ? await inChunks(folioOrders, (o) => deps.ports.folioCharge!(hotelId, posReference(o.id)))
    : folioOrders.map(() => null)
  folioOrders.forEach((o, idx) => { const c = folioCharges[idx]; if (c) salesByOrder.set(o.id, saleFromFolioCharge(c)) })

  // ─── Ventas ───
  const byMethod = emptyMethods()
  const byType: Record<OrderType, MethodTotals> = { dine_in: { amount: 0, orders: 0 }, room_service: { amount: 0, orders: 0 }, takeaway: { amount: 0, orders: 0 } }
  const byHourMap = new Map<number, HourTotals>()
  const byDayMap = new Map<string, DayTotals>(days.map((d) => [d, { date: d, orders: 0, amount: 0, tips: 0 }]))
  const items = new Map<string, ItemTotals>()
  const stations = new Map<string, StationTotals>()
  let subtotal = 0, tax = 0, tips = 0, covers = 0
  const addMoney = (s: Sale, businessDate: string) => {
    subtotal += s.subtotal; tax += s.tax; tips += s.tip
    byMethod[s.method].amount += s.net; byMethod[s.method].orders += 1
    const day = byDayMap.get(businessDate)
    if (day) { day.amount += s.net; day.tips += s.tip }
  }

  for (const o of sold) {
    const businessDate = dayOfOrder.get(o.id) as string
    const sale = salesByOrder.get(o.id)
    const net = sale?.net ?? 0
    if (sale) addMoney(sale, businessDate)
    else { const m: SalesMethod = o.settlement === 'folio' || o.status === 'charged' ? 'folio' : 'other'; byMethod[m].orders += 1 }
    if (o.type === 'dine_in' && Number.isFinite(Number(o.covers)) && Number(o.covers) > 0) covers += Number(o.covers)

    const type: OrderType = byType[o.type] ? o.type : 'dine_in'
    byType[type].amount += net; byType[type].orders += 1
    const day = byDayMap.get(businessDate)
    if (day) day.orders += 1
    const local = o.closedAt ? localDateHour(o.closedAt, timezone) : null
    if (local) {
      const h = byHourMap.get(local.hour) ?? { hour: local.hour, orders: 0, amount: 0 }
      h.orders += 1; h.amount += net; byHourMap.set(local.hour, h)
    }

    for (const l of (lines.get(o.id) ?? []).filter(isLineActive).filter(isSellable)) {
      const key = l.menuItemId || `name:${l.name}`
      const it = items.get(key) ?? { menuItemId: l.menuItemId || null, name: l.name, quantity: 0, amount: 0 }
      it.quantity += Number(l.quantity || 0); it.amount += lineGross(l); items.set(key, it)
      const sKey = l.stationId || 'none'
      const st = stations.get(sKey) ?? { stationId: l.stationId || null, stationName: l.stationName || 'Sin estación', quantity: 0, amount: 0 }
      st.quantity += Number(l.quantity || 0); st.amount += lineGross(l); stations.set(sKey, st)
    }
  }
  for (const { sale, businessDate } of orphanSales) addMoney(sale, businessDate)

  // ─── Anulaciones: comandas canceladas (todas sus líneas) + líneas anuladas dentro de comandas vendidas ───
  const voidRows: VoidRow[] = []
  let voidedLinesCount = 0, voidedAmount = 0
  for (const o of cancelled) {
    const ls = (lines.get(o.id) ?? []).filter(isSellable)
    const amount = ls.reduce((s, l) => s + lineGross(l), 0)
    const firstVoided = ls.find((l) => l.status === 'voided')
    voidedAmount += amount
    voidRows.push({
      kind: 'order', orderId: o.id, orderNumber: o.number ?? null,
      name: ls.length ? ls.map((l) => `${l.quantity}× ${l.name}`).join(', ') : 'Sin consumos',
      quantity: ls.reduce((s, l) => s + Number(l.quantity || 0), 0),
      amount: round2(amount),
      reason: o.cancelReason || firstVoided?.voidReason || null,
      at: o.closedAt ?? null, by: firstVoided?.voidedBy ?? null,
    })
  }
  for (const o of sold) {
    for (const l of (lines.get(o.id) ?? []).filter((x) => !isLineActive(x)).filter(isSellable)) {
      const amount = lineGross(l)
      voidedLinesCount += 1; voidedAmount += amount
      voidRows.push({
        kind: 'line', orderId: o.id, orderNumber: o.number ?? null, name: l.name,
        quantity: Number(l.quantity || 0), amount: round2(amount),
        reason: l.voidReason ?? null, at: l.voidedAt ?? o.closedAt ?? null, by: l.voidedBy ?? null,
      })
    }
  }

  // ─── Devoluciones: `payments` type:'refund' del día, restan del método y de la propina ───
  let refundsCount = 0, refundedAmount = 0
  for (const d of perDay) {
    for (const p of d.payments.filter(isRefund)) {
      const order = await orderOfPayment(deps, hotelId, p, known)
      const r = refundBreakdown(p, order)
      refundsCount += 1; refundedAmount += Number(p.amount || 0)
      subtotal -= r.subtotal; tax -= r.tax; tips -= r.tip
      byMethod[r.method].amount -= r.net
      const day = byDayMap.get(d.businessDate)
      if (day) { day.amount -= r.net; day.tips -= r.tip }
      voidRows.push({
        kind: 'refund', orderId: order?.id ?? String(p.metadata?.orderId ?? ''), orderNumber: order?.number ?? null,
        name: 'Reembolso de la comanda', quantity: 0, amount: round2(Number(p.amount || 0)), reason: null,
        at: p.processedAt ?? p.createdAt ?? null, by: p.createdBy || null,
      })
    }
  }
  voidRows.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))

  // ─── Descuentos y cortesías (#215): líneas activas con descuento + descuento de comanda, en comandas vendidas ───
  const discountRows: DiscountRow[] = []
  const discountedOrders = new Set<string>()
  for (const o of sold) {
    for (const l of (lines.get(o.id) ?? []).filter(isLineActive).filter(isSellable)) {
      const amount = Number(l.discountAmount || 0)
      if (!l.discountType || amount <= 0) continue
      const base = Number(l.lineTotal || 0)
      discountedOrders.add(o.id)
      discountRows.push({
        kind: 'line', orderId: o.id, orderNumber: o.number ?? null, name: l.name, quantity: Number(l.quantity || 0),
        base: round2(base), amount: round2(amount), percent: base > 0 ? round2((amount / base) * 100) : 0,
        courtesy: isCourtesy(base, amount), reason: l.discountReason ?? null, at: l.discountAt ?? null, by: l.discountBy ?? null, byName: null,
      })
    }
    const orderAmount = Number(o.discountAmount || 0)
    if (o.discountType && orderAmount > 0) {
      // La base del descuento de comanda es la suma de líneas ya descontadas = subtotal + lo que se restó.
      const base = Number(o.subtotal || 0) + orderAmount
      discountedOrders.add(o.id)
      discountRows.push({
        kind: 'order', orderId: o.id, orderNumber: o.number ?? null, name: 'Comanda completa', quantity: 0,
        base: round2(base), amount: round2(orderAmount), percent: base > 0 ? round2((orderAmount / base) * 100) : 0,
        courtesy: isCourtesy(base, orderAmount), reason: o.discountReason ?? null, at: o.discountAt ?? null, by: o.discountBy ?? null, byName: null,
      })
    }
  }
  const names = await userNames(deps, discountRows.map((r) => r.by || ''))
  for (const r of discountRows) r.byName = r.by ? names.get(r.by) ?? null : null
  discountRows.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
  const courtesyRows = discountRows.filter((r) => r.courtesy)

  const total = round2(subtotal + tax)
  const ordersCount = sold.length
  const roundMethods = <K extends string>(rec: Record<K, MethodTotals>): Record<K, MethodTotals> => {
    for (const k of Object.keys(rec) as K[]) rec[k] = { amount: round2(rec[k].amount), orders: rec[k].orders }
    return rec
  }
  const roundItems = (list: ItemTotals[]) => list.map((i) => ({ ...i, amount: round2(i.amount) }))
  const allItems = [...items.values()]

  return {
    from, to, timezone, currency,
    empty: ordersCount === 0 && cancelled.length === 0 && refundsCount === 0 && voidedLinesCount === 0 && orphanSales.length === 0,
    sales: {
      total, subtotal: round2(subtotal), tax: round2(tax), tips: round2(tips), collected: round2(total + tips),
      orders: ordersCount,
      averageTicket: ordersCount ? round2(total / ordersCount) : 0,
      covers,
      averagePerCover: covers ? round2(total / covers) : 0,
    },
    byMethod: roundMethods(byMethod),
    byType: roundMethods(byType),
    voided: { orders: cancelled.length, lines: voidedLinesCount, amount: round2(voidedAmount), rows: voidRows },
    refunded: { orders: refundsCount, amount: round2(refundedAmount) },
    discounts: {
      orders: discountedOrders.size, count: discountRows.length,
      amount: round2(discountRows.reduce((s, r) => s + r.amount, 0)),
      courtesies: { count: courtesyRows.length, amount: round2(courtesyRows.reduce((s, r) => s + r.amount, 0)) },
      rows: discountRows,
    },
    topItemsByQuantity: roundItems([...allItems].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount).slice(0, TOP_ITEMS)),
    topItemsByAmount: roundItems([...allItems].sort((a, b) => b.amount - a.amount || b.quantity - a.quantity).slice(0, TOP_ITEMS)),
    byStation: [...stations.values()].map((s) => ({ ...s, amount: round2(s.amount) })).sort((a, b) => b.amount - a.amount),
    byHour: [...byHourMap.values()].map((h) => ({ ...h, amount: round2(h.amount) })).sort((a, b) => a.hour - b.hour),
    byDay: [...byDayMap.values()].map((d) => ({ ...d, amount: round2(d.amount), tips: round2(d.tips) })),
  }
}
