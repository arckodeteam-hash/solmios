// tickets/sockets.ts — Hooks OPCIONALES hacia otros módulos
// Los sockets son opcionales. El módulo funciona sin ellos.
// Un conector puede pasar sockets para reaccionar a eventos del módulo.

import type { TicketsDTO, TicketMessage } from './types'

/** Quién y desde qué estado se hizo el update. name resuelto por el server (el JWT no lo trae). */
export interface TicketsUpdateActor { id: string; name: string; role: string; hotelId?: string; userType?: string }
export interface TicketsUpdateContext { previous: TicketsDTO; actor: TicketsUpdateActor }

export interface TicketsSockets {
  onTicketsCreated?: (data: TicketsDTO) => Promise<void>
  /** `change` es opcional para no romper a los connectors que sólo miran el ticket (REQ-SOP-06). */
  onTicketsUpdated?: (data: TicketsDTO, change?: TicketsUpdateContext) => Promise<void>
  onTicketsDeleted?: (id: string) => Promise<void>
  /** Se invoca con el ticket YA actualizado y el mensaje YA persistido (REQ-SOP-02). */
  onTicketsMessageAdded?: (ticket: TicketsDTO, message: TicketMessage) => Promise<void>
}
