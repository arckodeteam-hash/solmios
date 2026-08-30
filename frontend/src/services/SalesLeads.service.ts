// services/SalesLeads.service.ts — Cliente API del módulo backend `sales-leads`
// (leads del formulario "Hablar con Ventas" de la landing):
//   GET    /api/sales-leads            → {data, total} — admin
//   PUT    /api/sales-leads/:id        → SalesLead — admin (solo status/notes)
//   DELETE /api/sales-leads/:id        → 204 — admin
//   POST   /api/public/sales-leads     → {received: true} — público, sin auth

import { http } from './http'
import type {
  SalesLead,
  SalesLeadListResult,
  UpdateSalesLeadInput,
  CreateSalesLeadInput,
  SalesLeadAck,
} from '@/types/sales-leads'

export const SalesLeadsService = {
  list(): Promise<SalesLeadListResult> {
    return http.get<SalesLeadListResult>('/sales-leads')
  },

  update(id: string, input: UpdateSalesLeadInput): Promise<SalesLead> {
    return http.put<SalesLead>(`/sales-leads/${id}`, input)
  },

  remove(id: string): Promise<void> {
    return http.delete<void>(`/sales-leads/${id}`)
  },
}

// ── Público (sin auth, rate-limited) — lo consume el formulario de la landing ──
export const PublicSalesLeads = {
  create(input: CreateSalesLeadInput): Promise<SalesLeadAck> {
    return http.post<SalesLeadAck>('/public/sales-leads', input)
  },
}
