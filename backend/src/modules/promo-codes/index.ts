// promo-codes/index.ts — PUERTA PÚBLICA del módulo promo_codes (F2, spec booking-widget).
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Wiring: registra el modelo `PromoCodes`, construye repos + service + controller,
// y expone 5 rutas:
//   GET    /api/promo-codes                              admin (auth + promo:view)
//   POST   /api/promo-codes                              admin (auth + promo:create)
//   PUT    /api/promo-codes/:id                          admin (auth + promo:edit)
//   DELETE /api/promo-codes/:id                          admin (auth + promo:delete)
//   POST   /api/promo-codes/preview                      auth (userType merchant, SIN promo:*)
//   POST   /api/public/hotels/:slug/promo/validate       pública (sin auth, rate-limited 30/min/IP)
//
// El UNIQUE index `(hotelId, code)` se crea en `migrate-db.ts` (multi-motor) — el service
// captura la violación y la traduce a ValidationError. Ver model.ts.
import { createModule, OrmRepository } from 'arckode-framework'
import { registerPromoCodesModels } from './model'
import { PromoCodesService } from './service'
import { PromoCodesController } from './controller'
import type { PromoCodeDTO, CreatePromoCodeDTO, UpdatePromoCodeDTO, ValidatePromoCodeDTO, PromoValidationResult } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'

export { PromoCodesService, registerPromoCodesModels }
export type {
  PromoCodeDTO, CreatePromoCodeDTO, UpdatePromoCodeDTO, ValidatePromoCodeDTO,
  PromoValidationResult, PromoCodeKind, CurrentUser,
} from './types'
export type { PromoCodesSockets } from './sockets'
export { PromoCodesValidator, CreatePromoCodeSchema, UpdatePromoCodeSchema, ValidatePromoCodeSchema } from './validators/schema'

export function PromoCodesModule() {
  return createModule({
    name: 'promo-codes',
    version: '1.0.0',
    description: 'Códigos promocionales del widget de reservas público (F2 booking-widget)',

    contract: {
      name: 'promo-codes',
      version: '1.0.0',
      description: 'Códigos % o monto fijo aplicables en el checkout del widget público',
      actions: ['list', 'create', 'update', 'delete', 'validate'],
      events: ['onPromoCodeCreated', 'onPromoCodeUpdated', 'onPromoCodeDeleted'],
      tables: ['promo_codes'],
      dependencies: [],
      rules: [
        'Ownership por hotelId (auth.assertOwnership post-find)',
        'Unique (hotelId, code) por UNIQUE index físico (migrate-db.ts)',
        'validar NO incrementa uses (uso atómico en task 2.5)',
        'code normalizado UPPERCASE al persistir',
      ],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('promo-codes: auth dependency required')
      registerPromoCodesModels(orm)

      const promoCodes = new OrmRepository<PromoCodeDTO>(orm, 'PromoCodes')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const hotelsRepo = new OrmRepository<any>(orm, 'Hotels')
      const log = logger.child('promo-codes')
      const service = new PromoCodesService(promoCodes, userRepo, auth, log)
      // PC-1 (2026-08-19): consumo/liberación de usos con optimistic lock — OrmRepository no
      // expone `updateMany`, así que el orm va al service solo para estas ops atómicas
      // (ver promo-atomic.ts). Lo cablea el index, no composition-root: el módulo es dueño.
      service.setAtomicOrm(orm)
      const controller = new PromoCodesController(service, log, hotelsRepo)

      // Guard admin: userType merchant + permiso promo:*. Mismo patrón que landing.
      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      // Feature-gating por plan: códigos = sub-clave 'site-pages.promos' (tab Códigos de
      // descuento de /panel/pagina-publica).
      const adminGuard = (action: 'view' | 'create' | 'edit' | 'delete') => [
        ...permGuard('promo', action),
        requireUserType('merchant'),
        createModuleGuard(orm)('site-pages.promos'),
      ]

      // ─── Rutas admin ──────────────────────────────────────────────────────
      router.get('/api/promo-codes', adminGuard('view'), (req) => controller.index(req))
      router.post('/api/promo-codes', adminGuard('create'), (req) => controller.store(req))
      router.put('/api/promo-codes/:id', adminGuard('edit'), (req) => controller.update(req))
      router.delete('/api/promo-codes/:id', adminGuard('delete'), (req) => controller.destroy(req))

      // FIX 2026-07-31 — preview autenticado (staff crea reserva manual): solo userType merchant,
      // SIN permiso `promo:*` (receptionist no administra códigos pero sí puede aplicar uno al
      // cargar una reserva). hotelId sale del token, nunca del body. Mismo gate de plan que el
      // CRUD: sin 'site-pages.promos' no hay códigos que aplicar.
      router.post('/api/promo-codes/preview', [auth.authenticate(), requireUserType('merchant'), createModuleGuard(orm)('site-pages.promos')], (req: any) => controller.previewForUser(req))

      // ─── Ruta pública ─────────────────────────────────────────────────────
      // Sin auth, rate-limited por IP (spec: 30 req/min/IP, mismo criterio que
      // public-landing — el validador es read-only barato). El rate-limit va ANTES
      // del controller (mismo patrón que bookingengine/index.ts).
      router.post('/api/public/hotels/:slug/promo/validate', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-promo-validate:${getClientIp(req)}`, {
          maxAttempts: 30,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.validateBySlug(req)
      })

      log.info('Módulo promo-codes listo')
      return service
    },
  })
}
