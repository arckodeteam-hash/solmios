import { createModule, OrmRepository } from 'arckode-framework'
import { registerNotificacionesModels } from './model'
import { NotificacionesService } from './service'
import { NotificacionesController } from './controller'
import type { NotificacionesDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'

export { NotificacionesService }
export type { HotelEmailDeps } from './service'
export type { NotificacionesDTO, CreateNotificacionesDTO, UpdateNotificacionesDTO, NotificacionesQuery, NotificacionesPaginated } from './types'
export type { NotificacionesSockets } from './sockets'
export { NotificacionesValidator, CreateNotificacionesSchema, UpdateNotificacionesSchema } from './validators/schema'

export function NotificacionesModule() {
  return createModule({
    name: 'notificaciones',
    version: '2.0.0',
    description: 'Módulo de notificaciones',
    contract: {
      name: 'notificaciones',
      version: '2.0.0',
      description: 'Notifications with ownership and pagination',
      actions: ['list', 'getById', 'create', 'update', 'delete'],
      events: ['onNotificacionesCreated', 'onNotificacionesUpdated', 'onNotificacionesDeleted'],
      tables: ['notifications'],
      dependencies: [],
      rules: ['Ownership check required', 'hotelId not updatable'],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('notificaciones: auth dependency required')
      registerNotificacionesModels(orm)
      const repo = new OrmRepository<NotificacionesDTO>(orm, 'Notifications')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const log = logger.child('notificaciones')
      const service = new NotificacionesService(repo, userRepo, log, cache, auth)
      const controller = new NotificacionesController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const guard = createPermissionGuard(auth, roleRepo)

      // Leer los avisos del propio hotel no exige `dashboard:view`: camarera,
      // supervisor y mantenimiento no lo tienen, y la campanita les quedaba
      // vacía con un 403 silencioso. `list()` ya filtra por el hotelId del token.
      router.get('/api/notificaciones', [auth.authenticate()], (req) => controller.index(req))
      router.get('/api/notificaciones/:id', [auth.authenticate()], (req) => controller.show(req))
      router.post('/api/notificaciones', guard('dashboard', 'create'), (req) => controller.store(req))
      // SC-03: el PUT (actualizar) exigía `dashboard:create` en vez de `dashboard:edit`.
      router.put('/api/notificaciones/:id', guard('dashboard', 'edit'), (req) => controller.update(req))
      // Borrar la PROPIA notificación no exige `dashboard:delete` (camarera/
      // mantenimiento no lo tienen): así la campanita se puede vaciar de verdad
      // en el servidor y no reaparece. El service impide borrar la de otra
      // persona; el guard de rol quedaba impidiendo hasta borrar la propia.
      router.delete('/api/notificaciones/:id', [auth.authenticate()], (req) => controller.destroy(req))

      log.info('Módulo notificaciones v2 listo')
      return service
    },
  })
}
