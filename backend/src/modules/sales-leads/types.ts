// sales-leads/types.ts — Contratos de API del módulo (≠ model.ts, que es BD).

export const SALES_LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'] as const
export type SalesLeadStatus = (typeof SALES_LEAD_STATUSES)[number]

export const STATUS_LABELS: Record<SalesLeadStatus, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  won: 'Ganado',
  lost: 'Perdido',
}

/** Fila completa — solo para el admin. */
export interface SalesLeadDTO {
  id: string
  fullName: string
  email: string
  phone: string | null
  hotelName: string | null
  roomsRange: string | null
  message: string | null
  planInterest: string | null
  status: SalesLeadStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** Lo que llena el visitante en el formulario de la landing. */
export interface CreateSalesLeadDTO {
  fullName: string
  email: string
  phone?: string
  hotelName?: string
  roomsRange?: string
  message?: string
  planInterest?: string
}

/** Lo que puede tocar el admin: solo status/notes (nunca los datos del lead). */
export interface UpdateSalesLeadDTO {
  status?: SalesLeadStatus
  notes?: string
}

/** Respuesta pública al enviar el formulario. */
export interface SalesLeadAck {
  received: true
}

export interface SalesLeadListResult {
  data: SalesLeadDTO[]
  total: number
}
