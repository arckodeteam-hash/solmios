import { createModule, OrmRepository } from 'arckode-framework'
import { registerRolesModels } from './model'
import { RolesService } from './service'
import { RolesController } from './controller'
import type { RolesDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { denyImpersonation } from '../../infrastructure/auth/deny-impersonation'

export { RolesService }
export type { RolesDTO, CreateRolesDTO, UpdateRolesDTO, RolesQuery, RolesPaginated } from './types'
export type { RolesSockets } from './sockets'
export { RolesValidator, CreateRolesSchema, UpdateRolesSchema } from './validators/schema'

export function RolesModule() {
  return createModule({
    name: 'roles',
    version: '2.0.0',
    description: 'Módulo de roles — permisos por hotel',
    contract: {
      name: 'roles',
      version: '2.0.0',
      description: 'Roles with ownership, pagination, and system role protection',
      actions: ['list', 'getById', 'create', 'update', 'delete'],
      events: ['onRolesCreated', 'onRolesUpdated', 'onRolesDeleted'],
      tables: ['roles'],
      dependencies: [],
      rules: ['Ownership check required', 'System roles protected', 'hotelId not updatable'],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('roles: auth dependency required')
      registerRolesModels(orm)
      const repo = new OrmRepository<RolesDTO>(orm, 'Roles')
      const log = logger.child('roles')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const service = new RolesService(repo, log, cache, userRepo, auth)
      const controller = new RolesController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('hr.roles')]

      router.get('/api/roles', guard('users', 'view'), (req) => controller.index(req))
      // /catalog ANTES de /:id o la ruta con param lo captura como id='catalog'.
      router.get('/api/roles/catalog', guard('users', 'view'), (req) => controller.catalog(req))
      router.get('/api/roles/:id', guard('users', 'view'), (req) => controller.show(req))
      // Escribir roles queda fuera de la impersonación, igual que el ABM de usuarios. El candado
      // mira el claim `impersonatedBy`, no el rol: el token de impersonación lleva el rol REAL del
      // cliente, y los permisos totales que el admin necesita adentro se los da `loadPermissions`
      // a partir de ese claim ⇒ ['*:*']. Justamente por eso `requirePermission` y
      // `assertGrantablePermissions` lo dejarían pasar a escribir roles, y `service.create` podría
      // marcar `system: 1`. Definir quién puede qué no es mirar la cuenta de un cliente: se hace
      // desde el panel de super admin, con la identidad propia, y queda escrito en la tabla mucho
      // después de que la sesión de soporte caduque.
      router.post('/api/roles', [...guard('users', 'create'), denyImpersonation()], (req) => controller.store(req))
      router.put('/api/roles/:id', [...guard('users', 'edit'), denyImpersonation()], (req) => controller.update(req))
      router.post('/api/roles/:id/restore', [...guard('users', 'edit'), denyImpersonation()], (req) => controller.restore(req))
      router.delete('/api/roles/:id', [...guard('users', 'delete'), denyImpersonation()], (req) => controller.destroy(req))

      log.info('Módulo roles v2 listo')
      return service
    },
  })
}
