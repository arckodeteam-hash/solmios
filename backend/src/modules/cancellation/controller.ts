// cancellation/controller.ts — Adaptador HTTP del módulo (F1 plan #627).
// F1: scaffolding tipado. Las rutas se registran en F3 (index.ts). NO lógica de negocio,
// NO llamadas al ORM directo. Toda mutación (POST/PUT) pasa por validateSchema() (REGLA #11).
import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { CancellationService } from './service'
import { CreateCancellationPolicySchema, UpdateCancellationPolicySchema, UpsertBasePolicySchema, UpsertOverridePolicySchema } from './validators/schema'
import { validateTiers } from './usecases/policies-crud'

export class CancellationController {
  constructor(
    private readonly service: CancellationService,
    private readonly logger: Logger,
  ) {}

  /**
   * hotelId del TOKEN, no de la query (anti-IDOR cross-tenant). Un usuario de hotel NO
   * puede apuntar a otro hotel pasando ?hotelId=. super_admin puede cross-hotel via query.
   * Mismo patrón que pricing/controller.ts hotelOf().
   */
  private hotelOf(req: any): string | undefined {
    const userHotel = req?.user?.hotelId
    if (userHotel && userHotel !== 'platform') return userHotel as string
    if (req?.user?.role === 'super_admin' && req?.query?.hotelId) return req.query.hotelId as string
    return undefined
  }


  // ── CRUD admin (F3) — rutas con guard('settings', ...) registradas en index.ts ──────

  /** GET /api/cancellation-policies → { data: CancellationPolicyDTO[] } */
  async list(req: HttpRequest) {
    const hotelId = this.hotelOf(req)
    if (!hotelId) return { status: 200, body: { data: [] } }
    const data = await this.service.listPolicies(hotelId)
    return { status: 200, body: { data } }
  }

  /** PUT /api/cancellation-policies/base → upsert de la política base. */
  async upsertBase(req: HttpRequest) {
    try {
      const hotelId = this.hotelOf(req)
      if (!hotelId) return { status: 400, body: { error: 'hotelId requerido (no hay sesión de hotel)' } }
      const data = validateSchema(UpsertBasePolicySchema, req.body) as any
      // validateSchema descarta arrays/objects (tiers) → reinyectar del body crudo + validar en profundidad.
      const rawTiers = (req.body as any)?.tiers
      validateTiers(rawTiers)
      const name = typeof data?.name === 'string' ? data.name : undefined
      const item = await this.service.upsertBase(hotelId, rawTiers, name)
      return { status: 200, body: item }
    } catch (e: any) {
      return { status: 400, body: { error: e.message || 'Error al guardar la política base' } }
    }
  }

  /** POST /api/cancellation-policies/override → upsert de un override por canal. */
  async upsertOverride(req: HttpRequest) {
    try {
      const hotelId = this.hotelOf(req)
      if (!hotelId) return { status: 400, body: { error: 'hotelId requerido (no hay sesión de hotel)' } }
      const data = validateSchema(UpsertOverridePolicySchema, req.body) as any
      // F3: solo overrides por canal. El usecase vuelve a validar, pero acá ya acotamos el
      // tipo para TS (scope: 'channel' literal, no string genérico).
      if (data.scope !== 'channel') {
        return { status: 400, body: { error: "scope debe ser 'channel' (rate/season vienen en próximas fases)" } }
      }
      const rawTiers = (req.body as any)?.tiers
      validateTiers(rawTiers)
      const item = await this.service.upsertOverride(hotelId, {
        scope: 'channel',
        scopeId: String(data.scopeId),
        tiers: rawTiers,
        name: typeof data?.name === 'string' ? data.name : undefined,
        priority: typeof data?.priority === 'number' ? data.priority : undefined,
      })
      return { status: 201, body: item }
    } catch (e: any) {
      // 409 si el conflicto es de unicidad/base-ausente; 400 resto. El usecase lanza ValidationError.
      const msg = e.message || 'Error al guardar el override'
      const status = /no existe una política base/i.test(msg) ? 409 : 400
      return { status, body: { error: msg } }
    }
  }

  /** DELETE /api/cancellation-policies/:id → borra (no permite borrar base con overrides). */
  async remove(req: HttpRequest) {
    try {
      const hotelId = this.hotelOf(req)
      if (!hotelId) return { status: 400, body: { error: 'hotelId requerido (no hay sesión de hotel)' } }
      await this.service.deletePolicy(req.params.id, hotelId)
      return { status: 200, body: { success: true } }
    } catch (e: any) {
      const msg = e.message || 'Error al borrar'
      const status = /no encontrad/i.test(msg) ? 404 : (/no se puede borrar/i.test(msg) ? 409 : 400)
      return { status, body: { error: msg } }
    }
  }
}
