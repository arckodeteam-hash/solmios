// hotelmedia/types.ts — DTOs y tipos del módulo hotel_media (API contract).
// El schema físico de la tabla vive en ./model.ts — son conceptos distintos (mem anti-patrón ORM).

/** Tipo de media. Mismo enum cerrado que valida el usecase. */
export type MediaType = 'gallery' | 'hero' | 'room'

/**
 * DTO de lectura. espeja los campos persistidos en `hotel_media` (model.ts).
 * `roomId` es nullable; sólo tiene sentido cuando `type='room'`.
 */
export interface HotelMediaDTO {
  id: string
  hotelId: string
  type: MediaType
  url: string
  alt?: string | null
  sortOrder?: number
  roomId?: string | null
  /** Tarea 3.5 — false = oculta de la landing pública sin borrarla. Default true. */
  active?: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Payload de creación. El usecase espera `url` como data-URL base64 (router no propaga
 * multipart) o como URL http(s) ya resuelta; en el primer caso sube a S3 y reemplaza la URL.
 */
export interface CreateHotelMediaDTO {
  type: MediaType
  url: string
  alt?: string | null
  sortOrder?: number
  roomId?: string | null
  /** Nombre del archivo original (para preservar extensión en el storage). Opcional. */
  fileName?: string
}

/** Campos editables: hotelId y type NO se cambian desde el update (reglas de negocio). */
export interface UpdateHotelMediaDTO {
  type?: MediaType
  url?: string
  alt?: string | null
  sortOrder?: number
  roomId?: string | null
  active?: boolean
}

/** Payload del endpoint `/reorder`. ids en el orden final deseado, sin gaps (0..N-1). */
export interface ReorderHotelMediaDTO {
  ids: string[]
}

/** Usuario autenticado (req.user). Para ownership (IDOR) y forzar hotelId. */
export interface CurrentUser {
  id: string
  hotelId?: string | null
  role?: string
}
