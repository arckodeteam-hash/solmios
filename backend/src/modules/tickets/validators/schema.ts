import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'

const CATEGORY_ENUM = ['technical', 'billing', 'reservation', 'housekeeping', 'maintenance', 'general']
const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent']
const STATUS_ENUM = ['open', 'in_progress', 'resolved', 'closed']

export const CreateTicketsSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  userId: { type: 'string' as const, required: true },
  subject: { type: 'string' as const, required: true, min: 2, max: 200 },
  category: { type: 'string' as const, enum: CATEGORY_ENUM },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM },
  status: { type: 'string' as const, enum: STATUS_ENUM },
  description: { type: 'string' as const, max: 5000 },
  assignedTo: { type: 'string' as const, max: 100 },
  messages: { type: 'array' as const },
}

export const UpdateTicketsSchema: Record<string, ValidationRule> = {
  subject: { type: 'string' as const, min: 2, max: 200 },
  category: { type: 'string' as const, enum: CATEGORY_ENUM },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM },
  status: { type: 'string' as const, enum: STATUS_ENUM },
  description: { type: 'string' as const, max: 5000 },
  assignedTo: { type: 'string' as const, max: 100 },
  // REQ-SOP-02: messages NO es escribible por PUT — se agrega solo vía
  // POST /api/tickets/:id/messages (AddMessageSchema, más abajo).
}

// REQ-SOP-02: `type: 'text'` trimea antes de medir longitud (shared/validators/validate-body.ts)
// — cubre "1..4000 tras trim" a nivel schema; el usecase (add-message.ts) repite el chequeo
// porque es lógica pura testeada sin pasar por el controller.
export const AddMessageSchema: Record<string, ValidationRule> = {
  message: { type: 'text' as const, required: true, min: 1, max: 4000 },
}

export const TicketsValidator = { create: CreateTicketsSchema, update: UpdateTicketsSchema }
