import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { AdminService } from './service'
import {
  CreatePlanSchema, UpdatePlanSchema, CreateAmenityCatalogSchema, UpdateAmenityCatalogSchema, UpdateHotelAdminSchema,
  ApplySpecialConditionsSchema, UpdateSpecialCategorySchema, UpdateSubscriptionSettingsSchema, ModuleOverrideSchema,
  ExtendTrialSchema, ManualPaymentSchema,
} from './validators/schema'

/**
 * Mapeo de error → HTTP. Nació para el catálogo de amenities y lo comparte la facturación de
 * plataforma (BIL-2/BIL-3): el criterio es el mismo, el status sale del TIPO de error.
 *
 * COR-3/SEC-5: los tres handlers tenían un `catch` con un status FIJO — el alta devolvía 409
 * "Amenity ya existe" para CUALQUIER excepción, incluido el `ForbiddenError` que tira
 * `assertOwnership` (un merchant recibía "ya existe" en vez de 403) y los errores de validación
 * ("key y label requeridos" salía como conflicto). Ahora el status sale del TIPO de error.
 *
 * STR-4: el mapeo es por TIPO, no por texto. Antes `msg.includes('ya existe')` decidía el 409, así
 * que cambiar un mensaje de UI cambiaba el código de respuesta; el usecase ahora tira
 * `ValidationError`/`ConflictError`/`NotFoundError` del framework (mismo criterio que
 * `usecases/subscription-categories.ts`). El único match por texto que queda es el `Forbidden` que
 * `Auth.assertOwnership` tira como `Error` pelado desde el kernel: ese string no es de UI.
 */
const ERROR_STATUS_BY_TYPE: Record<string, number> = {
  AuthError: 403, ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  ValidationError: 400,
  // BIL-3: el correo de plataforma sin cablear no es culpa del pedido — 503, no 400.
  ServiceUnavailableError: 503,
  // REQ-PIPE-05: falta el connector `admin-subscriptions-trial` — mismo criterio, 503 por tipo.
  TrialPortUnavailableError: 503,
}

function httpStatusOfError(e: unknown): number {
  const err = e as { name?: string; message?: string }
  const byType = ERROR_STATUS_BY_TYPE[String(err?.name ?? '')]
  if (byType) return byType
  // `kernel/auth.ts` tira un Error sin subclase para el fallo de ownership.
  if (String(err?.message ?? '').startsWith('Forbidden')) return 403
  return 400
}

export class AdminController {
  constructor(
    private readonly service: AdminService,
    private readonly logger: Logger,
  ) {}

  async listHotels() {
    return { status: 200, body: await this.service.listHotels() }
  }

  async listUsers() {
    return { status: 200, body: await this.service.listUsers() }
  }

  async getAnalytics() {
    return { status: 200, body: await this.service.getAnalytics() }
  }

  async getPlatformMetrics() {
    return { status: 200, body: await this.service.getPlatformMetrics() }
  }

  async listSubscriptions() {
    return { status: 200, body: await this.service.listSubscriptions() }
  }

  /** #142: los filtros y la paginación viajan por query y se aplican en la consulta. */
  async listAuditLogs(req: HttpRequest) {
    const q = (req.query ?? {}) as Record<string, string>
    return {
      status: 200,
      body: await this.service.listAuditLogs({
        hotelId: q.hotelId, userId: q.userId, action: q.action, entity: q.entity,
        from: q.from, to: q.to,
        page: Number(q.page) || undefined, limit: Number(q.limit) || undefined,
      }),
    }
  }

  async getAnnouncementsReach() {
    return { status: 200, body: await this.service.getAnnouncementsReach() }
  }

  async listAnnouncements() {
    return { status: 200, body: await this.service.listAnnouncements() }
  }

  async getMonitoring() {
    return { status: 200, body: await this.service.getMonitoring() }
  }

  async listPlans() {
    return { status: 200, body: await this.service.listPlans() }
  }

  // validateSchema del framework SOLO maneja string/number/boolean/date → DESCARTA los campos
  // array/object (features, modules, limits). Se re-inyectan del body crudo (el service los whitelistea).
  private mergeComplexPlanFields(data: any, body: any): any {
    const b = body ?? {}
    if (Array.isArray(b.features)) data.features = b.features
    if (Array.isArray(b.modules)) data.modules = b.modules
    if (b.limits && typeof b.limits === 'object') data.limits = b.limits
    return data
  }

  async createPlan(req: HttpRequest) {
    try {
      const data = this.mergeComplexPlanFields(validateSchema(CreatePlanSchema, req.body) as any, req.body)
      const plan = await this.service.createPlan(data)
      return { status: 201, body: plan }
    } catch (e: any) {
      return { status: 400, body: { error: e.message } }
    }
  }

  async updatePlan(req: HttpRequest) {
    try {
      const data = this.mergeComplexPlanFields(validateSchema(UpdatePlanSchema, req.body) as any, req.body)
      return { status: 200, body: await this.service.updatePlan(req.params.id, data, req.user as any) }
    } catch (e: any) {
      return { status: e.message.includes('no encontrado') ? 404 : 400, body: { error: e.message } }
    }
  }

  async deletePlan(req: HttpRequest) {
    try {
      await this.service.deletePlan(req.params.id, req.user as any)
      return { status: 200, body: { success: true } }
    } catch (e: any) {
      return { status: 404, body: { error: e.message } }
    }
  }

  async updateHotel(req: HttpRequest) {
    try {
      const data = validateSchema(UpdateHotelAdminSchema, req.body) as any
      return { status: 200, body: await this.service.updateHotel(req.params.id, data, req.user as any) }
    } catch (e: any) {
      const msg = e.message || 'Error'
      const status = msg.includes('no encontrado') ? 404 : (msg.includes('no existe') ? 400 : 400)
      return { status, body: { error: msg } }
    }
  }

  async listAmenitiesCatalog() {
    return { status: 200, body: await this.service.listAmenitiesCatalog() }
  }

  async createAmenityCatalog(req: HttpRequest) {
    try {
      const data = validateSchema(CreateAmenityCatalogSchema, req.body) as any
      return { status: 201, body: await this.service.createAmenityCatalog(data, req.user as any) }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }

  async updateAmenityCatalog(req: HttpRequest) {
    try {
      const data = validateSchema(UpdateAmenityCatalogSchema, req.body) as any
      return { status: 200, body: await this.service.updateAmenityCatalog(req.params.id, data, req.user as any) }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }

  async deleteAmenityCatalog(req: HttpRequest) {
    try {
      await this.service.deleteAmenityCatalog(req.params.id, req.user as any)
      return { status: 200, body: { success: true } }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }

  async getPublicUsers() {
    return { status: 200, body: await this.service.getPublicUsers() }
  }

  // ── Condiciones especiales / Fundador-Pionero (PLAN-SUSCRIPCIONES.md) ──────────────────

  async searchSubscriptionByEmail(req: HttpRequest) {
    try {
      const email = String((req.query as any)?.email ?? '').trim()
      if (!email) return { status: 400, body: { error: 'Falta el parámetro email' } }
      return { status: 200, body: await this.service.searchSubscriptionByEmail(email) }
    } catch (e: any) {
      return { status: /no se encontr|no encontrad/i.test(e.message ?? '') ? 404 : 400, body: { error: e.message } }
    }
  }

  async subscriptionDetail(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.subscriptionDetail(req.params.hotelId) }
    } catch (e: any) {
      return { status: 404, body: { error: e.message } }
    }
  }

  async applySpecialConditions(req: HttpRequest) {
    try {
      const data = validateSchema(ApplySpecialConditionsSchema, req.body) as any
      // `category` viaja explícitamente en null para desasignar — validateSchema descarta
      // undefined/null de entrada (kernel/validator.ts), así que se re-inyecta del body crudo,
      // mismo criterio que mergeComplexPlanFields con features/modules/limits.
      if (data.type === 'category') {
        const raw = (req.body as any)?.category
        data.category = raw === null || typeof raw === 'string' ? raw : undefined
      }
      return { status: 200, body: await this.service.applySpecialConditions(req.params.hotelId, data, req.user as any) }
    } catch (e: any) {
      return { status: e.message?.includes('no encontrado') || e.message?.includes('no tiene una suscripción') ? 404 : 400, body: { error: e.message } }
    }
  }

  async suspendSubscription(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.suspendSubscriptionManual(req.params.hotelId) }
    } catch (e: any) {
      return { status: 404, body: { error: e.message } }
    }
  }

  async reactivateSubscription(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.reactivateSubscriptionManual(req.params.hotelId) }
    } catch (e: any) {
      return { status: 404, body: { error: e.message } }
    }
  }

  /**
   * REQ-PIPE-05 (#146): `{ days: 1..30 }` entero → 400 fuera de rango o no entero, 404 sin
   * suscripción, 409 si la suscripción no es una prueba (active/past_due/suspended/canceled o con
   * Stripe), 503 sin connector. Todo por TIPO de error: nada de regex sobre el mensaje.
   */
  async extendTrial(req: HttpRequest) {
    try {
      const data = validateSchema(ExtendTrialSchema, req.body || {}) as { days: number }
      return { status: 200, body: await this.service.extendTrial(req.params.hotelId, data.days, req.user as any) }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }

  async listSubscriptionCategories() {
    return { status: 200, body: await this.service.listSubscriptionCategories() }
  }

  async updateSubscriptionCategory(req: HttpRequest) {
    try {
      const data = validateSchema(UpdateSpecialCategorySchema, req.body) as any
      return { status: 200, body: await this.service.updateSubscriptionCategory(req.params.key, data) }
    } catch (e: any) {
      return { status: e.message?.includes('no encontrada') ? 404 : 400, body: { error: e.message } }
    }
  }

  async getSubscriptionSettings() {
    return { status: 200, body: await this.service.getSubscriptionSettings() }
  }

  async updateSubscriptionSettings(req: HttpRequest) {
    try {
      const data = validateSchema(UpdateSubscriptionSettingsSchema, req.body) as any
      return { status: 200, body: await this.service.updateSubscriptionSettings(data) }
    } catch (e: any) {
      return { status: 400, body: { error: e.message } }
    }
  }

  // ── Overrides de módulos por hotel (3ra capa de entitlement) ──────────────────────────

  async listModuleOverrides(req: HttpRequest) {
    return { status: 200, body: await this.service.listModuleOverrides(req.params.hotelId) }
  }

  async upsertModuleOverride(req: HttpRequest) {
    try {
      const data = validateSchema(ModuleOverrideSchema, req.body) as any
      const override = await this.service.upsertModuleOverride(req.params.hotelId, data, req.user as any)
      return { status: 201, body: override }
    } catch (e: any) {
      const msg = e.message || 'Error'
      const status = msg.includes('no encontrad') ? 404 : 400
      return { status, body: { error: msg } }
    }
  }

  async deleteModuleOverride(req: HttpRequest) {
    try {
      await this.service.deleteModuleOverride(req.params.id, req.user as any)
      return { status: 200, body: { success: true } }
    } catch (e: any) {
      return { status: 404, body: { error: e.message } }
    }
  }
  // ── Facturación de la PLATAFORMA (/admin/billing, REQ-BIL-04) ─────────────────────────────
  // Los filtros viajan como query y se aplican en el usecase (server-side): la pantalla del
  // super-admin cruza todos los hoteles, mandarle el historial entero al navegador no escala.

  private billingQuery(req: HttpRequest) {
    const q = (req.query ?? {}) as Record<string, string>
    const nonEmpty = (v?: string) => (v && v !== 'all' ? String(v) : undefined)
    return {
      status: nonEmpty(q.status), planId: nonEmpty(q.planId),
      from: nonEmpty(q.from), to: nonEmpty(q.to), q: nonEmpty(q.q),
      page: Number(q.page) || undefined, limit: Number(q.limit) || undefined,
    }
  }

  async listBillingInvoices(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.billing.list(this.billingQuery(req)) }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }

  async getBillingInvoice(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.billing.detail(String(req.params.id)) }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }

  async getBillingStats(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.billing.stats(this.billingQuery(req)) }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }

  /** CSV como Buffer, NO string: el framework envuelve cualquier body no-Buffer en el envelope
   *  JSON y el .csv saldría como un blob con `\n` literales (mismo motivo que reports). */
  async exportBillingCsv(req: HttpRequest) {
    try {
      const csv = await this.service.billing.csv(this.billingQuery(req))
      const filename = `facturacion-plataforma-${new Date().toISOString().slice(0, 10)}.csv`
      return {
        status: 200,
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
        body: Buffer.from(csv, 'utf-8'),
      }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }
  /** REQ-BIL-05 — 409 si ya no se reclama o si se recordó hace menos de 24 h (con la hora). */
  async remindBillingInvoice(req: HttpRequest) {
    try {
      return { status: 200, body: await this.service.billing.remind(String(req.params.id), req.user as any) }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }

  /** REQ-BIL-06 — pago fuera de Stripe: deja la fila `manual`/`paid` y reactiva la suscripción. */
  async registerManualPayment(req: HttpRequest) {
    try {
      const data = validateSchema(ManualPaymentSchema, req.body) as any
      return { status: 201, body: await this.service.billing.manualPayment(data, req.user as any) }
    } catch (e: any) {
      return { status: httpStatusOfError(e), body: { error: e.message } }
    }
  }
}
