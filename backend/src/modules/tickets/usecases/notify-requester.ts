// tickets/usecases/notify-requester.ts — Avisos al SOLICITANTE del ticket tras un cambio.
// - Email (best-effort): se encola vía EmailService solo si el hotel tiene SMTP/Resend
//   configurado. Un fallo del email NUNCA tumba la operación de negocio: se loguea y sigue.
// - Sockets: `onTicketsStatusChanged` se dispara SOLO si un admin de plataforma cambió el status.
// Puerto mínimo por duck typing (mismo patrón que facturas/usecases/email-invoice.ts).

import type { Logger } from 'arckode-framework'
import type { TicketsDTO, TicketMessage, TicketStatus } from '../types'
import type { TicketsSockets, TicketStatusChange } from '../sockets'
import { buildTicketMessageNotice, buildTicketStatusNotice, type TicketNotice } from '../../../shared/usecases/notify-ticket'

/** Lo único que tickets necesita del EmailService. EmailService.enqueue/isConfigured lo cumplen. */
export interface TicketEmailPort {
  enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }): Promise<unknown>
  /** ¿El hotel tiene SMTP o Resend configurado? Si no, el email se encolaría pero nunca se entregaría. */
  isConfigured(hotelId: string): Promise<boolean>
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderTicketNoticeHtml(notice: TicketNotice): string {
  return `<p>${escapeHtml(notice.message)}</p><p><a href="${escapeHtml(notice.link)}">Ver el ticket</a></p>`
}

/**
 * Encola un email al solicitante (ticket.requester.email, resuelto por enrichTickets).
 * No hace nada si no hay puerto, no hay email o el hotel no tiene email configurado.
 * Nunca propaga: el fallo se loguea.
 */
export async function emailRequester(
  port: TicketEmailPort | null,
  ticket: TicketsDTO,
  notice: TicketNotice,
  logger: Logger,
): Promise<void> {
  try {
    const to = ticket.requester?.email
    if (!port || !to) return
    if (!(await port.isConfigured(ticket.hotelId))) return
    await port.enqueue({
      to,
      subject: notice.title,
      html: renderTicketNoticeHtml(notice),
      hotelId: ticket.hotelId,
      relatedType: 'ticket',
      relatedId: ticket.id,
    })
  } catch (e) {
    logger.error('tickets: falló el email al solicitante', { ticketId: ticket.id, error: (e as Error).message })
  }
}

export interface AfterUpdateActor { id: string; name: string; userType?: string }

/**
 * Orquestación post-update del service: socket genérico + (solo si un admin de plataforma
 * cambió el status) socket de estado + email al solicitante.
 */
export async function afterTicketUpdated(
  deps: { sockets: TicketsSockets; emailPort: TicketEmailPort | null; logger: Logger },
  enriched: TicketsDTO,
  previousStatus: TicketStatus | undefined,
  actor: AfterUpdateActor,
): Promise<void> {
  await deps.sockets.onTicketsUpdated?.(enriched)
  const to = enriched.status
  if (!to || to === previousStatus || actor.userType !== 'admin') return
  const change: TicketStatusChange = { from: previousStatus, to, actor }
  await deps.sockets.onTicketsStatusChanged?.(enriched, change)
  await emailRequester(deps.emailPort, enriched, buildTicketStatusNotice(enriched, actor.name, to), deps.logger)
}

/** Orquestación post-addMessage: socket + email al solicitante SOLO si respondió soporte. */
export async function afterTicketMessageAdded(
  deps: { sockets: TicketsSockets; emailPort: TicketEmailPort | null; logger: Logger },
  enriched: TicketsDTO,
  message: TicketMessage,
): Promise<void> {
  await deps.sockets.onTicketsMessageAdded?.(enriched, message)
  if (message.authorKind !== 'support') return
  await emailRequester(deps.emailPort, enriched, buildTicketMessageNotice(enriched, message.authorName, message.message), deps.logger)
}
