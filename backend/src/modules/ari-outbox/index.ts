// ari-outbox/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule } from 'arckode-framework'
import { registerAriOutboxModels } from './model'
import { AriOutboxService } from './service'
import { AriOutboxController } from './controller'
import { createAriOutboxStore } from './usecases/outbox-store'
import { createQueueConfigStore } from './usecases/outbox-admin'
import { requireUserType } from '../../infrastructure/auth/require-user-type'

export { AriOutboxService }
export { AriOutboxController }
export { AriOutboxModel, registerAriOutboxModels } from './model'
export type { AriOutboxRow, AriOutboxStatus, AriOutboxKind } from './types'
export type { AriPublisher, AriPushFn, AriOutboxPort } from './usecases/outbox-queue'
export type { AriOutboxList, AriOutboxListQuery, AriOutboxStore } from './service'
// Hooks opcionales del módulo: sin este export ningún conector podría cablear setSockets()
// con tipos (misma línea que email-queue/index.ts:10).
export type { AriOutboxSockets } from './sockets'
export { AriOutboxValidator, ListAriOutboxSchema } from './validators/schema'
export { createAriOutboxStore } from './usecases/outbox-store'
// Operación de la cola desde el Super Admin: la config y los contadores los consume la pantalla y
// el conector que le pasa el techo de peticiones/minuto al transporte de Channex.
export { QueueConfigSchema } from './validators/schema'
export { createQueueConfigStore, QUEUE_CONFIG_KEY, QUEUE_CONFIG_DEFAULTS, sanearConfig } from './usecases/outbox-admin'
export type { QueueConfig, QueueConfigStore, OutboxCounts, OutboxCountFilters } from './usecases/outbox-admin'

/**
 * Cada cuánto tickea el drain desde composition-root. CORTO a propósito: el debounce de la ráfaga
 * ya son 1.5s, así que el tick solo agrega latencia encima. Con 500ms un cambio de tarifa sale a
 * Channex en ~2s, igual que con el `setTimeout` del coalescer en memoria que reemplaza; un tick de
 * 30s (el de la cola de emails) convertiría un push inmediato en medio minuto de espera.
 */
export const ARI_OUTBOX_TICK_MS = 500

export function AriOutboxModule() {
  return createModule({
    name: 'ari-outbox',
    // 1.1.0: + la API de operación de la cola (stats, retry, config). Un cambio observable del
    // contrato bumpea la versión (misma convención que admin/index.ts).
    version: '1.1.0',
    description: 'Outbox persistente de ARI: agrupa las ráfagas de cambios de tarifas/inventario y las publica a Channex sobreviviendo a un reinicio',

    contract: {
      name: 'ari-outbox',
      version: '1.1.0',
      description: 'Persistent ARI push outbox: debounced scheduling + sequential drain with backoff',
      actions: ['list', 'schedule', 'drain', 'stats', 'retry', 'getQueueConfig', 'setQueueConfig'],
      events: [],
      tables: ['ari_outbox'],
      dependencies: [],
      rules: [
        'No importar de otros módulos: los publishers los inyecta un conector',
        'El drain publica de a una fila por vez (paralelizar pisa los rate plans)',
        'La ráfaga se escribe antes de que venza el debounce: un reinicio no se come el push',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('ari-outbox: auth dependency required')
      // Registrar modelo(s) — delegado a model.ts
      registerAriOutboxModels(orm)

      // El store del módulo, NO un OrmRepository pelado: el reclamo de fila del drain necesita
      // el UPDATE condicional de orm.updateMany, que el repositorio del framework no expone
      // (ver usecases/outbox-store.ts).
      const repo = createAriOutboxStore(orm)
      const log = logger.child('ari-outbox')
      // La config vive en `Configuration` (key/value a nivel plataforma), no en la tabla de la
      // outbox: por eso su propio store, construido acá y bajado al service como puerto.
      const service = new AriOutboxService(repo, log, createQueueConfigStore(orm))
      const controller = new AriOutboxController(service, log)

      // CA-9: la vista de la outbox. Es operación de la PLATAFORMA (el evaluador de Channex mira
      // las filas y sus estados de todos los hoteles), no del panel de un hotel: por eso admin y
      // no permission guard por módulo, igual que /api/admin/channex-config en canales.
      const adminOnly = [auth.authenticate('super_admin'), requireUserType('admin')]
      router.get('/api/admin/ari-outbox', adminOnly, (req) => controller.index(req))
      // Las literales ANTES que la ruta con `:id`: el router resuelve por orden de registro y se
      // queda con el primer patrón que matchea (kernel/http/router.ts:128-133).
      router.get('/api/admin/ari-outbox/stats', adminOnly, (req) => controller.stats(req))
      router.get('/api/admin/ari-outbox/config', adminOnly, (req) => controller.getConfig(req))
      router.put('/api/admin/ari-outbox/config', adminOnly, (req) => controller.putConfig(req))
      router.post('/api/admin/ari-outbox/:id/retry', adminOnly, (req) => controller.retry(req))

      log.info('Modulo ari-outbox listo')
      // El conector de wiring hace resolveModule('ari-outbox') y usa registerPublisher/schedule/drain.
      return service
    },
  })
}
