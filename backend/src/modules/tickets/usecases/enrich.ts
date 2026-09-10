// tickets/usecases/enrich.ts — Resuelve solicitante, hotel y agente en el SERVIDOR (REQ-SOP-01/03).
// El hotel no puede resolver el nombre del agente (assignedTo) por su cuenta: el agente puede
// pertenecer a otro hotel/a la plataforma y por lo tanto no aparece en su propio /api/usuarios.
import type { RepositoryAdapter } from 'arckode-framework'
import type { TicketsDTO, TicketRequester, TicketHotelSummary, TicketAssignee } from '../types'
import { normalizeMessages } from './normalize-message'

export interface EnrichTicketsDeps {
  userRepo: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<any>
}

/**
 * Enriquece una página de tickets con `requester`/`hotel`/`assignee`. Una sola consulta a
 * `users` y una a `hotels` para TODA la página (sin N+1, sin importar cuántos tickets/hoteles/
 * usuarios distintos aparezcan) — el resto se resuelve contra Maps en memoria.
 * Un userId/hotelId/assignedTo que no matchea ningún registro NO rompe la página: el campo
 * resuelto queda con nombre vacío ('') en vez de tirar error.
 */
export async function enrichTickets(tickets: TicketsDTO[], deps: EnrichTicketsDeps): Promise<TicketsDTO[]> {
  if (!tickets.length) return []

  const [users, hotels] = await Promise.all([
    deps.userRepo.findMany({}),
    deps.hotelRepo.findMany({}),
  ])

  const userById = new Map<string, any>()
  for (const u of users as any[]) if (u?.id) userById.set(u.id, u)
  const hotelById = new Map<string, any>()
  for (const h of hotels as any[]) if (h?.id) hotelById.set(h.id, h)

  return tickets.map((t) => {
    const requesterUser = userById.get(t.userId)
    const hotelRow = hotelById.get(t.hotelId)
    const assigneeUser = t.assignedTo ? userById.get(t.assignedTo) : undefined

    const requester: TicketRequester = {
      id: t.userId,
      name: requesterUser?.name ?? '',
      email: requesterUser?.email ?? '',
      role: requesterUser?.role ?? '',
      active: requesterUser ? Number(requesterUser.active) !== 0 : false,
    }
    const hotel: TicketHotelSummary = { id: t.hotelId, name: hotelRow?.name ?? '' }
    const assignee: TicketAssignee | null = t.assignedTo ? { id: t.assignedTo, name: assigneeUser?.name ?? '' } : null
    // REQ-SOP-02/04: normaliza la forma vieja { author, date, message } en lectura.
    const messages = normalizeMessages(t.messages)

    return { ...t, requester, hotel, assignee, messages }
  })
}
