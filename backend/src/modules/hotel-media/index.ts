// hotelmedia/index.ts — PUERTA PÚBLICA del módulo hotel_media.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Wiring: registra el modelo `HotelMedia`, construye repos + service + controller, y
// expone 6 rutas (F0 task 0.8):
//   GET    /api/hotel-media                          admin (auth + media:view)
//   POST   /api/hotel-media                          admin (auth + media:create)
//   PUT    /api/hotel-media/:id                      admin (auth + media:edit)
//   DELETE /api/hotel-media/:id                      admin (auth + media:delete)
//   POST   /api/hotel-media/reorder                  admin (auth + media:edit)
//   GET    /api/public/hotels/:slug/media            pública (sin auth, rate-limited 60/min/IP)
import { createModule, OrmRepository } from 'arckode-framework'
import type { StorageService } from 'arckode-framework/modules/storage'
import { registerHotelMediaModels } from './model'
import { HotelMediaService } from './service'
import { HotelMediaController } from './controller'
import type { HotelMediaDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'

export { HotelMediaService, HotelMediaController }
export type {
  HotelMediaDTO, CreateHotelMediaDTO, UpdateHotelMediaDTO, ReorderHotelMediaDTO,
  MediaType, CurrentUser,
} from './types'
export {
  HotelMediaValidator,
  CreateHotelMediaSchema, UpdateHotelMediaSchema, ReorderHotelMediaSchema,
} from './validators/schema'
export { registerHotelMediaModels } from './model'

/**
 * Factory del módulo hotel_media.
 * `storage` es opcional: si no se pasa, `upload` con data-URL fallará con
 * `ValidationError` claro (no crash). Es lo que permite testear sin storage.
 */
export function HotelMediaModule(opts: { storage?: StorageService } = {}) {
  return createModule({
    name: 'hotel-media',
    version: '1.0.0',
    description: 'Media del hotel (hero/gallery/room) para landing pública — F0',

    contract: {
      name: 'hotel-media',
      version: '1.0.0',
      description: 'Media del hotel (hero/gallery/room)',
      actions: ['listByHotel', 'upload', 'update', 'remove', 'reorder'],
      events: [],
      tables: ['hotel_media'],
      dependencies: [],
      rules: [
        'Ownership por hotelId (auth.assertOwnership post-find)',
        'type=room exige roomId del mismo hotel',
        'sortOrder consecutivo sin gaps (reorder 0..N-1)',
        'Reuso de S3StorageAdapter con dir hotel-media/',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('hotel-media: auth dependency required')
      registerHotelMediaModels(orm)

      const media = new OrmRepository<HotelMediaDTO>(orm, 'HotelMedia')
      const rooms = new OrmRepository<any>(orm, 'Rooms')
      const hotels = new OrmRepository<any>(orm, 'Hotels')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const log = logger.child('hotel-media')
      // M2 fix (audit) — Transactor para reorder atómico. Envuelve `orm.transaction` en la
      // interface `MediaTransactor` para que el service no dependa del ORM concreto (regla
      // "service no inyecta ORM directo" del analyzer). Mismo patrón que landing/index.ts.
      const transactor = { transaction: <T>(fn: (tx: any) => Promise<T>): Promise<T> => orm.transaction(fn) }
      const service = new HotelMediaService(media, rooms, userRepo, log, auth, opts.storage, transactor)
      const controller = new HotelMediaController(service, log, media, rooms, hotels)

      // Guard admin: userType merchant + permiso media:action. Mismo patrón que
      // landing/index.ts (createPermissionGuard + capa extra de userType).
      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      // Feature-gating por plan: media del hotel = sub-clave 'site-pages.media' (tab Media
      // de /panel/pagina-publica).
      const adminGuard = (action: 'view' | 'create' | 'edit' | 'delete') => [
        ...permGuard('media', action),
        requireUserType('merchant'),
        createModuleGuard(orm)('site-pages.media'),
      ]

      // ─── Rutas admin ──────────────────────────────────────────────────────
      router.get('/api/hotel-media', adminGuard('view'), (req) => controller.index(req))
      router.post('/api/hotel-media', adminGuard('create'), (req) => controller.store(req))
      router.put('/api/hotel-media/:id', adminGuard('edit'), (req) => controller.update(req))
      router.delete('/api/hotel-media/:id', adminGuard('delete'), (req) => controller.destroy(req))
      router.post('/api/hotel-media/reorder', adminGuard('edit'), (req) => controller.reorder(req))

      // ─── Ruta pública ─────────────────────────────────────────────────────
      // Sin auth, rate-limited por IP (spec hotel-media: 60 req/min/IP). El rate-limit va
      // ANTES del controller (mismo patrón que opiniones/index.ts:60-67 con public-reviews).
      router.get('/api/public/hotels/:slug/media', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-hotel-media:${getClientIp(req)}`, {
          maxAttempts: 60,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.publicMedia(req)
      })

      log.info('Módulo hotel-media listo (rutas admin + pública cableadas)')
      return service
    },
  })
}
