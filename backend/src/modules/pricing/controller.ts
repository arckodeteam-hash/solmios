import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { PricingService } from './service'
import type { PricingCalendarService } from './service-calendar'
import {
  UpdateSeasonsSchema, UpdateRatesSchema, UpdateRateRestrictionsSchema, CreateBlockSchema,
  ActivateSeasonSchema, UpdateDateRestrictionsSchema, AssignSeasonSchema,
  validateRateItems, validateSeasonItems, validateRestrictionItems, validateBlockRange,
  validateDateRestrictionItems, validateAssignSeason,
} from './validators/schema'

export class PricingController {
  constructor(
    private readonly service: PricingService,
    private readonly logger: Logger,
    private readonly calendar: PricingCalendarService,
  ) {}

  /** SC-05: quién ejecuta el cambio de tarifa. Sin esto el audit log no sirve de nada. */
  private actorOf(req: any): { id?: string; role?: string } | undefined {
    const user = req?.user
    return user ? { id: user.id, role: user.role } : undefined
  }

  private async hotelOf(req: any): Promise<string | undefined> {
    const q = req?.query || {}
    // Seguridad (IDOR cross-tenant): el hotel sale del TOKEN, no de la query. Un usuario de hotel
    // NO puede apuntar a otro hotel pasando ?hotelId=. Solo super_admin (platform) puede cross-hotel.
    const userHotel = req?.user?.hotelId
    if (userHotel && userHotel !== 'platform') return userHotel as string
    if (req?.user?.role === 'super_admin' && q.hotelId) return q.hotelId as string
    if (req?.user?.id && req?.user?.role !== 'super_admin') {
      const hotelId = await this.service.hotelIdOfUser(req.user.id)
      if (hotelId) return hotelId
    }
    return undefined
  }

  async listSeasons(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 200, body: { data: [] } }
    return { status: 200, body: { data: await this.service.listSeasons(id) } }
  }

  async updateSeasons(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    validateSchema(UpdateSeasonsSchema, req.body)
    const { seasons } = req.body as any
    validateSeasonItems(seasons)
    return { status: 200, body: { success: true, count: await this.service.updateSeasons(id, seasons, this.actorOf(req)) } }
  }

  async activateSeason(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    validateSchema(ActivateSeasonSchema, req.body)
    const { name } = req.body as any
    return { status: 200, body: { success: true, data: await this.service.activateSeason(id, String(name), this.actorOf(req)) } }
  }

  async getPricingMode(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 200, body: { mode: 'per_room' } }
    return { status: 200, body: { mode: await this.service.getPricingMode(id) } }
  }

  async setPricingMode(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    const mode = (req.body as any)?.mode
    if (mode !== 'per_room' && mode !== 'per_person') return { status: 400, body: { error: 'mode inválido (per_room|per_person)' } }
    return { status: 200, body: { mode: await this.service.setPricingMode(id, mode) } }
  }

  async listRates(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 200, body: { data: [] } }
    // ?channel= filtra a las tarifas de ese canal (con fallback a la base); sin él, devuelve la base.
    const channel = typeof req.query?.channel === 'string' ? req.query.channel : undefined
    return { status: 200, body: { data: await this.service.listRates(id, channel) } }
  }

  async updateRates(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    validateSchema(UpdateRatesSchema, req.body)
    const { rates } = req.body as any
    validateRateItems(rates)
    return { status: 200, body: { success: true, count: await this.service.updateRates(id, rates, this.actorOf(req)) } }
  }

  async copyRatesNextYear(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    return { status: 200, body: { success: true, ...await this.service.copyRatesNextYear(id, this.actorOf(req)) } }
  }

  async listBlocks(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 200, body: { data: [] } }
    const { startDate, endDate } = req.query as any
    return { status: 200, body: { data: await this.service.listBlocks(id, startDate, endDate) } }
  }

  async createBlocks(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    validateSchema(CreateBlockSchema, req.body)
    const { roomIds, reason, startDate, endDate } = req.body as any
    if (!roomIds?.length) return { status: 400, body: { error: 'roomIds requerido' } }
    validateBlockRange(startDate, endDate)
    const created = await this.service.createBlocks(id, (req.user as any)?.id || '', roomIds, reason, startDate, endDate)
    return { status: 201, body: { data: created, count: created.length } }
  }

  async deleteBlock(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    await this.service.deleteBlock(req.params.id, id, this.actorOf(req))
    return { status: 200, body: { success: true } }
  }

  async listRateRestrictions(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 200, body: { data: [] } }
    return { status: 200, body: { data: await this.service.listRateRestrictions(id) } }
  }

  async updateRateRestrictions(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    validateSchema(UpdateRateRestrictionsSchema, req.body)
    const { restrictions } = req.body as any
    validateRestrictionItems(restrictions)
    return { status: 200, body: { success: true, count: await this.service.updateRateRestrictions(id, restrictions, this.actorOf(req)) } }
  }

  async getChannelMetrics(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 200, body: { data: [] } }
    return { status: 200, body: { data: await this.service.getChannelMetrics(id) } }
  }

  async listDateRestrictions(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 200, body: { data: [] } }
    const { from, to } = (req.query || {}) as any
    return { status: 200, body: { data: await this.calendar.listDateRestrictions(id, from, to) } }
  }

  async updateDateRestrictions(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    validateSchema(UpdateDateRestrictionsSchema, req.body)
    const { items } = req.body as any
    validateDateRestrictionItems(items)
    return { status: 200, body: { success: true, count: await this.calendar.updateDateRestrictions(id, items) } }
  }

  async listSeasonAssignments(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 200, body: { data: [] } }
    const { from, to } = (req.query || {}) as any
    return { status: 200, body: { data: await this.calendar.listSeasonAssignments(id, from, to) } }
  }

  async assignSeason(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    validateSchema(AssignSeasonSchema, req.body)
    validateAssignSeason(req.body)
    const { from, to, weekdays, season } = req.body as any
    const count = await this.calendar.assignSeason(id, { from, to, weekdays, season: season ?? '' })
    // Pintar días cambia el precio de esas fechas → re-publicar tarifas en los canales.
    if (count > 0) await this.service.notifySeasonAssignmentsUpdated(id, count)
    return { status: 200, body: { success: true, count } }
  }
}
