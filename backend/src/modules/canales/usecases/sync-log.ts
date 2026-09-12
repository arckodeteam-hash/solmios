const SYNC_ACTION_LABELS: Record<string, string> = {
  sync_property: 'Sincronización de propiedad',
  ingest_bookings: 'Recepción de reservas',
  push_availability: 'Disponibilidad enviada',
  push_rates: 'Tarifas enviadas',
  push_rate_overrides: 'Tarifas por fecha enviadas',
  open_channel_test: 'Open Channel: prueba de conexión',
  open_channel_mapping: 'Open Channel: pedido de mapeo',
  open_channel_change: 'Open Channel: cambio recibido',
  ingest_bookings_cron: 'Reservas: barrido del feed (cron)',
  ingest_booking_webhook: 'Reservas: revisión ingestada por webhook',
  recover_bookings: 'Reservas: rescate desde /bookings',
  // #347 — lo que el transporte le cuenta al registro (channex-trail.ts)
  channex_throttled: 'Channex: push en espera por límite de peticiones',
  channex_rate_limited: 'Channex: 429 — se reintenta',
  channex_server_error: 'Channex: error del servidor — se reintenta',
  channex_network_error: 'Channex: sin respuesta (red/timeout) — se reintenta',
  channex_retry_exhausted: 'Channex: reintentos agotados, el push NO salió',
  channex_rejected: 'Channex: petición rechazada (4xx)',
  webhook_ingested: 'Webhook: reserva recibida e ingestada',
  webhook_ingest_failed: 'Webhook: reserva recibida, la ingesta falló (queda para el cron)',
  webhook_feed_fallback: 'Webhook: aviso sin ids, se barrió el feed',
  webhook_rejected: 'Webhook: llamada rechazada (credencial inválida)',
  webhook_no_payload: 'Webhook: aviso sin ids y sin evento de reserva',
  webhook_own_event: 'Webhook: eco de un cambio propio, descartado',
}

/** Acciones y estados que acepta el filtro del registro de admin (lo que existe, no texto libre). */
export const SYNC_ACTIONS = Object.keys(SYNC_ACTION_LABELS)
export const SYNC_STATUSES = ['success', 'warning', 'error'] as const

/** Nombres legibles de las claves que escriben los pushes ARI (`ari-tasks.ts`). */
const DETAIL_LABELS: Record<string, string> = {
  taskIds: 'tareas',
  entries: 'entradas',
  calls: 'llamadas',
  error: 'error',
  endpoint: 'endpoint',
  path: 'ruta',
  propertyIds: 'property',
  waitSec: 'espera (s)',
  reason: 'motivo',
  httpStatus: 'HTTP',
  attempt: 'intento',
  retryAfter: 'Retry-After',
  backoffMs: 'backoff (ms)',
  willRetry: 'reintenta',
  propertyPausedSec: 'property en pausa (s)',
  revisionId: 'revisión',
  propertyId: 'property',
  event: 'evento',
  feedSize: 'en el feed',
  ingested: 'ingestadas',
  acknowledged: 'confirmadas',
  skipped: 'ya existentes',
  unmapped: 'sin hotel',
  suspended: 'hotel suspendido',
  errors: 'errores',
}

/** Claves que no aportan al texto de la tabla (ya están como columna o son ruido). */
const DETAIL_HIDDEN = new Set(['waitMs'])

/** `details` ya parseado a objeto, venga como json string o como objeto del ORM. */
function parseDetails(d: any): any {
  if (d === null || d === undefined) return null
  if (typeof d === 'string') { try { return JSON.parse(d) } catch { return d } }
  return d
}

/** Convierte el objeto `details` (json) del sync_log en un texto legible para la tabla del panel. */
export function formatSyncDetails(d: any): string {
  const obj = parseDetails(d)
  if (obj === null || obj === undefined) return ''
  if (typeof obj !== 'object') return String(obj)
  return Object.entries(obj)
    .filter(([k, v]) => !DETAIL_HIDDEN.has(k) && v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${DETAIL_LABELS[k] || k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join(' · ')
}

/** Los task ids de una fila, sueltos, para que el panel los muestre copiables. */
export function syncTaskIds(d: any): string[] {
  const obj = parseDetails(d)
  const ids = obj && typeof obj === 'object' ? (obj as any).taskIds : null
  return Array.isArray(ids) ? ids.filter((x: unknown): x is string => typeof x === 'string') : []
}

/**
 * Historial de sincronización desde la tabla `sync_log` (donde el sync/ingest escriben).
 * Antes se leía de Configuration('channex_sync_log'), fuente que nadie escribía → el historial
 * salía siempre vacío. Devuelve los últimos 50, más nuevos primero, con acción/detalle legibles.
 */
export async function getSyncLog(syncLogRepo: any, hotelId?: string): Promise<any[]> {
  if (!syncLogRepo) return []
  // Orden y tope en la consulta (#347): antes traía la tabla entera del hotel a memoria — en prod
  // un hotel con Open Channel tenía 3.000+ filas de "cambio recibido" para mostrar 50.
  const rows = (await syncLogRepo.findMany(hotelId ? { hotelId } : {}, { limit: 50, orderBy: { field: 'createdAt', dir: 'DESC' } })) as any[]
  return rows.map(toSyncLogRow)
}

/** La fila tal como la ven el panel del hotel y el registro del admin. */
export function toSyncLogRow(r: any) {
  return {
    id: r.id,
    hotelId: r.hotelId,
    channel: r.channel,
    status: r.status,
    createdAt: r.createdAt,
    actionKey: r.action,
    action: SYNC_ACTION_LABELS[r.action] || r.action,
    details: formatSyncDetails(r.details),
    // Sueltos además del texto: el panel los muestra copiables (los pide la certificación PMS).
    taskIds: syncTaskIds(r.details),
  }
}

export interface ChannexLogQuery {
  hotelId?: string
  status?: string
  action?: string
  page?: number
  limit?: number
}

/**
 * Registro de TODOS los hoteles para el super-admin (#347): paginado en la consulta, más nuevo
 * primero. `hotelId='platform'` son las filas de cuenta (cron, webhook sin property, errores de
 * red antes de saber de quién era el push). Los filtros son por igualdad, lo único que sabe el ORM.
 */
export async function listChannexLog(syncLogRepo: any, q: ChannexLogQuery = {}): Promise<{ items: any[]; total: number; page: number; limit: number; pages: number }> {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit) || 50)))
  const page = Math.max(1, Math.floor(Number(q.page) || 1))
  if (!syncLogRepo) return { items: [], total: 0, page, limit, pages: 0 }
  const filters: Record<string, unknown> = {}
  if (q.hotelId) filters.hotelId = q.hotelId
  if (q.status && (SYNC_STATUSES as readonly string[]).includes(q.status)) filters.status = q.status
  if (q.action && SYNC_ACTIONS.includes(q.action)) filters.action = q.action
  const res = await syncLogRepo.paginate(filters, { limit, offset: (page - 1) * limit, orderBy: { field: 'createdAt', dir: 'DESC' } })
  // `items`, no `data`: el cliente HTTP del frontend trata `{data: [...], total}` como envelope de lista.
  return { items: (res.data as any[]).map(toSyncLogRow), total: res.total, page, limit, pages: res.pages }
}
