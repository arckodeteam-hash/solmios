// monitoring/service.ts — Orquestador del monitoreo de la plataforma (REQ-MON-01..06).
//
// Delgado A PROPÓSITO: no mide nada. Las mediciones viven en shared/observability y llegan por
// puertos; el registro de errores está en usecases/error-logs.ts y la lectura de colas en
// usecases/queues.ts. Acá se arma cada respuesta, se decide qué se OMITE cuando una fuente falla
// (nunca un cero que se lea como medición, REQ-MON-07) y se audita lo sensible: crear y descargar
// un backup son un volcado completo de los datos de todos los hoteles.

import { NotFoundError } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import type { ErrorEvent } from '../../shared/observability/http-metrics'
import type { ErrorLogs } from './usecases/error-logs'
import { leerColas, type QueueReaders } from './usecases/queues'
import type {
  AriOutboxStatsPort, BackupCreated, BackupFile, BackupsPort, ErrorLogRow, HttpMetricsSnapshot,
  MonitoringActor, MonitoringModuleOptions, QueuesSnapshot, SystemSnapshot,
} from './types'
import type { MonitoringSockets } from './sockets'

export interface MonitoringDeps extends Omit<MonitoringModuleOptions, 'errorLogRetentionDays'> {
  errorLogs: ErrorLogs
  queues: QueueReaders
}

export interface BackupDownload {
  archivo: BackupFile
  /** Ruta absoluta dentro del directorio de backups: la resolvió el store, no el id del cliente. */
  path: string
}

export class MonitoringService {
  private auditPort: AuditPort | null = null
  private ariOutbox: AriOutboxStatsPort | null = null
  /** Hooks opcionales hacia otros módulos. Vacío = el módulo funciona igual (email-queue:15). */
  private sockets: MonitoringSockets = {}

  constructor(
    private readonly deps: MonitoringDeps,
    private readonly logger: Logger,
  ) {}

  /** Registra hooks. Se ACUMULAN (varios conectores al mismo evento), igual que email-queue/service.ts:25. */
  setSockets(s: Partial<MonitoringSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  /** Conecta el audit log. Lo inyecta el connector `monitoring-auditlog`. */
  setAuditDeps(port: AuditPort): void {
    this.auditPort = port
  }

  /** Conecta los contadores de la cola de Channex. Lo inyecta el connector `monitoring-ari-outbox`. */
  setAriOutboxPort(port: AriOutboxStatsPort): void {
    this.ariOutbox = port
  }

  // ── Errores ──

  /** El sink del middleware httpMetrics: fire-and-forget, nunca lanza. */
  recordError(event: ErrorEvent): void {
    this.deps.errorLogs.record(event)
  }

  listErrors(limit?: unknown): Promise<ErrorLogRow[]> {
    return this.deps.errorLogs.list(limit)
  }

  async removeError(id: string): Promise<void> {
    if (!(await this.deps.errorLogs.remove(id))) throw new NotFoundError('Error no encontrado')
  }

  /** Retención por antigüedad; lo llama un cron desde composition-root. */
  purgeErrors(): Promise<number> {
    return this.deps.errorLogs.purge()
  }

  // ── Lecturas ──

  apiMetrics(): HttpMetricsSnapshot {
    return this.deps.metrics.snapshot()
  }

  /**
   * Cada bloque se mide por separado y el que falla se OMITE del payload: la pantalla muestra
   * "sin datos" en ese bloque y sigue mostrando el resto (REQ-MON-03/04/07).
   */
  async system(): Promise<SystemSnapshot> {
    const [salud, uploads, db] = await Promise.all([
      this.medir('sistema', () => this.deps.systemHealth?.read()),
      this.medir('uploads', () => this.deps.uploads?.read()),
      this.medir('db', () => this.deps.dbHealth?.()),
    ])
    const out: SystemSnapshot = {}
    if (salud) {
      out.proceso = salud.proceso
      out.so = salud.so
      if (salud.disco) out.disco = salud.disco
    }
    if (uploads) out.uploads = uploads
    if (db) out.db = db
    return out
  }

  queues(): Promise<QueuesSnapshot> {
    return leerColas(this.deps.queues, this.ariOutbox)
  }

  // ── Backups ──

  async listBackups(): Promise<BackupFile[]> {
    return this.backups().store.list()
  }

  /** Crea el volcado y lo audita con el usuario: sin rastro no hay backup (design › riesgo operativo). */
  async createBackup(actor: MonitoringActor): Promise<BackupCreated> {
    const { store, dump } = this.backups()
    const created = await store.create(dump)
    this.logger.info('Monitoring: backup creado', { id: created.archivo.id, bytes: created.archivo.bytes, eliminados: created.eliminados })
    await auditSafely(this.auditPort, this.logger, {
      userId: actor.id,
      hotelId: actor.hotelId,
      action: 'backup.create',
      entity: 'backup',
      entityId: created.archivo.id,
      detail: `motor=${dump.motor} bytes=${created.archivo.bytes}` + (created.eliminados.length ? ` eliminados=${created.eliminados.join(',')}` : ''),
    })
    // Un hook de otro módulo que tira se loguea: el backup YA está creado y auditado.
    try {
      await this.sockets.onBackupCreated?.(created)
    } catch (err: unknown) {
      this.logger.warn('Monitoring: falló un hook de sockets', { event: 'onBackupCreated', error: err instanceof Error ? err.message : String(err) })
    }
    return created
  }

  /** Coincidencia exacta contra la lista real (nunca se arma una ruta con el id): lo ajeno es 404. */
  async backupDownload(id: string, actor: MonitoringActor): Promise<BackupDownload> {
    const { store } = this.backups()
    const archivo = await store.find(id)
    const path = archivo ? await store.pathOf(archivo.id) : null
    if (!archivo || !path) throw new NotFoundError('Backup no encontrado')
    await auditSafely(this.auditPort, this.logger, {
      userId: actor.id,
      hotelId: actor.hotelId,
      action: 'backup.download',
      entity: 'backup',
      entityId: archivo.id,
      detail: `bytes=${archivo.bytes}`,
    })
    return { archivo, path }
  }

  async removeBackup(id: string, actor: MonitoringActor): Promise<void> {
    if (!(await this.backups().store.remove(id))) throw new NotFoundError('Backup no encontrado')
    this.logger.info('Monitoring: backup eliminado', { id, userId: actor.id })
  }

  private backups(): BackupsPort {
    if (!this.deps.backups) throw new NotFoundError('Backups no configurados en esta instalación')
    return this.deps.backups
  }

  /** Una fuente que falla se loguea y devuelve `undefined`: el bloque se omite, no se inventa. */
  private async medir<T>(nombre: string, fn: () => Promise<T | undefined> | T | undefined): Promise<T | undefined> {
    try {
      return await fn()
    } catch (err: unknown) {
      this.logger.warn('Monitoring: no se pudo medir', { fuente: nombre, error: err instanceof Error ? err.message : String(err) })
      return undefined
    }
  }
}
