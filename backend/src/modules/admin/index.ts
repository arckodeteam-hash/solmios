import { createModule, OrmRepository } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import { estadoMetaApp, guardarMetaApp } from '../../infrastructure/meta-app-config'
import { MetaAppConfigSchema } from './validators/meta-app-schema'
import type { PlanDTO, AmenityCatalogDTO } from './types'
import { AdminService } from './service'
import { AdminController } from './controller'
import { DashboardQueries } from './usecases/dashboard-queries'
import { MODULE_CATALOG, getModuleState, setModuleState, getModuleStateForHotel, moduleCatalogTree } from './usecases/modules'
import { SpecialConditionsUseCase } from './usecases/special-conditions'
import { SubscriptionCategoriesUseCase } from './usecases/subscription-categories'
import { ModuleOverridesUseCase } from './usecases/module-overrides'
import { PlatformBillingUseCase } from './usecases/billing'
import { requireUserType } from '../../infrastructure/auth/require-user-type'

export { AdminService }

export function AdminModule() {
  return createModule({
    name: 'admin',
    // STR-6: los tres endpoints de amenities cambiaron su contrato de error (409-para-todo →
    // 400/403/404/409, por TIPO de error). Un cambio observable del contrato bumpea la versión.
    // 1.2.0: + GET /api/admin/modules/catalog (árbol módulo→sub-módulos para el editor de planes)
    // y `plans.modules` se valida contra el catálogo (400 con las claves inválidas).
    // 1.3.0 (BIL-2, #154): + facturación de la plataforma — listado con filtros, detalle, stats y
    // export CSV sobre `platform_invoices`. Contrato observable nuevo.
    // 1.4.0 (BIL-3, #155): + recordatorio de cobro (plantilla por estado, dedup 24 h) y registro de
    // pago manual (reactiva la suscripción vía connector). Las dos dejan audit log.
    version: '1.4.0',
    description: 'Super admin platform management',
    contract: {
      name: 'admin', version: '1.4.0',
      description: 'Platform-level management: hotels, users, plans, analytics',
      actions: ['listHotels', 'updateHotel', 'listUsers', 'getAnalytics', 'listSubscriptions', 'listAuditLogs', 'listAnnouncements', 'getMonitoring', 'listPlans', 'createPlan', 'updatePlan', 'deletePlan', 'listAmenitiesCatalog', 'createAmenityCatalog', 'updateAmenityCatalog', 'deleteAmenityCatalog', 'getPublicUsers', 'getModules', 'getModulesCatalog', 'setModules', 'getEnabledModules', 'searchSubscriptionByEmail', 'subscriptionDetail', 'applySpecialConditions', 'suspendSubscription', 'reactivateSubscription', 'listSubscriptionCategories', 'updateSubscriptionCategory', 'getSubscriptionSettings', 'updateSubscriptionSettings', 'listModuleOverrides', 'upsertModuleOverride', 'deleteModuleOverride', 'listBillingInvoices', 'getBillingInvoice', 'getBillingStats', 'exportBillingCsv', 'remindBillingInvoice', 'registerManualPayment'],
      events: [],
      tables: [],
      dependencies: [],
      rules: [
        'Super_admin only',
        'billing/*: la verdad es `platform_invoices` (la llena el webhook de Stripe, BIL-1). NUNCA derivar una factura de `listSubscriptions` ni calcular el monto desde el precio del plan',
        'billing/*: los filtros (estado, plan, rango de fechas, texto) se aplican en el usecase, no en el navegador sobre el set completo',
        'billing/remind: una factura no se recuerda dos veces en 24 h (409) — el reintento de Stripe ya genera varios eventos del mismo cobro',
        'billing/manual-payment: PRIMERO la fila del cobro, DESPUÉS la activación. La suscripción se toca SOLO vía el connector admin-subscriptions-billing',
      ],
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
      // `subscriptionsRepo` (último): sin él, el select de plan de /admin/hotels solo escribiría el
      // espejo legacy `hotels.plan` y el hotel seguiría con los módulos del plan viejo (#46).
      // Facturación de la PLATAFORMA (BIL-1..3): `platform_invoices` la define el módulo
      // `subscriptions` (es su tabla); acá solo se LEE/escribe vía repo, igual que `Subscriptions`
      // más arriba — los módulos no se importan entre sí, el modelo es compartido por el ORM.
      const platformBilling = new PlatformBillingUseCase({
        invoicesRepo: new OrmRepository<any>(orm, 'PlatformInvoices'),
        hotelsRepo, subscriptionsRepo, logger: log,
        // MRR real (solo `active`), misma cuenta que /admin/subscriptions — no se recalcula acá.
        readMrr: async () => (await queries.listSubscriptions()).mrrTotal,
      })
      const service = new AdminService(plansRepo, amenitiesRepo, log, auth, queries, hotelsRepo, specialConditions, categories, configRepo, moduleOverrides, subscriptionsRepo, platformBilling)
      const controller = new AdminController(service, log)

      const sa = [auth.authenticate('super_admin'), requireUserType('admin')]
      const ar = [auth.authenticate('hotel_admin', 'receptionist', 'super_admin'), requireUserType('merchant')]

      // ── Módulos del producto (activar/desactivar) — global en configuration(platform,'modules') + por plan ──
      // Editar: solo super_admin. Leer: cualquier logueado; el estado sale de global ∩ el plan de SU hotel.
      router.get('/api/admin/modules', sa, async () => ({ status: 200, body: { catalog: MODULE_CATALOG, state: await getModuleState(configRepo) } }))
      // Árbol módulo→sub-módulos (claves + labels en español) para el editor de planes.
      // Fuente única: el mismo catálogo que lee el gate — el frontend no duplica la lista.
      router.get('/api/admin/modules/catalog', sa, () => ({ status: 200, body: moduleCatalogTree() }))
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

      // Credenciales de la APP de Meta (plataforma). El secreto firma los webhooks de TODOS los
      // hoteles: no es configuración de ninguno en particular. El GET nunca devuelve el secreto.
      router.get('/api/admin/meta-whatsapp', sa, async () => ({ status: 200, body: await estadoMetaApp(configRepo) }))
      router.put('/api/admin/meta-whatsapp', sa, async (req: any) => {
        const body = validateSchema(MetaAppConfigSchema, req.body || {}) as any
        return { status: 200, body: await guardarMetaApp(configRepo, body) }
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
      router.get('/api/admin/platform-metrics', sa, () => controller.getPlatformMetrics())
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

      // ── Facturación de la PLATAFORMA (lo que los hoteles le pagan a SOLMI OS) ──────────────
      // `export.csv` va ANTES de `/:id`: el router matchea por orden y `export.csv` entraría
      // como un `:id` que no existe (404 con el archivo vacío).
      router.get('/api/admin/billing/invoices', sa, (req: any) => controller.listBillingInvoices(req))
      router.get('/api/admin/billing/stats', sa, (req: any) => controller.getBillingStats(req))
      router.get('/api/admin/billing/export.csv', sa, (req: any) => controller.exportBillingCsv(req))
      router.get('/api/admin/billing/invoices/:id', sa, (req: any) => controller.getBillingInvoice(req))
      router.post('/api/admin/billing/invoices/:id/remind', sa, (req: any) => controller.remindBillingInvoice(req))
      router.post('/api/admin/billing/manual-payment', sa, (req: any) => controller.registerManualPayment(req))

      log.info('Módulo admin listo (43 endpoints)')
      return service
    },
  })
}
