// messages/usecases/all-conversations.ts — Monitor de chats del hotel, PAGINADO.
//
// Antes el monitor del admin traía TODOS los mensajes del hotel de una: con muchos
// chats la respuesta explotaba y el panel se colgaba. Ahora devuelve los más
// RECIENTES primero, de a `limit`; el cliente pide páginas más viejas al scrollear
// (`offset`). El agrupado en conversaciones lo sigue haciendo el cliente sobre lo
// que va cargando.

import type { RepositoryAdapter } from 'arckode-framework'
import type { MessageDTO, MessageUser } from '../types'

const DEFAULT_PAGE = 200
const MAX_PAGE = 500

const isManager = (role: string) => role === 'hotel_admin' || role === 'super_admin'

// #279: `messages`, no `data`. Con `{ data: [], total, hasMore }` el envelope del framework (buildEnvelope,
// kernel/http/server.ts) lo toma como lista paginada y DESCARTA `hasMore` (solo sobrevive `total` en
// meta.pagination). Con otra clave el cuerpo se envuelve entero y el cliente lee las tres.
export interface PagedMessages {
  messages: MessageDTO[]
  total: number
  hasMore: boolean
}

export async function listAllPaged(
  repo: RepositoryAdapter<MessageDTO>,
  currentUser: MessageUser,
  opts: { limit?: number; offset?: number } = {},
): Promise<PagedMessages> {
  if (!isManager(currentUser.role)) return { messages: [], total: 0, hasMore: false }
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_PAGE, 1), MAX_PAGE)
  const offset = Math.max(opts.offset ?? 0, 0)
  const result = await repo.paginate(
    { hotelId: currentUser.hotelId },
    { offset, limit, orderBy: { field: 'createdAt', dir: 'DESC' } },
  )
  return {
    messages: result.data,
    total: result.total,
    hasMore: offset + result.data.length < result.total,
  }
}
