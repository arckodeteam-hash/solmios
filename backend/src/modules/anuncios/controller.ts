import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { AnunciosService } from './service'
import { CreateAnunciosSchema, UpdateAnunciosSchema } from './validators/schema'

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
    const item = await this.service.create(data as any, currentUser)
    return { status: 201, body: item }
  }

  async update(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(UpdateAnunciosSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, currentUser)
    return { status: 200, body: item }
  }

  /**
   * Registrar la lectura NO puede costar la entrega del mensaje: si algo falla, se responde 200
   * con `recorded: false` y el banner sigue mostrando el anuncio. Un error acá es un dato de
   * métrica perdido; un error propagado sería un aviso que el hotel no ve.
   */
  async seen(req: HttpRequest) {
    const currentUser = req.user as any
    try {
      await this.service.markSeen(req.params.id, currentUser)
      return { status: 200, body: { recorded: true } }
    } catch (e: any) {
      this.logger.warn('No se pudo registrar la vista del anuncio', { id: req.params.id, error: String(e?.message ?? e) })
      return { status: 200, body: { recorded: false } }
    }
  }

  async dismiss(req: HttpRequest) {
    const currentUser = req.user as any
    try {
      await this.service.markDismissed(req.params.id, currentUser)
      return { status: 200, body: { recorded: true } }
    } catch (e: any) {
      this.logger.warn('No se pudo registrar el cierre del anuncio', { id: req.params.id, error: String(e?.message ?? e) })
      return { status: 200, body: { recorded: false } }
    }
  }

  async destroy(req: HttpRequest) {
    const currentUser = req.user as any
    await this.service.delete(req.params.id, currentUser)
    return { status: 204, body: null }
  }
}
