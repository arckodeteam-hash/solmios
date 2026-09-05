// digitalizacion/validators/schema.ts — Validación de entrada.
//
// Solo forma y rango: las reglas que cruzan campos (googleHotel exige googleMaps listo,
// config listo exige configPaid…) viven en el servicio, porque dependen del estado guardado.
import { CASE_STATUSES, DIGITALIZATION_STEPS, STEP_STATUSES } from '../types'
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
  // `string` (no `url`) y sin `enum` a propósito: el string vacío es "borrá el dato" —la pantalla
  // necesita poder deshacer una carga— y `url`/`enum` lo rechazaban con 400 en el borde, antes de
  // llegar a la regla de borrado (un expediente recién abierto ni siquiera podía guardar sus datos
  // vacíos). El formato http(s) de las URLs y la pertenencia de `templateKey` al catálogo se validan
  // en `usecases/advance-step.ts`, donde ya viven las demás reglas: `assertTemplateKey` corre en las
  // dos rutas (avance y `update`) y las URLs se chequean al escribirse en el avance del paso.
  templateKey: { type: 'string' as const, max: 64 },
  siteUrl: { type: 'string' as const, max: 500 },
  googlePlaceId: { type: 'string' as const, max: 200 },
  googleMapsUrl: { type: 'string' as const, max: 500 },
  bookingEngineUrl: { type: 'string' as const, max: 500 },
}

/** Avance de un paso: `step` y `status` cerrados por enum, más los datos que ese paso necesite. */
export const AdvanceStepSchema: BodySchema = {
  step: { type: 'string' as const, required: true, enum: [...DIGITALIZATION_STEPS] },
  status: { type: 'string' as const, required: true, enum: [...STEP_STATUSES] },
  // Mismo criterio que en el update: el vacío tiene que entrar para poder borrar el dato.
  templateKey: { type: 'string' as const, max: 64 },
  siteUrl: { type: 'string' as const, max: 500 },
  configFee: { type: 'number' as const, min: 0 },
  configCurrency: { type: 'string' as const, max: 8 },
  configPaid: { type: 'boolean' as const },
  googlePlaceId: { type: 'string' as const, max: 200 },
  googleMapsUrl: { type: 'string' as const, max: 500 },
  bookingEngineUrl: { type: 'string' as const, max: 500 },
  notes: { type: 'text' as const, max: 2000 },
}

export const DigitalizacionValidator = {
  create: CreateDigitalizationCaseSchema,
  update: UpdateDigitalizationCaseSchema,
  advance: AdvanceStepSchema,
}
