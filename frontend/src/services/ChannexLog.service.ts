import { http } from './http'

// Espeja backend/src/modules/canales › GET /api/admin/channex/log (#347): el registro de TODO lo que
// pasa con Channex, de todos los hoteles, paginado en el servidor. Es la pestaña "Registro" de
// /admin/channex-queue. Cada fila sale de `sync_log`: pushes con sus task ids, esperas por rate
// limit, 429/5xx, reintentos agotados, y lo que hizo el webhook con cada reserva.
// Ojo: las rutas van SIN `/api` (lo agrega `http`), igual que el resto de los services.

export type ChannexLogStatus = 'success' | 'warning' | 'error'

/** `hotelId` de las filas de cuenta (cron del feed, webhook sin property, errores antes de saber el hotel). */
export const CHANNEX_LOG_PLATFORM = 'platform'

export interface ChannexLogRow {
  id: string
  hotelId: string
  channel?: string
  status: ChannexLogStatus | string
  createdAt: string
  /** Clave cruda (`channex_throttled`, `push_availability`…): sirve para filtrar y para el color. */
  actionKey: string
  /** Etiqueta legible, ya traducida por el backend. */
  action: string
  /** Detalle ya formateado como texto ("HTTP: 429 · intento: 1 · …"). */
  details: string
  /** Ids de tarea de Channex de un push, copiables (los pide la certificación PMS). */
  taskIds: string[]
}

export interface ChannexLogPage {
  items: ChannexLogRow[]
  total: number
  page: number
  limit: number
  pages: number
  /** Lo que acepta el filtro del backend: nunca texto libre. */
  filters: { actions: string[]; statuses: string[] }
}

export interface ChannexLogParams {
  hotelId?: string
  status?: ChannexLogStatus
  action?: string
  page?: number
  limit?: number
}

function queryString(params: Record<string, unknown>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

export const ChannexLogService = {
  list: (params: ChannexLogParams = {}) => http.get<ChannexLogPage>(`/admin/channex/log${queryString({ ...params })}`),
}

// Badges con los colores que ya usa el tema (mismo criterio que ARI_OUTBOX_STATUS_META).
export const CHANNEX_LOG_STATUS_META: Record<string, { label: string; class: string }> = {
  success: { label: 'OK', class: 'bg-teal/10 text-teal' },
  warning: { label: 'Aviso', class: 'bg-orange/10 text-orange' },
  error: { label: 'Error', class: 'bg-red/10 text-red' },
}

export function channexLogStatusMeta(status: string) {
  return CHANNEX_LOG_STATUS_META[status] || { label: status, class: 'bg-surface text-text-muted' }
}

/**
 * Etiquetas de las claves de acción para el `<select>` del filtro. El backend ya manda la etiqueta
 * en cada fila, pero el filtro necesita el nombre ANTES de tener filas. Espejo de
 * `SYNC_ACTION_LABELS` (backend/src/modules/canales/usecases/sync-log.ts); una clave que no esté acá
 * se muestra cruda, no se pierde.
 */
export const CHANNEX_LOG_ACTION_LABELS: Record<string, string> = {
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
  channex_throttled: 'Channex: push en espera por límite de peticiones',
  channex_rate_limited: 'Channex: 429 — se reintenta',
  channex_server_error: 'Channex: error del servidor — se reintenta',
  channex_network_error: 'Channex: sin respuesta (red/timeout) — se reintenta',
  channex_retry_exhausted: 'Channex: reintentos agotados, el push NO salió',
  channex_rejected: 'Channex: petición rechazada (4xx)',
  webhook_ingested: 'Webhook: reserva recibida e ingestada',
  webhook_ingest_failed: 'Webhook: reserva recibida, la ingesta falló',
  webhook_feed_fallback: 'Webhook: aviso sin ids, se barrió el feed',
  webhook_rejected: 'Webhook: llamada rechazada (credencial inválida)',
  webhook_no_payload: 'Webhook: aviso sin ids y sin evento de reserva',
  webhook_own_event: 'Webhook: eco de un cambio propio, descartado',
}

export function channexLogActionLabel(key: string): string {
  return CHANNEX_LOG_ACTION_LABELS[key] || key
}
