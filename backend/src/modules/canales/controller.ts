// canales/controller.ts — Adaptador HTTP del módulo
// Responsabilidad ÚNICA: traducir request → service → response.
// SIN lógica de negocio. SIN llamadas directas al ORM. (REGLA #12)
// Toda mutación (POST/PUT/PATCH) DEBE pasar por validateSchema(). (REGLA #11)
//
// Multi-tenant: el hotelId se resuelve con resolveTenant(req) — sale del token,
// override por ?hotelId= solo para super_admin. NUNCA confiar en el hotelId que
// manda el cliente por query/body (fuga cross-tenant, anti-patrón query||token).
//
// La sincronización (POST /api/channels/sync) se cablea en index.ts porque
// necesita datos del módulo habitaciones (cross-module → route en el root del módulo).

import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { CanalesService } from './service'
import { resolveTenant } from '../../shared/utils/resolve-tenant'
import { CreateCanalesSchema, UpdateCanalesSchema, TestConnectionSchema, ConnectOTASchema, DeactivateSchema, IngestBookingsSchema } from './validators/schema'

export class CanalesController {
  constructor(
    private readonly service: CanalesService,
    private readonly logger: Logger,
  ) {}

  async syncLog(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    return { status: 200, body: await this.service.getSyncLog(hotelId) }
  }

  // GET /api/channels?hotelId= — canales conectados (Channex real + fallback).
  async channels(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    this.logger.info('GET /api/channels', { hotelId })
    const result = await this.service.listChannels(hotelId)
    return { status: 200, body: result }
  }

  // GET /api/channels/feed — reservas pendientes del feed de Channex.
  async feed() {
    this.logger.info('GET /api/channels/feed')
    return { status: 200, body: await this.service.getFeed() }
  }

  // POST /api/channels/test-connection — prueba conexión con una OTA.
  async testConnection(req: HttpRequest) {
    const data = validateSchema(TestConnectionSchema, req.body) as any
    const hotelId = resolveTenant(req) as string
    this.logger.info('POST /api/channels/test-connection', { channel: data.channel, hotel_id: data.hotel_id })
    const result = await this.service.testConnection(hotelId, data.channel, data.hotel_id)
    return { status: result.success ? 200 : 422, body: result }
  }

  // GET /api/channels/mapping-details — obtiene rooms/rates de la OTA para mapear.
  async mappingDetails(req: HttpRequest) {
    const q = req.query as any
    const { channel, hotel_id } = q
    const hotelId = resolveTenant(req) as string
    this.logger.info('GET /api/channels/mapping-details', { channel, hotel_id })
    const result = await this.service.getMappingDetails(hotelId, channel, hotel_id)
    return { status: result.success ? 200 : 422, body: result }
  }

  // GET /api/channels/groups — lista grupos del account Channex.
  async groups(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    this.logger.info('GET /api/channels/groups')
    return { status: 200, body: await this.service.listGroups(hotelId) }
  }

  // POST /api/channels/connect — crea y activa un canal OTA.
  async connectOTA(req: HttpRequest) {
    const dto = validateSchema(ConnectOTASchema, req.body) as any
    const hotelId = resolveTenant(req) as string
    this.logger.info('POST /api/channels/connect', { channel: dto.channel })
    const result = await this.service.createOTAChannel(hotelId, dto)
    return { status: result.success ? 200 : 422, body: result }
  }

  // POST /api/channels/:id/deactivate — desactiva un canal OTA.
  async deactivate(req: HttpRequest) {
    const data = validateSchema(DeactivateSchema, req.body) as any
    const hotelId = resolveTenant(req) as string
    this.logger.info('POST /api/channels/:id/deactivate', { id: req.params.id })
    const result = await this.service.deactivateChannel(hotelId, req.params.id)
    return { status: result.success ? 200 : 422, body: result }
  }

  // GET /api/channels/bookings — lista bookings pendientes del feed.
  async bookings(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    this.logger.info('GET /api/channels/bookings', { hotelId })
    const data = await this.service.getBookings(hotelId)
    return { status: 200, body: { data, total: data.length } }
  }

  // POST /api/channels/bookings/ingest — botón manual: dispara el sync GLOBAL de bookings.
  // El feed es por cuenta de plataforma (no por hotel); el usecase deriva por propertyId.
  // Mantiene el shape { message } que espera el frontend (BookingSyncResult no lo trae).
  async ingestBookings(req: HttpRequest) {
    validateSchema(IngestBookingsSchema, req.body)  // valida body; el hotelId ya no filtra (feed global)
    const hotelId = resolveTenant(req) as string
    this.logger.info('POST /api/channels/bookings/ingest (global sync)', { hotelId })
    const r = await this.service.syncAllBookingRevisions()
    const message = r.feedSize === 0
      ? 'No hay bookings pendientes'
      : `${r.ingested} reservas creadas, ${r.skipped} actualizadas, ${r.acknowledged} confirmadas a la OTA`
    return { status: r.success ? 200 : 422, body: { ...r, message } }
  }

  // GET /api/channels/iframe-token — token para embed de Channex.
  async iframeToken(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    const username = (req.query as any)?.username || 'Hotel Admin'
    this.logger.info('GET /api/channels/iframe-token', { hotelId, username })
    const token = await this.service.getIframeToken(hotelId, username)
    if (!token) return { status: 422, body: { error: 'No se pudo generar el token. Verifica que la propiedad esté configurada.' } }
    const propertyId = await this.service.getPropertyId(hotelId)
    if (!propertyId) return { status: 422, body: { error: 'La propiedad no está sincronizada con Channex. Ejecutá la sincronización primero.' } }
    return { status: 200, body: { token, iframeUrl: `https://staging.channex.io/auth/exchange?oauth_session_key=${token}&app_mode=headless&redirect_to=/channels&property_id=${propertyId}&lng=es` } }
  }

  // GET /api/channels/:id/detail — detalle completo del canal con tarifas y mapping.
  async channelDetail(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    this.logger.info('GET /api/channels/:id/detail', { id: req.params.id, hotelId })
    const result = await this.service.getChannelDetail(hotelId, req.params.id)
    return { status: result ? 200 : 404, body: result || { error: 'Canal no encontrado' } }
  }

  // PUT /api/channels/:id/mapping — mapea los rate plans del hotel contra los del canal.
  // REEMPLAZA el mapeo completo (semántica de Channex): el body trae la lista entera.
  async updateMapping(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    const ratePlans = (req.body as any)?.ratePlans
    if (!Array.isArray(ratePlans)) return { status: 400, body: { error: 'ratePlans debe ser un array' } }
    this.logger.info('PUT /api/channels/:id/mapping', { id: req.params.id, hotelId, ratePlans: ratePlans.length })
    const result = await this.service.updateChannelMapping(hotelId, req.params.id, ratePlans)
    return { status: result.success ? 200 : 422, body: result }
  }

  // GET /api/channels/:id/readiness — qué falta para poder activar el canal.
  async channelReadiness(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    return { status: 200, body: await this.service.checkChannelReadiness(hotelId, req.params.id) }
  }

  // POST /api/channels/:id/activate — verifica primero y activa.
  async activate(req: HttpRequest) {
    const hotelId = resolveTenant(req) as string
    this.logger.info('POST /api/channels/:id/activate', { id: req.params.id, hotelId })
    const result = await this.service.activateChannel(hotelId, req.params.id)
    return { status: result.success ? 200 : 422, body: result }
  }

  // ─── CRUD admin sobre la config ──────────────────────────────────────
  async index(req: HttpRequest) {
    const result = await this.service.list(req.query as any, req.user as any)
    return { status: 200, body: result }
  }

  async show(req: HttpRequest) {
    const item = await this.service.getById(req.params.id, req.user as any)
    return { status: 200, body: item }
  }

  async store(req: HttpRequest) {
    const data = validateSchema(CreateCanalesSchema, req.body)
    const item = await this.service.create(data as any)
    return { status: 201, body: item }
  }

  async update(req: HttpRequest) {
    const data = validateSchema(UpdateCanalesSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }

  async destroy(req: HttpRequest) {
    await this.service.delete(req.params.id, req.user as any)
    return { status: 204, body: null }
  }
}
