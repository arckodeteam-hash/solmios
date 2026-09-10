import { createModule, OrmRepository } from 'arckode-framework'
import { registerTicketsModels } from './model'
import { TicketsService } from './service'
import { TicketsController } from './controller'
import type { TicketsDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { denyImpersonation } from '../../infrastructure/auth/deny-impersonation'

export { TicketsService }
export type { TicketsDTO, CreateTicketsDTO, UpdateTicketsDTO, TicketsQuery, TicketsPaginated, TicketMessage } from './types'
export type { TicketsSockets } from './sockets'
export { TicketsValidator, CreateTicketsSchema, UpdateTicketsSchema, AddMessageSchema } from './validators/schema'

export function TicketsModule() {
  return createModule({
    name: 'tickets',
    version: '2.0.0',
    description: 'Módulo de tickets — soporte y incidencias',
    contract: {
      name: 'tickets',
      version: '2.0.0',
      description: 'Support tickets with ownership and pagination',
      actions: ['list', 'getById', 'create', 'update', 'delete', 'addMessage'],
      events: ['onTicketsCreated', 'onTicketsUpdated', 'onTicketsDeleted', 'onTicketsMessageAdded'],
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
      const hotelRepo = new OrmRepository<any>(orm, 'Hotels')
      const service = new TicketsService(repo, log, cache, userRepo, auth, hotelRepo)
      const controller = new TicketsController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      // REQ-SOP-07: sin gate por plan. Antes exigía 'operations.maintenance' (misma clave que
      // /api/mantenimiento) — un hotel sin ese módulo en su plan veía "Error al cargar tickets"
      // en la pantalla de ayuda, que es CORE (soporte de la plataforma, no una feature vendible).
      // Deuda anotada: falta un permiso propio 'support:*' — hoy sigue prestado de 'reports'.
      const guard = (m: 'reports', a: 'view' | 'create' | 'edit' | 'delete') => [
        ...createPermissionGuard(auth, roleRepo)(m, a),
      ]

      router.get('/api/tickets', guard('reports', 'view'), (req) => controller.index(req))
      router.get('/api/tickets/:id', guard('reports', 'view'), (req) => controller.show(req))
      router.post('/api/tickets', guard('reports', 'create'), (req) => controller.store(req))
      router.put('/api/tickets/:id', guard('reports', 'edit'), (req) => controller.update(req))
      // REQ-SOP-02/03: el autor del mensaje lo resuelve el server (req.user) — nunca la sesión
      // de un admin impersonando a un hotel (denyImpersonation, mismo patrón que auth/logout).
      router.post('/api/tickets/:id/messages', [...guard('reports', 'create'), denyImpersonation()], (req) => controller.addMessage(req))
      router.delete('/api/tickets/:id', guard('reports', 'delete'), (req) => controller.destroy(req))

      log.info('Módulo tickets v2 listo')
      return service
    },
  })
}
