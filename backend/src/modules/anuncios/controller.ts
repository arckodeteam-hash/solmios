import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { AnunciosService } from './service'
import { CreateAnunciosSchema, UpdateAnunciosSchema, assertAudienceConsistent } from './validators/schema'

export class AnunciosController {
  constructor(
    private readonly service: AnunciosService,
    private readonly logger: Logger,
  ) {}

  async index(req: HttpRequest) {
    const currentUser = req.user as any
    const result = await this.service.list(req.query as any, currentUser)
    return { status: 200, body: result }
  }

  async show(req: HttpRequest) {
    const currentUser = req.user as any
    const item = await this.service.getById(req.params.id, currentUser)
    return { status: 200, body: item }
  }

  async store(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(CreateAnunciosSchema, req.body)
    assertAudienceConsistent(data as any)
    const item = await this.service.create(data as any, currentUser)
    return { status: 201, body: item }
  }

  async update(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(UpdateAnunciosSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, currentUser)
    return { status: 200, body: item }
  }

  async destroy(req: HttpRequest) {
    const currentUser = req.user as any
    await this.service.delete(req.params.id, currentUser)
    return { status: 204, body: null }
  }

  // ── Lecturas por usuario (ANN-4): userId/hotelId salen del token, NUNCA del body ──

  /** POST /api/anuncios/:id/seen — marca el aviso como visto por el usuario del token. */
  async seen(req: HttpRequest) {
    const currentUser = req.user as any
    await this.service.markSeen(req.params.id, currentUser)
    return { status: 204, body: null }
  }

  /** POST /api/anuncios/:id/dismiss — el ✕ del banner, sólo para el usuario del token. */
  async dismiss(req: HttpRequest) {
    const currentUser = req.user as any
    await this.service.dismiss(req.params.id, currentUser)
    return { status: 204, body: null }
  }
}
