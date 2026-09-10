// sales-leads/usecases/pipeline.ts — El pipeline de ventas se CALCULA, no se guarda (REQ-PIPE-01/02).
//
// Una fila por hotel registrado (`subscriptions` ⋈ `hotels`) más una por `sales_leads` que todavía
// no tiene hotel. La etapa sale del estado de la suscripción y de si cargó habitaciones; el calor,
// de lo que ya hizo en el producto. Lo único persistido es lo que ventas anota (`sales_prospects`).
//
// Todo entra por repos inyectados (`RepositoryAdapter`): sin SQL, sin importar otros módulos. Las
// señales se piden POR HOTEL y acotadas (`count({hotelId})`, y para la última actividad un
// `findMany({hotelId}, {orderBy createdAt DESC, limit 1})`): son O(hoteles) consultas chicas por
// GET, aceptable para una pantalla de admin. La alternativa —traer `reservations` y `audit_log`
// completos de TODOS los hoteles para agrupar en memoria— cargaba las dos tablas más grandes de
// la base en cada refresco (COR-2).
import type { RepositoryAdapter } from 'arckode-framework'
import { toE164 } from '../../../shared/utils/phone-e164'
import type {
  PipelineHeat, PipelineSignals, PipelineStage, SalesLeadDTO, SalesLeadStatus, SalesPipelineResult,
  SalesPipelineRow, SalesProspectDTO,
} from '../types'

export interface PipelineDeps {
  subscriptions: RepositoryAdapter<any>
  hotels: RepositoryAdapter<any>
  rooms: RepositoryAdapter<any>
  roomRates: RepositoryAdapter<any>
  channelConfig: RepositoryAdapter<any>
  reservations: RepositoryAdapter<any>
  auditlog: RepositoryAdapter<any>
  /** `users`: lista de asignables y validación de `assignedTo` (SEC-3). El pipeline en sí no lo lee. */
  users: RepositoryAdapter<any>
  salesLeads: RepositoryAdapter<SalesLeadDTO>
  salesProspects: RepositoryAdapter<SalesProspectDTO>
  /** Inyectable en tests. */
  now?: () => Date
}

/**
 * País asumido cuando el hotel no cargó el suyo. La plataforma vende en República Dominicana y
 * `hotels.timezone` ya arranca en America/Santo_Domingo: un `809-555-0000` sin país es dominicano
 * antes que ambiguo. Con país cargado, manda el del hotel.
 */
const DEFAULT_COUNTRY = 'DO'
const DAY_MS = 24 * 60 * 60 * 1000
/** Actividad "reciente" para el calor: últimos 3 días. */
const RECENT_ACTIVITY_DAYS = 3

export const HEAT_HOT_MIN = 6
export const HEAT_WARM_MIN = 3

export function whatsappUrlFor(phone: string | null | undefined, country: string | null | undefined): string | null {
  const e164 = toE164(phone, country || DEFAULT_COUNTRY)
  return e164 ? `https://wa.me/${e164}` : null
}

export function heatScoreOf(signals: PipelineSignals, now: Date): number {
  let score = 0
  if (signals.rooms > 0) score += 2
  if (signals.rates > 0) score += 2
  if (signals.channels > 0) score += 3
  if (signals.reservations > 0) score += 3
  if (signals.lastActivityAt) {
    const ageMs = now.getTime() - Date.parse(signals.lastActivityAt)
    if (!Number.isNaN(ageMs) && ageMs <= RECENT_ACTIVITY_DAYS * DAY_MS) score += 2
  }
  return score
}

export function heatOf(score: number): PipelineHeat {
  if (score >= HEAT_HOT_MIN) return 'hot'
  if (score >= HEAT_WARM_MIN) return 'warm'
  return 'cold'
}

/** Días enteros hasta `trialEndsAt` (mañana → 1, hoy más tarde → 1, ayer → -1). Null sin fecha. */
export function daysLeftOf(trialEndsAt: string | null | undefined, now: Date): number | null {
  if (!trialEndsAt) return null
  const end = Date.parse(trialEndsAt)
  if (Number.isNaN(end)) return null
  return Math.ceil((end - now.getTime()) / DAY_MS)
}

/**
 * Etapa de un hotel registrado. `lost` manda sobre todo (una persona decidió); después el estado
 * de la suscripción. Un `canceled`/`suspended`/`past_due` sin `lostAt` cae en `expired`: no está
 * pagando y hay que rescatarlo, que es exactamente lo que esa etapa significa para ventas.
 */
export function stageOfHotel(
  sub: { status?: string | null; trialEndsAt?: string | null } | null,
  rooms: number,
  prospect: Pick<SalesProspectDTO, 'lostAt'> | null,
  now: Date,
): PipelineStage {
  if (prospect?.lostAt) return 'lost'
  const status = sub?.status ?? 'trialing'
  if (status === 'active') return 'paying'
  if (status === 'trialing') {
    const end = sub?.trialEndsAt ? Date.parse(sub.trialEndsAt) : NaN
    if (!Number.isNaN(end) && end < now.getTime()) return 'expired'
    return rooms > 0 ? 'activated' : 'registered'
  }
  return 'expired'
}

const HEAT_RANK: Record<PipelineHeat, number> = { hot: 2, warm: 1, cold: 0 }

/** Orden: `nextStepAt` vencido primero → calor desc → `daysLeft` asc (sin trial al final). */
export function comparePipelineRows(now: Date) {
  const nowMs = now.getTime()
  const overdue = (r: SalesPipelineRow): boolean => {
    if (!r.nextStepAt) return false
    const t = Date.parse(r.nextStepAt)
    return !Number.isNaN(t) && t <= nowMs
  }
  return (a: SalesPipelineRow, b: SalesPipelineRow): number => {
    const oa = overdue(a), ob = overdue(b)
    if (oa !== ob) return oa ? -1 : 1
    if (oa && ob) {
      const d = Date.parse(a.nextStepAt!) - Date.parse(b.nextStepAt!)
      if (d !== 0) return d
    }
    const h = HEAT_RANK[b.heat] - HEAT_RANK[a.heat]
    if (h !== 0) return h
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY
    const db = b.daysLeft ?? Number.POSITIVE_INFINITY
    if (da !== db) return da < db ? -1 : 1
    return String(a.key).localeCompare(String(b.key))
  }
}

const nul = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v))

function prospectFields(p: SalesProspectDTO | null) {
  return {
    nextStepAt: nul(p?.nextStepAt),
    nextStepNote: nul(p?.nextStepNote),
    assignedTo: nul(p?.assignedTo),
    contactedAt: nul(p?.contactedAt),
    lostAt: nul(p?.lostAt),
    lostReason: (nul(p?.lostReason) as SalesPipelineRow['lostReason']),
    notes: nul(p?.notes),
  }
}

/** Hoteles cuyas señales se piden en paralelo por tanda: acota conexiones abiertas contra la base. */
const SIGNALS_BATCH = 10

/**
 * Señales de UN hotel, acotadas a su `hotelId`. Cinco consultas chicas: cuatro `count` y la
 * última fila de `audit_log` (ordenada, `limit: 1`, solo `createdAt`).
 */
async function loadSignals(deps: PipelineDeps, hotelId: string): Promise<PipelineSignals> {
  const [rooms, rates, channels, reservations, lastAudit] = await Promise.all([
    deps.rooms.count({ hotelId }),
    deps.roomRates.count({ hotelId }),
    deps.channelConfig.count({ hotelId }),
    deps.reservations.count({ hotelId }),
    deps.auditlog.findMany({ hotelId }, { orderBy: { field: 'createdAt', dir: 'DESC' }, limit: 1, select: ['id', 'createdAt'] }),
  ])
  const last = (lastAudit as Array<{ createdAt?: string | null }>)[0]
  return { rooms, rates, channels, reservations, lastActivityAt: nul(last?.createdAt) }
}

async function loadSignalsByHotel(deps: PipelineDeps, hotelIds: string[]): Promise<Map<string, PipelineSignals>> {
  const out = new Map<string, PipelineSignals>()
  for (let i = 0; i < hotelIds.length; i += SIGNALS_BATCH) {
    const batch = hotelIds.slice(i, i + SIGNALS_BATCH)
    const results = await Promise.all(batch.map((id) => loadSignals(deps, id)))
    batch.forEach((id, j) => out.set(id, results[j]!))
  }
  return out
}

/**
 * Última suscripción por hotel: si un hotel tiene más de una (re-alta, migración), la más nueva
 * es la que describe su situación de hoy.
 */
function latestSubscriptionByHotel(subscriptions: any[]): Map<string, any> {
  const subByHotel = new Map<string, any>()
  for (const s of subscriptions) {
    if (!s.hotelId) continue
    const cur = subByHotel.get(s.hotelId)
    if (!cur || String(s.createdAt ?? '') > String(cur.createdAt ?? '')) subByHotel.set(s.hotelId, s)
  }
  return subByHotel
}

function hotelRow(hotel: any, sub: any, signals: PipelineSignals, prospect: SalesProspectDTO | null, now: Date): SalesPipelineRow {
  const heatScore = heatScoreOf(signals, now)
  const phone = nul(hotel.phone)
  return {
    key: `hotel:${hotel.id}`,
    hotelId: hotel.id,
    leadId: null,
    hotelName: nul(hotel.name),
    ownerName: nul(hotel.ownerName),
    email: nul(hotel.email),
    phone,
    whatsappUrl: whatsappUrlFor(phone, nul(hotel.country)),
    stage: stageOfHotel(sub, signals.rooms, prospect, now),
    leadStatus: null,
    subscriptionStatus: nul(sub.status),
    planId: nul(sub.planId),
    trialEndsAt: nul(sub.trialEndsAt),
    daysLeft: daysLeftOf(sub.trialEndsAt, now),
    signals,
    heatScore,
    heat: heatOf(heatScore),
    message: null,
    registeredAt: nul(hotel.createdAt) ?? nul(sub.createdAt),
    ...prospectFields(prospect),
  }
}

/**
 * Etapa de un lead sin hotel. `lostAt` del prospecto o `status='lost'` del lead (lo que el admin
 * marcó en /admin/leads) → `lost`; el resto (`new`/`contacted`/`won` sin hotel todavía) es
 * `contact`: hasta que se registre no hay nada más que contacto.
 */
export function stageOfLead(lead: Pick<SalesLeadDTO, 'status'>, prospect: Pick<SalesProspectDTO, 'lostAt'> | null): PipelineStage {
  if (prospect?.lostAt || lead.status === 'lost') return 'lost'
  return 'contact'
}

function leadRow(lead: SalesLeadDTO, prospect: SalesProspectDTO | null): SalesPipelineRow {
  const phone = nul(lead.phone)
  return {
    key: `lead:${lead.id}`,
    hotelId: null,
    leadId: lead.id,
    hotelName: nul(lead.hotelName),
    ownerName: nul(lead.fullName),
    email: nul(lead.email),
    phone,
    whatsappUrl: whatsappUrlFor(phone, null),
    stage: stageOfLead(lead, prospect),
    leadStatus: (nul(lead.status) as SalesLeadStatus | null),
    subscriptionStatus: null,
    planId: nul(lead.planInterest),
    trialEndsAt: null,
    daysLeft: null,
    signals: null,
    heatScore: 0,
    heat: 'cold',
    message: nul(lead.message),
    registeredAt: nul(lead.createdAt),
    ...prospectFields(prospect),
  }
}

export function sortRows(rows: SalesPipelineRow[], now: Date): SalesPipelineRow[] {
  return rows.sort(comparePipelineRows(now))
}

export async function buildPipeline(deps: PipelineDeps): Promise<SalesPipelineResult> {
  const now = deps.now ? deps.now() : new Date()

  const [subscriptions, hotels, leads, prospects] = await Promise.all([
    deps.subscriptions.findMany({}),
    deps.hotels.findMany({}),
    deps.salesLeads.findMany({}),
    deps.salesProspects.findMany({}),
  ])
  const subByHotel = latestSubscriptionByHotel(subscriptions as any[])

  // Inner join (spec REQ-PIPE-01): un hotel sin suscripción no está en el embudo comercial —
  // es el demo o un alta anterior al módulo de suscripciones, no un prospecto.
  const funnelHotels = (hotels as any[]).filter((h) => subByHotel.has(h.id))
  const signalsBy = await loadSignalsByHotel(deps, funnelHotels.map((h) => h.id))

  const prospectByHotel = new Map<string, SalesProspectDTO>()
  const prospectByLead = new Map<string, SalesProspectDTO>()
  for (const p of prospects) {
    if (p.hotelId) prospectByHotel.set(p.hotelId, p)
    else if (p.leadId) prospectByLead.set(p.leadId, p)
  }

  const rows: SalesPipelineRow[] = []
  const hotelEmails = new Set<string>()
  for (const hotel of hotels as any[]) {
    if (hotel.email) hotelEmails.add(String(hotel.email).trim().toLowerCase())
  }
  for (const hotel of funnelHotels) {
    rows.push(hotelRow(hotel, subByHotel.get(hotel.id), signalsBy.get(hotel.id)!, prospectByHotel.get(hotel.id) ?? null, now))
  }
  for (const lead of leads) {
    // Un lead cuyo email ya es de un hotel se registró: su fila es la del hotel, no dos.
    if (lead.email && hotelEmails.has(String(lead.email).trim().toLowerCase())) continue
    rows.push(leadRow(lead, prospectByLead.get(lead.id) ?? null))
  }

  sortRows(rows, now)
  return { data: rows, total: rows.length }
}
