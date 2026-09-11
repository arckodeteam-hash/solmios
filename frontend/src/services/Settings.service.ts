import { http } from './http'
// Los tipos viven en Hotel.service, que es quien realmente consume /rates y /seasons.
import type { RoomRate, Season } from './Hotel.service'
import type { AutoMessage } from './AutoMessages.service'

export interface HotelFull {
  id: string
  name: string
  country?: string
  address?: string
  phone?: string
  phone2?: string
  /** WhatsApp público (#241) — Página pública → General. */
  whatsapp?: string
  warningPhone?: string
  email?: string
  timezone?: string
  currency?: string
  secondaryCurrency?: string
  checkIn?: string
  checkOut?: string
  plan?: string
  status?: string
  logo?: string
  website?: string
  bookingEngineUrl?: string
  youtubeUrl?: string
  starRating?: number | string
  onlineBookingStatus?: string
  motorVersion?: string
  // Propietario
  ownerName?: string
  ownerTaxId?: string
  deviceEmail?: string
  // Alojamiento
  accommodationType?: string
  registrationNumber?: string
  // Localización
  latitude?: number | string
  longitude?: number | string
  province?: string
  municipality?: string
  locality?: string
  postalCode?: string
  // Condiciones
  cleaningType?: string
  depositType?: string
  depositFixed?: number
  advanceType?: string
  advanceAmount?: number
  releaseHours?: number
  defaultPaymentMethod?: string
  freeCancellation?: string | boolean
  depositRequired?: boolean
  depositPercent?: number
  weekendSurcharge?: number
  // Reseñas (pueden venir como 0/1 desde la DB o boolean desde UI)
  requestReviews?: boolean | number
  publishReviewScore?: boolean | number
  publishReviewComments?: boolean | number
  // Impuestos
  taxName?: string
  taxRate?: number
  // Multilingüe + WiFi — permitimos string vacío inicial y Record cuando se carga
  descriptionJson?: string | Record<string, string>
  wifiNetwork?: string
  wifiPassword?: string
  // Condiciones opcionales (algunos son string libre)
  freeCancellationType?: string
  cancellationType?: string
  // F0 0.21 — Página pública (solmi-direct-booking). `slug` estable para /h/:slug; `amenities`
  // del hotel (nivel hotel, distinto de RoomAmenities); `descriptionTranslations` multilingüe
  // con { [lang]: { title, description } } — la clave 'es' la rechaza el backend (español base
  // vive en descriptionJson), así que acá solo va a tener 'en'/'pt'/etc.
  slug?: string
  amenities?: string[] | null
  descriptionTranslations?: Record<string, { title?: string; description?: string }> | null
}

export interface SettingsFull {
  hotel: HotelFull
  amenities: string[]
  seasons: Season[]
  rates: RoomRate[]
  blocks: any[]
  autoMessages: AutoMessage[]
  roomTypes: string[]
  taxes?: any
  impuestos?: any
  ttlock: { clientId?: string; clientSecret?: string; accountId?: string; accessToken?: string; configured: boolean }
}

export interface HotelPatch {
  [key: string]: unknown
}

const HOTEL_ALLOWED_FIELDS = [
  'name','country','address','phone','email','timezone','currency','checkIn','checkOut','plan',
  'freeCancellation','depositRequired','depositPercent','weekendSurcharge',
  'ownerName','ownerTaxId','deviceEmail','accommodationType','registrationNumber','website',
  'bookingEngineUrl','phone2','whatsapp','warningPhone','secondaryCurrency','youtubeUrl','starRating',
  'onlineBookingStatus','motorVersion','latitude','longitude','province','municipality',
  'locality','postalCode','cancellationType','cleaningType','depositType','depositFixed','advanceType','advanceAmount',
  'releaseHours','defaultPaymentMethod','requestReviews','publishReviewScore','publishReviewComments',
  'taxName','taxRate','descriptionJson','wifiNetwork','wifiPassword',
  // 'logo' se descartaba acá aunque la pantalla lo edita y facturas/emails/marketing lo consumen:
  // no había ninguna vía para cambiar el logo del hotel.
  'logo',
  // F0 0.21 — Página pública. El backend los descarta si no están en el allowlist de
  // hoteles-queries.ts y en UpdateHotelesSchema (validators/schema.ts) — ambos actualizados.
  'slug','amenities','descriptionTranslations',
] as const

export const SettingsService = {
  full: () => http.get<SettingsFull>('/settings/full'),
  get: () => http.get<{ hotel: HotelFull; baseRates: { type: string; price: number }[] }>('/settings'),
  patchHotel: (patch: HotelPatch) => {
    const safe: HotelPatch = {}
    for (const k of HOTEL_ALLOWED_FIELDS) if (patch[k] !== undefined) safe[k] = patch[k]
    return http.put<HotelFull>('/settings/hotel', { ...safe, id: undefined })
  },
}
