// tickets/sockets.ts — Hooks OPCIONALES hacia otros módulos
// Los sockets son opcionales. El módulo funciona sin ellos.
// Un conector puede pasar sockets para reaccionar a eventos del módulo.

import type { TicketsDTO, TicketMessage, TicketStatus } from './types'

/** Cambio de estado de un ticket hecho por un usuario de PLATAFORMA (userType 'admin'). */
export interface TicketStatusChange {
  from?: TicketStatus
  to: TicketStatus
  /** Agente que hizo el cambio: nombre REAL resuelto por el server (nunca el del body). */
  actor: { id: string; name: string; userType?: string }
}

export interface TicketsSockets {
  onTicketsCreated?: (data: TicketsDTO) => Promise<void>
  /** Se invoca con el ticket YA actualizado y YA enriquecido (requester/hotel/assignee). */
  onTicketsUpdated?: (data: TicketsDTO) => Promise<void>
  onTicketsDeleted?: (id: string) => Promise<void>
  /** Se invoca con el ticket YA actualizado (y enriquecido) y el mensaje YA persistido (REQ-SOP-02). */
  onTicketsMessageAdded?: (ticket: TicketsDTO, message: TicketMessage) => Promise<void>
  /**
   * Se invoca SOLO cuando un usuario de plataforma (userType 'admin') cambia el `status` del
   * ticket a un valor distinto del actual — un merchant cambiando su propio ticket NO dispara
   * este hook. Recibe el ticket YA enriquecido (requester/hotel/assignee resueltos).
   */
  onTicketsStatusChanged?: (ticket: TicketsDTO, change: TicketStatusChange) => Promise<void>
}
