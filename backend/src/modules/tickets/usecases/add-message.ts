// tickets/usecases/add-message.ts — Arma el mensaje + el patch a persistir (REQ-SOP-02/03).
// Lógica PURA (sin tocar el repo): el service hace el findById/update, esto valida y decide.
// El autor SIEMPRE sale de `actor` (resuelto por el server desde el JWT/users) — cualquier
// authorKind/authorName que venga en el body del cliente se ignora (no se lee acá).
import { ValidationError, ConflictError, ForbiddenError } from 'arckode-framework'
import type { TicketsDTO, TicketMessage } from '../types'
import { normalizeMessages } from './normalize-message'

export interface AddMessageActor {
  id: string
  /** Nombre real, resuelto por el server (snapshot) — NUNCA el que mande el body. */
  name: string
  role: string
  hotelId?: string
  userType?: string
}

export type TicketMessagePatch = Partial<Pick<TicketsDTO, 'messages' | 'assignedTo' | 'status'>>

export interface AddMessageResult {
  message: TicketMessage
  patch: TicketMessagePatch
}

const MIN_LEN = 1
const MAX_LEN = 4000

/**
 * Valida ownership/estado/longitud y arma el mensaje a agregar + el patch del ticket.
 * - hotel de otro hotel → ForbiddenError (403)
 * - ticket cerrado → ConflictError (409)
 * - message vacío (tras trim) o > 4000 → ValidationError (400)
 * - primer mensaje de un AGENTE (`authorKind: 'support'`) sobre un ticket 'open' sin agente
 *   asignado → auto-asigna y pasa a 'in_progress'. Si ya tenía agente, no se lo roba un
 *   segundo agente (el patch no toca assignedTo/status).
 */
export function buildAddMessage(ticket: TicketsDTO, rawMessage: string, actor: AddMessageActor): AddMessageResult {
  if (actor.role !== 'super_admin' && ticket.hotelId !== actor.hotelId) {
    throw new ForbiddenError('No autorizado')
  }
  if (ticket.status === 'closed') {
    throw new ConflictError('El ticket está cerrado')
  }
  const trimmed = (rawMessage ?? '').trim()
  if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) {
    throw new ValidationError(`El mensaje debe tener entre ${MIN_LEN} y ${MAX_LEN} caracteres`)
  }

  const authorKind: TicketMessage['authorKind'] = actor.userType === 'admin' ? 'support' : 'hotel'
  const message: TicketMessage = {
    id: crypto.randomUUID(),
    authorId: actor.id,
    authorName: actor.name,
    authorKind,
    message: trimmed,
    createdAt: new Date().toISOString(),
  }

  const patch: TicketMessagePatch = { messages: [...normalizeMessages(ticket.messages), message] }

  if (authorKind === 'support' && ticket.status === 'open' && !ticket.assignedTo) {
    patch.assignedTo = actor.id
    patch.status = 'in_progress'
  }

  return { message, patch }
}
