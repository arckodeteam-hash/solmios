// shared/usecases/notify-ticket.ts — Avisos al hotel sobre su ticket de soporte (REQ-SOP-06).
//
// La lógica de qué aviso mandar por cada evento vive acá; el connector
// `tickets-notificaciones` solo delega (regla: connectors solo wirean).
// Sin `userId` la notificación es broadcast al hotel: todo su staff se entera de la
// respuesta del agente sin tener que entrar a /panel/support.

import type { TicketsDTO, TicketMessage } from '../../modules/tickets/types'
import type { TicketsUpdateContext } from '../../modules/tickets/sockets'
import type { NotificacionesPort } from './notify-maintenance'

export type { NotificacionesPort }

/** El connector pasa el resolve del módulo diferido: si `notificaciones` no está montado, el error
 *  cae dentro del mismo try que el create y el aviso se pierde con log, no rompe la operación. */
export type NotificacionesResolver = () => NotificacionesPort

const sysUserFor = (hotelId: string) => ({ id: 'system', role: 'super_admin', hotelId })

/** Estado legible para el título del aviso. */
export const STATUS_LABELS: Record<string, string> = {
  open: 'Abierto',
  in_progress: 'En progreso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
}

/** Ruta interna que abre el ticket en el panel del hotel (el frontend rutea `metadata.link`). */
export const ticketLink = (id: string) => `/panel/support?ticket=${id}`

const PREVIEW_MAX = 140

/** Recorte del cuerpo del mensaje para el aviso: una línea, no el mensaje entero. */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : flat
}

// Los sockets se awaitean dentro de addMessage/update: si esto lanzara, el mensaje o el cambio
// ya quedaron guardados pero el endpoint devolvería 500 (mismo criterio que auditSafely).
// Un aviso que no sale se loguea, nunca rompe la operación principal.
async function createSafely(
  resolve: NotificacionesResolver,
  ticketId: string,
  event: 'message' | 'status',
  dto: Record<string, unknown>,
  hotelId: string,
): Promise<void> {
  try {
    await resolve().create(dto, sysUserFor(hotelId))
  } catch (err) {
    console.error(`[tickets-notificaciones] no se pudo avisar al hotel (ticket=${ticketId} evento=${event}):`, err instanceof Error ? err.message : err)
  }
}

/** Mensaje nuevo en el ticket: avisa al hotel SOLO si lo escribió soporte (lo suyo ya lo vio). */
export async function notifyTicketMessageAdded(notificaciones: NotificacionesResolver, ticket: TicketsDTO, message: TicketMessage): Promise<void> {
  if (message.authorKind !== 'support') return
  const agente = message.authorName?.trim() || 'Soporte'
  await createSafely(notificaciones, ticket.id, 'message', {
    hotelId: ticket.hotelId,
    type: 'system',
    title: `${agente} respondió tu ticket «${ticket.subject}»`,
    message: preview(message.message ?? ''),
    read: 0,
    date: new Date().toISOString(),
    metadata: { ticketId: ticket.id, link: ticketLink(ticket.id), event: 'message', agentId: message.authorId },
  }, ticket.hotelId)
}

/** Ticket actualizado: avisa al hotel SOLO si un admin (agente) le cambió el estado. */
export async function notifyTicketUpdated(notificaciones: NotificacionesResolver, ticket: TicketsDTO, change?: TicketsUpdateContext): Promise<void> {
  if (!change) return
  if (change.actor.userType !== 'admin') return // cambio hecho por el propio hotel
  if (ticket.status === change.previous.status) return // no cambió el estado
  const agente = change.actor.name?.trim() || 'Soporte'
  const status = ticket.status ?? ''
  await createSafely(notificaciones, ticket.id, 'status', {
    hotelId: ticket.hotelId,
    type: 'system',
    title: `${agente} marcó tu ticket «${ticket.subject}» como ${STATUS_LABELS[status] ?? status}`,
    read: 0,
    date: new Date().toISOString(),
    metadata: { ticketId: ticket.id, link: ticketLink(ticket.id), event: 'status', status, agentId: change.actor.id },
  }, ticket.hotelId)
}
