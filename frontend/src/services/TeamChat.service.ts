// services/TeamChat.service.ts — Monitor de solo lectura de los chats internos del equipo.
// El admin ve TODAS las conversaciones del hotel (grupal + 1-a-1) vía GET /messages/all.

import { http } from './http'

/** Mensaje crudo tal como lo devuelve el backend. */
export interface MessageDTO {
  id: string
  fromUserId: string
  toUserId: string
  message: string
  photoUrl?: string | null
  isRead: boolean | number
  hotelId: string
  createdAt: string
  updatedAt: string
}

/** Página de mensajes del monitor. Los más recientes primero. Espejo de `messages/usecases/all-conversations.ts`.
 *  #279: `messages`, no `data` — con `data` el envelope del backend la tomaba como lista paginada y tiraba `hasMore`. */
export interface PagedMessages {
  messages: MessageDTO[]
  total: number
  hasMore: boolean
}

export const TeamChatService = {
  /**
   * Trae una PÁGINA de mensajes del hotel (solo managers/admin), los más recientes
   * primero. Antes traía TODOS de una y con muchos chats el panel se colgaba.
   * El cliente pide páginas más viejas al scrollear (`offset`) y agrupa en conversaciones.
   */
  async listAll(offset = 0, limit = 200): Promise<PagedMessages> {
    const res = await http.get<PagedMessages>(`/messages/all?offset=${offset}&limit=${limit}`)
    const body = (res ?? {}) as Partial<PagedMessages>
    const messages = Array.isArray(body.messages) ? body.messages : []
    const total = typeof body.total === 'number' ? body.total : 0
    // #637/#279: el backend ya manda `hasMore` (desde #279 el cuerpo viaja entero en `data`); si un
    // backend viejo no lo trae, se deduce de `offset + messages.length < total`.
    const hasMore = typeof body.hasMore === 'boolean' ? body.hasMore : offset + messages.length < total
    return { messages, total, hasMore }
  },
}
