// sales-leads/service.ts — Leads de ventas de la landing pública.
// El formulario público SOLO crea (fullName/email/phone/hotelName/roomsRange/message/
// planInterest) y recibe un simple acuse — nunca ve status/notes de otros leads. El admin
// (super_admin) es quien lista y avanza el status: new → contacted → won | lost.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  SalesLeadDTO,
  CreateSalesLeadDTO,
  UpdateSalesLeadDTO,
  SalesLeadAck,
  SalesLeadListResult,
  SalesLeadStatus,
} from './types'
import { SALES_LEAD_STATUSES } from './types'
import type { SalesLeadsSockets } from './sockets'
import { notifyLead } from './usecases/lead-notify'
import { buildPipeline, type PipelineDeps } from './usecases/pipeline'
import { notifySignup, type SignedUpHotelInput, type SignedUpOwnerInput } from './usecases/signup-alert'
import { parseProspectKey, upsertProspect, type ProspectActor, type UpsertProspectDeps } from './usecases/prospect-upsert'
import { listAssignees, type AssigneesResult } from './usecases/assignees'
import type { SalesPipelineResult, SalesProspectDTO, UpdateSalesProspectDTO } from './types'

/** Puerto de email mínimo (lo cablea email-bootstrap con setEmailDeps) — mismo patrón que deletion-requests. */
export interface EmailPort {
  enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }): Promise<string>
}

// Sin hotel dueño de este email (scope plataforma): 'platform' resuelve la config SMTP/Resend
// de plataforma en EmailService.resolveSmtpConfig, igual que deletion-requests/site-pages.
const PLATFORM_HOTEL_ID = 'platform'
const SALES_ADMIN_EMAIL = process.env.SALES_LEADS_ADMIN_EMAIL || process.env.VITE_SALES_EMAIL || 'ventas@solmios.com'

function assertStatus(status: string): asserts status is SalesLeadStatus {
  if (!(SALES_LEAD_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status: debe ser una de ${SALES_LEAD_STATUSES.join(', ')}`)
  }
}

export class SalesLeadsService {
  private sockets: SalesLeadsSockets = {}
  private emailSender?: EmailPort
  private appUrl = '' // PUBLIC_URL: base de los links absolutos en los correos a ventas
  private pipelineDeps?: PipelineDeps
  private plansRepo?: RepositoryAdapter<any> // solo para el NOMBRE del plan en el aviso del alta (#145)
  private configRepo?: RepositoryAdapter<any> // configuration('plataforma') → nombre de la plataforma en el WhatsApp del alta

  constructor(
    private readonly repo: RepositoryAdapter<SalesLeadDTO>,
    private readonly logger: Logger,
  ) {}

  setEmailDeps(emailSender: EmailPort, appUrl?: string): void {
    this.emailSender = emailSender
    if (appUrl !== undefined) this.appUrl = appUrl
  }

  /** Repos de las tablas que el pipeline lee (los cablea index.ts; el service nunca ve el ORM). */
  setPipelineDeps(deps: Omit<PipelineDeps, 'salesLeads'> & {
    salesLeads?: RepositoryAdapter<SalesLeadDTO>
    plans?: RepositoryAdapter<any>
    configuration?: RepositoryAdapter<any>
  }): void {
    const { plans, configuration, ...rest } = deps
    this.pipelineDeps = { ...rest, salesLeads: rest.salesLeads ?? this.repo }
    if (plans) this.plansRepo = plans
    if (configuration) this.configRepo = configuration
  }

  /** REQ-PIPE-04 (#145): hotel recién registrado (socket `subscriptions.onHotelSignedUp` vía
   *  connector). Encola el aviso a ventas en ESTA MISMA petición. Best-effort: nunca tira. */
  notifySignup(hotel: SignedUpHotelInput, owner: SignedUpOwnerInput, planId: string): Promise<void> {
    return notifySignup({
      emailSender: this.emailSender, plansRepo: this.plansRepo, configRepo: this.configRepo, to: SALES_ADMIN_EMAIL,
      platformHotelId: PLATFORM_HOTEL_ID, appUrl: this.appUrl, logger: this.logger,
    }, hotel, owner, planId)
  }

  private requirePipelineDeps(): PipelineDeps {
    if (!this.pipelineDeps) throw new Error('sales-leads: pipeline deps no cableadas (setPipelineDeps)')
    return this.pipelineDeps
  }

  // ─── Pipeline de ventas (REQ-PIPE-01..03) ─────────────────────────────────

  /** Admin: una fila por hotel registrado + una por lead sin hotel, con etapa/calor calculados. */
  async getPipeline(): Promise<SalesPipelineResult> {
    return buildPipeline(this.requirePipelineDeps())
  }

  /** Admin: admins activos de la plataforma a los que se puede asignar un prospecto — solo id/name/email. */
  async listAssignees(): Promise<AssigneesResult> {
    return listAssignees(this.requirePipelineDeps().users)
  }

  /**
   * Admin: upsert de lo que ventas anota sobre `hotel:<id>` | `lead:<id>`. Parcial: solo pisa lo
   * que viene en el body (`null` explícito limpia). `lostReason` sin `lostAt` sella `lostAt = now`.
   * Deja rastro en `audit_log` con `hotelId='platform'`.
   */
  async updateProspect(key: string, input: UpdateSalesProspectDTO, actor: ProspectActor): Promise<SalesProspectDTO> {
    const deps = this.requirePipelineDeps()
    const target = parseProspectKey(key)
    const upsertDeps: UpsertProspectDeps = {
      salesProspects: deps.salesProspects,
      hotels: deps.hotels,
      salesLeads: deps.salesLeads,
      auditlog: deps.auditlog,
      users: deps.users,
      logger: this.logger,
      now: deps.now,
    }
    const saved = await upsertProspect(upsertDeps, target, input, actor)
    this.logger.info('sales-pipeline: prospecto actualizado', { key, fields: Object.keys(input) })
    return saved
  }

  setSockets(s: Partial<SalesLeadsSockets>): void {
    const next = s as Record<string, unknown>
    const cur = this.sockets as Record<string, unknown>
    for (const key of Object.keys(next)) {
      const h = next[key] as ((...a: unknown[]) => Promise<void>) | undefined
      if (!h) continue
      const prev = cur[key] as ((...a: unknown[]) => Promise<void>) | undefined
      cur[key] = prev ? async (...a: unknown[]) => { await prev(...a); await h(...a) } : h
    }
  }

  /** Lista completa para el admin, más recientes primero. */
  async list(): Promise<SalesLeadListResult> {
    const data = await this.repo.findMany({}, { orderBy: [{ field: 'createdAt', dir: 'DESC' }] })
    return { data, total: data.length }
  }

  async getById(id: string): Promise<SalesLeadDTO> {
    const item = await this.repo.findOne({ id })
    if (!item) throw new NotFoundError('Lead no encontrado')
    return item
  }

  /** Formulario público de la landing ("Hablar con Ventas" / "Contactar ventas"). */
  async create(input: CreateSalesLeadDTO): Promise<SalesLeadAck> {
    const item = await this.repo.create({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone ?? null,
      hotelName: input.hotelName ?? null,
      roomsRange: input.roomsRange ?? null,
      message: input.message ?? null,
      planInterest: input.planInterest ?? null,
      status: 'new',
      notes: null,
    } as Omit<SalesLeadDTO, 'id'>)
    this.logger.info('sales-leads: lead recibido', { id: item.id, email: item.email })
    await this.sockets.onSalesLeadCreated?.(item)
    await this.notifyLead(item)
    return { received: true }
  }

  /** Acuse al lead + aviso a ventas (usecases/lead-notify.ts). Best-effort: nunca rompe el formulario. */
  private notifyLead(item: SalesLeadDTO): Promise<void> {
    return notifyLead({ emailSender: this.emailSender, to: SALES_ADMIN_EMAIL, platformHotelId: PLATFORM_HOTEL_ID, logger: this.logger }, item)
  }

  /** Admin: avanza el flujo (status) y/o deja notas internas. Nunca toca los datos del lead. */
  async updateStatus(id: string, input: UpdateSalesLeadDTO): Promise<SalesLeadDTO> {
    await this.getById(id) // 404 si no existe
    if (input.status !== undefined) assertStatus(input.status)

    const updated = await this.repo.update(id, {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.notes !== undefined && { notes: input.notes }),
    })
    if (!updated) throw new NotFoundError('Lead no encontrado')
    this.logger.info('sales-leads: actualizado', { id, status: updated.status })
    await this.sockets.onSalesLeadUpdated?.(updated)
    return updated
  }

  async remove(id: string): Promise<void> {
    await this.getById(id)
    await this.repo.delete(id)
    this.logger.info('sales-leads: eliminado', { id })
    await this.removeProspectOf(id)
  }

  /** FE-15: lo que ventas anotó sobre el lead (`sales_prospects.leadId`) se va con él. Best-effort
   *  (el módulo no usa transacciones): el lead ya no existe; un prospecto huérfano solo se loguea. */
  private async removeProspectOf(leadId: string): Promise<void> {
    const prospects = this.pipelineDeps?.salesProspects
    if (!prospects) return
    try {
      const orphans = await prospects.findMany({ leadId })
      for (const p of orphans) await prospects.delete(p.id)
    } catch (e) {
      this.logger.warn('sales-leads: no se pudo borrar el prospecto del lead eliminado', { leadId, error: String(e) })
    }
  }
}
