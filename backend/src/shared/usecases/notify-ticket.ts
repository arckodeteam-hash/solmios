// shared/usecases/notify-ticket.ts — Avisos de soporte (tickets) al hotel.
//
// Texto y decisión de qué aviso mandar por cada evento viven acá; el connector
// `tickets-notificaciones` solo delega (regla: connectors solo wirean). Mismo patrón que
// notify-maintenance.ts: funciones puras sobre un puerto mínimo, sin import cross-módulo
// (el ticket se describe estructuralmente, no se importa de modules/tickets/types).

export interface NotificacionesPort {
  create(dto: Record<string, unknown>, user: { id: string; role: string; hotelId: string }): Promise<unknown>
}

/** Forma mínima del ticket que necesita este usecase (estructural, ver TicketsDTO). */
export interface TicketLike {
  id: string
  hotelId: string
  subject: string
  status?: string
}

export interface TicketMessageLike {
  authorName: string
  authorKind: 'support' | 'hotel'
  message: string
}

export interface TicketStatusChangeLike {
  from?: string
  to: string
  actor: { id: string; name: string; userType?: string }
}

export type TicketNotice = { title: string; message: string; link: string }

const STATUS_LABELS: Record<string, string> = {
  open: 'Abierto',
  in_progress: 'En progreso',
  resolved: 'Resuelto',
  closed: 'Cerrado',
}

const DEFAULT_AGENT = 'Soporte'
const MESSAGE_PREVIEW_LEN = 140

const sysUserFor = (hotelId: string) => ({ id: 'system', role: 'super_admin', hotelId })

export function ticketStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function ticketLink(ticket: Pick<TicketLike, 'id'>): string {
  return `/panel/support?ticket=${ticket.id}`
}

function agentLabel(agentName: string | undefined): string {
  const name = (agentName ?? '').trim()
  return name || DEFAULT_AGENT
}

function preview(text: string): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > MESSAGE_PREVIEW_LEN ? `${flat.slice(0, MESSAGE_PREVIEW_LEN - 1)}…` : flat
}

/** Un agente respondió el ticket. */
export function buildTicketMessageNotice(ticket: TicketLike, agentName: string | undefined, text?: string): TicketNotice {
  const agent = agentLabel(agentName)
  return {
    title: `${agent} respondió tu ticket «${ticket.subject}»`,
    message: preview(text ?? '') || `${agent} dejó una respuesta en tu ticket.`,
    link: ticketLink(ticket),
  }
}

/** Un agente cambió el estado del ticket. */
export function buildTicketStatusNotice(ticket: TicketLike, agentName: string | undefined, status: string): TicketNotice {
  const agent = agentLabel(agentName)
  const label = ticketStatusLabel(status)
  return {
    title: `${agent} marcó tu ticket «${ticket.subject}» como ${label}`,
    message: `Tu ticket «${ticket.subject}» ahora está ${label}.`,
    link: ticketLink(ticket),
  }
}

async function createSupportNotice(port: NotificacionesPort, ticket: TicketLike, notice: TicketNotice, agentName: string): Promise<void> {
  // Sin userId: broadcast al hotel (como notify-maintenance). Errores NO se tragan acá — el
  // connector decide (los loguea y no propaga).
  await port.create({
    hotelId: ticket.hotelId,
    type: 'support',
    title: notice.title,
    message: notice.message,
    read: 0,
    date: new Date().toISOString(),
    metadata: { ticketId: ticket.id, link: notice.link, agentName },
  }, sysUserFor(ticket.hotelId))
}

/** Mensaje nuevo: avisa al hotel SOLO si lo escribió soporte (authorKind 'support'). */
export async function notifyTicketMessage(port: NotificacionesPort, ticket: TicketLike, message: TicketMessageLike): Promise<void> {
  if (message.authorKind !== 'support') return
  const agentName = agentLabel(message.authorName)
  await createSupportNotice(port, ticket, buildTicketMessageNotice(ticket, agentName, message.message), agentName)
}

/** Cambio de estado hecho por soporte: avisa al hotel. */
export async function notifyTicketStatus(port: NotificacionesPort, ticket: TicketLike, change: TicketStatusChangeLike): Promise<void> {
  const agentName = agentLabel(change.actor.name)
  await createSupportNotice(port, ticket, buildTicketStatusNotice(ticket, agentName, change.to), agentName)
}
