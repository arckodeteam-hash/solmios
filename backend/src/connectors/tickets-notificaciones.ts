// connectors/tickets-notificaciones.ts — Wire: tickets → notificaciones (REQ-SOP-06)
// Solo delega. La lógica de cada aviso vive en shared/usecases/notify-ticket, incluido el
// fallo tragado: `notificaciones` se resuelve DIFERIDO dentro del usecase, así un módulo no
// montado o un repo que lanza se loguea y el mensaje/cambio del ticket ya guardado no se rompe.
import type { ConnectorContext } from 'arckode-framework'
import type { TicketsDTO, TicketMessage } from '../modules/tickets/types'
import type { TicketsUpdateContext } from '../modules/tickets/sockets'
import { notifyTicketMessageAdded, notifyTicketUpdated, type NotificacionesPort } from '../shared/usecases/notify-ticket'

export function ticketsNotificacionesConnector(ctx: ConnectorContext): void {
  const tickets = ctx.resolveModule<{ setSockets: (s: any) => void }>('tickets')
  const notificaciones = () => ctx.resolveModule<NotificacionesPort>('notificaciones')

  tickets.setSockets({
    onTicketsMessageAdded: async (ticket: TicketsDTO, message: TicketMessage) => {
      await notifyTicketMessageAdded(notificaciones, ticket, message)
    },
    onTicketsUpdated: async (ticket: TicketsDTO, change?: TicketsUpdateContext) => {
      await notifyTicketUpdated(notificaciones, ticket, change)
    },
  })
}
