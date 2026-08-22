import { createModule, OrmRepository } from 'arckode-framework'
import { registerTicketsModels } from './model'
import { TicketsService } from './service'
import { TicketsController } from './controller'
import type { TicketsDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { TicketsService }
export type { TicketsDTO, CreateTicketsDTO, UpdateTicketsDTO, TicketsQuery, TicketsPaginated } from './types'
export type { TicketsSockets } from './sockets'
export { TicketsValidator, CreateTicketsSchema, UpdateTicketsSchema } from './validators/schema'

export function TicketsModule() {
  return createModule({
    name: 'tickets',
    version: '2.0.0',
    description: 'Módulo de tickets — soporte y incidencias',
    contract: {
      name: 'tickets',
      version: '2.0.0',
      description: 'Support tickets with ownership and pagination',
      actions: ['list', 'getById', 'create', 'update', 'delete'],
      events: ['onTicketsCreated', 'onTicketsUpdated', 'onTicketsDeleted'],
      tables: ['tickets'],
      dependencies: [],
      rules: ['Ownership check required', 'hotelId/userId not updatable'],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('tickets: auth dependency required')
      registerTicketsModels(orm)
      const repo = new OrmRepository<TicketsDTO>(orm, 'Tickets')
      const log = logger.child('tickets')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const service = new TicketsService(repo, log, cache, userRepo, auth)
      const controller = new TicketsController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      // Feature-gating por plan: los tickets son incidencias de mantenimiento → misma clave
      // que /api/mantenimiento y el menú ('operations.maintenance'). Antes solo reports:view:
      // 200 para cualquier plan. Corta a host (sin módulo mantenimiento) — correcto.
      const guard = (m: 'reports', a: 'view' | 'create' | 'edit' | 'delete') => [
        ...createPermissionGuard(auth, roleRepo)(m, a),
        createModuleGuard(orm)('operations.maintenance'),
      ]

      router.get('/api/tickets', guard('reports', 'view'), (req) => controller.index(req))
      router.get('/api/tickets/:id', guard('reports', 'view'), (req) => controller.show(req))
      router.post('/api/tickets', guard('reports', 'create'), (req) => controller.store(req))
      router.put('/api/tickets/:id', guard('reports', 'edit'), (req) => controller.update(req))
      router.delete('/api/tickets/:id', guard('reports', 'delete'), (req) => controller.destroy(req))

      log.info('Módulo tickets v2 listo')
      return service
    },
  })
}
