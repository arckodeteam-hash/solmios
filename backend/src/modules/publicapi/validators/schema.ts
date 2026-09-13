// publicapi/validators/schema.ts — Validación de entrada de la API pública v1.

import type { ValidationRule } from 'arckode-framework'

export const CreatePublicReservationSchema: Record<string, ValidationRule> = {
  // REQ-HAC-05 (#260): la API vende un TIPO de habitación. `roomId` pasó a ser opcional (la unidad
  // se asigna en recepción, assign-room); sin `roomId` hace falta `roomType`. La regla cruzada
  // "al menos uno" no la expresa el DSL: la aplica `createPublicReservation` (400 si faltan ambos).
  roomId: { type: 'string' as const },
  roomType: { type: 'string' as const, max: 50 },
  checkIn: { type: 'string' as const, required: true },
  checkOut: { type: 'string' as const, required: true },
  adults: { type: 'number' as const, min: 1 },
  children: { type: 'number' as const, min: 0 },
  totalAmount: { type: 'number' as const, required: true, min: 0 },
  currency: { type: 'string' as const, max: 10 },
  notes: { type: 'string' as const, max: 1000 },
  guestName: { type: 'string' as const, required: true, min: 2, max: 200 },
  guestEmail: { type: 'string' as const, max: 200 },
  guestPhone: { type: 'string' as const, max: 50 },
}

export const PublicapiValidator = { createReservation: CreatePublicReservationSchema }
