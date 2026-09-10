export type TicketCategory = 'technical' | 'billing' | 'reservation' | 'housekeeping' | 'maintenance' | 'general'
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'

export interface TicketMessage {
  userId: string
  message: string
  createdAt: string
}

// Resueltos por el SERVIDOR en list/getById (REQ-SOP-01/03, ver usecases/enrich.ts) — el hotel
// no puede resolver estos nombres por su cuenta (el agente puede no pertenecer a su hotel, fuera
// de su propio /api/usuarios). Ausentes en create/update (solo list/getById los completan).
export interface TicketRequester { id: string; name: string; email: string; role: string; active: boolean }
export interface TicketHotelSummary { id: string; name: string }
export interface TicketAssignee { id: string; name: string }

export interface TicketsDTO {
  id: string
  hotelId: string
  userId: string
  subject: string
  category?: TicketCategory
  priority?: TicketPriority
  status?: TicketStatus
  description?: string
  assignedTo?: string
  messages?: TicketMessage[]
  createdAt: string
  updatedAt: string
  requester?: TicketRequester
  hotel?: TicketHotelSummary
  assignee?: TicketAssignee | null
}

export interface CreateTicketsDTO {
  hotelId: string
  userId: string
  subject: string
  category?: TicketCategory
  priority?: TicketPriority
  status?: TicketStatus
  description?: string
  assignedTo?: string
  messages?: TicketMessage[]
}

export interface UpdateTicketsDTO {
  // NOTE: hotelId intentionally NOT here
  // NOTE: userId intentionally NOT here — creator cannot be changed
  subject?: string
  category?: TicketCategory
  priority?: TicketPriority
  status?: TicketStatus
  description?: string
  assignedTo?: string
  messages?: TicketMessage[]
}

export interface TicketsQuery {
  hotelId?: string
  status?: TicketStatus
  category?: TicketCategory
  priority?: TicketPriority
  userId?: string
  assignedTo?: string
  search?: string
  page?: number
  limit?: number
}

export interface TicketsPaginated {
  data: TicketsDTO[]
  total: number
  page?: number
  limit?: number
  pages?: number
}
