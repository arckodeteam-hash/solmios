// monitoring/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository } from 'arckode-framework'
import { registerMonitoringModels } from './model'
import { MonitoringService } from './service'
import { MonitoringController } from './controller'
import { ErrorLogs } from './usecases/error-logs'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import type { ErrorLogRow, MonitoringModuleOptions } from './types'
import type { EmailQueueRow, WebhookDeliveryRow } from './usecases/queues'

export { MonitoringService }
export { MonitoringController }
export { ErrorLogsModel, registerMonitoringModels } from './model'
export type {
  ErrorLogRow, MonitoringActor, MonitoringModuleOptions, SystemSnapshot, QueuesSnapshot,
  AriOutboxCounts, AriOutboxStatsPort, EmailQueueSummary, WebhookDeliveryView, BackupsPort, BackupsStorePort,
} from './types'
export type { MonitoringDeps, BackupDownload } from './service'
export type { MonitoringSockets } from './sockets'
export { ErrorLogs, resolveRetentionDays, DEFAULT_ERROR_LOG_RETENTION_DAYS } from './usecases/error-logs'
export type { ErrorLogsRepo } from './usecases/error-logs'
export { leerColas, WEBHOOK_DELIVERIES_LIMIT } from './usecases/queues'
export type { QueueReaders, QueueReader, EmailQueueRow, WebhookDeliveryRow } from './usecases/queues'
export { MonitoringValidator, ListErrorsSchema, CreateBackupSchema, IdParamSchema } from './validators/schema'

/**
 * Cada cuánto corre la retención de error_logs desde composition-root. Una vez por día alcanza:
 * la tabla no crece por petición (agrupa por path+message) y lo que se borra son filas de 30 días.
 */
export const ERROR_LOG_PURGE_TICK_MS = 24 * 60 * 60_000

/** Modelos de OTROS módulos que este sólo LEE (los define shared/models.ts y webhooks/model.ts). */
const EMAIL_QUEUE_MODEL = 'EmailQueue'
const WEBHOOK_DELIVERY_MODEL = 'WebhookDelivery'
const ERROR_LOGS_MODEL = 'ErrorLogs'

/**
 * Factory del módulo. Los puertos de medición (métricas HTTP, salud de sistema/base, uploads,
 * backups) los arma composition-root: el módulo no importa infraestructura ni lee env por su
 * cuenta, así que en tests se monta con dobles en memoria.
 */
export function MonitoringModule(opts: MonitoringModuleOptions) {
  return createModule({
    name: 'monitoring',
    version: '1.0.0',
    description: 'Monitoreo real de la plataforma: métricas HTTP, errores persistidos, salud de base/sistema, colas y backups de la base (super_admin)',

    contract: {
      name: 'monitoring',
      version: '1.0.0',
      description: 'Platform observability: HTTP metrics, persisted error log, db/system health, queues and database backups',
      actions: ['apiMetrics', 'listErrors', 'removeError', 'purgeErrors', 'system', 'queues', 'listBackups', 'createBackup', 'backupDownload', 'removeBackup'],
      events: ['onBackupCreated'],
      tables: ['error_logs'],
      dependencies: [],
      rules: [
        'No importar de otros módulos: los contadores de ari-outbox y el audit log llegan por conectores',
        'Toda ruta es super_admin + userType admin: un backup es un volcado de los datos de todos los hoteles',
        'Una métrica que no se pudo medir se omite: nunca un cero que se lea como medición',
        'El registro de errores es fire-and-forget: un fallo al persistir no cambia la respuesta al cliente',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('monitoring: auth dependency required')
      registerMonitoringModels(orm)

      const log = logger.child('monitoring')
      const errorLogs = new ErrorLogs(
        new OrmRepository<ErrorLogRow>(orm, ERROR_LOGS_MODEL),
        log,
        opts.errorLogRetentionDays !== undefined ? { retentionDays: opts.errorLogRetentionDays } : {},
      )
      const service = new MonitoringService({
        ...opts,
        errorLogs,
        queues: {
          email: new OrmRepository<EmailQueueRow>(orm, EMAIL_QUEUE_MODEL),
          webhooks: new OrmRepository<WebhookDeliveryRow>(orm, WEBHOOK_DELIVERY_MODEL),
        },
      }, log)
      const controller = new MonitoringController(service, log)

      // Operación de la PLATAFORMA, no del panel de un hotel: super_admin + userType admin, igual
      // que /api/admin/ari-outbox. Un merchant autenticado recibe 403 en las nueve rutas.
      const adminOnly = [auth.authenticate('super_admin'), requireUserType('admin')]
      router.get('/api/admin/monitoring/api', adminOnly, (req) => controller.api(req))
      router.get('/api/admin/monitoring/errors', adminOnly, (req) => controller.errors(req))
      router.delete('/api/admin/monitoring/errors/:id', adminOnly, (req) => controller.removeError(req))
      router.get('/api/admin/monitoring/system', adminOnly, (req) => controller.system(req))
      router.get('/api/admin/monitoring/queues', adminOnly, (req) => controller.queues(req))
      router.get('/api/admin/backups', adminOnly, (req) => controller.listBackups(req))
      router.post('/api/admin/backups', adminOnly, (req) => controller.createBackup(req))
      router.get('/api/admin/backups/:id/download', adminOnly, (req) => controller.downloadBackup(req))
      router.delete('/api/admin/backups/:id', adminOnly, (req) => controller.removeBackup(req))

      log.info('Modulo monitoring listo')
      // composition-root usa service.recordError como sink de httpMetrics y purgeErrors en el cron;
      // los conectores monitoring-auditlog / monitoring-ari-outbox le inyectan sus puertos.
      return service
    },
  })
}
