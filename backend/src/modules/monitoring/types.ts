// monitoring/types.ts — DTOs y puertos del módulo de monitoreo de la plataforma.
// SOLO tipos: el schema de la tabla vive en model.ts (el gate MODEL_IN_TYPES_FILE de
// `bun run analyze` se queja si se cuela acá).
//
// El módulo no mide nada por sí mismo: CONSUME lo que ya mide shared/observability (métricas
// HTTP, salud de base y sistema, tamaño de uploads, backups) y lo que ya tienen las colas de otros
// módulos. Todo le llega por puertos —los de acá— que arma composition-root o un conector.

import type { HttpMetricsSnapshot } from '../../shared/observability/metrics'
import type { ErrorEvent } from '../../shared/observability/http-metrics'
import type { DbHealth } from '../../shared/observability/db-health'
import type { SystemHealthReading } from '../../shared/observability/system-health'
import type { UploadsSizeResult } from '../../shared/observability/uploads-size'
import type { BackupFile, BackupCreated } from '../../shared/observability/backups'
import type { BackupDump } from '../../shared/observability/backup-dump'

export type { HttpMetricsSnapshot, ErrorEvent, DbHealth, SystemHealthReading, UploadsSizeResult, BackupFile, BackupCreated }

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

/** Quien pide la operación: lo que el audit log necesita para decir QUIÉN creó/descargó un backup. */
export interface MonitoringActor {
  id: string
  hotelId?: string
}

/** GET /api/admin/monitoring/system: cada bloque falta cuando no se pudo medir (nunca un cero). */
export interface SystemSnapshot {
  proceso?: SystemHealthReading['proceso']
  so?: SystemHealthReading['so']
  disco?: SystemHealthReading['disco']
  uploads?: UploadsSizeResult
  db?: DbHealth
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

/** Puerto hacia ari-outbox: lo inyecta el conector monitoring-ari-outbox. Sin él → `null` en el payload. */
export interface AriOutboxStatsPort {
  stats(): Promise<AriOutboxCounts>
}

export interface EmailQueueSummary {
  pending: number
  processing: number
  sent: number
  failed: number
  total: number
  /** `updatedAt` del último email enviado; null si nunca salió uno. */
  ultimoProcesadoEn: string | null
}

export interface WebhookDeliveryView {
  id: string
  webhookId: string
  event: string
  statusCode: number | null
  success: boolean
  attemptedAt: string
}

/** GET /api/admin/monitoring/queues (REQ-MON-06). */
export interface QueuesSnapshot {
  email: EmailQueueSummary
  ariOutbox: AriOutboxCounts | null
  webhooks: { ultimasEntregas: WebhookDeliveryView[] }
}

/** Lo mínimo de BackupsStore que usa el service (shared/observability/backups.ts lo satisface). */
export interface BackupsStorePort {
  list(): Promise<BackupFile[]>
  find(id: string): Promise<BackupFile | null>
  pathOf(id: string): Promise<string | null>
  remove(id: string): Promise<boolean>
  create(dump: BackupDump): Promise<BackupCreated>
}

export interface BackupsPort {
  store: BackupsStorePort
  dump: BackupDump
}

/** Lo que arma composition-root y le pasa al factory del módulo. Todo opcional salvo las métricas. */
export interface MonitoringModuleOptions {
  metrics: { snapshot(): HttpMetricsSnapshot }
  systemHealth?: { read(): Promise<SystemHealthReading> }
  uploads?: { read(): Promise<UploadsSizeResult> }
  dbHealth?: () => Promise<DbHealth>
  backups?: BackupsPort
  /** Días que se conservan las filas de error_logs. Default: ERROR_LOG_RETENTION_DAYS o 30. */
  errorLogRetentionDays?: number
}
