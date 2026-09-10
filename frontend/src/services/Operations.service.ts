import { http } from './http'
import type { SupportTicket, SupportTicketsListResponse, TicketStatus, TicketCategory, TicketPriority } from '@/types'

interface List { data: any[]; total: number }

const makeCrud = (path: string) => ({
  list: (hotelId?: string) => http.get<List>(`/${path}${hotelId ? `?hotelId=${hotelId}` : ''}`),
  create: (data: any) => http.post(`/${path}`, data),
  update: (id: string, data: any) => http.put(`/${path}/${id}`, data),
  delete: (id: string, hotelId?: string) => http.delete(`/${path}/${id}${hotelId ? `?hotelId=${hotelId}` : ''}`),
  post: (idPath: string, data: any) => http.post(`/${path}/${idPath}`, data),
  put: (idPath: string, data: any) => http.put(`/${path}/${idPath}`, data),
  get: (idPath: string) => http.get(`/${path}/${idPath}`),
})

/** Campos que el PUT de un ticket acepta de verdad (backend/tickets/types.ts UpdateTicketsDTO) —
 *  `messages` NO está: se agrega solo por POST /tickets/:id/messages (ver addMessage, REQ-SOP-02). */
export interface UpdateTicketPayload {
  status?: TicketStatus
  subject?: string
  category?: TicketCategory
  priority?: TicketPriority
  description?: string
  assignedTo?: string
}

export const OperationsService = {
  mantenimiento: makeCrud('mantenimiento'),
  tickets: {
    ...makeCrud('tickets'),
    list: (hotelId?: string, params?: { page?: number; limit?: number }): Promise<SupportTicketsListResponse> => {
      const query = new URLSearchParams()
      if (hotelId) query.set('hotelId', hotelId)
      if (params?.page) query.set('page', String(params.page))
      if (params?.limit) query.set('limit', String(params.limit))
      const qs = query.toString()
      return http.get<SupportTicketsListResponse>(`/tickets${qs ? `?${qs}` : ''}`)
    },
    update: (id: string, data: UpdateTicketPayload): Promise<SupportTicket> => http.put<SupportTicket>(`/tickets/${id}`, data),
    /** REQ-SOP-02: único camino para agregar un mensaje — el autor lo resuelve el server. */
    addMessage: (id: string, message: string): Promise<SupportTicket> => http.post<SupportTicket>(`/tickets/${id}/messages`, { message }),
  },
  grupos: makeCrud('grupos'),
  dispositivos: (hotelId?: string) => http.get<List>(`/dispositivos${hotelId ? `?hotelId=${hotelId}` : ''}`),
  planning: (hotelId?: string) => http.get<any>(`/planning${hotelId ? `?hotelId=${hotelId}` : ''}`),
  nightAudit: (hotelId?: string) => http.get<any>(`/night-audit${hotelId ? `?hotelId=${hotelId}` : ''}`),
  nightAuditRun: (hotelId?: string) => http.post<any>('/folios/audit/post-room-charges', { hotelId }),
}
