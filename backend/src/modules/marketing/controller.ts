// marketing/controller.ts
import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { MarketingService } from './service'
import { CreateAutoMessageSchema, CreateTemplateSchema, UpdateAutoMessageSchema, CreateMessageLogSchema, UpdateTemplateSchema } from './validators/schema'
import type { CreateAutoMessageDTO, CreateWhatsappTemplateDTO, MarketingUser } from './types'

export class MarketingController {
  constructor(private readonly service: MarketingService, private readonly logger: Logger) {}

  /**
   * hotelId multi-tenant: SIEMPRE del JWT (req.user.hotelId), nunca de query/body.
   * super_admin puede opcionalmente apuntar a otro hotel via query ?hotelId=.
   * Tokens legacy sin hotelId → '__none__' (lista vacía, sin fuga).
   */
  private hotelIdFor(req: HttpRequest, bodyHotelId?: string): string {
    const user = (req as any).user as MarketingUser | undefined
    if (user?.role === 'super_admin') {
      const q = (req.query as any)?.hotelId
      return q || bodyHotelId || user?.hotelId || ''
    }
    return user?.hotelId ?? '__none__'
  }

  /**
   * H1/H2 (qa-ui config-2026-08-22): el schema exige `hotelId` pero el cliente no lo manda —
   * sale del token. Se inyectaba DESPUÉS de `validateSchema`, así que la validación reventaba
   * ANTES de llegar a esa línea y crear auto-mensajes/plantillas WhatsApp devolvía 400 siempre
   * (funcionalidad muerta). Va ANTES de validar, mismo fix que crm (`withHotelId`): el token
   * pisa al body — un merchant no puede crear en otro hotel.
   */
  private withHotelId(req: HttpRequest): Record<string, unknown> {
    const body = (req.body ?? {}) as Record<string, unknown>
    return { ...body, hotelId: this.hotelIdFor(req, typeof body.hotelId === 'string' ? body.hotelId : undefined) }
  }

  async listAutoMessages(req: HttpRequest) { const h = this.hotelIdFor(req); return { status: 200, body: { data: await this.service.listAutoMessages(h) } } }
  async createAutoMessage(req: HttpRequest) {
    const d = validateSchema(CreateAutoMessageSchema, this.withHotelId(req)) as any
    return { status: 201, body: await this.service.createAutoMessage(d) }
  }
  async updateAutoMessage(req: HttpRequest) {
    const data = validateSchema(UpdateAutoMessageSchema, req.body)
    const user = (req as any).user as MarketingUser | undefined
    return { status: 200, body: await this.service.updateAutoMessage(req.params.id, data, user) }
  }
  async deleteAutoMessage(req: HttpRequest) {
    const user = (req as any).user as MarketingUser | undefined
    await this.service.deleteAutoMessage(req.params.id, user); return { status: 200, body: { success: true } }
  }

  async listMessageLogs(req: HttpRequest) {
    const h = this.hotelIdFor(req); const { reservationId } = req.query as any
    return { status: 200, body: { data: await this.service.listMessageLogs(h, reservationId) } }
  }
  async createMessageLog(req: HttpRequest) {
    const d = validateSchema(CreateMessageLogSchema, this.withHotelId(req)) as any
    return { status: 201, body: await this.service.createMessageLog(d) }
  }

  async listTemplates(req: HttpRequest) { const h = this.hotelIdFor(req); return { status: 200, body: { data: await this.service.listTemplates(h) } } }
  async createTemplate(req: HttpRequest) {
    // BUG FIX: casteo crudo `req.body as DTO` sin validateSchema → persistía body/category sin
    // sanitizar ni enum-check. Ahora valida con CreateTemplateSchema (igual que updateTemplate).
    const d = validateSchema(CreateTemplateSchema, this.withHotelId(req)) as any
    if (!d.name) return { status: 400, body: { error: 'name requerido' } }
    return { status: 201, body: await this.service.createTemplate(d) }
  }
  async updateTemplate(req: HttpRequest) {
    const data = validateSchema(UpdateTemplateSchema, req.body)
    const user = (req as any).user as MarketingUser | undefined
    return { status: 200, body: await this.service.updateTemplate(req.params.id, data, user) }
  }
  async deleteTemplate(req: HttpRequest) {
    const user = (req as any).user as MarketingUser | undefined
    await this.service.deleteTemplate(req.params.id, user); return { status: 200, body: { success: true } }
  }
}
