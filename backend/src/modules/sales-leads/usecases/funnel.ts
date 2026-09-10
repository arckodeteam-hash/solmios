// sales-leads/usecases/funnel.ts — Embudo semanal registrados → activados → pagando → perdidos
// (REQ-PIPE-10, #151). Se CALCULA, como el pipeline: nada persistido.
//
// Por semana ISO (lunes 00:00 UTC), las últimas N (1..26, default 8, la actual incluida):
// - registered: hoteles con suscripción cuya alta (`hotels.createdAt`) cae en la semana.
// - activated:  de esos, los que cargaron su primera habitación dentro de los 7 días del alta.
//               Se mira la habitación MÁS VIEJA del hotel (`rooms` por hotelId, orderBy createdAt
//               ASC, limit 1): una sola consulta chica por hotel de la ventana.
// - paying:     hoteles cuyo PRIMER cobro de plataforma (`platform_invoices.paidAt` mínimo) cae en
//               la semana. Un `active` sin factura cobrada (alta manual sin registro) cuenta por
//               `paymentMethodAddedAt` y, sin eso, por `updatedAt` de la suscripción — es lo más
//               cercano a "primer active" que hay guardado.
// - lost:       prospectos con `lostAt` en la semana, por `lostReason` (los sin motivo van a `other`).
//
// Las tasas son sobre `registered` de la MISMA semana (así lo define el issue): sirven para leer
// tendencia, no para atribuir un pago a la cohorte exacta — para eso hace falta más historia.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { SalesFunnelResult, SalesFunnelWeek, SalesLostReason, SalesProspectDTO } from '../types'
import { SALES_LOST_REASONS } from '../types'

export interface FunnelDeps {
  subscriptions: RepositoryAdapter<any>
  hotels: RepositoryAdapter<any>
  rooms: RepositoryAdapter<any>
  salesProspects: RepositoryAdapter<SalesProspectDTO>
  platformInvoices: RepositoryAdapter<any>
  now?: () => Date
}

/** Arma las deps del embudo a partir de las del pipeline (mismos repos) más `platform_invoices`. */
export function funnelDepsFrom(
  d: Pick<FunnelDeps, 'subscriptions' | 'hotels' | 'rooms' | 'salesProspects' | 'now'>,
  platformInvoices: RepositoryAdapter<any> | undefined,
): FunnelDeps {
  return {
    subscriptions: d.subscriptions, hotels: d.hotels, rooms: d.rooms, salesProspects: d.salesProspects, now: d.now,
    platformInvoices: platformInvoices ?? ({ findMany: async () => [] } as unknown as RepositoryAdapter<any>),
  }
}

export const FUNNEL_WEEKS_DEFAULT = 8
export const FUNNEL_WEEKS_MAX = 26
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
/** Ventana de activación desde el alta. */
export const ACTIVATION_WINDOW_DAYS = 7
const ROOMS_BATCH = 10

export function parseWeeks(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return FUNNEL_WEEKS_DEFAULT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > FUNNEL_WEEKS_MAX) {
    throw new ValidationError(`weeks: debe ser un entero entre 1 y ${FUNNEL_WEEKS_MAX}`)
  }
  return n
}

/** Lunes 00:00 UTC de la semana que contiene `d`. */
export function startOfIsoWeek(d: Date): Date {
  const day = d.getUTCDay() || 7 // domingo → 7
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - (day - 1))
  return monday
}

/** Etiqueta ISO 8601 `YYYY-Www` de la semana que arranca en `monday`. */
export function isoWeekLabel(monday: Date): string {
  const thursday = new Date(monday.getTime() + 3 * DAY_MS)
  const year = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const week1Monday = startOfIsoWeek(jan4)
  const week = Math.floor((thursday.getTime() - week1Monday.getTime()) / WEEK_MS) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

const ms = (iso: unknown): number => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? NaN : t
}

const pct = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0)

function emptyLost(): Record<SalesLostReason, number> {
  const out = {} as Record<SalesLostReason, number>
  for (const r of SALES_LOST_REASONS) out[r] = 0
  return out
}

/** Índice de semana (0 = la más vieja de la ventana) para un timestamp, o -1 si cae fuera. */
function weekIndexOf(t: number, windowStart: number, weeks: number): number {
  if (Number.isNaN(t) || t < windowStart) return -1
  const idx = Math.floor((t - windowStart) / WEEK_MS)
  return idx >= weeks ? -1 : idx
}

async function earliestRoomAt(deps: FunnelDeps, hotelId: string): Promise<number> {
  const rows = (await deps.rooms.findMany(
    { hotelId },
    { orderBy: { field: 'createdAt', dir: 'ASC' }, limit: 1, select: ['id', 'createdAt'] },
  )) as Array<{ createdAt?: string }>
  return ms(rows[0]?.createdAt)
}

export async function buildFunnel(deps: FunnelDeps, weeks: number): Promise<SalesFunnelResult> {
  const now = deps.now ? deps.now() : new Date()
  const currentMonday = startOfIsoWeek(now)
  const windowStart = currentMonday.getTime() - (weeks - 1) * WEEK_MS

  const buckets: SalesFunnelWeek[] = []
  for (let i = 0; i < weeks; i++) {
    const start = new Date(windowStart + i * WEEK_MS)
    buckets.push({
      week: isoWeekLabel(start),
      start: start.toISOString(),
      end: new Date(start.getTime() + WEEK_MS - 1).toISOString(),
      registered: 0, activated: 0, paying: 0, lost: emptyLost(), lostTotal: 0,
      activationRate: 0, payingRate: 0,
    })
  }

  const [subscriptions, hotels, prospects, invoices] = await Promise.all([
    deps.subscriptions.findMany({}),
    deps.hotels.findMany({}),
    deps.salesProspects.findMany({}),
    deps.platformInvoices.findMany({}),
  ])

  const subByHotel = new Map<string, any>()
  for (const s of subscriptions as any[]) {
    if (!s.hotelId) continue
    const cur = subByHotel.get(s.hotelId)
    if (!cur || String(s.createdAt ?? '') > String(cur.createdAt ?? '')) subByHotel.set(s.hotelId, s)
  }

  // Registrados: alta dentro de la ventana. Guardamos (hotelId, semana, alta) para la activación.
  const registeredInWindow: Array<{ hotelId: string; week: number; registeredAt: number }> = []
  for (const h of hotels as any[]) {
    if (!subByHotel.has(h.id)) continue
    const t = ms(h.createdAt)
    const w = weekIndexOf(t, windowStart, weeks)
    if (w < 0) continue
    buckets[w]!.registered++
    registeredInWindow.push({ hotelId: h.id, week: w, registeredAt: t })
  }

  // Activados: primera habitación dentro de los 7 días del alta (una consulta chica por hotel).
  for (let i = 0; i < registeredInWindow.length; i += ROOMS_BATCH) {
    const batch = registeredInWindow.slice(i, i + ROOMS_BATCH)
    const firstRooms = await Promise.all(batch.map((r) => earliestRoomAt(deps, r.hotelId)))
    batch.forEach((r, j) => {
      const at = firstRooms[j]!
      if (!Number.isNaN(at) && at <= r.registeredAt + ACTIVATION_WINDOW_DAYS * DAY_MS) buckets[r.week]!.activated++
    })
  }

  // Pagando: primer cobro por hotel; sin factura, el `active` cuenta por paymentMethodAddedAt/updatedAt.
  const firstPaidByHotel = new Map<string, number>()
  for (const inv of invoices as any[]) {
    const t = ms(inv.paidAt)
    if (!inv.hotelId || Number.isNaN(t)) continue
    const cur = firstPaidByHotel.get(inv.hotelId)
    if (cur === undefined || t < cur) firstPaidByHotel.set(inv.hotelId, t)
  }
  for (const [hotelId, sub] of subByHotel) {
    let t = firstPaidByHotel.get(hotelId)
    if (t === undefined && sub.status === 'active') t = ms(sub.paymentMethodAddedAt ?? sub.updatedAt)
    if (t === undefined) continue
    const w = weekIndexOf(t, windowStart, weeks)
    if (w >= 0) buckets[w]!.paying++
  }

  // Perdidos: por semana de `lostAt`, agrupados por motivo.
  for (const p of prospects) {
    const w = weekIndexOf(ms(p.lostAt), windowStart, weeks)
    if (w < 0) continue
    const reason = (SALES_LOST_REASONS as readonly string[]).includes(String(p.lostReason)) ? (p.lostReason as SalesLostReason) : 'other'
    buckets[w]!.lost[reason]++
    buckets[w]!.lostTotal++
  }

  const totals = { registered: 0, activated: 0, paying: 0, lost: emptyLost(), lostTotal: 0, activationRate: 0, payingRate: 0 }
  for (const b of buckets) {
    b.activationRate = pct(b.activated, b.registered)
    b.payingRate = pct(b.paying, b.registered)
    totals.registered += b.registered
    totals.activated += b.activated
    totals.paying += b.paying
    totals.lostTotal += b.lostTotal
    for (const r of SALES_LOST_REASONS) totals.lost[r] += b.lost[r]
  }
  totals.activationRate = pct(totals.activated, totals.registered)
  totals.payingRate = pct(totals.paying, totals.registered)

  return { weeks: buckets, totals, weeksCount: weeks, generatedAt: now.toISOString() }
}
