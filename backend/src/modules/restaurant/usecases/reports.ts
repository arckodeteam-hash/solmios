// restaurant/usecases/reports.ts — Cierre del día del restaurante (#213, epic #202).
//
// Hasta acá el único "reporte" del POS era el cierre de turno de caja, que SOLO ve efectivo: lo
// cobrado con tarjeta, por transferencia o cargado a la habitación no consolidaba en ningún lado y el
// dueño no podía responder "¿cuánto vendió el restaurante ayer y por qué medio?". Este usecase arma
// ese cierre a partir de las comandas TERMINALES del rango (`paid`/`charged` = ventas; `cancelled` y
// líneas `voided` = anulaciones con motivo; `refunded` = devoluciones) más el método real de cada cobro,
// que vive en `payments` (fuente única del dinero, CLAUDE.md) y entra por un puerto que inyecta el
// conector `restaurante-payments` — el módulo no importa payments.
//
// Acotación de las consultas: el ORM del framework solo arma igualdades (`buildWhere`, sin rangos ni
// IN), así que el rango de fechas no puede ir en el WHERE. Se pide `findMany({ hotelId, status })`
// por cada estado terminal (nunca la tabla entera ni otro hotel) y el rango se aplica en memoria
// sobre `closedAt`; las líneas se piden POR COMANDA del rango (índice `orderId`), no todas las del
// hotel, para que el costo crezca con el período consultado y no con el histórico.
//
// Día del hotel: `closedAt` es ISO UTC; el corte de "hoy" y la franja horaria se calculan en
// `hotels.timezone` (misma regla que hotel-schedule.ts — medianoche UTC no es medianoche del hotel).
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, CurrentUser, OrderType } from '../types'
import { round2 } from '../../../shared/utils/money'
import { hotelTimezone, zonedTimeToUtc } from '../../../shared/utils/hotel-schedule'
import { isLineActive } from './order-totals'

// ─── Puertos ───
export interface ReportPorts {
  /**
   * Método real (`cash|card|transfer|…`) de UN payment, por id — null si no existe o no es del hotel.
   * Lo provee el conector restaurante-reports-payments; sin puerto, todo cobro directo se reporta como
   * `other`. El ORM no tiene IN, así que es una ida por comanda: el usecase las agrupa en tandas acotadas.
   */
  paymentMethod?: (paymentId: string, user: CurrentUser) => Promise<string | null>
}

export interface ReportsDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  hotels: RepositoryAdapter<any>
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

export interface RestaurantDailyReport {
  from: string
  to: string
  timezone: string
  currency: string
  /** true si no hubo ventas, anulaciones ni reembolsos en el rango: la UI muestra estado vacío, no ceros. */
  empty: boolean
  sales: {
    /** Ventas sin propina (subtotal + impuesto). Es lo que se compara con "cuánto vendió". */
    total: number
    subtotal: number
    tax: number
    tips: number
    /** total + tips: lo que efectivamente entró (cobro directo + cargos a folio). */
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
  refunded: { orders: number; amount: number }
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
/** Estados en los que una comanda ya cerró y tiene `closedAt` (ver order-totals.TERMINAL_ORDER_STATUSES). */
const SOLD_STATUSES: OrderDTO['status'][] = ['paid', 'charged']
const CLOSED_STATUSES: OrderDTO['status'][] = ['paid', 'charged', 'cancelled', 'refunded']
/** Concurrencia al pedir líneas por comanda y métodos por payment: acotada para no abrir miles de consultas a la vez en PG. */
const LINES_CONCURRENCY = 25

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

/** Fecha ('YYYY-MM-DD') y hora (0-23) de un instante en la zona del hotel. */
export function localDateHour(iso: string, timeZone: string): { date: string; hour: number } | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(new Date(t))
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return { date: `${at('year')}-${at('month')}-${at('day')}`, hour: Number(at('hour')) }
}

/** Hoy en la zona del hotel. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateHour(now.toISOString(), timeZone)!.date
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

/** Monto bruto de una línea (neto + su impuesto congelado). */
function lineGross(l: OrderItemDTO): number {
  const net = Number(l.lineTotal || 0)
  return net + (net * Number(l.taxRate || 0)) / 100
}

/** Las líneas que cuentan como "un plato": nunca los componentes de un combo (van en 0, el header lleva el precio). */
const isSellable = (l: OrderItemDTO): boolean => l.kind !== 'combo_component'

/** `Promise.all` por tandas de LINES_CONCURRENCY. */
async function inChunks<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += LINES_CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + LINES_CONCURRENCY).map(fn))))
  }
  return out
}

async function linesOf(deps: ReportsDeps, orders: OrderDTO[]): Promise<Map<string, OrderItemDTO[]>> {
  const results = await inChunks(orders, (o) => deps.lines.findMany({ orderId: o.id }) as Promise<OrderItemDTO[]>)
  return new Map(orders.map((o, idx) => [o.id, results[idx] ?? []]))
}

/** Método real de cada cobro directo (payments), por paymentId. Un payment que falle u otro hotel → se omite (cae en `other`). */
async function paymentMethodsOf(deps: ReportsDeps, paymentIds: string[], user: CurrentUser): Promise<Record<string, string>> {
  const port = deps.ports.paymentMethod
  if (!port || !paymentIds.length) return {}
  const methods = await inChunks(paymentIds, (id) => port(id, user).catch(() => null))
  const out: Record<string, string> = {}
  paymentIds.forEach((id, idx) => { const m = methods[idx]; if (m) out[id] = m })
  return out
}

function emptyMethods(): Record<SalesMethod, MethodTotals> {
  return { cash: { amount: 0, orders: 0 }, card: { amount: 0, orders: 0 }, transfer: { amount: 0, orders: 0 }, folio: { amount: 0, orders: 0 }, other: { amount: 0, orders: 0 } }
}

function methodOf(order: OrderDTO, paymentMethods: Record<string, string>): SalesMethod {
  if (order.settlement === 'folio' || order.status === 'charged') return 'folio'
  const m = order.paymentId ? paymentMethods[order.paymentId] : undefined
  if (m === 'cash' || m === 'card' || m === 'transfer') return m
  return 'other'
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
  const startMs = zonedTimeToUtc(from, '00:00', timezone).getTime()
  const endMs = zonedTimeToUtc(addDays(to, 1), '00:00', timezone).getTime()

  // Una consulta por estado terminal, siempre con hotelId; el rango se corta en memoria (ver cabecera).
  const perStatus = await Promise.all(CLOSED_STATUSES.map((status) => deps.orders.findMany({ hotelId, status }) as Promise<OrderDTO[]>))
  const inRange = (o: OrderDTO): boolean => {
    if (o.hotelId !== hotelId || !o.closedAt) return false
    const t = Date.parse(o.closedAt)
    return Number.isFinite(t) && t >= startMs && t < endMs
  }
  const closed = perStatus.flat().filter(inRange)
  const sold = closed.filter((o) => SOLD_STATUSES.includes(o.status))
  const cancelled = closed.filter((o) => o.status === 'cancelled')
  const refunded = closed.filter((o) => o.status === 'refunded')

  const lines = await linesOf(deps, [...sold, ...cancelled])

  // Método real de cada cobro directo (el folio no tiene payment).
  const paymentIds = sold.filter((o) => o.settlement !== 'folio' && o.paymentId).map((o) => o.paymentId as string)
  const paymentMethods = await paymentMethodsOf(deps, paymentIds, user)

  // ─── Ventas ───
  const byMethod = emptyMethods()
  const byType: Record<OrderType, MethodTotals> = { dine_in: { amount: 0, orders: 0 }, room_service: { amount: 0, orders: 0 }, takeaway: { amount: 0, orders: 0 } }
  const byHourMap = new Map<number, HourTotals>()
  const byDayMap = new Map<string, DayTotals>()
  for (let d = from; d <= to; d = addDays(d, 1)) byDayMap.set(d, { date: d, orders: 0, amount: 0, tips: 0 })
  const items = new Map<string, ItemTotals>()
  const stations = new Map<string, StationTotals>()
  let subtotal = 0, tax = 0, tips = 0, covers = 0

  for (const o of sold) {
    const oSub = Number(o.subtotal || 0), oTax = Number(o.tax || 0), oTip = Number(o.tip || 0)
    const net = oSub + oTax   // venta sin propina
    subtotal += oSub; tax += oTax; tips += oTip
    if (o.type === 'dine_in' && Number.isFinite(Number(o.covers)) && Number(o.covers) > 0) covers += Number(o.covers)

    const m = methodOf(o, paymentMethods)
    byMethod[m].amount += net; byMethod[m].orders += 1
    const type: OrderType = byType[o.type] ? o.type : 'dine_in'
    byType[type].amount += net; byType[type].orders += 1

    const local = localDateHour(o.closedAt as string, timezone)
    if (local) {
      const h = byHourMap.get(local.hour) ?? { hour: local.hour, orders: 0, amount: 0 }
      h.orders += 1; h.amount += net; byHourMap.set(local.hour, h)
      const day = byDayMap.get(local.date)
      if (day) { day.orders += 1; day.amount += net; day.tips += oTip }
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
  let refundedAmount = 0
  for (const o of refunded) {
    refundedAmount += Number(o.total || 0)
    voidRows.push({
      kind: 'refund', orderId: o.id, orderNumber: o.number ?? null, name: 'Reembolso de la comanda',
      quantity: 0, amount: round2(Number(o.total || 0)), reason: null, at: o.closedAt ?? null, by: null,
    })
  }
  voidRows.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))

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
    empty: ordersCount === 0 && cancelled.length === 0 && refunded.length === 0 && voidedLinesCount === 0,
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
    refunded: { orders: refunded.length, amount: round2(refundedAmount) },
    topItemsByQuantity: roundItems([...allItems].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount).slice(0, TOP_ITEMS)),
    topItemsByAmount: roundItems([...allItems].sort((a, b) => b.amount - a.amount || b.quantity - a.quantity).slice(0, TOP_ITEMS)),
    byStation: [...stations.values()].map((s) => ({ ...s, amount: round2(s.amount) })).sort((a, b) => b.amount - a.amount),
    byHour: [...byHourMap.values()].map((h) => ({ ...h, amount: round2(h.amount) })).sort((a, b) => a.hour - b.hour),
    byDay: [...byDayMap.values()].map((d) => ({ ...d, amount: round2(d.amount), tips: round2(d.tips) })),
  }
}
