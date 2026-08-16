// site-pages/controller.ts — HTTP layer: validateSchema en POST/PUT, sin lógica de negocio.
import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { SitePagesService } from './service'
import { CreateSitePageSchema, UpdateSitePageSchema } from './validators/schema'

export class SitePagesController {
  constructor(
    private readonly service: SitePagesService,
    private readonly logger: Logger,
  ) {}

  async index() {
    return { status: 200, body: await this.service.list() }
  }

  async show(req: HttpRequest) {
    return { status: 200, body: await this.service.getById(req.params.id) }
  }

  async store(req: HttpRequest) {
    const data = validateSchema(CreateSitePageSchema, req.body)
    return { status: 201, body: await this.service.create(data as any) }
  }

  async update(req: HttpRequest) {
    const data = validateSchema(UpdateSitePageSchema, req.body)
    return { status: 200, body: await this.service.update(req.params.id, data as any) }
  }

  async destroy(req: HttpRequest) {
    await this.service.remove(req.params.id)
    return { status: 204, body: null }
  }

  async publicIndex() {
    return { status: 200, body: { data: await this.service.listPublic() } }
  }

  async publicShow(req: HttpRequest) {
    this.logger.debug('site-pages: lectura pública', { slug: req.params.slug })
    // Item directo (mismo shape que apikeys show): el envelope del framework
    // lo termina exponiendo como { success, data: página }.
    return { status: 200, body: await this.service.getPublicBySlug(req.params.slug) }
  }
}
