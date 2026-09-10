import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { AdminAnalyticsDTO, MonitoringDTO, PlanDTO, AmenityCatalogDTO, ModuleOverrideDTO } from './types'
import { PLANS_PRICE_ORDER } from '../../shared/utils/plans-order'
import type { DashboardQueries } from './usecases/dashboard-queries'
import type { PlatformMetrics } from './usecases/platform-metrics'
import { type AuditPort } from './usecases/audit'
import type { ApplySpecialConditionsInput, SpecialConditionsUseCase } from './usecases/special-conditions'
import type { SubscriptionCategoriesUseCase } from './usecases/subscription-categories'
import {
  getSubscriptionSettings, setSubscriptionSettings,
  type SubscriptionSettings,
} from './usecases/subscription-settings'
import type { ModuleOverridesUseCase } from './usecases/module-overrides'
import type { PlatformBillingUseCase } from './usecases/billing'
import * as plans from './usecases/plans'
import { updateHotel } from './usecases/update-hotel'
import {
  listAmenitiesCatalog, createAmenityCatalog, updateAmenityCatalog, deleteAmenityCatalog,
  type AmenitiesCatalogDeps,
} from './usecases/amenities-catalog'

/**
 * Planes y catálogo de amenities son recursos de la plataforma: no pertenecen a ningún hotel ni
 * usuario. `assertOwnership(dueño, solicitante, rol, rolAdmin)` sale bien por una de dos puertas:
 * que el solicitante SEA el dueño, o que tenga el rol de admin. Este centinela nunca va a coincidir
 * con un `user.id`, así que cierra la primera puerta y deja sólo la del rol.
 *
 * Antes se llamaba `assertOwnership(existing, { role: 'super_admin' })` — dos objetos, `===` siempre
 * false y sin rol: lanzaba Forbidden hasta para el super_admin. Editar un plan era imposible.
 */
const PLATFORM_RESOURCE = '__platform__'

export class AdminService {
  private auditPort: AuditPort | null = null

  /** Conecta el audit log. Lo inyecta el connector `admin-auditlog`. */
  setAuditDeps(port: AuditPort): void {
    this.auditPort = port
  }

  /**
   * SMTP-UI (2026-08-19): EmailService para el botón "Email de prueba" de settings del
   * super-admin. Lo cablea email-bootstrap (mismo patrón que reservas/subscriptions). Sin
   * cablear, el endpoint responde 503 — nunca un falso éxito.
   */
  private emailPort: { sendTestEmail(to: string): Promise<'smtp' | 'resend'> } | null = null
  setEmailDeps(es: { sendTestEmail(to: string): Promise<'smtp' | 'resend'> }): void {
    this.emailPort = es
  }

  get emailReady(): boolean { return this.emailPort !== null }

  async sendTestEmail(to: string): Promise<'smtp' | 'resend'> {
    if (!this.emailPort) throw new Error('EmailService no cableado (email-bootstrap)')
    return this.emailPort.sendTestEmail(to)
  }

  constructor(
    private readonly plansRepo: RepositoryAdapter<PlanDTO>,
    private readonly amenitiesRepo: RepositoryAdapter<AmenityCatalogDTO>,
    private readonly logger: Logger,
    private readonly auth?: any,
    private readonly queries?: DashboardQueries,
    private readonly hotelsRepo?: RepositoryAdapter<any>,
    private readonly specialConditions?: SpecialConditionsUseCase,
    private readonly categories?: SubscriptionCategoriesUseCase,
    private readonly configRepo?: RepositoryAdapter<any>,
    private readonly moduleOverrides?: ModuleOverridesUseCase,
    /** #46: `subscriptions.planId`, fuente de verdad del plan para el gate. OPCIONAL como el resto
     *  de los deps: sin cablear, `updateHotel` solo espeja `hotels.plan` (como antes) y no rompe. */
    private readonly subscriptionsRepo?: RepositoryAdapter<any>,
    /** BIL-2: facturación de la plataforma. El service solo la EXPONE — toda la lógica vive en `usecases/billing*.ts`, que es lo que pide la regla del God Object. */
    private readonly platformBilling?: PlatformBillingUseCase,
  ) {}

  /** `platform_invoices` para /admin/billing. Sin cablear (tabla no migrada) tira y el controller responde 503 — nunca una pantalla que miente. */
  get billing(): PlatformBillingUseCase {
    if (!this.platformBilling) throw new Error('admin: facturación de plataforma no cableada')
    return this.platformBilling
  }

  async listHotels(): Promise<{ data: any[]; total: number }> { return this.queries!.listHotels() }
  async listUsers(): Promise<{ data: any[]; total: number }> { return this.queries!.listUsers() }
  async getAnalytics(): Promise<AdminAnalyticsDTO> { return this.queries!.getAnalytics() }

  async getPlatformMetrics(): Promise<PlatformMetrics> { return this.queries!.getPlatformMetrics() }
  async listSubscriptions(): Promise<{ data: any[]; total: number; mrrTotal: number }> { return this.queries!.listSubscriptions() }
  async listAuditLogs(): Promise<{ data: any[]; total: number }> { return this.queries!.listAuditLogs() }
  async listAnnouncements(): Promise<{ data: any[]; total: number }> { return this.queries!.listAnnouncements() }
  async getMonitoring(): Promise<MonitoringDTO> { return this.queries!.getMonitoring() }
  async getPublicUsers(): Promise<any[]> { return this.queries!.getPublicUsers() }

  /**
   * #30: mismo orden que el catálogo público (`PLANS_PRICE_ORDER` — price ASC, slug ASC), para
   * que el admin vea los planes como los ve el cliente. Antes salía en el orden que devolvía
   * la base (arbitrario).
   */
  async listPlans(): Promise<{ data: any[]; total: number }> {
    const data = await this.plansRepo.findMany({}, { orderBy: PLANS_PRICE_ORDER })
    return { data: data as any[], total: data.length }
  }

  /**
   * CRUD de planes — delega a usecases/plans.ts (mismo patrón que amenities-catalog):
   * la matriz `modules` se valida contra el catálogo del gate (CS-9, clave inválida → 400).
   */
  private get plansDeps() {
    return {
      plansRepo: this.plansRepo, logger: this.logger, auth: this.auth,
      platformResource: PLATFORM_RESOURCE, auditPort: () => this.auditPort,
    }
  }

  async createPlan(body: any): Promise<any> { return plans.createPlan(this.plansDeps, body) }

  async updatePlan(id: string, body: any, user?: any): Promise<any> { return plans.updatePlan(this.plansDeps, id, body, user) }

  async deletePlan(id: string, user?: any): Promise<void> { return plans.deletePlan(this.plansDeps, id, user) }

  /** Ver `usecases/update-hotel.ts`: valida el plan contra el catálogo y espeja la suscripción. */
  async updateHotel(id: string, body: any, user?: any): Promise<any> {
    return updateHotel({
      hotelsRepo: this.hotelsRepo, plansRepo: this.plansRepo as RepositoryAdapter<any>,
      subscriptionsRepo: this.subscriptionsRepo, logger: this.logger, auth: this.auth,
      platformResource: PLATFORM_RESOURCE,
    }, id, body, user)
  }

  /** Deps del CRUD de amenities. `auth` OBLIGATORIO: es un recurso de plataforma (QA7-3). */
  private get amenitiesDeps(): AmenitiesCatalogDeps {
    if (!this.auth) throw new Error('admin: auth requerido para operar el catálogo de amenities')
    return {
      repo: this.amenitiesRepo, logger: this.logger, auth: this.auth,
      platformResource: PLATFORM_RESOURCE, auditPort: () => this.auditPort,
    }
  }

  listAmenitiesCatalog(): Promise<{ data: any[]; total: number }> { return listAmenitiesCatalog(this.amenitiesDeps) }
  createAmenityCatalog(body: any, user?: any): Promise<any> { return createAmenityCatalog(this.amenitiesDeps, body, user) }
  updateAmenityCatalog(id: string, body: any, user?: any): Promise<any> { return updateAmenityCatalog(this.amenitiesDeps, id, body, user) }
  deleteAmenityCatalog(id: string, user?: any): Promise<void> { return deleteAmenityCatalog(this.amenitiesDeps, id, user) }

  // ── Condiciones especiales / Fundador-Pionero (PLAN-SUSCRIPCIONES.md) ──────────────────

  searchSubscriptionByEmail(email: string): Promise<any> {
    return this.specialConditions!.searchByEmail(email)
  }

  subscriptionDetail(hotelId: string): Promise<any> {
    return this.specialConditions!.detail(hotelId)
  }

  applySpecialConditions(hotelId: string, input: ApplySpecialConditionsInput, user?: any): Promise<any> {
    return this.specialConditions!.apply(hotelId, input, { id: user?.id })
  }

  suspendSubscriptionManual(hotelId: string): Promise<any> {
    return this.specialConditions!.suspendManual(hotelId)
  }

  reactivateSubscriptionManual(hotelId: string): Promise<any> {
    return this.specialConditions!.reactivateManual(hotelId)
  }

  listSubscriptionCategories(): Promise<{ data: any[]; total: number }> {
    return this.categories!.list()
  }

  updateSubscriptionCategory(key: string, patch: any): Promise<any> {
    return this.categories!.update(key, patch)
  }

  getSubscriptionSettings(): Promise<SubscriptionSettings> {
    return getSubscriptionSettings(this.configRepo!)
  }

  updateSubscriptionSettings(patch: Partial<SubscriptionSettings>): Promise<SubscriptionSettings> {
    return setSubscriptionSettings(this.configRepo!, patch)
  }

  // ── Overrides de módulos por hotel (3ra capa) — delega a ModuleOverridesUseCase ──
  async listModuleOverrides(hotelId: string): Promise<ModuleOverrideDTO[]> {
    return this.moduleOverrides ? this.moduleOverrides.list(hotelId) : []
  }
  upsertModuleOverride(hotelId: string, body: any, user?: any): Promise<any> { return this.moduleOverrides!.upsert(hotelId, body, user) }
  deleteModuleOverride(id: string, user?: any): Promise<void> { return this.moduleOverrides!.delete(id, user) }
}
