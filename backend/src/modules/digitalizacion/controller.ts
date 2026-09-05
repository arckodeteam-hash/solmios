// digitalizacion/controller.ts — Adaptador HTTP del módulo.
//
// Solo traduce request → service → {status, body}: las reglas del expediente viven en service.ts
// y la forma del body en validators/schema.ts. Todas las rutas son del super_admin (herramienta
// interna de ventas), así que no hay variante pública como en sales-leads.
import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { DigitalizacionService } from './service'
import { SITE_TEMPLATES } from './types'
import { AdvanceStepSchema, CreateDigitalizationCaseSchema, UpdateDigitalizationCaseSchema } from './validators/schema'

export class DigitalizacionController {
  constructor(
    private readonly service: DigitalizacionService,
    private readonly logger: Logger,
  ) {}

  /** Expedientes abiertos/completados/cancelados, más recientes primero. */
  async index() {
    this.logger.info('GET /digitalizacion')
    return { status: 200, body: await this.service.list() }
  }

  /** Hoteles sin página web y sin expediente vivo — los detecta el sistema, no se cargan a mano. */
  async candidates() {
    return { status: 200, body: { data: await this.service.listCandidates() } }
  }

  /**
   * Catálogo de plantillas de la página del hotel. Es una constante del módulo (no hay tabla):
   * el front la pide para pintar el selector en vez de duplicar las keys.
   */
  async templates() {
    return { status: 200, body: { data: SITE_TEMPLATES } }
  }

  async show(req: HttpRequest) {
    return { status: 200, body: await this.service.getById(req.params.id) }
  }

  async store(req: HttpRequest) {
    const data = validateSchema(CreateDigitalizationCaseSchema, req.body)
    return { status: 201, body: await this.service.create(data as any) }
  }

  async update(req: HttpRequest) {
    const data = validateSchema(UpdateDigitalizationCaseSchema, req.body)
    return { status: 200, body: await this.service.update(req.params.id, data as any) }
  }

  /** Avance de UN paso del acompañamiento; los datos del paso viajan en el mismo body. */
  async advance(req: HttpRequest) {
    const data = validateSchema(AdvanceStepSchema, req.body)
    return { status: 200, body: await this.service.advanceStep(req.params.id, data as any) }
  }

  async destroy(req: HttpRequest) {
    await this.service.remove(req.params.id)
    return { status: 204, body: null }
  }
}
