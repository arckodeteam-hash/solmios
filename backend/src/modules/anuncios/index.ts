import { createModule, OrmRepository } from 'arckode-framework'
import { registerAnunciosModels } from './model'
import { AnunciosService } from './service'
import { AnunciosController } from './controller'
import type { AnunciosDTO, AnnouncementReadDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'

export { AnunciosService }
export type {
  AnunciosDTO, CreateAnunciosDTO, UpdateAnunciosDTO, AnunciosQuery, AnunciosPaginated,
  AnnouncementReadDTO, AnnouncementAudience, AnunciosScope,
} from './types'
export type { AnunciosSockets } from './sockets'
export { AnunciosValidator, CreateAnunciosSchema, UpdateAnunciosSchema } from './validators/schema'

export function AnunciosModule() {
  return createModule({
    name: 'anuncios',
    version: '2.0.0',
    description: 'Modulo de anuncios — comunicados del hotel',
    contract: {
      name: 'anuncios',
      version: '2.0.0',
      description: 'Announcements with ownership and pagination',
      actions: ['list', 'getById', 'create', 'update', 'delete', 'markSeen', 'markDismissed'],
      events: ['onAnunciosCreated', 'onAnunciosUpdated', 'onAnunciosDeleted'],
      tables: ['announcements', 'announcement_reads'],
      dependencies: [],
      rules: [
        'Ownership check required',
        'hotelId not updatable',
        'Platform-wide audience (all/admins) is super_admin only',
        'Reads are per user, never per hotel',
      ],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('anuncios: auth dependency required')
      registerAnunciosModels(orm)
      const repo = new OrmRepository<AnunciosDTO>(orm, 'Announcements')
      const log = logger.child('anuncios')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const readsRepo = new OrmRepository<AnnouncementReadDTO>(orm, 'AnnouncementReads')
      const service = new AnunciosService(repo, log, cache, userRepo, auth, readsRepo)
      const controller = new AnunciosController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const guard = createPermissionGuard(auth, roleRepo)

      router.get('/api/anuncios', guard('dashboard', 'view'), (req) => controller.index(req))
      router.get('/api/anuncios/:id', guard('dashboard', 'view'), (req) => controller.show(req))
      router.post('/api/anuncios', guard('dashboard', 'create'), (req) => controller.store(req))
      router.put('/api/anuncios/:id', guard('dashboard', 'edit'), (req) => controller.update(req))
      router.delete('/api/anuncios/:id', guard('dashboard', 'delete'), (req) => controller.destroy(req))
      // Lecturas por usuario: cualquiera que pueda VER el anuncio puede marcarlo. No es una
      // escritura de negocio, es el acuse de que lo leyó.
      router.post('/api/anuncios/:id/seen', guard('dashboard', 'view'), (req) => controller.seen(req))
      router.post('/api/anuncios/:id/dismiss', guard('dashboard', 'view'), (req) => controller.dismiss(req))

      log.info('Modulo anuncios v2 listo')
      return service
    },
  })
}
