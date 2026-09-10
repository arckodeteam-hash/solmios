// hoteles/controller.ts — Adaptador HTTP del módulo
// Responsabilidad ÚNICA: traducir request → service → response.
// SIN lógica de negocio. SIN llamadas directas al ORM. (REGLA #12)
// Toda mutación (POST/PUT/PATCH) DEBE pasar por validateSchema(). (REGLA #11)

import type { HttpRequest, Logger } from 'arckode-framework'
// `validateSchema` del framework no entiende `type:'array'` ni `type:'json'` (los descarta). El
// módulo hoteles ahora valida `amenities` (array) y `descriptionTranslations` (json) en
// UpdateHotelesSchema → hace falta el wrapper de shared/validators que sí los procesa. Es un
// superconjunto: los tipos `string|number|boolean|email|url|date` siguen validando igual.
import { validateSchema } from '../../shared/validators/validate-body'
import type { StorageService } from 'arckode-framework/modules/storage'
import type { HotelesService } from './service'
import type { HotelesQueries } from './usecases/hoteles-queries'
import { CreateHotelesSchema, UpdateHotelesSchema, SetConfigSchema } from './validators/schema'
import { getExchangeRate, type ExchangeRateDeps } from './usecases/exchange-rate'
import { parseDataUrl, isImage, exceedsMaxImageSize } from '../../shared/utils/data-url'

export class HotelesController {
  constructor(
    private readonly service: HotelesService,
    private readonly logger: Logger,
    private readonly queries?: HotelesQueries,
    private readonly storage?: StorageService,
    /** Repos que necesita el usecase de tasa de cambio (Configuration + Hotels). Los arma index.ts. */
    private readonly exchangeRateRepos?: Pick<ExchangeRateDeps, 'configRepo' | 'hotelRepo'>,
  ) {}

  async index(req: HttpRequest) {
    this.logger.info('GET /hoteles')
    const currentUser = req.user as any
    const result = await this.service.list(req.query as any, currentUser)
    return { status: 200, body: result }
  }

  async show(req: HttpRequest) {
    this.logger.info('GET /hoteles/:id', { id: req.params.id })
    const currentUser = req.user as any
    const item = await this.service.getById(req.params.id, currentUser)
    return { status: 200, body: item }
  }

  async store(req: HttpRequest) {
    this.logger.info('POST /hoteles')
    const data = validateSchema(CreateHotelesSchema, req.body)
    const item = await this.service.create(data as any)
    return { status: 201, body: item }
  }

  async update(req: HttpRequest) {
    this.logger.info('PUT /hoteles/:id', { id: req.params.id })
    const currentUser = req.user as any
    const data = validateSchema(UpdateHotelesSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, currentUser)
    return { status: 200, body: item }
  }

  async destroy(req: HttpRequest) {
    this.logger.info('DELETE /hoteles/:id', { id: req.params.id })
    const currentUser = req.user as any
    await this.service.delete(req.params.id, currentUser)
    return { status: 204, body: null }
  }

  // ── Settings ─────────────────────────────────────────────────────────
  async getSettings(req: HttpRequest) {
    const id = await this.resolveHotel(req)
    if (!id) return { status: 404, body: { error: 'Sin hotel' } }
    const result = await this.service.getSettings(id, req.user as any)
    return { status: 200, body: result }
  }

  async updateHotel(req: HttpRequest) {
    const id = (req.body as any).id || (await this.resolveHotel(req))
    if (!id) return { status: 404, body: { error: 'Sin hotel' } }
    const data = validateSchema(UpdateHotelesSchema, req.body)
    const body = await this.service.updateHotel(id, data as any, req.user as any)
    return { status: 200, body }
  }

  async getSettingsFull(req: HttpRequest) {
    const id = await this.resolveHotel(req); if (!id) return { status: 404, body: { error: 'Sin hotel' } }
    const result = await this.service.getSettingsFull(id, req.user as any)
    return { status: 200, body: result }
  }

  /** Sube el logo del hotel y lo deja guardado — mismo patrón que uploadAvatar (usuarios/controller.ts). */
  async uploadLogo(req: HttpRequest) {
    if (!this.storage) return { status: 500, body: { error: 'Storage no configurado' } }
    const id = await this.resolveHotel(req)
    if (!id) return { status: 404, body: { error: 'Sin hotel' } }

    const body = (req.body ?? {}) as { logo?: string; fileName?: string }
    if (!body.logo) return { status: 400, body: { error: 'Falta el campo logo (data URL base64)' } }
    const parsed = parseDataUrl(body.logo)
    if (!parsed) return { status: 400, body: { error: 'Formato inválido (se espera data URL base64)' } }
    if (!isImage(parsed.mimeType)) return { status: 400, body: { error: 'Solo se permiten imágenes' } }
    // El frontend ya corta en 5MB antes de armar el data URL (StepIdentidad.vue/general.vue),
    // pero eso es solo UX — nada impedía mandar el data URL grande directo a la API.
    if (exceedsMaxImageSize(parsed.buffer)) return { status: 400, body: { error: 'La imagen supera el máximo de 5MB' } }

    const stored = await this.storage.upload(
      {
        fieldName: 'file',
        originalName: body.fileName || `logo-${id}.${parsed.ext}`,
        buffer: parsed.buffer,
        mimeType: parsed.mimeType,
        size: parsed.buffer.length,
      },
      'hotel-logos',
    )
    const hotel = await this.service.updateHotel(id, { logo: stored.url } as any, req.user as any)
    return { status: 201, body: hotel }
  }

  // ── Configuration KV ────────────────────────────────────────────────
  async getConfig(req: HttpRequest) {
    const id = await this.resolveHotel(req)
    if (!id) return { status: 404, body: { error: 'Sin hotel' } }
    const result = await this.service.getConfig(id, req.params.key)
    return { status: 200, body: result }
  }

  async setConfig(req: HttpRequest) {
    const data = validateSchema(SetConfigSchema, req.body) as any
    // valor es de tipo dinámico (string/number/object) — se pasa sin re-tipar, el service serializa a JSON si aplica.
    const result = await this.service.setConfig({ ...data, valor: (req.body as any).valor }, req.user as any)
    return { status: 200, body: result }
  }

  // Lectura solo-login de los contactos de emergencia. Mismo resolveHotel que el resto:
  // el hotel sale del token, solo super_admin puede apuntar a otro con ?hotelId=.
  async getEmergencyContacts(req: HttpRequest) {
    const id = await this.resolveHotel(req)
    if (!id) return { status: 404, body: { error: 'Sin hotel' } }
    const result = await this.service.getEmergencyContacts(id)
    return { status: 200, body: result }
  }

  // Tasa de cambio del hotel — lectura solo-login. La lógica vive en el usecase; acá solo se
  // inyecta el mismo resolveHotel que usan getConfig/getEmergencyContacts.
  async getExchangeRate(req: HttpRequest) {
    if (!this.exchangeRateRepos) return { status: 500, body: { error: 'Tasa de cambio no configurada' } }
    return getExchangeRate({ ...this.exchangeRateRepos, resolveHotelId: (r) => this.resolveHotel(r) }, req as any)
  }

  private async resolveHotel(req: any): Promise<string | undefined> {
    // Seguridad (IDOR cross-tenant): el hotel sale del usuario/token. Solo super_admin (platform)
    // puede apuntar a otro hotel via ?hotelId=; un usuario de hotel NO puede overridearlo.
    const q = req?.query || {}
    if (req?.user?.role === 'super_admin' && q.hotelId) return q.hotelId
    if (!this.queries) return undefined
    return this.queries.resolveHotelId(req?.user)
  }
}
