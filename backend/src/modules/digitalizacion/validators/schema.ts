// digitalizacion/validators/schema.ts — Validación de entrada.
//
// Solo forma y rango: las reglas que cruzan campos (googleHotel exige googleMaps listo,
// config listo exige configPaid…) viven en el servicio, porque dependen del estado guardado.
import { CASE_STATUSES, DIGITALIZATION_STEPS, SITE_TEMPLATE_KEYS, STEP_STATUSES } from '../types'
import type { BodySchema } from '../../../shared/validators/validate-body'

export const CreateDigitalizationCaseSchema: BodySchema = {
  hotelId: { type: 'string' as const, required: true, max: 64 },
  // `text`, no `string`: las notas son multilínea y `string` aplasta los saltos de línea.
  notes: { type: 'text' as const, max: 2000 },
}

export const UpdateDigitalizationCaseSchema: BodySchema = {
  status: { type: 'string' as const, enum: [...CASE_STATUSES] },
  notes: { type: 'text' as const, max: 2000 },
  // Sin `min`: 0 es un precio válido (configuración bonificada). El default sigue siendo null.
  configFee: { type: 'number' as const, min: 0 },
  configCurrency: { type: 'string' as const, max: 8 },
  configPaid: { type: 'boolean' as const },
  templateKey: { type: 'string' as const, enum: [...SITE_TEMPLATE_KEYS] },
  siteUrl: { type: 'url' as const },
  googlePlaceId: { type: 'string' as const, max: 200 },
  googleMapsUrl: { type: 'url' as const },
  bookingEngineUrl: { type: 'url' as const },
}

/** Avance de un paso: `step` y `status` cerrados por enum, más los datos que ese paso necesite. */
export const AdvanceStepSchema: BodySchema = {
  step: { type: 'string' as const, required: true, enum: [...DIGITALIZATION_STEPS] },
  status: { type: 'string' as const, required: true, enum: [...STEP_STATUSES] },
  templateKey: { type: 'string' as const, enum: [...SITE_TEMPLATE_KEYS] },
  siteUrl: { type: 'url' as const },
  configFee: { type: 'number' as const, min: 0 },
  configCurrency: { type: 'string' as const, max: 8 },
  configPaid: { type: 'boolean' as const },
  googlePlaceId: { type: 'string' as const, max: 200 },
  googleMapsUrl: { type: 'url' as const },
  bookingEngineUrl: { type: 'url' as const },
  notes: { type: 'text' as const, max: 2000 },
}

export const DigitalizacionValidator = {
  create: CreateDigitalizationCaseSchema,
  update: UpdateDigitalizationCaseSchema,
  advance: AdvanceStepSchema,
}
