import type { Logger, CacheAdapter, Auth } from 'arckode-framework'
import { AuthError } from 'arckode-framework'
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
  processIncomingMessage,
} from './usecases/intents'
import { listTemplates, createTemplate, updateTemplate } from './usecases/templates'
import { conversationChannel } from './usecases/conversation-channel'
import type { ReservationCancelPort, InvoiceIssuePort } from './usecases/llm-pipeline'
import { getWhatsappConfig, updateWhatsappConfig, getWhatsappCredentials } from './usecases/whatsapp-config'
import type { WhatsappCredentials } from './usecases/whatsapp-config'
import { getMetrics, getDashboardMetrics } from './usecases/metrics'
import { deleteIntentAudited, deleteTemplateAudited } from './usecases/audit-deletes'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import type { AuditPort } from '../../shared/usecases/audit'

export class AiRecepcionistaService {
  private sockets: AiRecepcionistaSockets = {}
  private auditPort: AuditPort | null = null
  /** Pusher de availability a Channex al crear una reserva desde la IA. Inyectado desde composition-root. */
  channexPusher: ((hotelId: string, roomId: string) => void) | null = null
  /** Cancelación real de reservas (política + snapshot + release de depósito). Lo inyecta el connector `ai-recepcionista-reservas`. */
  cancelReservationPort: ReservationCancelPort | null = null
  /** Emisión de factura vía el módulo `facturas`. Lo inyecta el connector `ai-facturas`. */
  invoicingPort: InvoiceIssuePort | null = null

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

  async listConversations(q: ConversationQuery, u: any) {
    return listConversations(this.conversationRepo, q, await this.resolveHotelId(u, q.hotelId))
  }
  async getConversation(id: string, u: any) {
    return getConversationWithMessages(this.conversationRepo, this.messageRepo, id, this.userHotel(u), this.userRole(u))
  }
  async findOrCreateConversation(dto: CreateAiConversationDTO) {
    return findOrCreateConversation(this.conversationRepo, this.sockets, dto)
  }
  async closeConversation(id: string, resolvedBy: string, score?: number, u?: any) {
    return closeConversation(this.conversationRepo, this.sockets, this.cache, id, resolvedBy, score, this.userHotel(u!), this.userRole(u!))
  }
  async transferConversation(id: string, agentId: string | null, reason?: string, u?: any) {
    return transferConversation(this.conversationRepo, this.sockets, id, agentId, reason, this.userHotel(u!), this.userRole(u!))
  }
  async sendMessage(conversationId: string, dto: any, u: any) {
    return sendMessage(this.conversationRepo, this.messageRepo, this.sockets, this.cache, { ...dto, conversationId }, this.userHotel(u), this.userRole(u))
  }
  async processIncomingMessage(conversationId: string, content: string, hotelId: string) {
    let hotelName = 'Hotel' // nombre real del hotel, para personalizar la respuesta
    try {
      // @ignore IDOR_RISK
      hotelName = (await this.hotelRepo.findById(hotelId))?.name || 'Hotel'
    } catch (e: any) {
      this.logger?.warn?.('No se pudo leer el nombre del hotel', { hotelId, error: e?.message })
    }
    const channel = await conversationChannel(this.conversationRepo, conversationId, hotelId)
    return processIncomingMessage(this.conversationRepo, this.messageRepo, this.intentRepo, this.whatsappConfigRepo, this.sockets, this.cache, this.logger, conversationId, content, hotelId, hotelName, { roomRepo: this.roomRepo, reservationRepo: this.reservationRepo, hotelRepo: this.hotelRepo, guestRepo: this.guestRepo, configRepo: this.configRepo, issueInvoice: this.invoicingPort ?? undefined, channel, logger: this.logger, onReservationCreated: this.onReservationCreated, cancelReservation: this.cancelReservationPort ?? undefined })
  }

  async listIntents(q: IntentQuery, u: any) {
    return listIntents(this.intentRepo, await this.resolveHotelId(u, q.hotelId), q.category, q.isActive, q.page, q.limit)
  }
  async seedSystemIntents(hotelId: string) { const { seedHotelIntents } = await import('./usecases/seed'); return seedHotelIntents(this.intentRepo, hotelId) }
  async getIntent(id: string, u: any) { return getIntent(this.intentRepo, id, this.userHotel(u), this.userRole(u)) }
  async createIntent(dto: CreateAiIntentDTO, u: any) {
    return createIntent(this.intentRepo, this.cache, dto, await this.resolveHotelId(u, dto.hotelId))
  }
  async updateIntent(id: string, dto: UpdateAiIntentDTO, u: any) {
    return updateIntent(this.intentRepo, this.cache, id, dto, this.userHotel(u), this.userRole(u))
  }
  async deleteIntent(id: string, u: any) { return deleteIntentAudited({ repo: this.intentRepo, cache: this.cache, logger: this.logger, auditPort: this.auditPort }, id, u, this.userHotel(u), this.userRole(u)) }
  async testIntent(id: string, message: string, u: any): Promise<NlpResult> {
    const { getIntent } = await import('./usecases/intents')
    const intent = await getIntent(this.intentRepo, id, this.userHotel(u), this.userRole(u))
    const { detectIntent } = await import('./usecases/nlp-engine')
    return detectIntent(message, [intent])
  }

  async listTemplates(q: TemplateQuery, u: any) {
    return listTemplates(this.templateRepo, await this.resolveHotelId(u, q.hotelId), q.category, q.isActive, q.page, q.limit)
  }
  async createTemplate(dto: CreateAiTemplateDTO, u: any) {
    return createTemplate(this.templateRepo, dto, await this.resolveHotelId(u, dto.hotelId))
  }
  async updateTemplate(id: string, dto: UpdateAiTemplateDTO, u: any) {
    return updateTemplate(this.templateRepo, id, dto, this.userHotel(u), this.userRole(u))
  }
  async deleteTemplate(id: string, u: any) { return deleteTemplateAudited({ repo: this.templateRepo, logger: this.logger, auditPort: this.auditPort }, id, u, this.userHotel(u), this.userRole(u)) }

  async getWhatsappConfig(hotelId: string, u: any): Promise<AiWhatsappConfigDTO | null> { return getWhatsappConfig(this.whatsappConfigRepo, await this.resolveHotelId(u, hotelId)) }
  async updateWhatsappConfig(dto: CreateAiWhatsappConfigDTO, u: any): Promise<AiWhatsappConfigDTO> { return updateWhatsappConfig(this.whatsappConfigRepo, await this.resolveHotelId(u, dto.hotelId), dto) }
  /** Credenciales en claro para uso INTERNO del servidor (connector `marketing-whatsapp`). */
  async getWhatsappCredentials(hotelId: string): Promise<WhatsappCredentials | null> { return getWhatsappCredentials(this.whatsappConfigRepo, hotelId) }

  async getMetrics(hotelId: string, _period: string, u: any): Promise<AiMetricsDTO[]> {
    return getMetrics(this.metricsRepo, await this.resolveHotelId(u, hotelId))
  }

  async getDashboardMetrics(hotelId: string, u: any): Promise<Record<string, unknown>> {
    return getDashboardMetrics(this.conversationRepo, this.metricsRepo, await this.resolveHotelId(u, hotelId))
  }

  async getBookingFlow(conversationId: string) { return getBookingFlow(this.bookingFlowRepo, conversationId) }
  async createBookingFlow(conversationId: string, hotelId: string) { return createBookingFlow(this.bookingFlowRepo, conversationId, hotelId) }
  async updateBookingFlow(id: string, data: Partial<AiBookingFlowRecord>) { return this.bookingFlowRepo.update(id, data as any) }

  async getVoiceConfig(hotelId: string, u: any): Promise<AiVoiceConfigRecord | null> {
    const hid = await this.resolveHotelId(u, hotelId)
    const configs = await this.voiceConfigRepo.findMany({ hotelId: hid })
    return configs[0] || null
  }

  async startWhatsappSession(hotelId: string) {
    const { beginSession } = await import('./usecases/whatsapp-sessions')
    const configs = await this.whatsappConfigRepo.findMany({ hotelId })
    return beginSession(hotelId, configs[0] || null, this.whatsappConfigRepo, this.conversationRepo, this.messageRepo, this.intentRepo, this.sockets, this.cache, this.logger, (cid: string, txt: string, hid: string) => this.processIncomingMessage(cid, txt, hid), (dto: any) => this.findOrCreateConversation(dto))
  }

  async autoReconnectSessions() {
    const { beginSession } = await import('./usecases/whatsapp-sessions')
    // Find all hotels with active Baileys config and saved credentials
    const allConfigs = await this.whatsappConfigRepo.findMany({})
    for (const cfg of allConfigs) {
      if (cfg.connectionMode === 'baileys' && cfg.baileysCredentials) {
        console.log(`[WA] Auto-reconnecting hotel ${cfg.hotelId}`)
        try {
          await beginSession(cfg.hotelId, cfg, this.whatsappConfigRepo, this.conversationRepo, this.messageRepo, this.intentRepo, this.sockets, this.cache, this.logger, (cid: string, txt: string, hid: string) => this.processIncomingMessage(cid, txt, hid), (dto: any) => this.findOrCreateConversation(dto))
        } catch (e: any) {
          console.log(`[WA] Auto-reconnect failed for ${cfg.hotelId}: ${e?.message}`)
        }
      }
    }
  }
  async stopWhatsappSession(hotelId: string) {
    const { endSession } = await import('./usecases/whatsapp-sessions')
    return endSession(hotelId, this.whatsappConfigRepo)
  }
  async getWhatsappQR(hotelId: string) {
    const { getQRSync } = await import('./usecases/whatsapp-sessions')
    return getQRSync(hotelId)
  }
  async getWhatsappStatus(hotelId: string) {
    const { getStatusSync } = await import('./usecases/whatsapp-sessions')
    return getStatusSync(hotelId, this.whatsappConfigRepo)
  }
}
