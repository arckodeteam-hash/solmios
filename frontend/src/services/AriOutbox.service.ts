import { http } from './http'

// Espeja backend/src/modules/ari-outbox (rutas de super_admin).
// GET  /api/admin/ari-outbox            → listado paginado de la cola de ARI hacia Channex.
// GET  /api/admin/ari-outbox/stats      → contadores por estado.
// POST /api/admin/ari-outbox/:id/retry  → reintento manual de una fila.
// GET|PUT /api/admin/ari-outbox/config  → reintentos automáticos y peticiones/minuto a Channex.
// Ojo: las rutas van SIN `/api` (lo agrega `http`), igual que el resto de los services.

export type AriOutboxStatus = 'pending' | 'processing' | 'sent' | 'failed'
export type AriOutboxKind = 'rates' | 'inventory'

/** Una fila de la outbox = una ráfaga de cambios de un hotel esperando su push a Channex. */
export interface AriOutboxRow {
  id: string
  hotelId: string
  kind: AriOutboxKind | string
  /** Canales explícitos de la ráfaga. `[]` = cambio global (tarifa base + canales con override). */
  channels: string[]
  status: AriOutboxStatus
  /** ISO: cuándo vence el debounce de la ráfaga, o cuándo toca el próximo reintento. */
  scheduledAt: string
  attempts: number
  maxAttempts: number
  lastError?: string | null
  claimedBy?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AriOutboxPage {
  items: AriOutboxRow[]
  total: number
  page: number
  limit: number
}

/**
 * Contadores del monitor. `retrying` NO es un estado de la tabla: son las `pending` que YA
 * fallaron alguna vez (`attempts > 0`), y `pending` cuenta solo las que nunca fallaron. Son
 * conjuntos DISJUNTOS: `total = pending + retrying + processing + sent + failed`.
 */
export interface AriOutboxStats {
  pending: number
  processing: number
  sent: number
  failed: number
  retrying: number
  total: number
}

/** Config de la cola, a nivel plataforma. Rangos del backend: 1..10 y 1..60. */
export interface AriQueueConfig {
  maxAttempts: number
  maxPerMinute: number
}

export interface AriOutboxListParams {
  hotelId?: string
  status?: AriOutboxStatus
  kind?: AriOutboxKind
  page?: number
  limit?: number
}

/** Los mismos filtros del listado menos `status`: pedir totales por estado filtrando por uno no dice nada. */
export type AriOutboxStatsParams = Omit<AriOutboxListParams, 'status' | 'page' | 'limit'>

function queryString(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') qs.set(key, String(value))
  }
  const query = qs.toString()
  return query ? `?${query}` : ''
}

export const AriOutboxService = {
  list: (params: AriOutboxListParams = {}) =>
    http.get<AriOutboxPage>(`/admin/ari-outbox${queryString({ ...params })}`),

  stats: (params: AriOutboxStatsParams = {}) =>
    http.get<AriOutboxStats>(`/admin/ari-outbox/stats${queryString({ ...params })}`),

  /** Devuelve la fila a `pending` con los intentos en 0 y sin dueño: el próximo drain la toma. */
  retry: (id: string) => http.post<{ item: AriOutboxRow }>(`/admin/ari-outbox/${id}/retry`),

  getConfig: () => http.get<AriQueueConfig>('/admin/ari-outbox/config'),

  /** PUT parcial: el backend saneó los rangos y devuelve la config ya guardada. */
  saveConfig: (patch: Partial<AriQueueConfig>) =>
    http.put<AriQueueConfig>('/admin/ari-outbox/config', patch),
}

/** Estado que se MUESTRA: 'retrying' es una `pending` que ya falló, y se lee distinto. */
export type AriOutboxViewStatus = AriOutboxStatus | 'retrying'

export function ariOutboxViewStatus(row: AriOutboxRow): AriOutboxViewStatus {
  if (row.status === 'pending' && (row.attempts ?? 0) > 0) return 'retrying'
  return row.status
}

// Badges con los colores que ya usa el tema (mismo criterio que EMAIL_STATUS_META).
export const ARI_OUTBOX_STATUS_META: Record<string, { label: string; class: string }> = {
  pending: { label: 'Pendiente', class: 'bg-surface text-text-muted' },
  retrying: { label: 'En reintento', class: 'bg-orange/10 text-orange' },
  processing: { label: 'Procesando', class: 'bg-cyan/10 text-cyan' },
  sent: { label: 'Enviada', class: 'bg-teal/10 text-teal' },
  failed: { label: 'Fallida', class: 'bg-red/10 text-red' },
}

export function ariOutboxStatusMeta(status: string) {
  return ARI_OUTBOX_STATUS_META[status] || { label: status, class: 'bg-surface text-text-muted' }
}

export const ARI_OUTBOX_KIND_LABELS: Record<string, string> = {
  rates: 'Tarifas',
  inventory: 'Inventario',
}

export function ariOutboxKindLabel(kind: string): string {
  return ARI_OUTBOX_KIND_LABELS[kind] || kind
}
