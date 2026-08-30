// hotelmedia/validators/schema.ts — Validación de entrada del módulo hotel_media.
// `validateSchema` (shared) devuelve SOLO los campos declarados acá (los demás se
// descartan en silencio, mem anti-patrón ORM). Por eso cada campo persistido está.
import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'

const MEDIA_TYPES = ['gallery', 'hero', 'room']

/** Creación. `url` puede ser data-URL base64 o http(s) — el usecase decide. */
export const CreateHotelMediaSchema: Record<string, ValidationRule> = {
  type: { type: 'string' as const, required: true, enum: MEDIA_TYPES },
  url: { type: 'string' as const, required: true },
  alt: { type: 'string' as const },
  sortOrder: { type: 'number' as const },
  roomId: { type: 'string' as const },
  fileName: { type: 'string' as const },
}

/** Actualización. `type` y `url` se pueden cambiar (mover de tipo / reemplazar foto). */
export const UpdateHotelMediaSchema: Record<string, ValidationRule> = {
  type: { type: 'string' as const, enum: MEDIA_TYPES },
  url: { type: 'string' as const },
  alt: { type: 'string' as const },
  sortOrder: { type: 'number' as const },
  roomId: { type: 'string' as const },
  // Tarea 3.5 — toggle ocultar/mostrar sin borrar.
  active: { type: 'boolean' as const },
}

/** Reordenar: lista de ids en el orden final deseado. */
export const ReorderHotelMediaSchema: Record<string, ValidationRule> = {
  ids: { type: 'array' as const, required: true },
}

export const HotelMediaValidator = {
  create: CreateHotelMediaSchema,
  update: UpdateHotelMediaSchema,
  reorder: ReorderHotelMediaSchema,
}
