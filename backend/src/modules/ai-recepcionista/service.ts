import type { Logger, CacheAdapter, Auth } from 'arckode-framework'
import { AuthError, ConflictError } from 'arckode-framework'
import type {
  AiConversationDTO, CreateAiConversationDTO,
  AiMessageDTO,
  AiIntentDTO, CreateAiIntentDTO, UpdateAiIntentDTO,
  AiTemplateDTO, CreateAiTemplateDTO, UpdateAiTemplateDTO,
  AiWhatsappConfigDTO, CreateAiWhatsappConfigDTO,
  AiMetricsDTO, AiBookingFlowRecord, AiVoiceConfigRecord,
  ConversationQuery, IntentQuery, TemplateQuery,
  NlpResult, BotResponse,
} from './types'
import type { AiRecepcionistaSockets } from './sockets'
import {
  listConversations, getConversationWithMessages,
  findOrCreateConversation, closeConversation, transferConversation,
  sendMessage, getBookingFlow, createBookingFlow,
} from './usecases/conversations'
import {
  listIntents, getIntent, createIntent, updateIntent,
  processIncomingMessage, probarIntent,
} from './usecases/intents'
import { listTemplates, createTemplate, updateTemplate } from './usecases/templates'
import { conversationChannel } from './usecases/conversation-channel'
import type { ReservationCancelPort, InvoiceIssuePort } from './usecases/llm-pipeline'
import { getWhatsappConfig, updateWhatsappConfig, getWhatsappCredentials } from './usecases/whatsapp-config'
import type { WhatsappCredentials } from './usecases/whatsapp-config'
import { connectWhatsapp, disconnectWhatsapp, proyectarConexion, listarConexiones } from './usecases/whatsapp-connection'
import { connectionDepsFor } from './usecases/whatsapp-connection-deps'
import type { ConnectInput } from './usecases/whatsapp-connection'
import { getMetrics, getDashboardMetrics } from './usecases/metrics'
import { deleteIntentAudited, deleteTemplateAudited } from './usecases/audit-deletes'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import type { AuditPort } from '../../shared/usecases/audit'
import type { DeliveryStatusPort } from './usecases/whatsapp-delivery-status'
import type { TemplateStatusPort } from './usecases/whatsapp-template-status'
import { listarBandeja, abrirConversacion, tomarConversacion, soltarConversacion, responderConversacion, registrarEntrante } from './usecases/inbox'
import type { InboxDeps } from './usecases/inbox'
import { consumoDelMes, sincronizarConsumo, assertPuedeIniciarConversacion } from './usecases/whatsapp-usage'
import type { UsageDeps } from './usecases/whatsapp-usage'
import { usageDepsDe } from './usecases/whatsapp-usage-deps'
import {
  iniciarSesionLegacy, reconectarSesionesLegacy, detenerSesionLegacy, qrSesionLegacy, estadoSesionLegacy,
  type SesionLegacyDeps,
} from './usecases/whatsapp-sessions-facade'

export class AiRecepcionistaService {
  private sockets: AiRecepcionistaSockets = {}
  private auditPort: AuditPort | null = null
  /** Pusher de availability a Channex al crear una reserva desde la IA. Inyectado desde composition-root. */
  channexPusher: ((hotelId: string, roomId: string) => void) | null = null
  /** Cancelación real de reservas (política + snapshot + release de depósito). Lo inyecta el connector `ai-recepcionista-reservas`. */
  cancelReservationPort: ReservationCancelPort | null = null
  /** Emisión de factura vía el módulo `facturas`. Lo inyecta el connector `ai-facturas`. */
  invoicingPort: InvoiceIssuePort | null = null

  /** Escribe el acuse de entrega en `message_logs` (tabla de marketing). Lo inyecta un connector. */
  deliveryStatusPort: DeliveryStatusPort | null = null
  setDeliveryStatusPort(p: DeliveryStatusPort): void { this.deliveryStatusPort = p }

  /** Anota en `whatsapp_templates` lo que Meta decidió sobre una plantilla. Lo inyecta un connector. */
  templateStatusPort: TemplateStatusPort | null = null
  setTemplateStatusPort(p: TemplateStatusPort): void { this.templateStatusPort = p }

  /** Conecta el audit log. Lo inyecta el connector `ai-recepcionista-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  constructor(
    private readonly conversationRepo: any,
    private readonly messageRepo: any,
    private readonly intentRepo: any,
    private readonly templateRepo: any,
    private readonly whatsappConfigRepo: any,
    private readonly metricsRepo: any,
    private readonly bookingFlowRepo: any,
    private readonly voiceConfigRepo: any,
    private readonly userRepo: any,
    private readonly hotelRepo: any,
    private readonly roomRepo: any,
    private readonly reservationRepo: any,
    private readonly configRepo: any,
    private readonly guestRepo: any,
    private readonly logger: any,
    private readonly cache: any,
    private readonly auth: any,
    private readonly onReservationCreated?: (hotelId: string, roomId: string) => Promise<void>,
  ) {}

  setSockets(s: Partial<AiRecepcionistaSockets>): void { accumulateSockets(this.sockets as any, s as any) }

  private async resolveHotelId(user: { id: string; role: string; hotelId?: string }, dtoHotelId?: string): Promise<string> {
    if (user.role === 'super_admin' && dtoHotelId) return dtoHotelId
    if (user.hotelId) return user.hotelId
    // @ignore IDOR_RISK
    const u = await this.userRepo.findById(user.id)
    if (u?.hotelId && u.hotelId !== 'platform') return u.hotelId
    throw new AuthError('No hotel assigned')
  }

  private userHotel(user: { hotelId?: string }): string { return user.hotelId || '' }
  private userRole(user: { role?: string }): string { return user.role || '' }

  async listConversations(q: ConversationQuery, u: any) { return listConversations(this.conversationRepo, q, await this.resolveHotelId(u, q.hotelId)) }
  async getConversation(id: string, u: any) { return getConversationWithMessages(this.conversationRepo, this.messageRepo, id, this.userHotel(u), this.userRole(u)) }
  async findOrCreateConversation(dto: CreateAiConversationDTO) { return findOrCreateConversation(this.conversationRepo, this.sockets, dto) }
  async closeConversation(id: string, resolvedBy: string, score?: number, u?: any) { return closeConversation(this.conversationRepo, this.sockets, this.cache, id, resolvedBy, score, this.userHotel(u!), this.userRole(u!)) }
  async transferConversation(id: string, agentId: string | null, reason?: string, u?: any) { return transferConversation(this.conversationRepo, this.sockets, id, agentId, reason, this.userHotel(u!), this.userRole(u!)) }
  async sendMessage(conversationId: string, dto: any, u: any) { return sendMessage(this.conversationRepo, this.messageRepo, this.sockets, this.cache, { ...dto, conversationId }, this.userHotel(u), this.userRole(u)) }
  async processIncomingMessage(conversationId: string, content: string, hotelId: string) {
    // Nombre real del hotel, para personalizar la respuesta. Si falla, se sigue con el genérico.
    let hotelName = 'Hotel'
    // @ignore IDOR_RISK
    try { hotelName = (await this.hotelRepo.findById(hotelId))?.name || 'Hotel' }
    catch (e: any) { this.logger?.warn?.('No se pudo leer el nombre del hotel', { hotelId, error: e?.message }) }
    const channel = await conversationChannel(this.conversationRepo, conversationId, hotelId)
    return processIncomingMessage(this.conversationRepo, this.messageRepo, this.intentRepo, this.whatsappConfigRepo, this.sockets, this.cache, this.logger, conversationId, content, hotelId, hotelName, { roomRepo: this.roomRepo, reservationRepo: this.reservationRepo, hotelRepo: this.hotelRepo, guestRepo: this.guestRepo, configRepo: this.configRepo, issueInvoice: this.invoicingPort ?? undefined, channel, logger: this.logger, onReservationCreated: this.onReservationCreated, cancelReservation: this.cancelReservationPort ?? undefined })
  }

  async listIntents(q: IntentQuery, u: any) { return listIntents(this.intentRepo, await this.resolveHotelId(u, q.hotelId), q.category, q.isActive, q.page, q.limit) }
  async seedSystemIntents(hotelId: string) { const { seedHotelIntents } = await import('./usecases/seed'); return seedHotelIntents(this.intentRepo, hotelId) }
  async getIntent(id: string, u: any) { return getIntent(this.intentRepo, id, this.userHotel(u), this.userRole(u)) }
  async createIntent(dto: CreateAiIntentDTO, u: any) { return createIntent(this.intentRepo, this.cache, dto, await this.resolveHotelId(u, dto.hotelId)) }
  async updateIntent(id: string, dto: UpdateAiIntentDTO, u: any) { return updateIntent(this.intentRepo, this.cache, id, dto, this.userHotel(u), this.userRole(u)) }
  async deleteIntent(id: string, u: any) { return deleteIntentAudited({ repo: this.intentRepo, cache: this.cache, logger: this.logger, auditPort: this.auditPort }, id, u, this.userHotel(u), this.userRole(u)) }
  async testIntent(id: string, message: string, u: any): Promise<NlpResult> { return probarIntent(this.intentRepo, id, message, this.userHotel(u), this.userRole(u)) }

  async listTemplates(q: TemplateQuery, u: any) { return listTemplates(this.templateRepo, await this.resolveHotelId(u, q.hotelId), q.category, q.isActive, q.page, q.limit) }
  async createTemplate(dto: CreateAiTemplateDTO, u: any) { return createTemplate(this.templateRepo, dto, await this.resolveHotelId(u, dto.hotelId)) }
  async updateTemplate(id: string, dto: UpdateAiTemplateDTO, u: any) { return updateTemplate(this.templateRepo, id, dto, this.userHotel(u), this.userRole(u)) }
  async deleteTemplate(id: string, u: any) { return deleteTemplateAudited({ repo: this.templateRepo, logger: this.logger, auditPort: this.auditPort }, id, u, this.userHotel(u), this.userRole(u)) }

  async getWhatsappConfig(hotelId: string, u: any): Promise<AiWhatsappConfigDTO | null> { return getWhatsappConfig(this.whatsappConfigRepo, await this.resolveHotelId(u, hotelId)) }
  async updateWhatsappConfig(dto: CreateAiWhatsappConfigDTO, u: any): Promise<AiWhatsappConfigDTO> { return updateWhatsappConfig(this.whatsappConfigRepo, await this.resolveHotelId(u, dto.hotelId), dto) }
  // ─── Consumo de WhatsApp ───────────────────────────────────────────────────
  /** Cuánto lleva consumido el hotel este mes, y contra qué tope. */
  async consumoDeWhatsapp(u: any, hotelId?: string, mes?: string) { return consumoDelMes(this.usageDeps(), await this.resolveHotelId(u, hotelId), mes) }
  /** Trae de Meta el consumo real y lo guarda. Lo llama el panel y el cron. */
  async sincronizarConsumo(hotelId: string, mes?: string) { return sincronizarConsumo(this.usageDeps(), hotelId, mes) }
  /** Guarda del corte: la usa el envío antes de iniciar una conversación nueva. */
  async assertPuedeIniciar(hotelId: string) { return assertPuedeIniciarConversacion(this.usageDeps(), hotelId) }

  /** Repo, cliente de Meta y cupo: los trae el connector `ai-recepcionista-consumo`. */
  usagePorts: Omit<UsageDeps, 'logger'> | null = null
  setUsageDeps(p: Omit<UsageDeps, 'logger'>): void { this.usagePorts = p }
  private usageDeps(): UsageDeps { return usageDepsDe(this.usagePorts, this.logger) }

  // ─── Bandeja de WhatsApp ───────────────────────────────────────────────────
  /** Anota el entrante (ventana + no leídos) y dice si el bot debe callarse. */
  async registrarEntrante(conversationId: string, hotelId: string) { return registrarEntrante(this.inboxDeps(), conversationId, hotelId) }
  async listarBandeja(u: any, hotelId?: string, estado?: any) { return listarBandeja(this.inboxDeps(), await this.resolveHotelId(u, hotelId), { estado }) }
  async abrirConversacion(id: string, u: any) { return abrirConversacion(this.inboxDeps(), id, await this.resolveHotelId(u)) }
  async tomarConversacion(id: string, u: any) { return tomarConversacion(this.inboxDeps(), id, await this.resolveHotelId(u), u.id) }
  async soltarConversacion(id: string, u: any) { return soltarConversacion(this.inboxDeps(), id, await this.resolveHotelId(u)) }
  async responderConversacion(id: string, texto: string, u: any) { return responderConversacion(this.inboxDeps(), id, await this.resolveHotelId(u), texto, u.id) }

  /** Envío y registro de la bandeja. Los inyecta el connector `ai-recepcionista-whatsapp`. */
  inboxPorts: { whatsapp: InboxDeps['whatsapp']; registrarEnvio?: InboxDeps['registrarEnvio'] } = { whatsapp: null }
  setInboxDeps(p: { whatsapp: InboxDeps['whatsapp']; registrarEnvio?: InboxDeps['registrarEnvio'] }): void { this.inboxPorts = p }
  private inboxDeps(): InboxDeps { return { conversationRepo: this.conversationRepo, messageRepo: this.messageRepo, logger: this.logger, ...this.inboxPorts } }

  // ─── Conexión oficial con Meta (Embedded Signup) ───────────────────────────
  /** Canjea el código de la ventana de Meta y deja el WhatsApp del hotel conectado. */
  async connectWhatsapp(input: ConnectInput, u: any) { return connectWhatsapp(await connectionDepsFor(this.whatsappConfigRepo, this.logger, this.configRepo), input, await this.resolveHotelId(u, (input as any).hotelId), u?.id) }
  /** Da de baja la conexión: primero en Meta, después acá. */
  async disconnectWhatsapp(u: any, hotelId?: string) { return disconnectWhatsapp(await connectionDepsFor(this.whatsappConfigRepo, this.logger, this.configRepo), await this.resolveHotelId(u, hotelId)) }
  /** Todas las conexiones, para el soporte de la plataforma. Solo lectura, sin secretos. */
  async listarConexiones() { return listarConexiones(this.whatsappConfigRepo) }
  /** Estado de la conexión para la tarjeta del panel. Sin secretos. */
  async getWhatsappConnection(hotelId: string, u: any) { return proyectarConexion(await getWhatsappConfig(this.whatsappConfigRepo, await this.resolveHotelId(u, hotelId))) }

  /** Credenciales en claro para uso INTERNO del servidor (connector `marketing-whatsapp-meta`). */
  async getWhatsappCredentials(hotelId: string): Promise<WhatsappCredentials | null> { return getWhatsappCredentials(this.whatsappConfigRepo, hotelId) }

  async getMetrics(hotelId: string, _period: string, u: any): Promise<AiMetricsDTO[]> { return getMetrics(this.metricsRepo, await this.resolveHotelId(u, hotelId)) }
  async getDashboardMetrics(hotelId: string, u: any): Promise<Record<string, unknown>> { return getDashboardMetrics(this.conversationRepo, this.metricsRepo, await this.resolveHotelId(u, hotelId)) }

  async getBookingFlow(conversationId: string) { return getBookingFlow(this.bookingFlowRepo, conversationId) }
  async createBookingFlow(conversationId: string, hotelId: string) { return createBookingFlow(this.bookingFlowRepo, conversationId, hotelId) }
  async updateBookingFlow(id: string, data: Partial<AiBookingFlowRecord>) { return this.bookingFlowRepo.update(id, data as any) }

  async getVoiceConfig(hotelId: string, u: any): Promise<AiVoiceConfigRecord | null> {
    return (await this.voiceConfigRepo.findMany({ hotelId: await this.resolveHotelId(u, hotelId) }))[0] || null
  }

  // ─── Sesión legacy por QR (Baileys) — se conserva para los hoteles que todavía la usan ─────
  private sesionDeps(): SesionLegacyDeps {
    return { configRepo: this.whatsappConfigRepo, conversationRepo: this.conversationRepo, messageRepo: this.messageRepo,
      intentRepo: this.intentRepo, sockets: this.sockets, cache: this.cache, logger: this.logger,
      procesar: (cid: string, txt: string, hid: string) => this.processIncomingMessage(cid, txt, hid),
      conversacion: (dto: any) => this.findOrCreateConversation(dto) }
  }
  async startWhatsappSession(hotelId: string) { return iniciarSesionLegacy(this.sesionDeps(), hotelId) }
  async autoReconnectSessions() { return reconectarSesionesLegacy(this.sesionDeps()) }
  async stopWhatsappSession(hotelId: string) { return detenerSesionLegacy(this.whatsappConfigRepo, hotelId) }
  async getWhatsappQR(hotelId: string) { return qrSesionLegacy(hotelId) }
  async getWhatsappStatus(hotelId: string) { return estadoSesionLegacy(this.whatsappConfigRepo, hotelId) }
}
