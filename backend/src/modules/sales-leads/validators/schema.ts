// sales-leads/validators/schema.ts — Validación de entrada.
import { SALES_LEAD_STATUSES } from '../types'
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

export const SalesLeadsValidator = {
  create: CreateSalesLeadSchema,
  update: UpdateSalesLeadSchema,
}
