import { createModule, OrmRepository } from 'arckode-framework'
import type { PlanDTO, AmenityCatalogDTO } from './types'
import { AdminService } from './service'
import { AdminController } from './controller'
import { DashboardQueries } from './usecases/dashboard-queries'
import { MODULE_CATALOG, getModuleState, setModuleState, getModuleStateForHotel } from './usecases/modules'
import { SpecialConditionsUseCase } from './usecases/special-conditions'
import { SubscriptionCategoriesUseCase } from './usecases/subscription-categories'
import { ModuleOverridesUseCase } from './usecases/module-overrides'
import { requireUserType } from '../../infrastructure/auth/require-user-type'

export { AdminService }

export function AdminModule() {
  return createModule({
    name: 'admin',
    // STR-6: los tres endpoints de amenities cambiaron su contrato de error (409-para-todo →
    // 400/403/404/409, por TIPO de error). Un cambio observable del contrato bumpea la versión.
    version: '1.1.0',
    description: 'Super admin platform management',
    contract: {
      name: 'admin', version: '1.1.0',
      description: 'Platform-level management: hotels, users, plans, analytics',
      actions: ['listHotels', 'updateHotel', 'listUsers', 'getAnalytics', 'listSubscriptions', 'listAuditLogs', 'listAnnouncements', 'getMonitoring', 'listPlans', 'createPlan', 'updatePlan', 'deletePlan', 'listAmenitiesCatalog', 'createAmenityCatalog', 'updateAmenityCatalog', 'deleteAmenityCatalog', 'getPublicUsers', 'getModules', 'setModules', 'getEnabledModules', 'searchSubscriptionByEmail', 'subscriptionDetail', 'applySpecialConditions', 'suspendSubscription', 'reactivateSubscription', 'listSubscriptionCategories', 'updateSubscriptionCategory', 'getSubscriptionSettings', 'updateSubscriptionSettings', 'listModuleOverrides', 'upsertModuleOverride', 'deleteModuleOverride'],
      events: [],
      tables: [],
      dependencies: [],
      rules: ['Super_admin only'],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('admin: auth dependency required')
      const log = logger.child('admin')
      const plansRepo = new OrmRepository<PlanDTO>(orm, 'Plans')
      const amenitiesRepo = new OrmRepository<AmenityCatalogDTO>(orm, 'AmenitiesCatalog')
      const queries = new DashboardQueries(orm)
      const configRepo = new OrmRepository<any>(orm, 'Configuration')
      const hotelsRepo = new OrmRepository<any>(orm, 'Hotels')
      const moduleOverridesRepo = new OrmRepository<any>(orm, 'HotelModuleOverrides')
      // Suscripción SaaS del hotel: FUENTE DE VERDAD del plan para el gate de módulos
      // (resolve-plan.ts). `hotels.plan` es el espejo legacy que solo aplica sin suscripción.
      const subscriptionsRepo = new OrmRepository<any>(orm, 'Subscriptions')
      // `orm` crudo (no repos): el cupo de Fundador/Pionero necesita CAS (orm.updateMany), que
      // RepositoryAdapter/OrmRepository no exponen. Mismo criterio que DashboardQueries.
      const specialConditions = new SpecialConditionsUseCase(orm)
      const categories = new SubscriptionCategoriesUseCase(orm)
      const moduleOverrides = new ModuleOverridesUseCase(moduleOverridesRepo, auth, log)
      const service = new AdminService(plansRepo, amenitiesRepo, log, auth, queries, hotelsRepo, specialConditions, categories, configRepo, moduleOverrides)
      const controller = new AdminController(service, log)

      const sa = [auth.authenticate('super_admin'), requireUserType('admin')]
      const ar = [auth.authenticate('hotel_admin', 'receptionist', 'super_admin'), requireUserType('merchant')]

      // ── Módulos del producto (activar/desactivar) — global en configuration(platform,'modules') + por plan ──
      // Editar: solo super_admin. Leer: cualquier logueado; el estado sale de global ∩ el plan de SU hotel.
      router.get('/api/admin/modules', sa, async () => ({ status: 200, body: { catalog: MODULE_CATALOG, state: await getModuleState(configRepo) } }))
      router.put('/api/admin/modules', sa, async (req: any) => ({ status: 200, body: { state: await setModuleState(configRepo, (req.body?.state ?? req.body) || {}) } }))
      router.get('/api/modules', [auth.authenticate()], async (req: any) => {
        const hotelId = req.user?.hotelId
        let planSlug: string | undefined
        if (hotelId && hotelId !== 'platform') {
          const hotel = ((await hotelsRepo.findMany({ id: hotelId })) as any[])?.[0]
          planSlug = hotel?.plan
        }
        // El estado sale de global ∩ la SUSCRIPCIÓN ACTIVA del hotel ∩ overrides.
        // planSlug (hotels.plan) solo aplica si no hay suscripción activa (legacy).
        // `log` (E2): el WARN del resolver tiene que llegar a los logs, no morir en `undefined`.
        return { status: 200, body: { state: await getModuleStateForHotel(configRepo, plansRepo, subscriptionsRepo, hotelId, moduleOverridesRepo, planSlug, log) } }
      })

      router.get('/api/admin/hoteles', sa, () => controller.listHotels())
      // ── SMTP-UI (2026-08-19): test REAL de la config de correo de la plataforma ──
      // El botón de settings.vue era un toast falso — ocultó meses de desconexión entre
      // lo que la página guardaba ('smtp'/server/password) y lo que el motor leía
      // ('email_config'/host/pass). Envío directo sin cola: devuelve el provider usado o
      // el error verdadero de SMTP/Resend.
      router.post('/api/admin/email/test', sa, async (req: any) => {
        const to = String(req.body?.to ?? '').trim()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
          return { status: 400, body: { error: 'Destinatario inválido' } }
        }
        if (!service.emailReady) {
          return { status: 503, body: { error: 'EmailService no disponible' } }
        }
        try {
          const provider = await service.sendTestEmail(to)
          return { status: 200, body: { provider, message: `Enviado vía ${provider} a ${to}` } }
        } catch (e: any) {
          return { status: 500, body: { error: e?.message || 'Fallo el envío de prueba' } }
        }
      })
      router.put('/api/admin/hoteles/:id', sa, (req: any) => controller.updateHotel(req))
      router.get('/api/admin/users', sa, () => controller.listUsers())
      router.get('/api/admin/analytics', sa, () => controller.getAnalytics())
      router.get('/api/admin/subscriptions', sa, () => controller.listSubscriptions())
      router.get('/api/admin/audit', sa, () => controller.listAuditLogs())
      router.get('/api/admin/announcements', sa, () => controller.listAnnouncements())
      router.get('/api/admin/monitoring', sa, () => controller.getMonitoring())
      router.get('/api/admin/plans', sa, () => controller.listPlans())
      router.post('/api/admin/plans', sa, (req: any) => controller.createPlan(req))
      router.put('/api/admin/plans/:id', sa, (req: any) => controller.updatePlan(req))
      router.delete('/api/admin/plans/:id', sa, (req: any) => controller.deletePlan(req))
      router.get('/api/admin/amenities/catalog', sa, () => controller.listAmenitiesCatalog())
      router.post('/api/admin/amenities/catalog', sa, (req: any) => controller.createAmenityCatalog(req))
      router.put('/api/admin/amenities/catalog/:id', sa, (req: any) => controller.updateAmenityCatalog(req))
      router.delete('/api/admin/amenities/catalog/:id', sa, (req: any) => controller.deleteAmenityCatalog(req))
      router.get('/api/public/users', () => controller.getPublicUsers())

      // ── Condiciones especiales / Fundador-Pionero (PLAN-SUSCRIPCIONES.md) ──────────────
      router.get('/api/admin/subscriptions/search', sa, (req: any) => controller.searchSubscriptionByEmail(req))
      router.get('/api/admin/subscriptions/categories', sa, () => controller.listSubscriptionCategories())
      router.put('/api/admin/subscriptions/categories/:key', sa, (req: any) => controller.updateSubscriptionCategory(req))
      router.get('/api/admin/subscriptions/settings', sa, () => controller.getSubscriptionSettings())
      router.put('/api/admin/subscriptions/settings', sa, (req: any) => controller.updateSubscriptionSettings(req))
      router.get('/api/admin/subscriptions/:hotelId', sa, (req: any) => controller.subscriptionDetail(req))
      router.post('/api/admin/subscriptions/:hotelId/special-conditions', sa, (req: any) => controller.applySpecialConditions(req))
      router.post('/api/admin/subscriptions/:hotelId/suspend', sa, (req: any) => controller.suspendSubscription(req))
      router.post('/api/admin/subscriptions/:hotelId/reactivate', sa, (req: any) => controller.reactivateSubscription(req))

      // ── Overrides de módulos por hotel (3ra capa de entitlement) ──────────────────────
      router.get('/api/admin/hotels/:hotelId/module-overrides', sa, (req: any) => controller.listModuleOverrides(req))
      router.post('/api/admin/hotels/:hotelId/module-overrides', sa, (req: any) => controller.upsertModuleOverride(req))
      router.delete('/api/admin/hotels/:hotelId/module-overrides/:id', sa, (req: any) => controller.deleteModuleOverride(req))

      log.info('Módulo admin listo (31 endpoints)')
      return service
    },
  })
}
