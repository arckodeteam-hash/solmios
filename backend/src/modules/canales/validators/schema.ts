// canales/validators/schema.ts — Validación de entrada
// Schemas planos, sin dependencias externas.

import type { ValidationRule } from 'arckode-framework'
import { CHANNEL_REQUEST_STATUSES, CHANNEL_REQUEST_MEDIUMS } from '../usecases/channel-requests'

export const CreateCanalesSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true, min: 1, max: 200 },
  channexPropertyId: { type: 'string' as const, max: 200 },
  syncEnabled: { type: 'number' as const },
}

export const UpdateCanalesSchema: Record<string, ValidationRule> = {
  channexPropertyId: { type: 'string' as const, max: 200 },
  syncEnabled: { type: 'number' as const },
    lastSync: { type: 'string' as const },
}

export const CanalesValidator = {
  create: CreateCanalesSchema,
  update: UpdateCanalesSchema,
}

export const TestConnectionSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  channel: { type: 'string' as const, required: true },
  hotel_id: { type: 'string' as const },
}

export const ConnectOTASchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  channel: { type: 'string' as const, required: true },
  hotel_id: { type: 'string' as const },
}

export const DeactivateSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const },
}

export const IngestBookingsSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const },
}

// ── Solicitudes de conexión de una OTA ────────────────────────────────────────────────────────
// El PUT del admin no tenía validación: `{ status: 'lo-que-sea' }` llegaba al usecase y volvía un
// 400 genérico armado a mano. Los estados válidos y las transiciones viven en
// `usecases/channel-requests.ts`; acá solo se filtra la FORMA del body.

/** Lo que el hotel manda al pedir una OTA. `message` ≤ 500 (REQ-CAN-06). */
export const CreateChannelRequestSchema: Record<string, ValidationRule> = {
  channel: { type: 'string' as const, required: true, min: 1, max: 100 },
  channelName: { type: 'string' as const, max: 120 },
  message: { type: 'string' as const, max: 500 },
  contactPhone: { type: 'string' as const, max: 40 },
}

export const UpdateChannelRequestSchema: Record<string, ValidationRule> = {
  status: { type: 'string' as const, enum: [...CHANNEL_REQUEST_STATUSES] },
  resolutionReason: { type: 'string' as const, max: 1000 },
  assignedTo: { type: 'string' as const, max: 100 },
}

export const ScheduleAppointmentSchema: Record<string, ValidationRule> = {
  at: { type: 'date' as const, required: true },
  medium: { type: 'string' as const, required: true, enum: [...CHANNEL_REQUEST_MEDIUMS] },
  contactName: { type: 'string' as const, required: true, min: 2, max: 120 },
  contactPhone: { type: 'string' as const, required: true, min: 5, max: 40 },
  contactEmail: { type: 'string' as const, max: 160 },
  note: { type: 'string' as const, max: 1000 },
}

// `note` viaja también por acá para que `validateSchema` controle tipo y largo, pero lo que se
// PERSISTE es el texto crudo del body: el sanitizador de strings del framework hace
// `.replace(/\s+/g,' ')` y le comería los saltos de línea a una nota de dos párrafos.
export const AddChannelRequestNoteSchema: Record<string, ValidationRule> = {
  note: { type: 'string' as const, required: true, min: 1, max: 2000 },
}

/** Datos de la CUENTA Channex que no vienen de la API: hoy, el vencimiento del plan (REQ-CAN-09). */
export const ChannexAccountSchema: Record<string, ValidationRule> = {
  planExpiresAt: { type: 'string' as const, max: 40 },
}
