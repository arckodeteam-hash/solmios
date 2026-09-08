// ari-outbox/controller.ts — Adapta el request al service y devuelve { status, body }.
// Sin lógica: los defaults y topes del listado son del service (mismo reparto que email-queue).

import type { HttpRequest, Logger } from 'arckode-framework'
import type { AriOutboxService, AriOutboxListQuery } from './service'
import type { AriOutboxStatus } from './types'

export class AriOutboxController {
  constructor(
    private readonly service: AriOutboxService,
    private readonly logger: Logger,
  ) {}

  async index(req: HttpRequest) {
    const q = (req.query ?? {}) as Record<string, string>
    const query: AriOutboxListQuery = {
      hotelId: q.hotelId,
      status: q.status as AriOutboxStatus | undefined,
      kind: q.kind,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    }
    const result = await this.service.list(query)
    return { status: 200, body: result }
  }
}
