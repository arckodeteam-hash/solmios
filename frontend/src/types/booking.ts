// types/booking.ts — Tipos del flujo de reserva pública (F0 0.20, solmi-direct-booking).
// Espejo de:
//   - bookingengine/validators/schema.ts ExtendedPublicBookingSchema (POST /api/public/booking)
//   - bookingengine/usecases/public-booking.ts createPublicBookingDirect (respuesta cruda)
//   - bookingengine/usecases/public-reservation.ts getPublicReservation (GET /api/public/reservations/:id)
//
// El DTO público (CreateBookingDTO) es "friendly": slug + guest anidado. El service lo aplana
// al shape que espera el backend (hotelId + guestName/guestEmail/guestPhone planos) resolviendo
// slug→hotelId con PublicHotel.service.getBySlug. Spec booking-unification R-1 pide respuesta
// plana {reservationId, accessToken, checkoutUrl} → el service también aplana la respuesta.

// ─── POST /api/public/booking ──────────────────────────

export interface CreateBookingGuest {
  name: string
  email: string
  phone: string
  /** Notas opcionales del huésped (pedidos especiales, hora de llegada, etc.). El service lo
   *  mapea a `notes` del body del backend (campo libre en Reservations). */
  notes?: string
}

/** Hook F2 (task 2.5): el backend aún no valida contra modelo Upsell, solo lo persiste en
 *  `notes` y reserved el campo para promo. El frontend lo manda igual — cuando F2 cablee el
 *  cálculo del total con upsells, ya va a estar en el body. */
export interface CreateBookingUpsell {
  id: string
  quantity: number
}

/** DTO friendly que recibe `BookingService.createBooking`. El service resuelve slug→hotelId,
 *  mapea `guest` → `guestName/guestEmail/guestPhone`, y postea al backend con el shape del
 *  `ExtendedPublicBookingSchema`.
 *
 *  FIX 2026-07-30 — `roomType` es el campo que el widget SIEMPRE manda (es el `id` que devuelve
 *  `public-rates.ts` por tipo de habitación — no hay entidad RoomType propia, `id` = string
 *  libre tipo "double"). El backend resuelve la unidad física concreta a partir de `roomType`
 *  al crear la reserva (`createPublicBookingDirect`). `roomId` queda OPCIONAL: solo lo usan
 *  integradores/callers que ya manejan un UUID real de `Rooms` (compat vieja); el widget del
 *  huésped no lo manda. */
export interface CreateBookingDTO {
  slug: string
  /** UUID real de `Rooms`. Opcional — solo para callers que ya conocen la unidad física. El
   *  widget público no lo manda (ver `roomType`). */
  roomId?: string
  roomType: string
  checkIn: string
  checkOut: string
  adults: number
  children?: number
  guest: CreateBookingGuest
  promoCode?: string
  upsells?: CreateBookingUpsell[]
  /** URLs de vuelta desde Stripe. Si se omiten, el backend deriva de PUBLIC_BASE_URL/Referer.
   *  Pattern: `/h/:slug?booking=:id&token=:token` (spec booking-unification R2). */
  successUrl?: string
  cancelUrl?: string
  /** Idempotency key client-side (F2 2.8): el widget la genera por intento de pago para
   *  prevenir doble submit del POST /public/booking. El backend hoy no la consume (dedupea
   *  por reservation.id en el charge de Stripe), pero queda como salvaguarda: si dos clicks
   *  llegan con la misma key, el backend podría rechazar el duplicado sin crear dos reservas
   *  pending. Se regenera solo tras un fallo real (no en cada click). */
  idempotencyKey?: string
}

/** Respuesta plana del service (spec booking-unification R-1). El backend devuelve
 *  `{reservation, guest, checkoutUrl, totalBreakdown, paymentError?}`; el service mapea a
 *  ESTE shape limpio.
 *  - `checkoutUrl: null` cuando el hotel no tiene Stripe configurado o el gateway cayó (la
 *    reserva se crea igual con status='pending'; ver robustez F0 en public-booking.ts).
 *  - `totalBreakdown` (F2 2.5): desglose estable para que el widget muestre el detalle y para
 *    que el step Pay pueda confiar en el total cobrado por Stripe. Siempre viene (aunque no
 *    haya promo/upsells, los importes van en 0).
 *  - `paymentError` solo se incluye si hubo un error real de pasarela. */
export interface CreateBookingResponse {
  reservationId: string
  accessToken: string
  checkoutUrl: string | null
  totalBreakdown: TotalBreakdown
  paymentError?: string
}

// ─── F2 2.8-2.10 Widget SPA — tipos de soporte ─────────────────────────────
// Espejos de los usecases `public-rates.ts`, `public-upsells.ts`, `promo-validate.ts` y del
// `totalBreakdown` que devuelve `createPublicBookingDirect`. El widget los consume vía
// `BookingService.getRates/getUpsells/validatePromo` (servicios que delegan en http).

/** Item de impuesto aplicado a un room type (`amount` = monto sobre `fromPrice`). */
export interface RoomTypeTaxItem {
  name: string
  rate: number
  amount: number
}

/**
 * Por qué una ocupación NO se puede vender. Espejo de `OccupancyUnavailableReason`
 * (`bookingengine/types.ts`). El orden de precedencia lo decide el backend
 * (`usecases/occupancy-matrix.ts`): over_capacity → no_rate → stop_sell → no_availability.
 *
 * El frontend NO interpreta la precedencia: solo traduce el motivo que ya llegó decidido.
 */
export type OccupancyUnavailableReason =
  | 'over_capacity'
  | 'no_rate'
  | 'stop_sell'
  | 'no_availability'

/**
 * Una fila de la matriz de ocupaciones de un room type ("para 1", "para 2", "para 4"…), el
 * mismo despliegue que muestra el motor de la competencia (MisterPlan).
 *
 * REGLA CENTRAL: las filas que el hotel NO puede vender **no se ocultan**. Llegan igual con
 * `available:false` + `unavailableReason` para que la UI las pinte en gris. Filtrarlas sería
 * indistinguible de "este hotel no ofrece habitaciones para 4" — el huésped tiene que ver que
 * la opción existe.
 *
 * - `price`: TOTAL de la estadía para esa ocupación, en `displayCurrency` y PRE-impuestos
 *   (mismo criterio que `fromPrice`). `0` cuando no hay tarifa (`unavailableReason:'no_rate'`).
 * - `pricePerNight`: `price / nights`. Es lo que la competencia rotula "Precio 1 noches USD $70".
 * - `taxBreakdown`: impuestos calculados sobre ESTE `price` (no sobre `fromPrice`).
 */
export interface RoomOccupancyRate {
  occupancy: number
  price: number
  pricePerNight: number
  available: boolean
  /** `null` cuando `available` es true. */
  unavailableReason: OccupancyUnavailableReason | null
  taxBreakdown: RoomTypeTaxItem[]
}

/**
 * Room type disponible devuelto por `GET /api/public/hotels/:slug/rates`.
 * - `id`/`name`: ambos son el `roomType` (string libre: 'standard', 'double', ...). En este
 *   PMS no hay entidad RoomType propia — `room.type` es un string. El widget puede prettify.
 * - `fromPrice`: TOTAL de la estadía para ese type (precio por noche más bajo × noches). El
 *   spec scenario muestra "From $354 total ($100 × 3 + $54 ITBIS)" → total, no por noche.
 *   Ya viene en `displayCurrency` (convertido si el cliente pidió ?currency= distinto).
 * - `availableCount`: unidades disponibles para las fechas. D11 urgencia: ≤3 → badge "Pocas
 *   habitaciones a este precio"; ≤1 → "Última disponible"; >3 → sin badge (no falsificar).
 */
export interface RoomTypeRate {
  id: string
  name: string
  fromPrice: number
  availableCount: number
  /** Adultos que entran en la habitación (F1 hero-search-rooms-content). Passthrough de
   *  `Rooms.capacity` — el backend lo calculaba pero no lo exponía hasta este endpoint. */
  capacity: number
  /** Metros cuadrados de la habitación. Passthrough de `Rooms.surfaceArea`. */
  surfaceArea: number
  taxBreakdown: RoomTypeTaxItem[]
  /** Foto representativa del type — primera `hotel_media(type='room')` encontrada entre las
   *  rooms físicas de ese type. `null` si ninguna room del type tiene foto asignada (no se
   *  inventa un placeholder acá, el frontend decide qué mostrar en su lugar). */
  photoUrl: string | null
  /**
   * Matriz de ocupaciones: una fila por cantidad de huéspedes (1 → capacidad), incluidas las
   * NO vendibles (ver `RoomOccupancyRate`).
   *
   * OPCIONAL A PROPÓSITO: el campo es aditivo en el backend, y entre el deploy y el vencimiento
   * de la caché de `/rates` (o contra un backend viejo, o un widget embebido en un sitio con
   * respuesta cacheada en CDN) puede llegar `undefined`. La UI degrada al comportamiento previo
   * (una sola tarjeta con `fromPrice`) en vez de renderizar una lista vacía.
   */
  occupancies?: RoomOccupancyRate[]
}

/** Respuesta de `GET /api/public/hotels/:slug/rates`. */
export interface PublicRatesResponse {
  roomTypes: RoomTypeRate[]
  /** Moneda en la que están expresados los precios mostrados (puede diferir de
   *  `chargeCurrency` si el cliente pidió ?currency=). */
  currency: string
  /** Lista de impuestos del hotel (solo name + rate; el monto va por roomType en
   *  `taxBreakdown`). Informativa — el widget puede mostrar "Incluye X% ITBIS". */
  taxes: { name: string; rate: number }[]
  nights: number
  /** Moneda en la que Stripe cobrará SIEMPRE (D10: el cobro es en `hotels.currency`, el
   *  display puede ser en otra). El botón de pago lo etiqueta ("Se cobrará en DOP"). */
  chargeCurrency: string
  checkIn: string
  checkOut: string
  /** FIX 2026-07-31 — texto libre que el admin configura en /panel/booking-engine (antes se
   *  guardaba y nunca se exponía). null si el hotel no la configuró. */
  cancellationPolicy: string | null
  /** F5 #627 — Política estructurada para mostrar al huésped (tiers + ventana gratuita).
   *  null si no hay repo cableado o falla → el widget cae al texto libre `cancellationPolicy`. */
  cancellationSummary: CancellationSummary | null
}

/**
 * Tipo de habitación devuelto por `GET /api/public/hotels/:slug/room-types` — catálogo SIN
 * filtrar por disponibilidad (a diferencia de `RoomTypeRate`/`/rates`, que excluye un tipo sin
 * stock continuo para el rango de fechas pedido). Usado como fallback cuando la landing necesita
 * mostrar TODOS los tipos que el hotel vende, no solo los libres en una ventana indicativa
 * puntual (bug real 2026-08-20: un tipo reservado esos días desaparecía de la vitrina entera).
 */
export interface RoomTypeCatalogEntry {
  id: string
  name: string
  capacity: number
  surfaceArea: number
  /** `min(rooms.basePrice)` del tipo, POR NOCHE (no total de estadía, a diferencia de
   *  `RoomTypeRate.fromPrice`). 0 si ninguna unidad del tipo tiene precio cargado. */
  basePrice: number
  photoUrl: string | null
}

/** Respuesta de `GET /api/public/hotels/:slug/room-types`. */
export interface PublicRoomTypesResponse {
  roomTypes: RoomTypeCatalogEntry[]
}

/** F5 #627 — Resumen estructurado de la política de cancelación. */
export interface CancellationSummary {
  tiers: CancellationTier[]
  /** Horas antes del checkIn hasta las cuales se puede cancelar gratis. null = no reembolsable. */
  freeUntilHours: number | null
  /** Descripción legible de la penalidad después de la ventana gratuita. */
  penaltyDescription: string
  /** Fuente: 'custom' (política propia del hotel) | 'preset' (mapeada de cancellationType) | 'default'. */
  source: 'custom' | 'preset' | 'default'
}

/** Tier de penalidad de cancelación. */
export interface CancellationTier {
  deadlineHours: number
  penaltyPercent: number
  refundable: boolean
  label?: string
}

/** Query params del endpoint de rates. Todos opcionales salvo checkIn/checkOut. */
export interface PublicRatesQuery {
  checkIn: string
  checkOut: string
  rooms?: number
  guests?: number
  currency?: string
}

// ─── GET /api/public/hotels/:slug/calendar ─────────────
// Espejo EXACTO de `bookingengine/usecases/public-calendar.ts` (CalendarDay / PublicCalendarBody).
// Alimenta el calendario de rango del buscador de la landing (`components/landing/RateCalendar.vue`).
// Es el complemento de `/rates`: `/rates` responde por estadía COMPLETA una vez que el huésped
// eligió checkIn/checkOut; `/calendar` responde noche a noche mientras todavía está eligiendo.

/** Un día del calendario público. `fromPrice` es el precio de ESA noche, SIN impuestos (mismo
 *  criterio que el `fromPrice` de `/rates`, que devuelve los impuestos aparte en `taxBreakdown`
 *  — si acá se mostrara con impuestos, el precio "subiría" al pasar al selector de habitación). */
export interface CalendarDay {
  /** YYYY-MM-DD. */
  date: string
  /** Precio más bajo entre los tipos vendibles esa noche. 0 = el backend no pudo derivar precio
   *  (sin tarifa de temporada Y sin `rooms.basePrice`) → el frontend muestra la celda sin precio. */
  fromPrice: number
  /** Unidades libres ese día. 0 = no se puede entrar/dormir esa noche. */
  available: number
  /** Stop-sell: sin disponibilidad, o todas las tarifas del día marcadas `closed`. */
  closed: boolean
  /** Estadía mínima para ENTRAR ese día. Solo viene si es > 1 (el backend lo omite si no aplica). */
  minStay?: number
}

/** Query de `GET /api/public/hotels/:slug/calendar`. `from`/`to` son inclusivos y el rango no
 *  puede superar `MAX_CALENDAR_DAYS` (90) — pedir más devuelve 400. */
export interface PublicCalendarQuery {
  from: string
  to: string
  /** Huéspedes por habitación (ocupación física: adultos + niños). Default backend = 2. */
  guests?: number
  /** Moneda de display. Default = `hotels.currency`. */
  currency?: string
}

export interface PublicCalendarResponse {
  /** Moneda en la que vienen expresados los `fromPrice`. */
  currency: string
  /** Moneda real del cobro (= `hotels.currency`); `currency` puede ser solo display. */
  chargeCurrency: string
  from: string
  to: string
  guests: number
  days: CalendarDay[]
}

/** Ocupación elegida en el buscador de la landing (`components/landing/OccupancySelector.vue`).
 *  ⚠️ NO hay edades por niño: el backend público (`ExtendedPublicBookingSchema`) solo acepta
 *  `adults` y `children` como CONTADORES; un array de edades se descartaría en silencio. */
export interface Occupancy {
  adults: number
  children: number
  rooms: number
}

/**
 * Contexto con el que la landing pública (`/h/:slug`) abre el modal de reserva
 * (`components/landing/BookingModal.vue`). Se inyecta con `provideLandingBooking`
 * (composables/useLandingBooking.ts) para que cualquier bloque de la landing pueda abrirlo sin
 * prop drilling y SIN sacar al huésped de la página.
 *
 * La idea es que el modal arranque con TODO lo que el huésped ya eligió: si vino del buscador
 * del hero, no se le vuelven a pedir las fechas ni la ocupación; si vino de una card de
 * habitación, esa habitación queda preseleccionada.
 */
export interface OpenBookingOptions {
  checkIn?: string
  checkOut?: string
  /** Adultos. Se mapea a `adults` de la reserva — NUNCA sumar niños acá. */
  adults?: number
  /** Niños (contador). Suma a la ocupación física para consultar tarifas y viaja aparte al backend. */
  children?: number
  rooms?: number
  /** `RoomTypeRate.id` (roomType string, ej. 'double') a preseleccionar apenas haya tarifas. */
  roomTypeId?: string
  /** Con fechas válidas: dispara la búsqueda al abrir y arranca directo en habitaciones
   *  (el huésped ya apretó "Ver disponibilidad" en el hero — pedírselo de nuevo es un paso muerto). */
  skipToRooms?: boolean
}

export type UpsellKind = 'per_room' | 'per_person' | 'per_stay'

/**
 * Upsell activo del hotel (`GET /api/public/hotels/:slug/upsells`). Público, sin auth.
 * `price` está en `hotels.currency` (el cobro SIEMPRE es en la moneda base del hotel).
 */
export interface Upsell {
  id: string
  name: string
  description: string | null
  price: number
  kind: UpsellKind
  sortOrder: number
}

/** Cantidad seleccionada de un upsell en el step Upsells (viaja al backend como
 *  `{id, quantity}` en el body del POST /public/booking). */
export interface SelectedUpsell {
  id: string
  quantity: number
}

export type PromoValidationReason =
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'max_uses_reached'
  | 'min_amount_not_met'

/**
 * Resultado de `POST /api/public/hotels/:slug/promo/validate` con `{code, subtotal}`.
 * `valid:true` → `discount` es el monto a restar del subtotal (antes de impuestos).
 * `valid:false` → `reason` explica el rechazo (para mostrar al huésped). El uso de
 * `code` upper-case lo normaliza el backend; lo devolvemos para mostrarlo en la UI.
 */
export interface PromoValidationResult {
  valid: boolean
  discount: number
  reason?: PromoValidationReason
  code?: string
}

/**
 * Desglose del total que calcula el backend (F2 2.5). El widget lo muestra en el step Pay
 * y lo usa para etiquetar el botón ("Se cobrará X"). El cobro real lo hace Stripe sobre
 * `total` en `chargeCurrency` (D10).
 */
export interface TotalBreakdown {
  subtotal: number
  promoDiscount: number
  upsellsTotal: number
  taxes: number
  total: number
}

// ─── GET /api/public/reservations/:id?token= ──────────
// Polling post-redirect (spec booking-unification R3). Token = accessToken de la reserva.

export interface PublicReservationGuest {
  id: string
  name: string
  email?: string | null
  phone?: string | null
}

/** Subset de `Reservations` que el backend devuelve al huésped (anti-enumeración: solo
 *  llega si el token HMAC validó). No se incluye `accessToken` acá — ya vive en la URL. */
export interface PublicReservation {
  id: string
  hotelId: string
  roomId: string
  guestId?: string
  checkIn: string
  checkOut: string
  status: string
  paymentStatus?: string
  source?: string
  adults?: number
  children?: number
  totalAmount?: number
  notes?: string | null
  promoCode?: string | null
}

export interface PublicReservationResponse {
  reservation: PublicReservation
  guest: PublicReservationGuest | null
  paymentStatus: string
}

/** F4 #627 — Respuesta de auto-cancelación pública del huésped. */
export interface CancelReservationResponse {
  reservationId: string
  status: 'cancelled'
  refundAmount: number
  cancellationFee: number
  policyApplied: { tiers: unknown[]; policyId: string; source: string; label?: string } | null
  /** true si la reserva ya estaba cancelada (idempotente — no se re-procesó). */
  idempotent?: boolean
}
