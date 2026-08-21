// services/PublicHotel.service.ts — Cliente API de la INFO PÚBLICA del hotel (F0 0.19,
// solmi-direct-booking / Pieza 6a).
//
// Tres endpoints públicos (sin auth, rate-limited por IP en el backend):
//   - GET /api/public/hotel/:slug               → PublicHotelInfo (33 campos, allow-list estricta)
//   - GET /api/public/hotels/:slug/media         → PublicHotelMedia (endpoint F0 0.8, futuro)
//   - GET /api/public/hotels/:slug/reviews       → PublicReviewsResponse
//
// El `http` client desenvuelve el envelope del framework y NO pega token si no hay sesión
// (rutas públicas). La regex `isPublicAuthPath` en http.ts ya matchea `/public/` → un 401
// acá no dispara logout falso (es "no pudiste entrar", no "sesión venció").
//
// Tipos en `@/types/public-hotel` (re-exportados desde `@/types`). Espejo del backend:
// bookingengine/types.ts + opiniones/types.ts + hotel-media spec.

import { http } from './http'
import type {
  PublicHotelInfo,
  PublicHotelMedia,
  PublicReviewsQuery,
  PublicReviewsResponse,
} from '@/types/public-hotel'
import type { PublicRoomTypesResponse } from '@/types/booking'

function build(qs: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const PublicHotelService = {
  /**
   * Info pública del hotel por slug.
   *
   * El backend aplica i18n sobre `title`/`description` cuando llega `?lang=` (resuelve
   * `descriptionTranslations[lang]` o cae al español base de `descriptionJson`). El resto
   * de los 33 campos son estables (no cambian por idioma).
   *
   * @param slug  slug estable del hotel (NO el id, NO el name computado).
   * @param lang  'es' (default backend) | 'en' | 'pt' — solo afecta title/description.
   */
  getBySlug(slug: string, lang?: string): Promise<PublicHotelInfo> {
    const path = `/public/hotel/${encodeURIComponent(slug)}${build({ lang })}`
    return http.get<PublicHotelInfo>(path)
  },

  /**
   * Media pública (hero/gallery/rooms) agrupada por type.
   *
   * ENDPOINT FUTURO (F0 0.8 — controller/rutas se cablean en otra pieza). El path y el
   * contract ya están decididos en specs/hotel-media/spec.md, así que cuando el backend
   * cuelgue la ruta este método anda sin tocar el frontend. Hoy, si se llama, devuelve 404
   * (la landing maneja el caso "sin media" sin romper).
   */
  getMedia(slug: string): Promise<PublicHotelMedia> {
    return http.get<PublicHotelMedia>(`/public/hotels/${encodeURIComponent(slug)}/media`)
  },

  /**
   * Catálogo de tipos de habitación SIN filtrar por disponibilidad (a diferencia de
   * `BookingService.getRates`, que excluye un tipo sin stock continuo para el rango de fechas
   * pedido). Usado por `hotel-landing.vue` para completar la vitrina "Habitaciones" con los
   * tipos que `/rates` excluyó por estar ocupados justo en la ventana de fechas indicativa —
   * bug real 2026-08-20: un tipo reservado esos días desaparecía ENTERO de la web pública.
   */
  getRoomTypes(slug: string): Promise<PublicRoomTypesResponse> {
    return http.get<PublicRoomTypesResponse>(`/public/hotels/${encodeURIComponent(slug)}/room-types`)
  },

  /**
   * Reseñas visibles + aggregate + distribución + paginación.
   *
   * `publishReviewScore=false` en el hotel → `aggregate.score: null` (solo count).
   * `publishReviewComments=false` → cada `review.comment: null` (solo rating/title).
   * El backend cachea el aggregate (24h, key `public-reviews-aggregate:${hotelId}:v1`).
   */
  getReviews(slug: string, params?: PublicReviewsQuery): Promise<PublicReviewsResponse> {
    const path = `/public/hotels/${encodeURIComponent(slug)}/reviews${build({
      page: params?.page,
      limit: params?.limit,
      source: params?.source,
      lang: params?.lang,
    })}`
    return http.get<PublicReviewsResponse>(path)
  },
}
