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
import { buildAckEmail, buildAdminAlertEmail } from './usecases/emails'

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

  constructor(
    private readonly repo: RepositoryAdapter<SalesLeadDTO>,
    private readonly logger: Logger,
  ) {}

  setEmailDeps(emailSender: EmailPort): void {
    this.emailSender = emailSender
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

  /**
   * Best-effort: acuse de recibo al lead + aviso a ventas (siempre). Un fallo de email
   * NUNCA debe romper el envío del formulario — el lead ya quedó guardado en DB.
   */
  private async notifyLead(item: SalesLeadDTO): Promise<void> {
    if (!this.emailSender) return
    try {
      const ack = buildAckEmail({ fullName: item.fullName })
      await this.emailSender.enqueue({
        to: item.email, subject: ack.subject, html: ack.html,
        hotelId: PLATFORM_HOTEL_ID, relatedType: 'sales-lead', relatedId: item.id,
      })
    } catch (e) {
      this.logger.error('sales-leads: falló el acuse de recibo por email', { error: (e as Error).message, id: item.id })
    }
    try {
      const alert = buildAdminAlertEmail({
        fullName: item.fullName, email: item.email, phone: item.phone, hotelName: item.hotelName,
        roomsRange: item.roomsRange, message: item.message, planInterest: item.planInterest,
      })
      await this.emailSender.enqueue({
        to: SALES_ADMIN_EMAIL, subject: alert.subject, html: alert.html,
        hotelId: PLATFORM_HOTEL_ID, relatedType: 'sales-lead', relatedId: item.id,
      })
    } catch (e) {
      this.logger.error('sales-leads: falló el aviso a ventas por email', { error: (e as Error).message, id: item.id })
    }
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
  }
}
