// huespedes/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository } from 'arckode-framework'
import { registerHuespedesModels } from './model'
import { HuespedesService } from './service'
import { HuespedesController } from './controller'
import type { HuespedesDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { HuespedesService }
export type { HuespedesDTO, CreateHuespedesDTO, UpdateHuespedesDTO, HuespedesQuery, HuespedesPaginated } from './types'
export type { HuespedesSockets } from './sockets'
export { HuespedesValidator, CreateHuespedesSchema, UpdateHuespedesSchema } from './validators/schema'

export function HuespedesModule() {
  return createModule({
    name: 'huespedes',
    version: '1.0.0',
    description: 'Módulo de huespedes',

    contract: {
      name: 'huespedes',
      version: '1.0.0',
      description: 'Módulo de huespedes',
      actions: ["list","getById","create","update","delete"],
      events: ["onHuespedesCreated","onHuespedesUpdated","onHuespedesDeleted"],
      tables: ['huespedes'],
      dependencies: [],
      rules: ['No importar de otros módulos'],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('huespedes: auth dependency required')
      // Registrar modelo(s) — delegado a model.ts
      registerHuespedesModels(orm)

      const repo = new OrmRepository<HuespedesDTO>(orm, 'Guests')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      // H-1 (auditoría 2026-08-19): guard de delete — acceso por NOMBRE de modelo global,
      // mismo patrón que bookingengine ("no import cross-module").
      const reservasRepo = new OrmRepository<any>(orm, 'Reservations')
      const log = logger.child('huespedes')
      const service = new HuespedesService(repo, userRepo, log, cache, auth, reservasRepo)
      const controller = new HuespedesController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('guests')]

      router.get('/api/huespedes', guard('guests', 'view'), (req) => controller.index(req))
      router.get('/api/huespedes/:id', guard('guests', 'view'), (req) => controller.show(req))
      router.post('/api/huespedes', guard('guests', 'create'), (req) => controller.store(req))
      router.put('/api/huespedes/:id', guard('guests', 'edit'), (req) => controller.update(req))
      router.delete('/api/huespedes/:id', guard('guests', 'delete'), (req) => controller.destroy(req))

      log.info('Módulo huespedes listo')
      return service
    },
  })
}
