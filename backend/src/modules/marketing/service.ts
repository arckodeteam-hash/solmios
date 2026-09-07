// marketing/service.ts
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { logsForDedupe, alreadySentToday } from './usecases/auto-message-dedupe'
import { activeFlag } from './usecases/active-flag'
import { NotFoundError, ConflictError } from 'arckode-framework'
import { submitTemplateToMeta, syncTemplateStatus } from './usecases/meta-templates'
import type { MetaTemplateDeps } from './usecases/meta-templates'
import { createTemplate, updateTemplate, deleteTemplate, loadOwnedTemplate } from './usecases/templates-crud'
import type { TemplateCrudDeps } from './usecases/templates-crud'
import type {
  AutoMessageDTO, CreateAutoMessageDTO,
  MessageLogDTO, CreateMessageLogDTO,
  WhatsappTemplateDTO, CreateWhatsappTemplateDTO,
  MarketingUser,
} from './types'
import type { MarketingSockets } from './sockets'
import { triggerAutoMessages } from './usecases/trigger-auto-messages'
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
  // El grueso vive en usecases/: la edición dejó de ser un patch plano (decide qué pasa con la
  // aprobación de Meta) y el service ya estaba en el límite de tamaño del analyzer.
  private crudDeps(): TemplateCrudDeps {
    return { templateRepo: this.templateRepo, auth: this.auth, auditPort: this.auditPort, logger: this.logger }
  }

  async listTemplates(hotelId: string): Promise<WhatsappTemplateDTO[]> { return this.templateRepo.findMany({ hotelId }) }
  async createTemplate(dto: CreateWhatsappTemplateDTO): Promise<WhatsappTemplateDTO> { return createTemplate(this.templateRepo, dto) }
  async updateTemplate(id: string, data: Partial<CreateWhatsappTemplateDTO>, user?: MarketingUser): Promise<WhatsappTemplateDTO> {
    return updateTemplate(this.crudDeps(), id, data, user)
  }
  async deleteTemplate(id: string, user?: MarketingUser): Promise<void> { return deleteTemplate(this.crudDeps(), id, user) }

  // ─── Plantillas ↔ Meta ─────────────────────────────────
  /** Puente con la cuenta de WhatsApp del hotel. Lo inyecta el connector `marketing-whatsapp-meta`. */
  private metaTemplateDeps: Pick<MetaTemplateDeps, 'credentials' | 'client'> | null = null
  setMetaCredsDeps(deps: Pick<MetaTemplateDeps, 'credentials' | 'client'>): void { this.metaTemplateDeps = deps }

  private metaDeps(): MetaTemplateDeps {
    if (!this.metaTemplateDeps) throw new ConflictError('La integración con WhatsApp de Meta no está disponible en este servidor.')
    return { templateRepo: this.templateRepo, ...this.metaTemplateDeps }
  }

  /** Manda la plantilla a Meta para aprobación. Valida pertenencia antes de salir a la red. */
  async submitTemplateToMeta(id: string, user?: MarketingUser): Promise<WhatsappTemplateDTO> {
    const existing = await loadOwnedTemplate(this.crudDeps(), id, user)
    const updated = await submitTemplateToMeta(this.metaDeps(), existing)
    await auditSafely(this.auditPort, this.logger, { hotelId: existing.hotelId, userId: user?.id, action: 'whatsapp_template.submit',
      entity: 'whatsapp_template', entityId: id, detail: `Plantilla "${existing.name}" enviada a Meta para aprobación` })
    return updated
  }

  /** Trae de Meta el estado de UNA plantilla ya enviada. */
  async syncTemplateStatus(id: string, user?: MarketingUser): Promise<WhatsappTemplateDTO> {
    return syncTemplateStatus(this.metaDeps(), await loadOwnedTemplate(this.crudDeps(), id, user))
  }

  // ─── Trigger Auto-Messages ────────────────────────────
  /** Dispara los auto-mensajes activos de un evento. La lógica vive en usecases/. */
  async triggerAutoMessages(params: Parameters<typeof triggerAutoMessages>[1]): Promise<void> {
    return triggerAutoMessages({
      triggerDeps: this.triggerDeps, autoMsgRepo: this.autoMsgRepo, logRepo: this.logRepo,
      logger: this.logger, sockets: this.sockets,
      createMessageLog: (dto) => this.createMessageLog(dto),
    }, params)
  }
}
