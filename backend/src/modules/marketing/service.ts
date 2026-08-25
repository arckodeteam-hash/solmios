// marketing/service.ts
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { logsForDedupe, alreadySentToday } from './usecases/auto-message-dedupe'
import { activeFlag } from './usecases/active-flag'
import { NotFoundError } from 'arckode-framework'
import type {
  AutoMessageDTO, CreateAutoMessageDTO,
  MessageLogDTO, CreateMessageLogDTO,
  WhatsappTemplateDTO, CreateWhatsappTemplateDTO,
  MarketingUser,
} from './types'
import type { MarketingSockets } from './sockets'
import type { EmailSender } from '../../services/email-sender'
import type { NotificationEvent, NotificationLanguage } from '../../services/notification-defaults'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'

export interface TriggerDeps {
  emailSender: EmailSender
  guestRepo: RepositoryAdapter<any>
  roomRepo: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<any>
}

export class MarketingService {
  private sockets: MarketingSockets = {}
  private auditPort: AuditPort | null = null

  /** Conecta el audit log. Lo inyecta el connector `marketing-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  constructor(
    private readonly autoMsgRepo: RepositoryAdapter<AutoMessageDTO>,
    private readonly logRepo: RepositoryAdapter<MessageLogDTO>,
    private readonly templateRepo: RepositoryAdapter<WhatsappTemplateDTO>,
    private readonly logger: Logger,
    cache: CacheAdapter,
    private readonly triggerDeps?: TriggerDeps,
    private readonly auth?: Auth,
  ) {}

  setSockets(s: Partial<MarketingSockets>): void {
    const next = s as Record<string, any>; const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) { const h = next[key]; if (!h) continue; const prev = cur[key]; cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h }
  }

  setTriggerDeps(deps: TriggerDeps): void {
    ;(this as any).triggerDeps = deps
  }

  // ─── Auto Messages ────────────────────────────────────
  async listAutoMessages(hotelId: string): Promise<AutoMessageDTO[]> { return this.autoMsgRepo.findMany({ hotelId }) }
  async createAutoMessage(dto: CreateAutoMessageDTO): Promise<AutoMessageDTO> {
    return this.autoMsgRepo.create({ ...dto, isActive: activeFlag(dto.isActive) } as any)
  }
  async updateAutoMessage(id: string, data: Partial<CreateAutoMessageDTO>, user?: MarketingUser): Promise<AutoMessageDTO> {
    const existing = await this.autoMsgRepo.findById(id)
    if (!existing) throw new NotFoundError('Auto-mensaje no encontrado')
    if (this.auth) this.auth.assertOwnership(existing.hotelId, user?.hotelId ?? '', user?.role, 'super_admin')
    const patch: Record<string, any> = {}
    const fields = ['title','color','emailSubject','emailBody','whatsappBody','channel','triggerEvent','triggerOffset','variables','isActive','event','language','triggerType']
    for (const k of fields) if ((data as any)[k] !== undefined) patch[k] = (data as any)[k]
    // Misma normalización que create: el PUT llega con 0/1 (schema number) o boolean legacy.
    if (patch.isActive !== undefined) patch.isActive = activeFlag(patch.isActive)
    await this.autoMsgRepo.update(id, patch as any)
    // @ignore IDOR_RISK — reload post-write, ownership ya validado arriba (mismo id)
    return this.autoMsgRepo.findById(id) as Promise<AutoMessageDTO>
  }
  async deleteAutoMessage(id: string, user?: MarketingUser): Promise<void> {
    const existing = await this.autoMsgRepo.findById(id)
    if (!existing) throw new NotFoundError('Auto-mensaje no encontrado')
    if (this.auth) this.auth.assertOwnership(existing.hotelId, user?.hotelId ?? '', user?.role, 'super_admin')
    await this.autoMsgRepo.delete(id)
    await auditSafely(this.auditPort, this.logger, { hotelId: existing.hotelId, userId: user?.id, action: 'auto_message.delete',
      entity: 'auto_message', entityId: id, detail: `Auto-mensaje "${existing.title}" eliminado` })
  }

  // ─── Message Logs ──────────────────────────────────────
  async listMessageLogs(hotelId: string, reservationId?: string): Promise<MessageLogDTO[]> {
    const filters: Record<string, any> = { hotelId }
    if (reservationId) filters.reservationId = reservationId
    const data = await this.logRepo.findMany(filters)
    return data.sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''))
  }
  async createMessageLog(dto: CreateMessageLogDTO): Promise<MessageLogDTO> { return this.logRepo.create(dto as any) }

  // ─── WhatsApp Templates ────────────────────────────────
  async listTemplates(hotelId: string): Promise<WhatsappTemplateDTO[]> { return this.templateRepo.findMany({ hotelId }) }
  async createTemplate(dto: CreateWhatsappTemplateDTO): Promise<WhatsappTemplateDTO> {
    return this.templateRepo.create({ ...dto, isActive: activeFlag(dto.isActive) } as any)
  }
  async updateTemplate(id: string, data: Partial<CreateWhatsappTemplateDTO>, user?: MarketingUser): Promise<WhatsappTemplateDTO> {
    const existing = await this.templateRepo.findById(id)
    if (!existing) throw new NotFoundError('Plantilla no encontrada')
    if (this.auth) this.auth.assertOwnership(existing.hotelId, user?.hotelId ?? '', user?.role, 'super_admin')
    const patch: Record<string, any> = {}
    for (const k of ['name','body','category']) if ((data as any)[k] !== undefined) patch[k] = (data as any)[k]
    if (data.isActive !== undefined) patch.isActive = activeFlag(data.isActive)
    await this.templateRepo.update(id, patch as any)
    // @ignore IDOR_RISK — reload post-write, ownership ya validado arriba (mismo id)
    return this.templateRepo.findById(id) as Promise<WhatsappTemplateDTO>
  }
  async deleteTemplate(id: string, user?: MarketingUser): Promise<void> {
    const existing = await this.templateRepo.findById(id)
    if (!existing) throw new NotFoundError('Plantilla no encontrada')
    if (this.auth) this.auth.assertOwnership(existing.hotelId, user?.hotelId ?? '', user?.role, 'super_admin')
    await this.templateRepo.delete(id)
    await auditSafely(this.auditPort, this.logger, { hotelId: existing.hotelId, userId: user?.id, action: 'whatsapp_template.delete',
      entity: 'whatsapp_template', entityId: id, detail: `Plantilla de WhatsApp "${existing.name}" eliminada` })
  }

  // ─── Trigger Auto-Messages ────────────────────────────
  /**
   * Dispara auto-messages activos para un evento dado.
   * Resuelve variables desde la reserva/huésped/hotel y encola emails via EmailSender.
   */
  async triggerAutoMessages(params: {
    hotelId: string
    event: string
    /** Triggers de huésped (birthday/win-back) no tienen reserva: deduplican por guestId. */
    reservationId?: string
    guestId?: string
    roomId?: string
    variables?: Record<string, string | number>
  }): Promise<void> {
    if (!this.triggerDeps?.emailSender) {
      this.logger.warn('triggerAutoMessages: emailSender no configurado')
      return
    }

    const { hotelId, event, reservationId, guestId, roomId, variables: extraVars } = params

    // Buscar auto-messages activos para este evento
    const allMsgs = await this.autoMsgRepo.findMany({ hotelId, isActive: 1 } as any)
    const matching = allMsgs.filter(m => m.triggerEvent === event)
    if (matching.length === 0) return

    // Resolver variables del contexto
    const guest = guestId ? await this.triggerDeps.guestRepo.findById(guestId) : null
    const room = roomId ? await this.triggerDeps.roomRepo.findById(roomId) : null
    const hotel = await this.triggerDeps.hotelRepo.findById(hotelId)

    const baseVars: Record<string, string | number> = {
      guest_name: guest?.name || guest?.firstName || 'Huésped',
      hotel_name: hotel?.name || 'Hotel',
      hotel_phone: hotel?.phone || '',
      hotel_address: hotel?.address || '',
      room_number: room?.number || '',
      room_type: room?.type || '',
      logo_url: (hotel as any)?.logo || '',
      ...extraVars,
    }

    // Dedup (spec 11.3.1): el cron corre cada 1h y la condición (checkIn=today AND status=confirmed)
    // se mantiene hasta el check-in real, así que sin este corte cada tick duplicaría el email.
    // message_logs no guarda templateId/channel/metadata (solo response/sentAt/status), por eso
    // usamos `response` como clave de dedup estable: `auto:{event}:{autoMessageId}`.
    // Dedupe mismo-día (usecases/auto-message-dedupe): por reserva o, sin reserva,
    // por huésped (birthday/win-back). Clave: response = `auto:{event}:{msgId}` + sentAt hoy.
    const sentLogs = await logsForDedupe(this.logRepo, { hotelId, reservationId, guestId })
    const already = (msgId: string) => alreadySentToday(sentLogs as any[], event, msgId)

    for (const msg of matching) {
      try {
        if (already(msg.id || '')) {
          this.logger.info('Auto-message dedup: ya enviado hoy', { hotelId, event, reservationId, autoMessageId: msg.id })
          continue
        }
        const language = (msg.language || 'es') as any
        const templateEvent = msg.event || 'checkin_welcome'

        const queueId = await this.triggerDeps.emailSender.enqueueNotification({
          to: guest?.email || '',
          hotelId,
          event: templateEvent as NotificationEvent,
          language: language as NotificationLanguage,
          variables: baseVars,
          relatedType: 'auto_message',
          relatedId: msg.id,
        })

        // Log del envío. response = clave de dedup (event×autoMessage) — persiste en message_logs.
        await this.createMessageLog({
          hotelId,
          reservationId: reservationId || null,
          guestId: guestId || null,
          messageType: 'email',
          status: queueId ? 'sent' : 'failed',
          recipient: guest?.email || null,
          response: `auto:${event}:${msg.id || ''}`,
          sentAt: new Date().toISOString(),
        } as any)

        this.logger.info('Auto-message encolado', { hotelId, event, guest: guest?.email, queueId })
      } catch (e) {
        this.logger.warn('Error en auto-message', { hotelId, event, error: (e as Error).message })
      }
    }
  }
}
