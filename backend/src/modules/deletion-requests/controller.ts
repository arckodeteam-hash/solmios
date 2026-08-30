// deletion-requests/controller.ts — Adaptador HTTP del módulo.
import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { DeletionRequestsService } from './service'
import { CreateDeletionRequestSchema, UpdateDeletionRequestSchema } from './validators/schema'

export class DeletionRequestsController {
  constructor(
    private readonly service: DeletionRequestsService,
    private readonly logger: Logger,
  ) {}

  // ─── Admin (super_admin) ────────────────────────────────────────────────
  async index() {
    this.logger.info('GET /deletion-requests')
    return { status: 200, body: await this.service.list() }
  }

  async show(req: HttpRequest) {
    return { status: 200, body: await this.service.getById(req.params.id) }
  }

  async update(req: HttpRequest) {
    const data = validateSchema(UpdateDeletionRequestSchema, req.body)
    return { status: 200, body: await this.service.updateStatus(req.params.id, data as any) }
  }

  async destroy(req: HttpRequest) {
    await this.service.remove(req.params.id)
    return { status: 204, body: null }
  }

  // ─── Público (sin auth) ─────────────────────────────────────────────────
  async publicStore(req: HttpRequest) {
    const data = validateSchema(CreateDeletionRequestSchema, req.body)
    const ack = await this.service.create(data as any)
    return { status: 201, body: ack }
  }
}
