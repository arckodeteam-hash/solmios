import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { AdminAnalyticsDTO, MonitoringDTO, PlanDTO, AmenityCatalogDTO, ModuleOverrideDTO } from './types'
import type { DashboardQueries } from './usecases/dashboard-queries'
import {
  auditSafely, planDeleteEntry, type AuditPort,
} from './usecases/audit'
import type { ApplySpecialConditionsInput, SpecialConditionsUseCase } from './usecases/special-conditions'
import type { SubscriptionCategoriesUseCase } from './usecases/subscription-categories'
import {
  getSubscriptionSettings, setSubscriptionSettings,
  type SubscriptionSettings,
} from './usecases/subscription-settings'
import type { ModuleOverridesUseCase } from './usecases/module-overrides'
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
  ) {}

  async listHotels(): Promise<{ data: any[]; total: number }> { return this.queries!.listHotels() }
  async listUsers(): Promise<{ data: any[]; total: number }> { return this.queries!.listUsers() }
  async getAnalytics(): Promise<AdminAnalyticsDTO> { return this.queries!.getAnalytics() }
  async listSubscriptions(): Promise<{ data: any[]; total: number; mrrTotal: number }> { return this.queries!.listSubscriptions() }
  async listAuditLogs(): Promise<{ data: any[]; total: number }> { return this.queries!.listAuditLogs() }
  async listAnnouncements(): Promise<{ data: any[]; total: number }> { return this.queries!.listAnnouncements() }
  async getMonitoring(): Promise<MonitoringDTO> { return this.queries!.getMonitoring() }
  async getPublicUsers(): Promise<any[]> { return this.queries!.getPublicUsers() }

  async listPlans(): Promise<{ data: any[]; total: number }> {
    const data = await this.plansRepo.findMany({})
    return { data: data as any[], total: data.length }
  }

  async createPlan(body: any): Promise<any> {
    if (!body.name || !body.price) throw new Error('name y price requeridos')
    return await this.plansRepo.create({
      name: body.name,
      slug: body.name.toLowerCase().replace(/\s+/g, '-'),
      price: Number(body.price), currency: body.currency || 'USD',
      description: body.description || '', features: body.features || [],
      modules: Array.isArray(body.modules) ? body.modules : [],
      limits: body.limits || { rooms: 30, users: 2, properties: 1 },
      isActive: body.isActive !== false ? 1 : 0, sortOrder: body.sortOrder || 0,
    })
  }

  async updatePlan(id: string, body: any, user?: any): Promise<any> {
    const existing = await this.plansRepo.findById(id) as any
    if (!existing) throw new Error('Plan no encontrado')
    if (this.auth) this.auth.assertOwnership(PLATFORM_RESOURCE, user?.id ?? '', user?.role, 'super_admin')
    const patch: Record<string, any> = {}
    for (const k of ['name', 'price', 'currency', 'description', 'features', 'modules', 'limits', 'isActive', 'sortOrder']) {
      if (body[k] !== undefined) patch[k] = k === 'isActive' ? (body[k] ? 1 : 0) : body[k]
    }
    if (body.name) patch.slug = body.name.toLowerCase().replace(/\s+/g, '-')
    return await this.plansRepo.update(id, patch)
  }

  async deletePlan(id: string, user?: any): Promise<void> {
    const existing = await this.plansRepo.findById(id) as any
    if (!existing) throw new Error('Plan no encontrado')
    if (this.auth) this.auth.assertOwnership(PLATFORM_RESOURCE, user?.id ?? '', user?.role, 'super_admin')
    await this.plansRepo.delete(id)
    await auditSafely(this.auditPort, this.logger, planDeleteEntry(existing, user))
  }

  /**
   * Actualiza plan/estado/datos de CUALQUIER hotel (operación de plataforma, solo super_admin).
   * El `plan` se valida contra la tabla `plans` (no un enum): un plan inexistente → error. Así se puede
   * asignar cualquier plan que exista en la tabla y no quedan planes fantasma.
   */
  async updateHotel(id: string, body: any, user?: any): Promise<any> {
    if (!this.hotelsRepo) throw new Error('hotelsRepo no disponible')
    const existing = await this.hotelsRepo.findById(id) as any
    if (!existing) throw new Error('Hotel no encontrado')
    if (this.auth) this.auth.assertOwnership(PLATFORM_RESOURCE, user?.id ?? '', user?.role, 'super_admin')
    const patch: Record<string, any> = {}
    if (body.plan !== undefined) {
      const slug = String(body.plan).toLowerCase()
      const plan = (await this.plansRepo.findMany({ slug }))[0]
      if (!plan) throw new Error(`El plan '${body.plan}' no existe en el catálogo de planes`)
      patch.plan = slug
    }
    if (body.status !== undefined) patch.status = String(body.status).toLowerCase()
    if (body.name !== undefined) patch.name = body.name
    if (body.email !== undefined) patch.email = body.email
    if (body.phone !== undefined) patch.phone = body.phone
    if (body.location !== undefined) patch.address = body.location
    return await this.hotelsRepo.update(id, patch)
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
