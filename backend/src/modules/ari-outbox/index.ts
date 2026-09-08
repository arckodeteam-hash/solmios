// ari-outbox/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository } from 'arckode-framework'
import { registerAriOutboxModels } from './model'
import { AriOutboxService } from './service'
import { AriOutboxController } from './controller'
import type { AriOutboxRow } from './types'
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
    version: '1.0.0',
    description: 'Outbox persistente de ARI: agrupa las ráfagas de cambios de tarifas/inventario y las publica a Channex sobreviviendo a un reinicio',

    contract: {
      name: 'ari-outbox',
      version: '1.0.0',
      description: 'Persistent ARI push outbox: debounced scheduling + sequential drain with backoff',
      actions: ['list', 'schedule', 'drain'],
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

      const repo = new OrmRepository<AriOutboxRow>(orm, 'AriOutbox')
      const log = logger.child('ari-outbox')
      const service = new AriOutboxService(repo, log)
      const controller = new AriOutboxController(service, log)

      // CA-9: la vista de la outbox. Es operación de la PLATAFORMA (el evaluador de Channex mira
      // las filas y sus estados de todos los hoteles), no del panel de un hotel: por eso admin y
      // no permission guard por módulo, igual que /api/admin/channex-config en canales.
      const adminOnly = [auth.authenticate('super_admin'), requireUserType('admin')]
      router.get('/api/admin/ari-outbox', adminOnly, (req) => controller.index(req))

      log.info('Modulo ari-outbox listo')
      // El conector de wiring hace resolveModule('ari-outbox') y usa registerPublisher/schedule/drain.
      return service
    },
  })
}
