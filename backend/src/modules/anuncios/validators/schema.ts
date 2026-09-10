import type { ValidationRule } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'

// 'feature' y 'promo' los ofrece el panel de la plataforma (/admin/announcements) desde
// siempre; al no estar en el enum, crear un anuncio de esos tipos devolvía 400. El panel es
// el único que los usa, así que se amplía el enum en vez de recortar la UI.
const TYPE_ENUM = ['info', 'warning', 'urgent', 'maintenance', 'feature', 'promo']
const PRIORITY_ENUM = ['low', 'medium', 'high']
const AUDIENCE_ENUM = ['all', 'hotel', 'admins']
const MAX_MESSAGE_LENGTH = 5000
const MIN_TITLE_LENGTH = 2
const MAX_TITLE_LENGTH = 200

export const CreateAnunciosSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const },
  authorId: { type: 'string' as const },
  title: { type: 'string' as const, required: true, min: MIN_TITLE_LENGTH, max: MAX_TITLE_LENGTH },
  message: { type: 'string' as const, max: MAX_MESSAGE_LENGTH },
  type: { type: 'string' as const, enum: TYPE_ENUM },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM },
  active: { type: 'number' as const },
  date: { type: 'string' as const },
  audience: { type: 'string' as const, enum: AUDIENCE_ENUM },
}

export const UpdateAnunciosSchema: Record<string, ValidationRule> = {
  authorId: { type: 'string' as const },
  title: { type: 'string' as const, min: MIN_TITLE_LENGTH, max: MAX_TITLE_LENGTH },
  message: { type: 'string' as const, max: MAX_MESSAGE_LENGTH },
  type: { type: 'string' as const, enum: TYPE_ENUM },
  priority: { type: 'string' as const, enum: PRIORITY_ENUM },
  active: { type: 'number' as const },
  date: { type: 'string' as const },
  audience: { type: 'string' as const, enum: AUDIENCE_ENUM },
}

/**
 * Regla cruzada (#106): un anuncio para 'hotel' necesita saber cuál. validateSchema valida campo
 * por campo y no puede expresarla, así que se chequea aparte y con el mismo 400 (ValidationError)
 * que nombra `hotelId`, para que el panel marque ese campo.
 */
export function assertAudienceConsistent(data: { audience?: string; hotelId?: string }): void {
  if (data.audience === 'hotel' && !data.hotelId) {
    throw new ValidationError('Validation error', { hotelId: ["hotelId es obligatorio cuando audience es 'hotel'"] })
  }
}

export const AnunciosValidator = { create: CreateAnunciosSchema, update: UpdateAnunciosSchema }
