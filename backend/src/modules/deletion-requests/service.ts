// deletion-requests/service.ts — Solicitudes de eliminación de datos (Ley 172-13).
// El formulario público SOLO crea (fullName/contactHandle/hotelName) y recibe un
// número de solicitud a cambio — nunca ve status/notes de otras solicitudes. El
// admin (super_admin) es quien lista y avanza el status del flujo declarado en
// /p/eliminacion-datos: received → verifying → completed | rejected.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  DeletionRequestDTO,
  CreateDeletionRequestDTO,
  UpdateDeletionRequestDTO,
  DeletionRequestAck,
  DeletionRequestListResult,
  DeletionRequestStatus,
} from './types'
import { DELETION_REQUEST_STATUSES } from './types'
import type { DeletionRequestsSockets } from './sockets'
import { buildAckEmail, buildAdminAlertEmail } from './usecases/emails'

/** Puerto de email mínimo (lo cablea email-bootstrap con setEmailDeps) — mismo patrón que capacitacion. */
export interface EmailPort {
  enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }): Promise<string>
}

// Sin hotel dueño de este email (scope plataforma): 'platform' resuelve la config SMTP/Resend
// de plataforma en EmailService.resolveSmtpConfig, igual que site-pages usa hotelId='platform'.
const PLATFORM_HOTEL_ID = 'platform'
const ADMIN_EMAIL = process.env.DELETION_REQUESTS_ADMIN_EMAIL || 'soporte@solmios.com'

function assertStatus(status: string): asserts status is DeletionRequestStatus {
  if (!(DELETION_REQUEST_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError(`status: debe ser una de ${DELETION_REQUEST_STATUSES.join(', ')}`)
  }
}

/** DEL-XXXXXXXX: legible para el acuse de recibo, no un token de seguridad. */
function generateRequestNumber(): string {
  return `DEL-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`
}

export class DeletionRequestsService {
  private sockets: DeletionRequestsSockets = {}
  private emailSender?: EmailPort

  constructor(
    private readonly repo: RepositoryAdapter<DeletionRequestDTO>,
    private readonly logger: Logger,
  ) {}

  setEmailDeps(emailSender: EmailPort): void {
    this.emailSender = emailSender
  }

  setSockets(s: Partial<DeletionRequestsSockets>): void {
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
  async list(): Promise<DeletionRequestListResult> {
    const data = await this.repo.findMany({}, { orderBy: [{ field: 'createdAt', dir: 'DESC' }] })
    return { data, total: data.length }
  }

  async getById(id: string): Promise<DeletionRequestDTO> {
    const item = await this.repo.findOne({ id })
    if (!item) throw new NotFoundError('Solicitud no encontrada')
    return item
  }

  /** Formulario público de /p/eliminacion-datos — devuelve solo el acuse de recibo. */
  async create(input: CreateDeletionRequestDTO): Promise<DeletionRequestAck> {
    const requestNumber = generateRequestNumber()
    const item = await this.repo.create({
      requestNumber,
      fullName: input.fullName,
      contactHandle: input.contactHandle,
      email: input.email ?? null,
      hotelName: input.hotelName ?? null,
      status: 'received',
      notes: null,
    } as Omit<DeletionRequestDTO, 'id'>)
    this.logger.info('deletion-requests: solicitud recibida', { requestNumber })
    await this.sockets.onDeletionRequestCreated?.(item)
    await this.notifyRequest(item)
    return { requestNumber: item.requestNumber }
  }

  /**
   * Best-effort: acuse de recibo al solicitante (si dejó correo) + aviso al admin (siempre).
   * Un fallo de email NUNCA debe romper el envío del formulario — el número de solicitud ya
   * quedó guardado en DB, que es la fuente de verdad del plazo de 15 días.
   */
  private async notifyRequest(item: DeletionRequestDTO): Promise<void> {
    if (!this.emailSender) return
    if (item.email) {
      try {
        const ack = buildAckEmail({ fullName: item.fullName, requestNumber: item.requestNumber })
        await this.emailSender.enqueue({
          to: item.email, subject: ack.subject, html: ack.html,
          hotelId: PLATFORM_HOTEL_ID, relatedType: 'deletion-request', relatedId: item.id,
        })
      } catch (e) {
        this.logger.error('deletion-requests: falló el acuse de recibo por email', { error: (e as Error).message, requestNumber: item.requestNumber })
      }
    }
    try {
      const alert = buildAdminAlertEmail({
        requestNumber: item.requestNumber, fullName: item.fullName,
        contactHandle: item.contactHandle, hotelName: item.hotelName,
      })
      await this.emailSender.enqueue({
        to: ADMIN_EMAIL, subject: alert.subject, html: alert.html,
        hotelId: PLATFORM_HOTEL_ID, relatedType: 'deletion-request', relatedId: item.id,
      })
    } catch (e) {
      this.logger.error('deletion-requests: falló el aviso al admin por email', { error: (e as Error).message, requestNumber: item.requestNumber })
    }
  }

  /** Admin: avanza el flujo (status) y/o deja notas internas. Nunca toca los datos del solicitante. */
  async updateStatus(id: string, input: UpdateDeletionRequestDTO): Promise<DeletionRequestDTO> {
    await this.getById(id) // 404 si no existe
    if (input.status !== undefined) assertStatus(input.status)

    const updated = await this.repo.update(id, {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.notes !== undefined && { notes: input.notes }),
    })
    if (!updated) throw new NotFoundError('Solicitud no encontrada')
    this.logger.info('deletion-requests: actualizada', { id, status: updated.status })
    await this.sockets.onDeletionRequestUpdated?.(updated)
    return updated
  }

  async remove(id: string): Promise<void> {
    await this.getById(id)
    await this.repo.delete(id)
    this.logger.info('deletion-requests: eliminada', { id })
  }
}
