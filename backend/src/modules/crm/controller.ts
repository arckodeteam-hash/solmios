// crm/controller.ts
import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { CrmService } from './service'
import { AwardPointsSchema, RedeemPointsSchema, CreateSegmentSchema, CreateCampaignSchema } from './validators/schema'

/**
 * El `hotelId` es obligatorio en el schema pero el cliente no lo manda: sale del token. Se inyectaba
 * DESPUÉS de `validateSchema`, así que la validación fallaba antes de llegar a esa línea y crear un
 * cupón o un segmento devolvía 400 `hotelId is required`. Va antes de validar.
 *
 * El token pisa al body: un merchant no puede crear en otro hotel. Sólo cae al body cuando el token
 * no trae hotel (super_admin de plataforma).
 */
const withHotelId = (req: HttpRequest): Record<string, unknown> => {
  const body = (req.body ?? {}) as Record<string, unknown>
  return { ...body, hotelId: (req as any).user?.hotelId ?? body.hotelId }
}

export class CrmController {
  constructor(private readonly service: CrmService, private readonly logger: Logger) {}

  async awardPoints(req: HttpRequest) {
    const b = validateSchema(AwardPointsSchema, req.body) as any
    return { status: 201, body: await this.service.awardPoints(b.guestId, (req as any).user?.hotelId, b.points, b.description, b.reservationId, (req as any).user?.role) }
  }
  async redeemPoints(req: HttpRequest) {
    const b = validateSchema(RedeemPointsSchema, req.body) as any
    return { status: 200, body: await this.service.redeemPoints(b.guestId, (req as any).user?.hotelId, b.points, b.description, (req as any).user?.role) }
  }
  async getPointsHistory(req: HttpRequest) { return { status: 200, body: await this.service.getPointsHistory(req.params.guestId, (req as any).user?.hotelId, (req as any).user?.role) } }
  async getPointsBalance(req: HttpRequest) { return { status: 200, body: { balance: await this.service.getPointsBalance(req.params.guestId, (req as any).user?.hotelId, (req as any).user?.role) } } }

  // ─── Campañas a segmentos (spec crm-campaigns) ───────
  async createCampaign(req: HttpRequest) {
    const d = validateSchema(CreateCampaignSchema, withHotelId(req)) as any
    return { status: 201, body: await this.service.createCampaign(d) }
  }
  async listCampaigns(req: HttpRequest) { return { status: 200, body: { data: await this.service.listCampaigns((req as any).user?.hotelId ?? (req.query as any).hotelId) } } }
  async sendCampaign(req: HttpRequest) {
    const u = (req as any).user
    if (!u?.hotelId) return { status: 400, body: { error: 'hotelId requerido' } }
    return { status: 200, body: await this.service.sendCampaign(u.hotelId, req.params.id) }
  }

  /** Recompute masivo de tiers (backfill tras cambiar umbrales). Spec crm-loyalty. */
  async recomputeTiers(req: HttpRequest) {
    const hotelId = (req as any).user?.hotelId
    if (!hotelId) return { status: 400, body: { error: 'hotelId requerido' } }
    return { status: 200, body: await this.service.recomputeTiers(hotelId) }
  }

  /** DEPRECADO (spec crm-coupons): los cupones del CRM duplicaban promo_codes sin
 *  conectar al motor. Rutas mantenidas con 410 explícito — append-only del index. */
  async couponGone(): Promise<{ status: number; body: { error: string } }> {
    return { status: 410, body: { error: 'Cupones del CRM deprecados: usá /api/promo-codes (se gestionan en Configuración → Promociones y aplican en el motor de reservas)' } }
  }

  async createSegment(req: HttpRequest) {
    const d = validateSchema(CreateSegmentSchema, withHotelId(req)) as any
    return { status: 201, body: await this.service.createSegment(d) }
  }
  async listSegments(req: HttpRequest) { return { status: 200, body: await this.service.listSegments((req as any).user?.hotelId ?? (req.query as any).hotelId) } }
  async getGuestsInSegment(req: HttpRequest) { return { status: 200, body: await this.service.getGuestsInSegment((req as any).user?.hotelId, req.params.id, (req as any).user?.role) } }

  /** CSV del segmento (spec crm-segments). Viaja como JSON {filename, csv}: el wrapper http
 *  del front siempre hace res.json() — text/csv crudo rompería el parseo; el caller arma
 *  el blob de descarga con el string. */
  async exportSegment(req: HttpRequest) {
    return { status: 200, body: await this.service.exportSegmentCsv((req as any).user?.hotelId, req.params.id, (req as any).user?.role) }
  }

  async getLTV(req: HttpRequest) { return { status: 200, body: await this.service.calculateLTV((req as any).user?.hotelId ?? (req.query as any).hotelId) } }
  async getDashboard(req: HttpRequest) { return { status: 200, body: await this.service.getDashboard((req as any).user?.hotelId ?? (req.query as any).hotelId) } }
}
