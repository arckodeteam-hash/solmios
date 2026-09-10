// admin/usecases/billing.ts — la facturación de la PLATAFORMA para el super-admin (REQ-BIL-04).
//
// Lee `platform_invoices` (la tabla que BIL-1 llenó desde los webhooks de Stripe y el backfill).
// Antes de esto `/admin/billing` fabricaba las facturas al vuelo desde `listSubscriptions`: una
// fila por HOTEL, con el precio del plan como monto, la fecha de alta del hotel como fecha de
// emisión y "Pagado" para todos. No era una factura, era una suposición.
//
// Dos reglas que valen para todo lo de acá:
//
//  - Los filtros se aplican en el SERVIDOR. El listado del super-admin cruza todos los hoteles:
//    mandarle la tabla entera al navegador para que filtre ahí es la diferencia entre una página
//    y todo el historial de cobros de la plataforma.
//  - `hotelName` se resuelve con un Map cargado UNA vez (mismo patrón que `dashboard-queries.ts`).
//    Un `findById` por fila es un N+1 que se nota con 500 facturas.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import { round2 } from '../../../shared/utils/money'
import {
  remindInvoice, registerManualPayment,
  type Actor, type BillingActionDeps, type ManualPaymentInput, type ManualPaymentResult, type RemindResult,
} from './billing-actions'

/** Página por defecto y techo: el super-admin puede pedir más, pero no la tabla entera. */
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200

export interface PlatformBillingDeps {
  invoicesRepo: RepositoryAdapter<any>
  hotelsRepo: RepositoryAdapter<any>
  subscriptionsRepo: RepositoryAdapter<any>
  logger: Logger
  /** MRR real (solo suscripciones `active`), de `dashboard-queries.listSubscriptions()`. */
  readMrr: () => Promise<number>
}

export interface InvoiceQuery {
  status?: string
  planId?: string
  /** Rango sobre `issuedAt`, en fechas `YYYY-MM-DD` (inclusive las dos puntas). */
  from?: string
  to?: string
  /** Busca en número, nombre del hotel y referencia. */
  q?: string
  page?: number
  limit?: number
}

export interface PlatformInvoiceDTO {
  id: string
  number: string
  hotelId: string
  hotelName: string
  planId: string
  planName: string
  status: string
  method: string
  currency: string
  amountDue: number
  amountPaid: number
  issuedAt: string
  dueAt: string
  paidAt: string
  periodStart: string
  periodEnd: string
  reference: string
  hostedInvoiceUrl: string
  invoicePdfUrl: string
  notes: string
  lastReminderAt: string
  /** `open` con vencimiento pasado. Se calcula acá para que la UI no tenga que rehacer la cuenta. */
  overdue: boolean
}

export interface PlatformInvoiceDetailDTO extends PlatformInvoiceDTO {
  hotelEmail: string
  subscriptionStatus: string
  isRecurring: boolean
  currentPeriodEnd: string
}

export interface PlatformBillingStats {
  collected: number
  open: number
  overdue: number
  failed: number
  /** % de lo cobrado sobre lo facturado (cobrado + pendiente + fallido). */
  collectionRate: number
  mrr: number
}

export interface PlatformInvoicePage {
  data: PlatformInvoiceDTO[]
  total: number
  page: number
  limit: number
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const num = (v: unknown): number => round2(Number(v) || 0)

/** `YYYY-MM-DD` de un ISO. Comparar por día evita que un `to` sin hora deje afuera el último día. */
const day = (iso: unknown): string => str(iso).slice(0, 10)

/**
 * Una factura `open` cuyo vencimiento ya pasó. `void`/`paid` nunca están vencidas, y una `failed`
 * tampoco: esa ya tiene su propio estado, contarla dos veces inflaría el reclamo.
 */
function isOverdue(row: any, now: Date): boolean {
  if (row.status !== 'open') return false
  const due = str(row.dueAt)
  return due !== '' && new Date(due).getTime() < now.getTime()
}

function toDTO(row: any, hotelName: string, now: Date): PlatformInvoiceDTO {
  return {
    id: str(row.id),
    number: str(row.number),
    hotelId: str(row.hotelId),
    hotelName,
    planId: str(row.planId),
    planName: str(row.planName),
    status: str(row.status),
    method: str(row.method) || 'card',
    currency: str(row.currency) || 'USD',
    amountDue: num(row.amountDue),
    amountPaid: num(row.amountPaid),
    issuedAt: str(row.issuedAt),
    dueAt: str(row.dueAt),
    paidAt: str(row.paidAt),
    periodStart: str(row.periodStart),
    periodEnd: str(row.periodEnd),
    reference: str(row.reference),
    hostedInvoiceUrl: str(row.hostedInvoiceUrl),
    invoicePdfUrl: str(row.invoicePdfUrl),
    notes: str(row.notes),
    lastReminderAt: str(row.lastReminderAt),
    overdue: isOverdue(row, now),
  }
}

/** Nombre del hotel por id, en una sola consulta (ver la regla del N+1 en el encabezado). */
async function hotelNames(deps: PlatformBillingDeps): Promise<Map<string, { name: string; email: string }>> {
  const hotels = ((await deps.hotelsRepo.findMany({})) as any[]) ?? []
  return new Map(hotels.map((h: any) => [str(h.id), { name: str(h.name), email: str(h.email) }]))
}

/**
 * Trae las filas ya filtradas y ordenadas por emisión descendente (la última factura arriba).
 *
 * Las igualdades (`status`, `planId`) se empujan al repo; el rango de fechas y la búsqueda de
 * texto se resuelven en memoria porque el ORM del framework solo sabe comparar por igualdad
 * (`kernel/db/orm-utils.ts:buildWhere` no tiene `>=`, `LIKE` ni `OR`).
 */
async function findFiltered(
  deps: PlatformBillingDeps, query: InvoiceQuery,
): Promise<{ rows: any[]; names: Map<string, { name: string; email: string }> }> {
  const where: Record<string, unknown> = {}
  if (query.status) where.status = query.status
  if (query.planId) where.planId = query.planId

  const [all, names] = await Promise.all([
    deps.invoicesRepo.findMany(where) as Promise<any[]>,
    hotelNames(deps),
  ])

  const from = day(query.from)
  const to = day(query.to)
  const needle = str(query.q).trim().toLowerCase()

  const rows = (all ?? []).filter((row: any) => {
    const issued = day(row.issuedAt)
    if (from && (!issued || issued < from)) return false
    if (to && (!issued || issued > to)) return false
    if (needle) {
      const hotel = names.get(str(row.hotelId))?.name ?? ''
      const haystack = `${str(row.number)} ${hotel} ${str(row.reference)}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })

  // Emisión descendente; a igual fecha, por id, para que la página 2 no repita ni saltee filas.
  rows.sort((a: any, b: any) => {
    const cmp = str(b.issuedAt).localeCompare(str(a.issuedAt))
    return cmp !== 0 ? cmp : str(a.id).localeCompare(str(b.id))
  })
  return { rows, names }
}

/** Listado paginado. `page` arranca en 1. */
export async function listPlatformInvoices(
  deps: PlatformBillingDeps, query: InvoiceQuery = {}, now: Date = new Date(),
): Promise<PlatformInvoicePage> {
  const { rows, names } = await findFiltered(deps, query)
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const page = Math.max(Number(query.page) || 1, 1)
  const slice = rows.slice((page - 1) * limit, (page - 1) * limit + limit)
  return {
    data: slice.map((row) => toDTO(row, names.get(str(row.hotelId))?.name ?? '', now)),
    total: rows.length,
    page,
    limit,
  }
}

/**
 * Detalle de UNA factura, con lo que el modal necesita del hotel y de su suscripción
 * (`isRecurring` decide qué plantilla ofrece el botón "Recordar", REQ-BIL-05).
 */
export async function getPlatformInvoice(
  deps: PlatformBillingDeps, id: string, now: Date = new Date(),
): Promise<PlatformInvoiceDetailDTO> {
  // @ignore IDOR_RISK — ruta de super_admin de plataforma (`auth.authenticate('super_admin')` +
  // `requireUserType('admin')`): las facturas no son de un hotel dueño, son de la plataforma.
  const row = await deps.invoicesRepo.findById(id)
  if (!row) throw new NotFoundError('Factura no encontrada')

  const hotelId = str((row as any).hotelId)
  const names = await hotelNames(deps)
  const hotel = names.get(hotelId)
  // La suscripción se busca por hotel (no por `subscriptionId`): una fila manual puede haberse
  // cargado sin suscripción, y el hotel es el que manda para saber cómo está hoy.
  const sub = ((await deps.subscriptionsRepo.findMany({ hotelId })) as any[])?.[0]

  return {
    ...toDTO(row, hotel?.name ?? '', now),
    hotelEmail: hotel?.email ?? '',
    subscriptionStatus: str(sub?.status),
    isRecurring: sub?.isRecurring === true || sub?.isRecurring === 1,
    currentPeriodEnd: str(sub?.currentPeriodEnd),
  }
}

/**
 * Totales del período (REQ-BIL-04). `overdue` es un SUBCONJUNTO de `open` (lo vencido sigue
 * pendiente), así que no entra dos veces en el denominador de la tasa de cobro.
 *
 * `collected` usa `amountPaid`, con `amountDue` de respaldo: una fila `paid` sin monto pagado
 * (payload recortado, pago manual viejo) contaría cero y bajaría la tasa de cobro sin motivo.
 */
export async function platformBillingStats(
  deps: PlatformBillingDeps, query: InvoiceQuery = {}, now: Date = new Date(),
): Promise<PlatformBillingStats> {
  const { rows } = await findFiltered(deps, { from: query.from, to: query.to })

  let collected = 0, open = 0, overdue = 0, failed = 0
  for (const row of rows) {
    const due = num(row.amountDue)
    if (row.status === 'paid') collected += num(row.amountPaid) || due
    else if (row.status === 'open') { open += due; if (isOverdue(row, now)) overdue += due }
    else if (row.status === 'failed') failed += due
  }

  const billed = collected + open + failed
  return {
    collected: round2(collected),
    open: round2(open),
    overdue: round2(overdue),
    failed: round2(failed),
    collectionRate: billed > 0 ? round2((collected / billed) * 100) : 0,
    mrr: round2(await deps.readMrr()),
  }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
// Separador `;` y BOM UTF-8: es lo que abre bien en el Excel en español (con `,` mete todo en
// una columna, sin BOM los acentos salen rotos).

/** Etiquetas de la columna Estado. El CSV lo abre una persona, no un programa. */
const STATUS_LABEL: Record<string, string> = {
  paid: 'Pagada', open: 'Pendiente', failed: 'Fallida', void: 'Anulada', uncollectible: 'Incobrable',
}
const METHOD_LABEL: Record<string, string> = { card: 'Tarjeta', manual: 'Manual' }

const CSV_HEADERS = [
  'Número', 'Hotel', 'Plan', 'Estado', 'Método', 'Moneda', 'Monto', 'Pagado',
  'Emisión', 'Vencimiento', 'Fecha de pago', 'Referencia', 'Período',
]

/**
 * Escapa una celda. Igual que `reports/helpers.ts:csvValue` (no se importa: los módulos no se
 * importan entre sí), pero con `;` como separador: Excel interpreta como FÓRMULA toda celda que
 * empieza con `= + - @`, así que un nombre de hotel `=cmd|...` se ejecutaría al abrir el archivo.
 */
function csvCell(v: unknown): string {
  let s = str(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  s = s.replace(/"/g, '""')
  return /[";\n\r]/.test(s) ? `"${s}"` : s
}

const period = (row: PlatformInvoiceDTO): string =>
  row.periodStart || row.periodEnd ? `${day(row.periodStart)} → ${day(row.periodEnd)}` : ''

/** CSV con los MISMOS filtros del listado (sin paginar: se exporta lo filtrado, no la página). */
export async function exportPlatformInvoicesCsv(
  deps: PlatformBillingDeps, query: InvoiceQuery = {}, now: Date = new Date(),
): Promise<string> {
  const { rows, names } = await findFiltered(deps, query)
  const lines = [CSV_HEADERS.join(';')]
  for (const raw of rows) {
    const row = toDTO(raw, names.get(str(raw.hotelId))?.name ?? '', now)
    lines.push([
      row.number || (row.method === 'manual' ? `Manual · ${row.reference}` : row.id),
      row.hotelName, row.planName,
      STATUS_LABEL[row.status] ?? row.status,
      METHOD_LABEL[row.method] ?? row.method,
      row.currency, row.amountDue, row.amountPaid,
      day(row.issuedAt), day(row.dueAt), day(row.paidAt),
      row.reference, period(row),
    ].map(csvCell).join(';'))
  }
  // BOM al principio: sin él Excel lee el archivo como Latin-1 y "Número" sale "NÃºmero".
  return `\ufeff${lines.join('\r\n')}\r\n`
}

/**
 * Fachada que usa el service (`admin/service.ts` solo la expone: la lógica vive en las funciones
 * de arriba y en `billing-actions.ts`). Se construye en `admin/index.ts` con los repos; los
 * puertos que llegan tarde —audit log, correo de plataforma, activación de la suscripción— los
 * inyecta el service/connector después con `setActionDeps`.
 */
export class PlatformBillingUseCase {
  /** Puertos que llegan después del arranque (audit log, correo, suscripciones) — ver `setActionDeps`. */
  private actionDeps: Partial<BillingActionDeps> = {}

  constructor(private readonly deps: PlatformBillingDeps) {}

  /**
   * Inyecta los puertos tardíos. Se llama más de una vez (uno por cada cableado: el connector de
   * audit log, el bootstrap de correo, el connector de suscripciones), así que MERGEA en vez de
   * pisar — si reemplazara, el último en cablear dejaría a los otros sin puerto.
   */
  setActionDeps(deps: Partial<BillingActionDeps>): void {
    this.actionDeps = { ...this.actionDeps, ...deps }
  }

  private get fullDeps(): BillingActionDeps { return { ...this.deps, ...this.actionDeps } }

  list(query: InvoiceQuery): Promise<PlatformInvoicePage> { return listPlatformInvoices(this.deps, query) }
  detail(id: string): Promise<PlatformInvoiceDetailDTO> { return getPlatformInvoice(this.deps, id) }
  stats(query: InvoiceQuery): Promise<PlatformBillingStats> { return platformBillingStats(this.deps, query) }
  csv(query: InvoiceQuery): Promise<string> { return exportPlatformInvoicesCsv(this.deps, query) }
  remind(id: string, actor: Actor): Promise<RemindResult> { return remindInvoice(this.fullDeps, id, actor) }
  manualPayment(input: ManualPaymentInput, actor: Actor): Promise<ManualPaymentResult> { return registerManualPayment(this.fullDeps, input, actor) }
}
