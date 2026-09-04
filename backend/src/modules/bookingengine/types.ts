// bookingengine/types.ts — DTOs y tipos de queries
// Contrato TypeScript del módulo (cómo se ven los datos).

// ─── BookingConfig ─────────────────────────────────────
export interface BookingConfigDTO {
  id: string
  hotelId: string
  enabled: boolean
  theme: string
  position: string
  currency: string
  language: string
  minNights: number
  maxNights: number
  cancellationPolicy: string
  showComparison: boolean
  googleAdsEnabled: boolean
  whatsappConfirmation: boolean
  instantConfirmation: boolean
  stripeAccountId: string
  allowedCountries: string[]
  createdAt: string
  updatedAt: string
}

export interface UpdateBookingConfigDTO {
  enabled?: boolean
  theme?: string
  position?: string
  currency?: string
  language?: string
  minNights?: number
  maxNights?: number
  cancellationPolicy?: string
  showComparison?: boolean
  googleAdsEnabled?: boolean
  whatsappConfirmation?: boolean
  instantConfirmation?: boolean
  stripeAccountId?: string
  allowedCountries?: string[]
}

// ─── Availability ──────────────────────────────────────
export interface AvailabilityQuery {
  hotelId: string
  checkIn: string
  checkOut: string
  adults?: number
  children?: number
  promoCode?: string
}

export interface RoomTypeAvailability {
  roomType: string
  available: number
  price: number
  currency: string
  originalPrice?: number
  capacity: number
  /** Feature adultos+niños+edades (2026-09-02) — máximo entre las rooms reales del type, null
   *  si ninguna lo configuró. Cota de UX para el widget; la autoridad real es el backend al
   *  crear la reserva (`fitsRoomCapacity`, shared/usecases/child-composition.ts). */
  maxAdults?: number | null
  maxChildren?: number | null
  /** Metros cuadrados (máximo entre las rooms reales del type). 0 si no está cargado. */
  surfaceArea: number
  amenities: string[]
  /**
   * Unidades vendibles del tipo POR OCUPACIÓN: el índice `i - 1` son las habitaciones libres
   * donde entran `i` huéspedes (largo = `capacity`). `available` es exactamente
   * `availableByOccupancy[adults - 1]` — es el mismo conteo, abierto por ocupación, porque un
   * tipo puede tener unidades de distinta capacidad y la de 4 puede estar ocupada mientras la
   * de 2 sigue libre.
   *
   * Opcional: los callers viejos (y las entradas que quedaran en caché de una versión anterior)
   * no lo traen; quien lo consuma debe degradar a `available`.
   */
  availableByOccupancy?: number[]
}

// ─── Matriz de ocupaciones (GET /api/public/hotels/:slug/rates) ─────────────────
/**
 * Por qué una fila de ocupación NO se puede vender. Códigos ESTABLES: el frontend los traduce,
 * así que renombrarlos rompe la UI pública.
 *  - `over_capacity`   — en la habitación no entra esa cantidad de gente.
 *  - `no_rate`         — el hotel no cargó tarifa para esa ocupación (y no hay fallback aplicable).
 *  - `stop_sell`       — hay tarifa, pero está cerrada (`room_rates.closed`) en alguna noche.
 *  - `no_availability` — abierta y con precio, pero sin unidades libres en esas fechas.
 */
export type OccupancyUnavailableReason =
  | 'over_capacity'
  | 'no_rate'
  | 'stop_sell'
  | 'no_availability'

export interface OccupancyRate {
  occupancy: number
  /** Total de la estadía para esa ocupación, en la moneda de display. 0 si no hay tarifa. */
  price: number
  /** `price / nights`. Lo que la competencia muestra como "Precio 1 noches USD $70". */
  pricePerNight: number
  available: boolean
  /** `null` cuando `available` es true. */
  unavailableReason: OccupancyUnavailableReason | null
  taxBreakdown: Array<{ name: string; rate: number; amount: number }>
}

export interface AvailabilityResult {
  hotelId: string
  hotelName: string
  checkIn: string
  checkOut: string
  nights: number
  roomTypes: RoomTypeAvailability[]
}

// ─── Public Booking ────────────────────────────────────
export interface PublicBookingDTO {
  id: string
  hotelId: string
  roomType: string
  roomId: string
  guestName: string
  guestEmail: string
  guestPhone: string
  checkIn: string
  checkOut: string
  adults: number
  children: number
  totalAmount: number
  currency: string
  status: string
  paymentStatus: string
  paymentRef: string
  promoCode: string
  createdAt: string
  updatedAt: string
}

export interface CreatePublicBookingDTO {
  hotelId: string
  roomType: string
  guestName: string
  guestEmail: string
  guestPhone: string
  checkIn: string
  checkOut: string
  adults: number
  children?: number
  promoCode?: string
}

// ─── Conversion Events ─────────────────────────────────
export interface ConversionEventDTO {
  id: string
  hotelId: string
  sessionId: string
  event: string
  roomType?: string
  amount?: number
  source?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  device?: string
  country?: string
  createdAt: string
  updatedAt: string
}

export interface CreateConversionEventDTO {
  hotelId: string
  sessionId: string
  event: string
  roomType?: string
  amount?: number
  source?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  device?: string
  country?: string
}

// ─── Analytics ─────────────────────────────────────────

/**
 * Step del funnel de conversión (F4 4.1 / D13). Orden fijo:
 *   view → search → select → upsell → form → pay → confirm.
 *
 * `count` = número de tracking_events con ese `event` para el hotel en el rango.
 * `dropOff` = % que avanzó al siguiente step respecto del actual (0–100). Para el último
 * step (`confirm`) dropOff queda null (no hay step siguiente).
 *
 * Los eventos se persisten en `tracking_events` con `target='internal'` ( eventos del
 * funnel que NO se disparan a Meta/GA4 externos — esos fires llevan `target='meta'|'ga4'`).
 * El funnel cuenta TODOS los targets (un evento puede haberse disparado a Meta Y persistirse
 * como internal — para el funnel solo nos importa el hecho del step, no el disparo externo).
 */
export interface FunnelStep {
  /** Nombre del step (view|search|select|upsell|form|pay|confirm). */
  step: string
  /** Etiqueta legible para el panel ( Matches TrackingEventType del server-tracking). */
  label: string
  /** Número de eventos de este step en el rango. */
  count: number
  /** % de conversión al step siguiente (count_siguiente / count_actual * 100). null en el último. */
  dropOff: number | null
}

export interface BookingAnalytics {
  totalSearches: number
  totalBookings: number
  conversionRate: number
  totalRevenue: number
  averageBookingValue: number
  /** F4 4.1 (D13) — Funnel real desde tracking_events. Reemplaza `topRoomTypes:[]` vacío. */
  funnel: FunnelStep[]
}

// ─── Hotel Info (público) ──────────────────────────────
/** DTO público de hotel — allow-list estricta (F0 0.4 spec public-hotel-info).
 *  NUNCA debe contener campos privados del hotelero (taxId, ownerName, ownerTaxId,
 *  deviceEmail, wifiNetwork, wifiPassword, internalNotes, bookingEngineUrl,
 *  motorVersion, warningPhone, registrationNumber). */
export interface PublicHotelInfoDTO {
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
  /** Google Maps JS API key (config KV `google_maps`, fallback a `hotelId:'platform'`), o
   *  `null` si no hay ninguna cargada. Client-visible por diseño (se restringe por dominio del
   *  lado de Google) — el frontend la usa para mapa interactivo en `/h/:slug`, cae al iframe
   *  embed sin key si es null. Ver `usecases/public-hotel-info.ts:resolveGoogleMapsKey`. */
  googleMapsApiKey: string | null
  /** Estadía mínima/máxima de `booking_config`. Van acá porque el cliente las necesita ANTES de
   *  cotizar: la landing pide tarifas indicativas y, sin saber el mínimo, un hotel con
   *  `minNights: 3` recibía 400 y se quedaba sin bloque de habitaciones. Sin esto el frontend
   *  tenía que deducir el número parseando el texto del mensaje de error. `null` = sin límite. */
  minNights: number | null
  maxNights: number | null
  /** Tarea 3.4 (corrección 2026-08-25) — preferencias de `booking_config` que el widget usa
   *  como DEFAULT inicial (el switcher del huésped, si lo toca, manda por encima). Distinto de
   *  `currency` de arriba, que es la moneda de COBRO del hotel (`hotels.currency`, fija, no una
   *  preferencia de display). `null` = sin config cargada, el widget cae a su propio default
   *  (`navigator.language` / `chargeCurrency`). */
  widgetDefaultLanguage: string | null
  widgetDefaultCurrency: string | null
  /** "Tema del Widget" — string libre (`booking_config.theme`), null si no hay config. El
   *  frontend decide qué valores conoce (`ACCENT_PRESETS` en `booking-widget.vue`) y cae a
   *  "sin override" ante cualquier otro — no se valida acá para no tener que migrar filas
   *  viejas si el set de presets cambia. */
  widgetAccentPreset: string | null
  /** Política de niños del hotel (feature adultos+niños+edades, 2026-09-02) — le dice al widget
   *  si mostrar la opción de agregar niños y con qué rango de edades. Siempre presente (nunca
   *  null): hoteles sin configurar reciben `DEFAULT_CHILD_POLICY` (acepta niños, todos consumen
   *  plaza — cero cambio de comportamiento hasta que el hotel configure lo contrario). */
  childPolicy: { acceptChildren: boolean; maxChildAge: number; maxFreeAge: number }
}

// ─── Upsells (F2 2.3 — sub-dominio de bookingengine) ────────────
/** Forma de cobro del upsell: cómo se multiplica al sumarlo al total de la reserva. */
export type UpsellKind = 'per_room' | 'per_person' | 'per_stay'

/** DTO de lectura. Espeja los campos persistidos en `upsells` (model.ts). */
export interface UpsellDTO {
  id: string
  hotelId: string
  name: string
  description: string | null
  /** Precio en la moneda del hotel. */
  price: number
  kind: UpsellKind
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** Body del POST /api/upsells. */
export interface CreateUpsellDTO {
  name: string
  description?: string | null
  price: number
  kind: UpsellKind
  active?: boolean
  sortOrder?: number
}

/** Body del PUT /api/upsells/:id. Todos opcionales (partial). */
export interface UpdateUpsellDTO {
  name?: string
  description?: string | null
  price?: number
  kind?: UpsellKind
  active?: boolean
  sortOrder?: number
}

/** Usuario autenticado (req.user). Para ownership (IDOR) y forzar hotelId. */
export interface UpsellCurrentUser {
  id: string
  hotelId?: string | null
  role?: string
  userType?: string
}

// ─── Regímenes de alimentación (tasks.md 2.2/2.4, solmi-direct-booking-qa-fixes) ────────────
// Catálogo FIJO de 3 códigos (no abierto como upsells) — "Solo alojamiento" es la base
// implícita, sin fila propia. Ver el comentario de `MealPlanModel` en model.ts.
export type MealPlanCode = 'breakfast' | 'half_board' | 'all_inclusive'
export type MealPlanPriceMode = 'included' | 'per_person_per_night'

/** DTO de lectura. Espeja los campos persistidos en `meal_plans` (model.ts). */
export interface MealPlanDTO {
  id: string
  hotelId: string
  code: MealPlanCode
  active: boolean
  priceMode: MealPlanPriceMode
  price: number
  createdAt: string
  updatedAt: string
}

/** Body del PUT /api/meal-plans/:code. */
export interface UpsertMealPlanDTO {
  active?: boolean
  priceMode?: MealPlanPriceMode
  price?: number
}

/** Fila pública (lo que el widget necesita) — sin hotelId/timestamps. */
export interface PublicMealPlan {
  code: MealPlanCode
  priceMode: MealPlanPriceMode
  price: number
}
