// site-pages/index.ts — PUERTA PÚBLICA del módulo site_pages (CMS del sitio del SaaS).
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Páginas del sitio público de SolmiOS (footer: producto/empresa/soporte/legal/blog).
// Scope PLATAFORMA: edición SOLO super_admin (userType admin) — el contenido del sitio
// del vendor no lo tocan hoteles ni roles de hotel. Lectura pública sin auth de las
// páginas published, rate-limited como el resto de /api/public/*.
//
// Wiring: registra el modelo `SitePages`, construye repo + service + controller, y expone:
//   GET    /api/site-pages                    admin (super_admin + requireUserType admin)
//   GET    /api/site-pages/:id                admin
//   POST   /api/site-pages                    admin
//   PUT    /api/site-pages/:id                admin
//   DELETE /api/site-pages/:id                admin
//   GET    /api/public/site-pages             pública (sin auth, rate-limited 30/min/IP)
//   GET    /api/public/site-pages/:slug       pública (sin auth, rate-limited 30/min/IP)
//   GET    /api/public/platform-contact       pública (sin auth, rate-limited 30/min/IP) — #148
import { createModule, OrmRepository } from 'arckode-framework'
import { registerSitePagesModels } from './model'
import { SitePagesService } from './service'
import { SitePagesController } from './controller'
import type { SitePageDTO, PublicSitePage, PublicSitePageSummary } from './types'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'
import { resolvePlatformContact } from './usecases/platform-contact'

export { SitePagesService }
export type {
  SitePageDTO, CreateSitePageDTO, UpdateSitePageDTO, PublicSitePage,
  PublicSitePageSummary, SitePageCategory, SitePageStatus, SitePageListResult,
} from './types'
export { SITE_PAGE_CATEGORIES, SITE_PAGE_STATUSES, CATEGORY_LABELS } from './types'
export { SitePagesValidator, CreateSitePageSchema, UpdateSitePageSchema } from './validators/schema'
export { registerSitePagesModels } from './model'
export { resolvePlatformContact, buildPlatformWhatsappUrl } from './usecases/platform-contact'
export type { PlatformContact } from './usecases/platform-contact'

export function SitePagesModule() {
  return createModule({
    name: 'site-pages',
    version: '1.0.0',
    description: 'CMS de páginas del sitio público del SaaS (footer del landing)',

    contract: {
      name: 'site-pages',
      version: '1.0.0',
      description: 'Páginas públicas del sitio de SolmiOS, editables desde el panel admin',
      actions: ['list', 'getById', 'create', 'update', 'delete', 'listPublic', 'getPublicBySlug', 'platformContact'],
      events: ['onSitePageCreated', 'onSitePageUpdated', 'onSitePageDeleted'],
      tables: ['site_pages', 'configuration'],
      dependencies: [],
      rules: [
        'Scope plataforma: hotelId siempre "platform" — no es contenido por hotel',
        'CRUD solo super_admin (userType admin); sin guard de permisos por rol de hotel',
        'Endpoint público solo expone status=published; draft y inexistente responden igual (404)',
        'slug único (ConflictError 409) + índice idx_site_pages_slug en migrate-db.ts',
        '/api/public/platform-contact: whatsappUrl sale de configuration(plataforma).supportPhone en E.164 o es null — sin número no hay botón',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('site-pages: auth dependency required')
      registerSitePagesModels(orm)

      const repo = new OrmRepository<SitePageDTO>(orm, 'SitePages')
      const log = logger.child('site-pages')
      const service = new SitePagesService(repo, log)
      // #148: el contacto público lee `configuration('plataforma')` (scope platform, sin hotel).
      const configRepo = new OrmRepository<Record<string, unknown>>(orm, 'Configuration')
      const controller = new SitePagesController(service, log, () => resolvePlatformContact(configRepo))

      // Guard de plataforma (patrón admin module): solo el dueño del SaaS toca el sitio.
      // El moduleGuard('site-pages') es no-op HOY (super_admin se saltea el gate de plan),
      // pero deja el invariant cableado si el scope del módulo algún día abre a hoteles.
      const sa = [auth.authenticate('super_admin'), requireUserType('admin'), createModuleGuard(orm)('site-pages')]

      // ─── Rutas admin ──────────────────────────────────────────────────────
      router.get('/api/site-pages', sa, () => controller.index())
      router.get('/api/site-pages/:id', sa, (req) => controller.show(req))
      router.post('/api/site-pages', sa, (req) => controller.store(req))
      router.put('/api/site-pages/:id', sa, (req) => controller.update(req))
      router.delete('/api/site-pages/:id', sa, (req) => controller.destroy(req))

      // ─── Rutas públicas ───────────────────────────────────────────────────
      // Sin auth, rate-limited por IP (mismo patrón que landing/index.ts:94-101).
      router.get('/api/public/site-pages', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-site-pages:${getClientIp(req)}`, {
          maxAttempts: 30,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.publicIndex()
      })

      router.get('/api/public/site-pages/:slug', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-site-pages:${getClientIp(req)}`, {
          maxAttempts: 30,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.publicShow(req)
      })

      // #148 (REQ-PIPE-07): WhatsApp de la plataforma para el botón flotante de la landing.
      router.get('/api/public/platform-contact', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-platform-contact:${getClientIp(req)}`, {
          maxAttempts: 30,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.publicPlatformContact()
      })

      log.info('Módulo site-pages listo')
      return service
    },
  })
}
