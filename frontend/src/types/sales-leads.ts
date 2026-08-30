// types/sales-leads.ts — Espejo del contract del módulo backend sales-leads
// (leads del formulario "Hablar con Ventas" / "Contactar ventas" de la landing).

export const SALES_LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'] as const
export type SalesLeadStatus = (typeof SALES_LEAD_STATUSES)[number]

export const STATUS_LABELS: Record<SalesLeadStatus, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  won: 'Ganado',
  lost: 'Perdido',
}

export interface SalesLead {
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

export interface SalesLeadListResult {
  data: SalesLead[]
  total: number
}

export interface UpdateSalesLeadInput {
  status?: SalesLeadStatus
  notes?: string
}

// ── Público (formulario de la landing, sin auth) ──
export interface CreateSalesLeadInput {
  fullName: string
  email: string
  phone?: string
  hotelName?: string
  roomsRange?: string
  message?: string
  planInterest?: string
}

export interface SalesLeadAck {
  received: true
}
