// connectors/tickets-notificaciones.ts — Wire: tickets → notificaciones (campanita del hotel).
//
// El hotel tiene que enterarse cuando SOPORTE le responde o le cambia el estado del ticket.
// `tickets` no puede importar `notificaciones` (regla: un módulo no importa a otro), así que el
// connector engancha los sockets y delega. Texto y decisión de qué avisar viven en
// shared/usecases/notify-ticket (mismo patrón que mantenimiento-notificaciones).
//
// Best-effort: un fallo de notificaciones.create NUNCA tumba la respuesta ni el cambio de estado
// (ya persistidos cuando corre el socket) — se loguea y no propaga.

import type { ConnectorContext, Logger } from 'arckode-framework'
import {
  notifyTicketMessage,
  notifyTicketStatus,
  type NotificacionesPort,
  type TicketLike,
  type TicketMessageLike,
  type TicketStatusChangeLike,
} from '../shared/usecases/notify-ticket'

export function ticketsNotificacionesConnector(logger: Logger): (ctx: ConnectorContext) => void {
  return (ctx: ConnectorContext) => {
    const tickets = ctx.resolveModule<{ setSockets: (s: any) => void }>('tickets')

    /** Se resuelve en cada aviso (no al cablear): si notificaciones no está, el ticket igual sigue. */
    const swallow = async (ticket: TicketLike, event: string, run: (port: NotificacionesPort) => Promise<void>): Promise<void> => {
      try {
        await run(ctx.resolveModule<NotificacionesPort>('notificaciones'))
      } catch (e) {
        logger.error('tickets: falló el aviso in-app al hotel', { ticketId: ticket.id, hotelId: ticket.hotelId, event, error: (e as Error).message })
      }
    }

    tickets.setSockets({
      // Solo cuando escribe soporte: lo decide notifyTicketMessage (authorKind 'support').
      onTicketsMessageAdded: (ticket: TicketLike, message: TicketMessageLike) =>
        swallow(ticket, 'message', (port) => notifyTicketMessage(port, ticket, message)),
      // El service ya filtra: solo dispara si un admin de plataforma cambió el status.
      onTicketsStatusChanged: (ticket: TicketLike, change: TicketStatusChangeLike) =>
        swallow(ticket, 'status', (port) => notifyTicketStatus(port, ticket, change)),
    })
  }
}
