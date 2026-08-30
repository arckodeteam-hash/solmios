// deletion-requests/validators/schema.ts — Validación de entrada.
import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'
import { DELETION_REQUEST_STATUSES } from '../types'

export const CreateDeletionRequestSchema: Record<string, ValidationRule> = {
  fullName: { type: 'string' as const, required: true, min: 2, max: 200 },
  contactHandle: { type: 'string' as const, required: true, min: 3, max: 100 },
  hotelName: { type: 'string' as const, max: 200 },
  // Opcional — sin esto no hay a quién mandarle el acuse de recibo por correo.
  email: { type: 'email' as const },
}

export const UpdateDeletionRequestSchema: Record<string, ValidationRule> = {
  status: { type: 'string' as const, enum: [...DELETION_REQUEST_STATUSES] },
  notes: { type: 'string' as const, max: 2000 },
}

export const DeletionRequestsValidator = {
  create: CreateDeletionRequestSchema,
  update: UpdateDeletionRequestSchema,
}
