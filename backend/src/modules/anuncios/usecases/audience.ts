// anuncios/usecases/audience.ts — A quién va dirigido un anuncio, y cuándo está vigente.
//
// Un anuncio de plataforma ('all' / 'admins') lo publica SOLO el dueño de la plataforma: un hotel
// no puede escribirle a los demás hoteles.

import { AuthError, ForbiddenError, ValidationError } from 'arckode-framework'
import type { AnnouncementAudience, CreateAnunciosDTO } from '../types'

export interface Author { id: string; role: string; hotelId?: string }

export interface ResolvedAudience {
  audience: AnnouncementAudience
  /** Ausente en un anuncio de plataforma. */
  hotelId?: string
}

export function resolveAudience(dto: CreateAnunciosDTO, author: Author): ResolvedAudience {
  const isSuper = author.role === 'super_admin'
  const audience: AnnouncementAudience = dto.audience ?? (dto.hotelId ? 'hotel' : (isSuper ? 'all' : 'hotel'))

  if (audience !== 'hotel' && !isSuper) {
    throw new ForbiddenError('Solo la plataforma puede publicar anuncios para varios hoteles')
  }

  if (audience === 'hotel') {
    const target = dto.hotelId ?? (isSuper ? undefined : author.hotelId)
    if (!target) throw new ValidationError('Un anuncio con audiencia "hotel" necesita hotelId')
    if (!isSuper && target !== author.hotelId) {
      throw new AuthError('No autorizado para crear en otro hotel')
    }
    return { audience, hotelId: target }
  }

  // Un anuncio de plataforma con hotelId sería un anuncio de un hotel disfrazado: se limpia.
  return { audience, hotelId: undefined }
}

/** `endsAt` antes que `startsAt` deja un anuncio que no se ve nunca: es un error de carga. */
export function assertWindow(dto: { startsAt?: string; endsAt?: string }): void {
  if (!dto.startsAt || !dto.endsAt) return
  const s = Date.parse(dto.startsAt)
  const e = Date.parse(dto.endsAt)
  if (Number.isNaN(s) || Number.isNaN(e)) throw new ValidationError('startsAt y endsAt deben ser fechas ISO 8601')
  if (e <= s) throw new ValidationError('endsAt debe ser posterior a startsAt')
}
