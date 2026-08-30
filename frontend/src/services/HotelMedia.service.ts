// services/HotelMedia.service.ts — Cliente API del módulo hotel_media (F0 0.8,
// solmi-direct-booking). Admin auth + permiso `media:view|create|edit|delete`:
//   GET    /api/hotel-media?type=hero|gallery|room   → { data: HotelMediaItem[], total }
//   POST   /api/hotel-media                          → HotelMediaItem (url = data-URL o http(s))
//   DELETE /api/hotel-media/:id                      → 204
//   POST   /api/hotel-media/reorder                  → { ok: true } (body { ids: [...] })
//
// El listado agrupa por `type` (default: todos). El upload acepta data-URL base64 (el router
// no propaga multipart, ver mem `arckode-router-files-not-propagated`) — el backend la sube a
// storage y devuelve la URL final. Usado por el MediaPicker del builder de la landing.

import { http } from './http'

export type HotelMediaType = 'gallery' | 'hero' | 'room'

/** Item plano que devuelve el admin (allow-list: sin hotelId ni timestamps del lado del
 *  frontend; el backend los persiste pero el picker solo necesita estos campos). */
export interface HotelMediaItem {
  id: string
  type: HotelMediaType
  url: string
  alt: string | null
  sortOrder: number
  roomId: string | null
  /** Tarea 3.5 — false = oculta de la landing pública sin borrarla. Default true. */
  active?: boolean
}

export interface HotelMediaListResult {
  data: HotelMediaItem[]
  total: number
}

export interface UploadHotelMediaInput {
  type: HotelMediaType
  /** data-URL base64 (`data:image/...;base64,...`) o URL http(s) ya resuelta. */
  url: string
  alt?: string | null
  /** Nombre original para preservar extensión en storage. Opcional. */
  fileName?: string
  roomId?: string | null
}

/** Query params del listado admin. `type` filtra por categoría. */
export interface HotelMediaListQuery {
  type?: HotelMediaType
}

function buildListUrl(query?: HotelMediaListQuery): string {
  if (!query?.type) return '/hotel-media'
  return `/hotel-media?type=${encodeURIComponent(query.type)}`
}

export const HotelMediaService = {
  /** Lista media del hotel del JWT. `type` opcional filtra por categoría. */
  list(query?: HotelMediaListQuery): Promise<HotelMediaListResult> {
    return http.get<HotelMediaListResult>(buildListUrl(query))
  },

  /** Sube una imagen (data-URL base64 o http). Devuelve el item creado con URL final. */
  upload(input: UploadHotelMediaInput): Promise<HotelMediaItem> {
    return http.post<HotelMediaItem>('/hotel-media', input)
  },

  /** Editar campos de un item (alt, type, sortOrder, roomId). ownership valida el backend. */
  update(id: string, patch: Partial<Omit<HotelMediaItem, 'id' | 'url'>>): Promise<HotelMediaItem> {
    return http.put<HotelMediaItem>(`/hotel-media/${encodeURIComponent(id)}`, patch)
  },

  /** Borra una media por id (ownership valida el backend). */
  remove(id: string): Promise<null> {
    return http.delete<null>(`/hotel-media/${encodeURIComponent(id)}`)
  },

  /** Reordena por ids (body `{ ids: [...] }`). El backend reescribe sortOrder 0..N-1. */
  reorder(ids: string[]): Promise<{ ok: boolean }> {
    return http.post<{ ok: boolean }>('/hotel-media/reorder', { ids })
  },
}
