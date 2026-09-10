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

// ─── Pipeline de ventas (REQ-PIPE-01..03) ───────────────────────────────────────────────

export const SALES_LOST_REASONS = [
  'no_response', 'price', 'missing_feature', 'chose_competitor', 'not_a_fit', 'other',
] as const
export type SalesLostReason = (typeof SALES_LOST_REASONS)[number]

/** Fila de `sales_prospects` — lo que ventas anota (model.ts es la BD; esto es el contrato). */
export interface SalesProspectDTO {
  id: string
  hotelId: string | null
  leadId: string | null
  nextStepAt: string | null
  nextStepNote: string | null
  assignedTo: string | null
  contactedAt: string | null
  lostAt: string | null
  lostReason: SalesLostReason | null
  notes: string | null
  sequenceSent: Record<string, string>
  createdAt: string
  updatedAt: string
}

/** Subconjunto editable por PUT /api/admin/sales-pipeline/:key. `null` explícito = limpiar. */
export interface UpdateSalesProspectDTO {
  nextStepAt?: string | null
  nextStepNote?: string | null
  assignedTo?: string | null
  contactedAt?: string | null
  lostAt?: string | null
  lostReason?: SalesLostReason | null
  notes?: string | null
}

/** Etapa CALCULADA (nunca guardada) — ver `usecases/pipeline.ts`. */
export type PipelineStage = 'contact' | 'registered' | 'activated' | 'paying' | 'expired' | 'lost'
export type PipelineHeat = 'hot' | 'warm' | 'cold'

/** Señales de uso del producto, todas por `hotelId`. Null en los leads sin hotel. */
export interface PipelineSignals {
  rooms: number
  rates: number
  channels: number
  reservations: number
  lastActivityAt: string | null
}

export interface SalesPipelineRow {
  /** `hotel:<id>` | `lead:<id>` — la clave del PUT. */
  key: string
  hotelId: string | null
  leadId: string | null
  hotelName: string | null
  ownerName: string | null
  email: string | null
  phone: string | null
  /** `https://wa.me/<E.164>` o null si el teléfono no da para un E.164 creíble. */
  whatsappUrl: string | null
  stage: PipelineStage
  /** Estado crudo de `sales_leads.status` (null en hoteles). `lost` ya se refleja en `stage`. */
  leadStatus: SalesLeadStatus | null
  /** Estado crudo de `subscriptions` (null en leads). */
  subscriptionStatus: string | null
  planId: string | null
  trialEndsAt: string | null
  /** Días hasta `trialEndsAt` (negativo = vencido). Null sin trial. */
  daysLeft: number | null
  signals: PipelineSignals | null
  /** Puntaje crudo del calor (para depurar/ordenar); `heat` es su etiqueta. */
  heatScore: number
  heat: PipelineHeat
  /** Mensaje del formulario (solo leads de contacto). */
  message: string | null
  /** Alta del hotel o del lead (ISO). */
  registeredAt: string | null
  nextStepAt: string | null
  nextStepNote: string | null
  assignedTo: string | null
  contactedAt: string | null
  lostAt: string | null
  lostReason: SalesLostReason | null
  notes: string | null
}

/** `{ data, total }`: es lo que el envelope del framework reconoce como listado (cualquier otra
 *  clave al lado de `data`+`total` se pierde en `buildEnvelope`, kernel/http/server.ts). */
export interface SalesPipelineResult {
  data: SalesPipelineRow[]
  total: number
}
