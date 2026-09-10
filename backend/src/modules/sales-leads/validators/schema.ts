// sales-leads/validators/schema.ts — Validación de entrada.
import { SALES_LEAD_STATUSES, SALES_LOST_REASONS } from '../types'
import type { BodySchema } from '../../../shared/validators/validate-body'

export const CreateSalesLeadSchema: BodySchema = {
  fullName: { type: 'string' as const, required: true, min: 2, max: 200 },
  email: { type: 'email' as const, required: true },
  phone: { type: 'string' as const, max: 50 },
  hotelName: { type: 'string' as const, max: 200 },
  roomsRange: { type: 'string' as const, max: 50 },
  // `text`, no `string`: el mensaje puede ser multilínea y `string` aplasta los saltos de línea.
  message: { type: 'text' as const, max: 2000 },
  planInterest: { type: 'string' as const, max: 50 },
}

export const UpdateSalesLeadSchema: BodySchema = {
  status: { type: 'string' as const, enum: [...SALES_LEAD_STATUSES] },
  notes: { type: 'text' as const, max: 2000 },
}

// PUT /api/admin/sales-pipeline/:key — cualquier subconjunto. Un campo en `null` explícito lo
// limpia (validateSchema descarta los null: el controller los re-inyecta del body crudo).
export const UpdateProspectSchema: BodySchema = {
  nextStepAt: { type: 'date' as const },
  nextStepNote: { type: 'string' as const, max: 500 },
  assignedTo: { type: 'string' as const, max: 100 },
  contactedAt: { type: 'date' as const },
  lostAt: { type: 'date' as const },
  lostReason: { type: 'string' as const, enum: [...SALES_LOST_REASONS] },
  notes: { type: 'text' as const, max: 5000 },
}

/** Campos del PUT que aceptan `null` explícito para limpiar. */
export const PROSPECT_CLEARABLE_FIELDS = Object.keys(UpdateProspectSchema) as ReadonlyArray<keyof typeof UpdateProspectSchema>

export const SalesLeadsValidator = {
  create: CreateSalesLeadSchema,
  update: UpdateSalesLeadSchema,
  updateProspect: UpdateProspectSchema,
}
