// auditlog/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository } from 'arckode-framework'
import { registerAuditlogModels } from './model'
import { AuditlogService } from './service'
import { AuditlogController } from './controller'
import type { AuditlogDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { AuditlogService }
export type { AuditlogDTO, CreateAuditlogDTO, UpdateAuditlogDTO, AuditlogQuery, AuditlogPaginated } from './types'
export type { AuditlogSockets } from './sockets'
export { AuditlogValidator, CreateAuditlogSchema, UpdateAuditlogSchema } from './validators/schema'

export function AuditlogModule() {
  return createModule({
    name: 'auditlog',
    version: '2.0.0',
    description: 'Módulo de audit log — append-only',

    contract: {
      name: 'auditlog',
      version: '1.0.0',
      description: 'Módulo de auditlog',
      actions: ["list","getById","create"],
      events: ["onAuditlogCreated"],
      tables: ['audit_log'],
      dependencies: [],
      rules: ['No importar de otros módulos', 'Append-only: sin update ni delete'],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('auditlog: auth dependency required')
      // Registrar modelo(s) — delegado a model.ts
      registerAuditlogModels(orm)

      const repo = new OrmRepository<AuditlogDTO>(orm, 'Auditlog')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const log = logger.child('auditlog')
      const service = new AuditlogService(repo, userRepo, log, cache, auth!)
      const controller = new AuditlogController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      // Feature-gating por plan: el log de auditoría = sub-clave 'settings.audit'
      // (/panel/config/auditoria, DT-17 solo hotel_admin).
      const guard = (a: 'view') => [...createPermissionGuard(auth, roleRepo)('reports', a), createModuleGuard(orm)('settings.audit')]

      router.get('/api/auditlog', guard('view'), (req) => controller.index(req))
      router.get('/api/auditlog/:id', guard('view'), (req) => controller.show(req))
      // NO hay POST HTTP: el audit log lo escribe SOLO el sistema, vía el puerto directo
      // (`service.create`, inyectado por los connectors `*-auditlog`). El endpoint POST tomaba
      // hotelId/userId/ip del body → un merchant forjaba entradas en el log de otro hotel
      // (evidencia falsa, cross-tenant). Ningún cliente legítimo lo usaba: el frontend solo hace GET.

      log.info('Módulo auditlog listo')
      return service
    },
  })
}
