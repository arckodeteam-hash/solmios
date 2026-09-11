// cash/validators/schema.ts — Validación de entrada (esquemas planos).

import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'

// hotelId NO va en el schema del body — el service lo fuerza desde el JWT (P0 IDOR).
// #212: el concepto es OBLIGATORIO (mín. 3 caracteres) en un movimiento manual — quedaban egresos
// de 500 sin decir para qué. Los automáticos (conectores) no pasan por acá: traen su concepto.
export const CreateMovementSchema: Record<string, ValidationRule> = {
  type: { type: 'string' as const, required: true },        // income | expense (enum validado en service)
  amount: { type: 'number' as const, required: true, min: 0 },
  method: { type: 'string' as const },
  concept: { type: 'string' as const, required: true, min: 3, message: 'Indicá el concepto' },
  category: { type: 'string' as const },
  guestName: { type: 'string' as const },
  roomNumber: { type: 'string' as const },
  reservationId: { type: 'string' as const },
  folioId: { type: 'string' as const },
  reference: { type: 'string' as const },
  notes: { type: 'text' as const },
}

export const UpdateMovementSchema: Record<string, ValidationRule> = {
  type: { type: 'string' as const },
  amount: { type: 'number' as const, min: 0 },
  method: { type: 'string' as const },
  concept: { type: 'string' as const, min: 3 },
  category: { type: 'string' as const },
  guestName: { type: 'string' as const },
  roomNumber: { type: 'string' as const },
  reference: { type: 'string' as const },
  notes: { type: 'text' as const },
}

export const OpenShiftSchema: Record<string, ValidationRule> = {
  openingAmount: { type: 'number' as const, min: 0 },
  notes: { type: 'text' as const },
}

export const CloseShiftSchema: Record<string, ValidationRule> = {
  countedAmount: { type: 'number' as const, required: true, min: 0 },
  denominations: { type: 'string' as const },   // JSON string
  notes: { type: 'text' as const },
}

export const CashValidator = {
  createMovement: CreateMovementSchema,
  updateMovement: UpdateMovementSchema,
  openShift: OpenShiftSchema,
  closeShift: CloseShiftSchema,
}
