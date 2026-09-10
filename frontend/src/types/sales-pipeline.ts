// types/sales-pipeline.ts — Espejo EXACTO de `backend/src/modules/sales-leads/types.ts`
// (SalesPipelineRow / SalesPipelineResult / UpdateSalesProspectDTO) y de la respuesta de
// `POST /api/admin/subscriptions/:hotelId/extend-trial` (#144, #146, #147).
//
// La fila se tipa COMPLETA a propósito: la vista no copia campos por lista blanca (un `.map()`
// que elija claves pierde sin error lo que el backend agregue después).

import type { SalesLeadStatus } from './sales-leads'

export const PIPELINE_STAGES = ['contact', 'registered', 'activated', 'paying', 'expired', 'lost'] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  contact: 'Contacto',
  registered: 'Registrado',
  activated: 'Activado',
  paying: 'Pagando',
  expired: 'Vencido',
  lost: 'Perdido',
}

export const PIPELINE_HEATS = ['hot', 'warm', 'cold'] as const
export type PipelineHeat = (typeof PIPELINE_HEATS)[number]

export const PIPELINE_HEAT_LABELS: Record<PipelineHeat, string> = {
  hot: 'Caliente',
  warm: 'Tibio',
  cold: 'Frío',
}

export const SALES_LOST_REASONS = [
  'no_response', 'price', 'missing_feature', 'chose_competitor', 'not_a_fit', 'other',
] as const
export type SalesLostReason = (typeof SALES_LOST_REASONS)[number]

export const SALES_LOST_REASON_LABELS: Record<SalesLostReason, string> = {
  no_response: 'No respondió',
  price: 'Precio',
  missing_feature: 'Le falta una función',
  chose_competitor: 'Eligió otro sistema',
  not_a_fit: 'No es el perfil',
  other: 'Otro',
}

/** Señales de uso del producto (null en los leads sin hotel). */
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
  subscriptionStatus: string | null
  planId: string | null
  trialEndsAt: string | null
  /** Días hasta `trialEndsAt` (negativo = vencido). Null sin trial. */
  daysLeft: number | null
  signals: PipelineSignals | null
  heatScore: number
  heat: PipelineHeat
  /** Mensaje del formulario (solo leads de contacto). */
  message: string | null
  registeredAt: string | null
  nextStepAt: string | null
  nextStepNote: string | null
  assignedTo: string | null
  contactedAt: string | null
  lostAt: string | null
  lostReason: SalesLostReason | null
  notes: string | null
}

export interface SalesPipelineResult {
  data: SalesPipelineRow[]
  total: number
}

/** Subconjunto editable por PUT /api/admin/sales-pipeline/:key. `null` explícito = limpiar. */
export interface UpdateSalesProspectInput {
  nextStepAt?: string | null
  nextStepNote?: string | null
  assignedTo?: string | null
  contactedAt?: string | null
  lostAt?: string | null
  lostReason?: SalesLostReason | null
  notes?: string | null
}

/** Fila de `sales_prospects` que devuelve el PUT (lo anotado por ventas, no la fila calculada). */
export interface SalesProspect {
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

/** Respuesta de POST /api/admin/subscriptions/:hotelId/extend-trial. */
export interface ExtendTrialResult {
  subscription: {
    id: string
    hotelId: string
    status: string
    trialEndsAt: string | null
    [extra: string]: unknown
  }
  /** Días de prueba que le quedan después de extender (= `days` si estaba vencido). */
  daysLeft: number
  previousTrialEndsAt: string | null
  emailSent: boolean
}

/** Usuario admin de la plataforma que puede quedar como responsable de un prospecto (`users.id`). */
export interface SalesAssignee {
  id: string
  name: string
  email: string
}

/** Respuesta de GET /api/admin/sales-pipeline/assignees. */
export interface SalesAssigneesResult {
  data: SalesAssignee[]
}

// ─── Embudo semanal (#151) — espejo de `backend/src/modules/sales-leads/types.ts` ─────────────

export interface SalesFunnelWeek {
  /** Semana ISO, p.ej. `2026-W37`. */
  week: string
  start: string
  end: string
  registered: number
  activated: number
  paying: number
  lost: Record<SalesLostReason, number>
  lostTotal: number
  /** % con un decimal; 0 sin registrados. */
  activationRate: number
  payingRate: number
}

export interface SalesFunnelResult {
  weeks: SalesFunnelWeek[]
  totals: Omit<SalesFunnelWeek, 'week' | 'start' | 'end'>
  weeksCount: number
  generatedAt: string
}
