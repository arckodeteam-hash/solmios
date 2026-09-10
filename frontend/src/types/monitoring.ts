// types/monitoring.ts — Espejo de las respuestas del módulo backend `monitoring`
// (backend/src/modules/monitoring/types.ts + shared/observability/*). Sólo tipos: la pantalla
// /admin/monitoring se tipa contra esto y no contra `any`.
//
// Regla del backend (REQ-MON-07): lo que no se pudo medir NO viene (campo ausente), nunca un
// cero que se lea como medición. Por eso casi todo en SystemSnapshot es opcional.

// ── GET /api/admin/monitoring/api ──

export interface RouteMetrics {
  ruta: string
  metodo: string
  count: number
  avgMs: number
  p95Ms: number
  maxMs: number
  errors: number
}

export interface HttpMetricsSnapshot {
  /** Desde cuándo acumula la ventana (arranque del proceso o último reset). */
  ventanaDesde: string
  rutas: RouteMetrics[]
  totales: { peticiones: number; erroresPct: number; avgMs: number }
}

// ── GET /api/admin/monitoring/errors ──

/** Una fila de `error_logs` = un (path, message) con su contador y sus fechas extremas. */
export interface ErrorLogRow {
  id: string
  hotelId?: string | null
  method: string
  path: string
  statusCode: number
  message: string
  stack?: string | null
  count: number
  firstSeenAt: string
  lastSeenAt: string
  createdAt?: string
  updatedAt?: string
}

export interface ErrorLogsResponse {
  items: ErrorLogRow[]
}

// ── GET /api/admin/monitoring/system ──

export type DbEngine = 'postgres' | 'sqlite'

export interface DbHealth {
  motor: DbEngine
  tamanoBytes?: number
  tablas?: number
  /** Sólo postgres: sqlite no tiene pool de conexiones. */
  conexiones?: number
}

export interface ProcessHealth {
  uptimeS: number
  memoriaRssMb: number
  memoriaHeapMb: number
  /** % de CPU del intervalo desde la lectura anterior; null en la primera lectura. */
  cpuPct: number | null
}

export interface OsHealth {
  uptimeS: number
  cargas: number[]
  memoriaTotalMb: number
  memoriaLibreMb: number
}

export interface DiskHealth {
  totalBytes: number
  libreBytes: number
  usadoPct: number
}

export interface UploadsSize {
  bytes: number
  archivos: number
  calculadoEn: string
}

/** Cada bloque falta cuando no se pudo medir (nunca un cero). */
export interface SystemSnapshot {
  proceso?: ProcessHealth
  so?: OsHealth
  disco?: DiskHealth
  uploads?: UploadsSize
  db?: DbHealth
}

// ── GET /api/admin/monitoring/queues ──

export interface EmailQueueSummary {
  pending: number
  processing: number
  sent: number
  failed: number
  total: number
  /** `updatedAt` del último email enviado; null si nunca salió uno. */
  ultimoProcesadoEn: string | null
}

/** Contadores de la cola de Channex tal como los expone ari-outbox (stats). */
export interface AriOutboxCounts {
  pending: number
  processing: number
  sent: number
  failed: number
  retrying: number
  total: number
}

export interface WebhookDeliveryView {
  id: string
  webhookId: string
  event: string
  statusCode: number | null
  success: boolean
  attemptedAt: string
}

export interface QueuesSnapshot {
  email: EmailQueueSummary
  /** null cuando el conector de ari-outbox no está cableado. */
  ariOutbox: AriOutboxCounts | null
  webhooks: { ultimasEntregas: WebhookDeliveryView[] }
}

// ── /api/admin/backups ──

export interface BackupFile {
  id: string
  bytes: number
  creadoEn: string
}

export interface BackupsListResponse {
  items: BackupFile[]
}

export interface BackupCreated {
  archivo: BackupFile
  /** Ids eliminados por retención al crear este backup. */
  eliminados: string[]
}
