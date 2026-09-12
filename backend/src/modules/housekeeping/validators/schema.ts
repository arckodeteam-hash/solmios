import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'
import { MAX_TEXT_LENGTH, MIN_TEXT_LENGTH } from '../../../shared/validators/limits'

const TYPE_ENUM = ['full_cleaning', 'quick_cleaning', 'deep_cleaning', 'inspection', 'maintenance', 'arrival_setup']
const PRIORITY_ENUM = ['low', 'medium', 'high', 'urgent']
const STATUS_ENUM = ['pending', 'in_progress', 'completed', 'inspected']

/** A quién le va el reporte. Solo `maintenance` abre un ticket. */
const REPORT_TYPE_ENUM = ['maintenance', 'supervisor']

/** Antes `/report` no validaba nada y la descripción era infinita. */
export const REPORT_DESCRIPTION_MAX = MAX_TEXT_LENGTH

export const ReportIssueSchema: Record<string, ValidationRule> = {
  description: {
    type: 'string' as const,
    required: true,
    min: MIN_TEXT_LENGTH,
    max: MAX_TEXT_LENGTH,
  },
  type: { type: 'string' as const, enum: REPORT_TYPE_ENUM },
}

export const CreateHousekeepingSchema: Record<string, ValidationRule> = {
  roomId: { type: 'string' as const, required: true },
  hotelId: { type: 'string' as const, required: true },
  staffId: { type: 'string' as const },
  type: { type: 'string' as const, enum: TYPE_ENUM },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM },
  status: { type: 'string' as const, enum: STATUS_ENUM },
  notes: { type: 'string' as const, max: MAX_TEXT_LENGTH },
  assignedDate: { type: 'string' as const },
  completedDate: { type: 'string' as const },
  cleaningItems: { type: 'array' as const },
  startTime: { type: 'string' as const },
  endTime: { type: 'string' as const },
  photos: { type: 'array' as const },
}

export const UpdateHousekeepingSchema: Record<string, ValidationRule> = {
  roomId: { type: 'string' as const },
  staffId: { type: 'string' as const },
  type: { type: 'string' as const, enum: TYPE_ENUM },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM },
  status: { type: 'string' as const, enum: STATUS_ENUM },
  notes: { type: 'string' as const, max: MAX_TEXT_LENGTH },
  assignedDate: { type: 'string' as const },
  completedDate: { type: 'string' as const },
  cleaningItems: { type: 'array' as const },
  // Timings + fotos gestionados principalmente vía endpoints dedicados (start/complete/photos),
  // pero se permiten en update para que el panel admin pueda corregirlos manualmente.
  startTime: { type: 'string' as const },
  endTime: { type: 'string' as const },
  photos: { type: 'array' as const },
}

export const HousekeepingValidator = { create: CreateHousekeepingSchema, update: UpdateHousekeepingSchema }

export const UploadPhotoSchema: Record<string, ValidationRule> = {
  photo: { type: 'string' as const, required: true },
  fileName: { type: 'string' as const },
  // A qué requisito corresponde la foto (cama, baño, general…). Opcional: las
  // fotos sueltas caen en 'evidence'.
  areaId: { type: 'string' as const },
}

export const RemovePhotoSchema: Record<string, ValidationRule> = {
  url: { type: 'string' as const, required: true },
}

/** Calificación de la limpieza: entero de 1 a 10. El supervisor la pone al aprobar. */
export const RATING_MIN = 1
export const RATING_MAX = 10

/**
 * Body de `POST /:id/approve`. `rating` es obligatorio: no se aprueba una limpieza
 * sin calificarla. El rango entero 1–10 se refuerza además en el usecase (el validador
 * del framework no garantiza min/max para números).
 */
export const ApproveHousekeepingSchema: Record<string, ValidationRule> = {
  rating: { type: 'number' as const, required: true, min: RATING_MIN, max: RATING_MAX },
  note: { type: 'text' as const, max: MAX_TEXT_LENGTH },
}

/** Ajustes de housekeeping del hotel. Merge parcial: todos los flags opcionales. */
export const UpdateHousekeepingSettingsSchema: Record<string, ValidationRule> = {
  requireSupervisorPhoto: { type: 'boolean' as const },
  // Evidencia de FIN: las fotos por área o UN video. Excluyente. La foto de inicio
  // no la afecta. El usecase normaliza cualquier valor raro al default.
  completionEvidence: { type: 'string' as const, enum: ['photos', 'video'] },
  maxVideoSeconds: { type: 'number' as const },
  // Retención de evidencias multimedia en días (#326). 0 = conservar para siempre. El usecase
  // topea el máximo y normaliza cualquier valor raro.
  evidenceRetentionDays: { type: 'number' as const, min: 0 },
}

/** Pedido de URL prefirmada para subir el video directo al bucket. */
export const VideoUploadUrlSchema: Record<string, ValidationRule> = {
  contentType: { type: 'string' as const, required: true },
  durationSeconds: { type: 'number' as const, required: true },
}

/** La app confirma que el video ya está en el bucket. */
export const AttachVideoSchema: Record<string, ValidationRule> = {
  url: { type: 'string' as const, required: true },
  path: { type: 'string' as const, required: true },
  durationSeconds: { type: 'number' as const, required: true },
  mimeType: { type: 'string' as const, required: true },
}
