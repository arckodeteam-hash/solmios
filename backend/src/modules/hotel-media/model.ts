// hotelmedia/model.ts — Schema de la tabla `hotel_media` (F0, spec hotel-media).
// DB en inglés, multi-tenant por hotelId, id = TEXT UUID, timestamps estándar.
// La columna física `roomId` es FK LÓGICA a `rooms.id` (validada en el usecase contra
// `Rooms.hotelId === user.hotelId`); no hay FK física, mismo patrón que combos/modificadores.
// Anti-patrón ORM (mem 1805): TODO campo persistido por el service/DTO/validator está
// declarado acá — case-sensitive (`sortOrder` ≠ `sortorder`).
import type { ModelDefinition, ORM } from 'arckode-framework'

/**
 * Media del hotel (F0). 3 tipos distinguibles por `type`:
 *  - `hero`    — imagen principal del hero banner (1-N).
 *  - `gallery` — fotos generales (lobby, exterior, amenities).
 *  - `room`    — foto(s) de un tipo de habitación; `roomId` REQUIRED.
 */
export const HotelMediaModel: ModelDefinition = {
  table: 'hotel_media',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    // 'gallery' | 'hero' | 'room'. Validado en el usecase (enum cerrado).
    type: { type: 'string', required: true },
    url: { type: 'string', required: true },
    alt: { type: 'string' },
    // Entero dentro del (hotelId, type). El usecase reorder reescribe 0..N-1 sin gaps.
    sortOrder: { type: 'number', default: 0 },
    // FK lógica a rooms.id. REQUIRED si type='room' (lo enforca el usecase, no el ORM).
    roomId: { type: 'string', indexed: true },
    // Tarea 3.5 (QA 2026-08-27) — "ocultar" sin borrar: el endpoint público filtra
    // active=false, el panel las sigue mostrando (atenuadas) para poder reactivarlas.
    active: { type: 'boolean', default: true },
  },
  timestamps: true,
}

/** Registra el modelo en el ORM. Idempotente (orm.define usa Map.set). */
export function registerHotelMediaModels(orm: ORM): void {
  orm.define('HotelMedia', HotelMediaModel)
}
