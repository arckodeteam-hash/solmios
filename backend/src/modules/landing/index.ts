// landing/index.ts — PUERTA PÚBLICA del módulo landing_blocks (F1, spec landing-builder).
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Wiring: registra el modelo `LandingBlocks`, construye repos + service + controller,
// y expone 4 rutas:
//   GET    /api/landing                          admin (auth + landing:view)
//   PUT    /api/landing                          admin (auth + landing:edit) — bulk upsert atómico
//   PATCH  /api/landing/:id/toggle               admin (auth + landing:edit)
//   GET    /api/public/hotels/:slug/landing      pública (sin auth, rate-limited 30/min/IP)
import { createModule, OrmRepository } from 'arckode-framework'
import { registerLandingModels } from './model'
import { LandingService } from './service'
import { LandingController } from './controller'
import type { LandingBlockDTO, UpsertLandingBlockInput, PublicLandingBlock, LandingBlockType } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'

export { LandingService }
export type {
  LandingBlockDTO, UpsertLandingBlockInput, ToggleLandingBlockDTO,
  PublicLandingBlock, LandingBlockType, LandingBlockListResult, CurrentUser,
  LandingTemplateId, ThemeTokens, LandingTheme, PublicLandingTheme,
} from './types'
export { BLOCK_TYPES, DEFAULT_SORT_ORDER, LANDING_TEMPLATE_IDS, THEME_COLOR_KEYS } from './types'
export type { LandingSockets } from './sockets'
export { LandingValidator, UpsertLandingSchema, ToggleLandingSchema, ThemeSchema } from './validators/schema'
export { registerLandingModels } from './model'
export { defaultConfigFor } from './usecases/defaults'
export { getTheme as getLandingTheme, setTheme as setLandingTheme, LANDING_THEME_KEY, DEFAULT_THEME as DEFAULT_LANDING_THEME } from './usecases/theme-crud'

export function LandingModule() {
  return createModule({
    name: 'landing',
    version: '1.0.0',
    description: 'Landing pública del hotel por bloques (hero/gallery/amenities/...) — F1',

    contract: {
      name: 'landing',
      version: '1.0.0',
      description: 'Bloques configurables de la landing pública del hotel',
      actions: ['list', 'upsert', 'toggle', 'listPublic', 'getTheme', 'setTheme'],
      events: ['onLandingBlockUpserted', 'onLandingBlockToggled', 'onLandingThemeSet'],
      tables: ['landing_blocks', 'configuration'],
      dependencies: [],
      rules: [
        'Ownership por hotelId (auth.assertOwnership post-find)',
        '1 fila por (hotelId, type) — enforced en el usecase',
        'upsert atómico (orm.transaction: delete-all + insert-all)',
        'Seeder lazy: 9 defaults al primer GET de hotel nuevo',
        'Theme: KV configuration.landing_theme (default classic), cache landing:public:${hotelId} se invalida en setTheme',
      ],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('landing: auth dependency required')
      registerLandingModels(orm)

      const blocks = new OrmRepository<LandingBlockDTO>(orm, 'LandingBlocks')
      const hotels = new OrmRepository<any>(orm, 'Hotels')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      // Repo `Configuration` para el theme (KV key='landing_theme'). El modelo
      // vive en shared/models.ts (multi-tenant por hotelId, NO redefinir acá).
      const config = new OrmRepository<any>(orm, 'Configuration')
      const log = logger.child('landing')
      // Transactor adapter: envuelve `orm.transaction` sin exponer el ORM al service
      // (regla "service no inyecta ORM directo" — el analyzer lo exige). El service
      // recibe solo la interface `LandingTransactor` de este módulo.
      const transactor = { transaction: <T>(fn: (tx: any) => Promise<T>) => orm.transaction(fn) }
      const service = new LandingService(blocks, hotels, userRepo, auth, transactor, log, config, cache)
      const controller = new LandingController(service, log)

      // Guard admin: userType merchant + permiso landing:view|edit. Mismo patrón que
      // opiniones/index.ts (createPermissionGuard + capa extra de userType).
      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      // Feature-gating por plan (catálogo 'site-pages'): el CONTENIDO de la landing es la
      // sub-clave 'site-pages.landing' (tab Landing); el theme es apariencia del sitio →
      // clave padre 'site-pages' (tab Apariencia).
      const adminGuard = (action: 'view' | 'edit') => [
        ...permGuard('landing', action),
        requireUserType('merchant'),
        moduleGuard('site-pages.landing'),
      ]
      // El theme NO exige la sub-clave 'site-pages.landing': es apariencia del sitio
      // (tab Apariencia, gateada por la clave padre 'site-pages' en el menú/ruta).
      const themeGuard = (action: 'view' | 'edit') => [
        ...permGuard('landing', action),
        requireUserType('merchant'),
        moduleGuard('site-pages'),
      ]

      // ─── Rutas admin ──────────────────────────────────────────────────────
      router.get('/api/landing', adminGuard('view'), (req) => controller.index(req))
      router.put('/api/landing', adminGuard('edit'), (req) => controller.upsert(req))
      router.patch('/api/landing/:id/toggle', adminGuard('edit'), (req) => controller.toggle(req))
      // Theme de la landing (solmi-direct-booking): un GET + un PUT, separados del
      // bulk upsert de bloques (contenido ≠ apariencia).
      router.get('/api/landing/theme', themeGuard('view'), (req) => controller.getTheme(req))
      router.put('/api/landing/theme', themeGuard('edit'), (req) => controller.setTheme(req))

      // ─── Ruta pública ─────────────────────────────────────────────────────
      // Sin auth, rate-limited por IP (spec: 30 req/min/IP). El rate-limit va ANTES del
      // controller (mismo patrón que opiniones/index.ts:60-67 con public-reviews).
      router.get('/api/public/hotels/:slug/landing', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-landing:${getClientIp(req)}`, {
          maxAttempts: 30,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.publicLanding(req)
      })

      log.info('Módulo landing listo')
      return service
    },
  })
}
