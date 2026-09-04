// types/public-hotel.ts — Tipos del dominio PÚBLICO (F0 0.19, solmi-direct-booking).
// Espejo del backend:
//   - bookingengine/types.ts PublicHotelInfoDTO (32 campos, allow-list estricta)
//   - opiniones/types.ts PublicReviewsResponse (reviews + aggregate + distribution + pagination)
//   - hotel-media: endpoint `/api/public/hotels/:slug/media` (F0 0.8 — controller/rutas vienen
//     en otra pieza; el contrato de respuesta YA está decidido en specs/hotel-media/spec.md).
//
// Estos tipos VIVEN separados de `index.ts` porque son públicos (sin hotelId, sin datos del
// hotelero, sin token interno). Re-exportados desde `@/types` para que el resto del frontend
// siga importando de un solo lugar.

// ─── PublicHotelInfo ───────────────────────────────────
// Espejo EXACTO de backend/src/modules/bookingengine/types.ts PublicHotelInfoDTO.
// NUNCA debe contener: taxId, ownerName, ownerTaxId, deviceEmail, wifiNetwork, wifiPassword,
// internalNotes, bookingEngineUrl, motorVersion, warningPhone, registrationNumber.
// Si se agrega un campo público nuevo en el backend, reflejarlo acá para mantener el contract.
export interface PublicHotelInfo {
  id: string
  slug: string
  name: string
  title: string | null
  description: string | null
  descriptionTranslations: Record<string, { title?: string; description?: string }> | null
  accommodationType: string
  starRating: string | null
  latitude: number
  longitude: number
  address: string | null
  province: string | null
  municipality: string | null
  locality: string | null
  postalCode: string | null
  phone: string | null
  email: string | null
  website: string | null
  checkIn: string
  checkOut: string
  currency: string
  taxName: string
  taxRate: number
  cancellationType: string
  freeCancellation: boolean
  depositRequired: boolean
  depositPercent: number
  releaseHours: number
  logo: string | null
  amenities: string[] | null
  onlineBookingStatus: string
  /** Google Maps JS API key (o `null` si no hay ninguna cargada) — `MapBlock.vue` la usa para
   *  mapa interactivo, cae al iframe embed sin key. Client-visible por diseño (restringida por
   *  dominio del lado de Google, no es secreta). */
  googleMapsApiKey: string | null
  /** Estadía mínima/máxima del hotel (`booking_config`), o `null` si no declara límite. La
   *  landing las necesita para pedir tarifas indicativas con un rango que el backend acepte:
   *  con `minNights: 3`, una consulta de 2 noches devuelve 400 y el bloque de habitaciones se
   *  queda sin datos. Opcionales en el tipo porque un backend anterior al cambio no las manda. */
  minNights?: number | null
  maxNights?: number | null
  /** Tarea 3.4 (corrección 2026-08-25) — preferencias de `booking_config` que el widget usa
   *  como DEFAULT inicial (el switcher del huésped, si lo toca, manda por encima). Distinto de
   *  `currency` de arriba (moneda de COBRO, fija). `null`/`undefined` = sin config cargada. */
  widgetDefaultLanguage?: string | null
  widgetDefaultCurrency?: string | null
  /** "Tema del Widget" — string libre, el frontend decide qué valores conoce (`ACCENT_PRESETS`
   *  en `booking-widget.vue`) y cae a "sin override" ante cualquiera que no reconozca. */
  widgetAccentPreset?: string | null
  /** Política de niños del hotel (feature adultos+niños+edades, 2026-09-02). Opcional en el tipo
   *  por si un backend viejo/caché todavía no la manda — el widget cae a "acepta, nadie gratis"
   *  (mismo default que `DEFAULT_CHILD_POLICY` del backend). */
  childPolicy?: { acceptChildren: boolean; maxChildAge: number; maxFreeAge: number }
}

// ─── Media (GET /api/public/hotels/:slug/media) ────────
// Endpoint futuro (F0 0.8). El backend devolverá media agrupada por type: hero/gallery/rooms.
// Mismo shape que el modelo HotelMedia (`type 'gallery'|'hero'|'room'`, sortOrder, roomId nullable).
export type PublicMediaType = 'gallery' | 'hero' | 'room'

export interface PublicMediaItem {
  id: string
  type: PublicMediaType
  url: string
  alt: string | null
  sortOrder: number
  roomId: string | null
}

export interface PublicRoomMedia {
  roomId: string
  photos: PublicMediaItem[]
}

export interface PublicHotelMedia {
  hero: PublicMediaItem[]
  gallery: PublicMediaItem[]
  rooms: PublicRoomMedia[]
}

// ─── Reviews (GET /api/public/hotels/:slug/reviews) ────
// Espejo de backend/src/modules/opiniones/types.ts PublicReviewsResponse.
// `score` null cuando el hotel tiene publishReviewScore=false;
// `comment` null cuando publishReviewComments=false (el backend lo aplica en el controller).
export type PublicReviewSource =
  | 'all'
  | 'direct'
  | 'google'
  | 'tripadvisor'
  | 'booking'
  | 'airbnb'
  | 'expedia'

export interface PublicReview {
  rating: number
  title: string | null
  comment: string | null
  channel: string
  date: string | null
  authorName: string | null
  /** Link a la review original en la fuente externa. `null` para reservas directas. */
  sourceUrl: string | null
}

export interface PublicReviewSourceStat {
  score: number
  count: number
}

export interface PublicReviewAggregate {
  score: number | null
  count: number
  perSource: { [channel: string]: PublicReviewSourceStat }
}

/** Distribución de estrellas (siempre 1..5, mismo shape que el backend). */
export interface PublicReviewDistribution {
  '1': number
  '2': number
  '3': number
  '4': number
  '5': number
}

export interface PublicReviewPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PublicReviewsResponse {
  reviews: PublicReview[]
  aggregate: PublicReviewAggregate
  distribution: PublicReviewDistribution
  pagination: PublicReviewPagination
}

/** Query params del endpoint público de reviews. `source`/`lang` validados contra enums
 *  en el backend; acá los dejamos como string para no romper si el backend suma una fuente. */
export interface PublicReviewsQuery {
  page?: number
  limit?: number
  source?: PublicReviewSource | string
  lang?: 'es' | 'en' | 'pt' | string
}
