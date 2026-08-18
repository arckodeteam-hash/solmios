import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import { parseDataUrl, isImage } from '../../shared/utils/data-url'
import type { MantenimientoService } from './service'
import { CreateMantenimientoSchema, UpdateMantenimientoSchema, AddNotesSchema, CompleteMantenimientoSchema, AddPhotoMantenimientoSchema, CreateProviderSchema, UpdateProviderSchema } from './validators/schema'

export class MantenimientoController {
  constructor(
    private readonly service: MantenimientoService,
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
    const data = validateSchema(CreateMantenimientoSchema, req.body)
    const item = await this.service.create(data as any, currentUser)
    return { status: 201, body: item }
  }

  async update(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(UpdateMantenimientoSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, currentUser)
    return { status: 200, body: item }
  }

  async destroy(req: HttpRequest) {
    const currentUser = req.user as any
    await this.service.delete(req.params.id, currentUser)
    return { status: 204, body: null }
  }

  // ─── Timer ────────────────────────────────────────────
  async start(req: HttpRequest) {
    const currentUser = req.user as any
    const item = await this.service.start(req.params.id, currentUser)
    return { status: 200, body: item }
  }

  async complete(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(CompleteMantenimientoSchema, req.body || {}) as any
    const item = await this.service.complete(req.params.id, currentUser, data.notes)
    return { status: 200, body: item }
  }

  // ─── Notes ────────────────────────────────────────────
  async addNotes(req: HttpRequest) {
    const currentUser = req.user as any
    const { notes } = validateSchema(AddNotesSchema, req.body) as { notes: string }
    const item = await this.service.addNotes(req.params.id, notes, currentUser)
    return { status: 200, body: item }
  }

  // ─── Photos ───────────────────────────────────────────
  /**
   * La foto llega como data URL en el JSON, no como multipart.
   *
   * El handler leía `req.file`, que el router del framework nunca completa: el
   * endpoint respondía 400 "Archivo requerido" a TODA subida, así que las fotos
   * del desperfecto no se podían adjuntar desde el panel. Es el mismo camino que
   * ya usa housekeeping para su evidencia.
   */
  async addPhoto(req: HttpRequest) {
    const currentUser = req.user as any
    const data = validateSchema(AddPhotoMantenimientoSchema, req.body || {}) as any
    const parsed = parseDataUrl(data.photo)
    if (!parsed) return { status: 400, body: { error: 'Formato inválido (se espera data URL base64)' } }
    if (!isImage(parsed.mimeType)) return { status: 400, body: { error: 'El archivo debe ser una imagen' } }
    const fileUpload = {
      fieldName: 'file',
      originalName: data.fileName || `foto.${parsed.ext}`,
      buffer: parsed.buffer,
      mimeType: parsed.mimeType,
      size: parsed.buffer.length,
    }
    const item = await this.service.addPhoto(req.params.id, fileUpload as any, data.type, currentUser)
    return { status: 200, body: item }
  }

  async removePhoto(req: HttpRequest) {
    const currentUser = req.user as any
    const photoUrl = (req.query as any).url as string | undefined
    if (!photoUrl) return { status: 400, body: { error: 'url de foto requerida (?url=...)' } }
    const item = await this.service.removePhoto(req.params.id, photoUrl, currentUser)
    return { status: 200, body: item }
  }

  // ─── Audit ────────────────────────────────────────────
  async auditHistory(req: HttpRequest) {
    const currentUser = req.user as any
    const history = await this.service.getAuditHistory(req.params.id, currentUser)
    return { status: 200, body: history }
  }

  // ─── Stats ────────────────────────────────────────────
  async stats(req: HttpRequest) {
    const user = req.user as any
    // Ownership: hotel_admin/receptionist SIEMPRE usan su propio hotel (ignoran query.hotelId).
    // Solo super_admin puede pedir stats de otro hotel vía query param.
    const hotelId = user.role === 'super_admin' ? ((req.query as any).hotelId || user.hotelId) : user.hotelId
    if (!hotelId) return { status: 400, body: { error: 'hotelId requerido' } }
    const stats = await this.service.getStats(hotelId)
    return { status: 200, body: stats }
  }

  // ─── Servicios externos (proveedores) ─────────────────────────────────────
  // El hotel carga acá a quién llama cuando algo no se arregla adentro. Después,
  // al crear o editar un ticket, se le puede asignar uno en vez de un técnico.

  async listProviders(req: HttpRequest) {
    // La vista de administración gestiona también los de baja (reactivar, catálogo completo):
    // `?includeInactive=1`. El resto de consumers (selector de tickets, app) no lo manda y
    // sigue viendo solo activos.
    const includeInactive = (req.query as Record<string, unknown>)['includeInactive'] === '1'
      || (req.query as Record<string, unknown>)['includeInactive'] === 'true'
    return { status: 200, body: { data: await this.service.listProviders(req.user as any, includeInactive) } }
  }

  async storeProvider(req: HttpRequest) {
    const data = validateSchema(CreateProviderSchema, req.body ?? {}) as any
    return { status: 201, body: { data: await this.service.createProvider(data, req.user as any) } }
  }

  async updateProvider(req: HttpRequest) {
    const data = validateSchema(UpdateProviderSchema, req.body ?? {}) as any
    return { status: 200, body: { data: await this.service.updateProvider(req.params.id, data, req.user as any) } }
  }

  async destroyProvider(req: HttpRequest) {
    await this.service.removeProvider(req.params.id, req.user as any)
    return { status: 204, body: null }
  }
}
