// sales-leads/controller.ts — Adaptador HTTP del módulo.
import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import { parseWeeks } from './usecases/funnel'
import type { SalesLeadsService } from './service'
import { CreateSalesLeadSchema, UpdateSalesLeadSchema, UpdateProspectSchema, PROSPECT_CLEARABLE_FIELDS } from './validators/schema'
import type { UpdateSalesProspectDTO } from './types'

export class SalesLeadsController {
  constructor(
    private readonly service: SalesLeadsService,
    private readonly logger: Logger,
  ) {}

  // ─── Admin (super_admin) ────────────────────────────────────────────────
  async index() {
    this.logger.info('GET /sales-leads')
    return { status: 200, body: await this.service.list() }
  }

  async show(req: HttpRequest) {
    return { status: 200, body: await this.service.getById(req.params.id) }
  }

  async update(req: HttpRequest) {
    const data = validateSchema(UpdateSalesLeadSchema, req.body)
    return { status: 200, body: await this.service.updateStatus(req.params.id, data as any) }
  }

  async destroy(req: HttpRequest) {
    await this.service.remove(req.params.id)
    return { status: 204, body: null }
  }

  // ─── Pipeline de ventas (admin) ─────────────────────────────────────────
  async pipeline() {
    this.logger.info('GET /admin/sales-pipeline')
    return { status: 200, body: await this.service.getPipeline() }
  }

  /** GET /admin/sales-pipeline/funnel?weeks=8 — embudo semanal (REQ-PIPE-10). `weeks` fuera de 1..26 → 400. */
  async funnel(req: HttpRequest) {
    const weeks = parseWeeks((req.query as Record<string, unknown> | undefined)?.weeks)
    return { status: 200, body: await this.service.getFunnel(weeks) }
  }

  async assignees() {
    return { status: 200, body: await this.service.listAssignees() }
  }

  async updateProspect(req: HttpRequest) {
    const data = validateSchema(UpdateProspectSchema, req.body) as Record<string, unknown>
    // `null` explícito = limpiar el campo. validateSchema descarta los null de entrada
    // (kernel/validator.ts), así que se re-inyectan del body crudo — mismo criterio que
    // admin.applySpecialConditions con `category`.
    const raw = (req.body ?? {}) as Record<string, unknown>
    for (const f of PROSPECT_CLEARABLE_FIELDS) if (raw[f] === null) data[f] = null
    const user = req.user as { id?: string; name?: string; email?: string } | undefined
    return { status: 200, body: await this.service.updateProspect(req.params.key, data as UpdateSalesProspectDTO, user) }
  }

  // ─── Público (sin auth) ─────────────────────────────────────────────────
  async publicStore(req: HttpRequest) {
    const data = validateSchema(CreateSalesLeadSchema, req.body)
    const ack = await this.service.create(data as any)
    return { status: 201, body: ack }
  }
}
