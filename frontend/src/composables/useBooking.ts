// composables/useBooking.ts — State machine del widget SPA de reserva (F2 2.8, solmi-direct-booking).
//
// Pinia store setup-syntax. Orquesta los 6 steps del widget público:
//
//   idle → searching → selecting → upselling → checkingout → paying → confirmed | failed
//     0       0          1           2             3            4          5
//     └─ SearchStep   RoomsStep  UpsellsStep  GuestCheckout  PayStep   ConfirmStep
//
// El store ES la fuente de verdad: los step components son vistas que leen/escriben refs de
// acá. Navegar back/forward entre steps restaura el estado correcto porque TODO vive acá
// (cart, selectedUpsells, guest, promoCode…) — el componente solo se re-renderiza con
// lo que ya está persistido en el store (acceptance 2.8).
//
// IDEMPOTENCIA DEL BOTÓN PAGAR (acceptance 2.8): `pay()` está guardado por `isSubmitting`.
// Un doble click dispara un solo POST. El `idempotencyKey` client-side (crypto.randomUUID)
// se adjunta al body; el backend hoy dedupea por `reservation.id` en el charge de Stripe
// (anti-doble-cobro), pero la key client-side previene el doble POST del create. Tras un
// fallo real se regenera la key (reintento = nuevo intento); tras éxito + redirect, se
// conserva (la página se descarga al ir a Stripe).
//
// MULTI-MONEDA (D10, task 2.15 / Pieza 4): el store expone `currencyPreference` (lo que el
// usuario eligió en el switcher) y `availableCurrencies` (lista para el dropdown). `search()`
// manda `currency` al backend vía `?currency=` → el backend convierte server-side usando
// `configuration('currency_rates')` (cron nightly) y devuelve `ratesResponse.currency` (display)
// + `ratesResponse.chargeCurrency` (siempre = hotels.currency; el cobro real en Stripe).
//
// NO se reusa `composables/useCurrency.ts` (del panel admin) porque ese lee
// `/configuracion/currency` con `secondaryCurrency` — un esquema dual pensado para reporting
// del merchant, no para conversión display del público. El widget publica necesita conversión
// server-side con rates actualizadas por cron (D10), no una secundaria fija por hotel.
//
// Display currency = `currencyPreference` (si el usuario eligió) sino `ratesResponse.currency`
// (que cuando no se pidió ?currency= coincide con `chargeCurrency`). El switcher setea
// `currencyPreference` y dispara re-fetch si hay una búsqueda activa → cambiar EUR→USD
// convierte sin recargar la página (acceptance 2.15).

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BookingService } from '@/services/Booking.service'
import { ApiError } from '@/services/http'
import type {
  CreateBookingResponse,
  CancelReservationResponse,
  CancellationSummary,
  PromoValidationResult,
  PromoValidationReason,
  PublicChildAmenity,
  PublicMealPlan,
  PublicRatesResponse,
  PublicRoomAmenity,
  RoomOccupancyRate,
  RoomTypeRate,
  RoomTypeTaxItem,
  SelectedUpsell,
  TotalBreakdown,
  UpsellLine,
  Upsell,
  UpsellKind,
} from '@/types/booking'
// Refactor cross-cutting: monedas del enum global (types/currency.ts — source of truth único).
import { CURRENCY_CODES, type CurrencyCode } from '@/types/currency'
import { resolveChildComposition, DEFAULT_CHILD_POLICY, type ChildPolicy } from '@/utils/child-composition'

export type BookingStatus =
  | 'idle' // step 0 (SearchStep): aún no busca
  | 'searching' // step 0: getRates in-flight (transitorio)
  | 'selecting' // step 1 (RoomsStep)
  | 'upselling' // step 2 (UpsellsStep)
  | 'checkingout' // step 3 (GuestCheckoutStep)
  | 'paying' // step 4 (PayStep)
  | 'confirmed' // step 5 (ConfirmStep): post-redirect OK
  | 'failed' // step 5: error / Stripe caído / cancel

export interface BookingGuest {
  name: string
  email: string
  phone: string
  /** Hora estimada de llegada (Tarea 3.1). */
  estimatedArrival: string
  /** Pedidos especiales en texto libre (cuna, piso alto, alergias…). Corrección 2026-08-22:
   *  el dueño del producto confirmó que recibir pedidos del huésped es un requisito duro —
   *  no alcanza con reemplazarlo por el campo estructurado de arriba. */
  specialRequests: string
}

/** Índice del step (0-5) para el stepper indicator del wrapper. ConfirmStep = índice 5. */
const STEP_INDEX: Record<BookingStatus, number> = {
  idle: 0,
  searching: 0,
  selecting: 1,
  upselling: 2,
  checkingout: 3,
  paying: 4,
  confirmed: 5,
  failed: 5,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Genera un idempotency key RFC 4122 v4. Fallback a crypto.getRandomValues si randomUUID
 *  no existe (WebView viejo). nuncathrows: siempre devuelve un string no vacío. */
function genIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fallback abajo */ }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const h = [...bytes].map((b) => b.toString(16).padStart(2, '0'))
    return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`
  }
  return `bk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** Clave de sessionStorage para backup de la reserva creada. Tras el redirect de Stripe, la
 *  página de aterrizaje lee este backup para reconstruir la reserva si los placeholders
 *  `:id`/`:token` del successUrl NO fueron reemplazados por el backend (hoy no los reemplaza —
 *  ver reporte F2). TTL 24h: si el usuario vuelve al otro día, no revivimos una reserva vieja. */
function bookingSessionKey(slug: string): string {
  return `booking-widget:${slug}:last-reservation`
}

interface StoredReservation {
  reservationId: string
  accessToken: string
  at: number
}

const STORED_TTL_MS = 24 * 60 * 60 * 1000

function storeReservation(slug: string, r: StoredReservation): void {
  try {
    sessionStorage.setItem(bookingSessionKey(slug), JSON.stringify(r))
  } catch { /* sessionStorage puede estar bloqueado (modo privado) — silencioso */ }
}

export function readStoredReservation(slug: string): StoredReservation | null {
  try {
    const raw = sessionStorage.getItem(bookingSessionKey(slug))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredReservation
    if (!parsed?.reservationId || !parsed?.accessToken) return null
    if (typeof parsed.at === 'number' && Date.now() - parsed.at > STORED_TTL_MS) {
      sessionStorage.removeItem(bookingSessionKey(slug))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearStoredReservation(slug: string): void {
  try {
    sessionStorage.removeItem(bookingSessionKey(slug))
  } catch { /* silent */ }
}

/**
 * F4 #627 — Cancela una reserva pública del huésped por token.
 * Wrapper delgado sobre BookingService: el fetch vive en el service (regla: fetch SOLO
 * en services/composables, no en componentes). La página de confirmación importa esta
 * función para el botón "Cancelar reserva".
 */
export async function cancelReservation(
  id: string,
  token: string,
  reason?: string,
): Promise<CancelReservationResponse> {
  return BookingService.cancelReservation(id, token, reason)
}

/** Una línea = un tipo de habitación + una ocupación ("para N") + cuántas unidades de ESA
 *  combinación. `key` es la identidad estable de la línea. Exportada (a diferencia del resto del
 *  store interno) porque RoomsStep.vue la necesita para tipar `cartLineGuestsLabel(line)`. */
/** REQ-01 (#233) — snapshot de una amenidad infantil dentro de una `CartLine`. */
export interface CartLineChildAmenity {
  id: string
  name: string
  price: number
}

/** REQ-01 (#233) — una amenidad infantil elegida, resuelta por línea del carrito, para mostrarla
 *  en el resumen/pago (espejo de `UpsellLine`, más `roomName`/`lineKey` porque acá la selección es
 *  POR HABITACIÓN). `total` = `unitPrice × quantity` (quantity = unidades de la línea). */
export interface ChildAmenityLine {
  lineKey: string
  roomName: string
  id: string
  name: string
  unitPrice: number
  quantity: number
  total: number
}

/** REQ-01 (#290) — snapshot de una amenidad DE LA HABITACIÓN (cuna, cama extra…) dentro de una
 *  `CartLine`. `key` = `custom:<slug>` del catálogo público por tipo. */
export interface CartLineRoomAmenity {
  key: string
  name: string
  price: number
}

/** REQ-01 (#290) — una amenidad de habitación elegida, resuelta por línea del carrito, para
 *  mostrarla en el resumen/pago (espejo de `ChildAmenityLine`). `total` = `price × quantity`. */
export interface RoomAmenityLine {
  lineKey: string
  roomName: string
  key: string
  name: string
  price: number
  quantity: number
  total: number
}

export interface CartLine {
  key: string
  roomType: string
  roomName: string
  /** Ocupación CHARGEABLE (la que cotiza) — para una línea con `childrenAges`, es
   *  `effectiveAdults + payingChildren` (los niños libres no suman acá). */
  occupancy: number
  quantity: number
  /** Feature adultos+niños+edades (2026-09-02). `undefined` solo en líneas armadas por el flujo
   *  viejo de ocupación plana (`addToCart(room, occupancyNumber)`) — esas se leen por `occupancy`
   *  tal como siempre. Requerimiento 3 (2026-09-03) migró BookingModal.vue (landing) al composer
   *  de adultos+niños+edades, igual que RoomsStep.vue (widget): HOY ninguna de las dos entradas
   *  públicas llama a `addToCart` con un número plano — el branch queda como compat defensiva,
   *  no como un camino que alguna de las dos UIs siga tomando (ver Requerimiento 15, auditoría de
   *  paridad wizard/landing, 2026-09-04). */
  adults?: number
  childrenAges?: number[]
  /** Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — asociada a ESTA
   *  línea/habitación, igual criterio que `childrenAges` (a diferencia de `selectedUpsells`, que
   *  es global al carrito). `undefined`/`false` en líneas sin bebé o del flujo legacy.
   *  `cribCount` es siempre 1 cuando `needsCrib` es true — no existe cantidad configurable. */
  needsCrib?: boolean
  cribCount?: number
  /** REQ-01 (#233, amenidades para niños y bebés) — elegidas para ESTA línea/habitación, MISMO
   *  criterio que `needsCrib`: POR LÍNEA (a diferencia de `selectedUpsells`, global al carrito).
   *  Es un SNAPSHOT del catálogo público (`store.childAmenities`) tomado al agregar: nombre y
   *  precio quedan fijos en la línea para el resumen/pago aunque el catálogo cambie después. Al
   *  backend viaja solo el id (`CreateBookingChildAmenity`) — él re-resuelve precio y valida que
   *  la habitación tenga menores. `undefined` en líneas sin menores, sin amenidades elegidas o del
   *  flujo legacy. Importe de la línea = Σ price × `quantity`. */
  childAmenities?: CartLineChildAmenity[]
  /** REQ-01 (#290, amenidades de la habitación) — elegidas para ESTA línea, POR LÍNEA igual que
   *  `childAmenities`, pero SIN gateo por niños (una cama extra o una cuna se pide para cualquier
   *  composición). SNAPSHOT del catálogo por tipo (`roomAmenitiesFor(roomType)`) tomado al
   *  agregar: nombre y precio quedan fijos para el resumen. Al backend viaja solo la `key`
   *  (`CreateBookingRoomAmenity`) — él cobra el precio real de la habitación que asigna.
   *  `undefined` en líneas sin amenidades elegidas. Importe de la línea = Σ price × `quantity`. */
  roomAmenities?: CartLineRoomAmenity[]
  /** Precio de UNA unidad a esta ocupación, la estadía completa (no por noche). */
  unitPrice: number
  unitTaxBreakdown: RoomTypeTaxItem[]
  /** Tope de cantidad al agregar — `rt.availableCount` en el momento de agregar. Es una cota
   *  de UX, no la autoridad: el backend revalida disponibilidad real al crear la reserva
   *  (`createPublicBookingGroup`, 409 con el máximo real si la cotización quedó vieja). */
  maxAvailable: number
  photoUrl: string | null
}

export const useBookingStore = defineStore('booking-widget', () => {
  // ─── Hotel + búsqueda (step 0) ────────────────────────────────────────────────
  const slug = ref('')
  const checkIn = ref('')
  const checkOut = ref('')
  /**
   * ADULTOS. Se llama `guests` por historia (el widget nació sin niños) y se mapea a `adults`
   * al crear la reserva — NO meter niños acá o se graban como adultos.
   *
   * Default 1 (2026-08-20, antes 2): el buscador YA NO pide huéspedes por adelantado — cada
   * tipo de habitación tiene su propio límite, y se elige la ocupación exacta ("para 1"/"para
   * 2"/"para 4") recién al elegir el tipo (matriz de `addToCart`/`cartTotalGuests`). Default 1
   * es el único valor que no excluye NINGÚN tipo por capacidad en la búsqueda inicial
   * (`AvailabilityUseCase` filtra `capacity >= guests`) — 2 excluiría, por ejemplo, una
   * habitación individual real. Sigue siendo overridable por `?guests=` en la URL (deep-link
   * de integradores externos, `init()` abajo), solo se quitó el control de UI que lo escribía.
   */
  const guests = ref(1)
  /** Niños (contador, sin edades — el schema público solo acepta contadores). Viaja aparte al
   *  backend (`children`) y suma a la ocupación FÍSICA para consultar tarifas. */
  const children = ref(0)
  const rooms = ref(1)
  /** Política de niños del hotel (feature adultos+niños+edades, 2026-09-02) — la carga
   *  `booking-widget.vue` desde `PublicHotelInfoDTO.childPolicy` al resolver el hotel.
   *  Default = DEFAULT_CHILD_POLICY (acepta, nadie gratis) hasta que llegue la real. */
  const childPolicy = ref<ChildPolicy>({ ...DEFAULT_CHILD_POLICY })

  // ─── Resultados (step 1) ──────────────────────────────────────────────────────
  const ratesResponse = ref<PublicRatesResponse | null>(null)
  const ratesLoading = ref(false)
  const ratesError = ref<string | null>(null)

  // ─── Carrito de habitaciones (step 1) — Tarea 10, QA 2026-08-20/21 ─────────────────────────
  // Reemplaza el modelo viejo de "una sola habitación seleccionada" (`selectedRoom`/
  // `selectedOccupancy`). El huésped puede agregar VARIAS líneas — mismo tipo ×N y/o tipos
  // distintos combinados (decisión de producto 2026-08-21, Opción A, ver spec
  // booking-availability-pricing) — antes de avanzar al paso de extras.
  //
  // Una línea = un tipo de habitación + una ocupación ("para N") + cuántas unidades de ESA
  // combinación. `key` es la identidad estable de la línea (mismo tipo + misma ocupación =
  // MISMA línea, se suma cantidad; distinta ocupación del mismo tipo = línea aparte, porque
  // cotiza distinto — ver `rate-resolution.ts:sumStayPrice`).

  const cart = ref<CartLine[]>([])

  function cartLineKey(roomType: string, occupancy: number): string {
    return `${roomType}|${occupancy}`
  }

  /** Key de una línea con composición (adultos+niños+edades) — DISTINTA del formato legacy
   *  (`roomType|occupancy`) a propósito: dos habitaciones con la MISMA ocupación chargeable
   *  pero niños de edades distintas no deben mezclarse en una sola línea "×2" (el huésped
   *  espera ver cada habitación con SUS edades). Misma composición exacta (mismos adultos,
   *  mismas edades) sí se agrupa — mismo criterio de "identidad = misma línea" que ya usa el
   *  formato legacy para ocupación repetida.
   *
   *  Tarea 22 (Cuna, 2026-09-08) — la cuna entra en la key por el MISMO motivo: dos habitaciones
   *  con la misma composición pero UNA pide cuna y la otra no son pedidos DISTINTOS ("asociar la
   *  solicitud a la habitación correspondiente"). Sin esto, agregar la segunda solo incrementaría
   *  `quantity` de la primera línea y la cuna de la primera "contagiaría" a la segunda en
   *  silencio. */
  function cartLineKeyForComposition(
    roomType: string, adults: number, childrenAges: number[], needsCrib = false,
    childAmenityIds: string[] = [], roomAmenityKeys: string[] = [],
  ): string {
    const sortedAges = [...childrenAges].sort((a, b) => a - b).join('.')
    // REQ-01 (#233) — las amenidades infantiles entran en la key por el MISMO motivo que la cuna:
    // misma composición con distintas amenidades = habitaciones DISTINTAS (ids ordenados para que
    // el orden en que se tildaron no genere dos líneas para la misma elección).
    const sortedAmenities = [...new Set(childAmenityIds)].sort().join(',')
    // REQ-01 (#290) — las amenidades de la habitación, ídem. El segmento `|ra...` se agrega SOLO
    // cuando hay alguna, para que las keys de líneas sin amenidades de habitación no cambien.
    const sortedRoomAmenities = [...new Set(roomAmenityKeys)].sort().join(',')
    const base = `${roomType}|a${adults}|c${sortedAges}|crib${needsCrib ? 1 : 0}|am${sortedAmenities}`
    return sortedRoomAmenities ? `${base}|ra${sortedRoomAmenities}` : base
  }

  // ─── Upsells (step 2) ─────────────────────────────────────────────────────────
  const upsells = ref<Upsell[]>([])
  const upsellsLoading = ref(false)
  const selectedUpsells = ref<SelectedUpsell[]>([])

  // ─── Regímenes de alimentación (step 1, tasks.md 2.2/2.4) ──────────────────────
  // Los regímenes se muestran DESDE que aparece la lista de habitaciones (RoomsStep) —
  // se cargan junto con `search()`. Solo informativo esta fase: "Solo alojamiento" es la
  // base implícita (no viene del backend); `priceMode:'per_person_per_night'` se muestra
  // con precio pero NO es seleccionable todavía (ver alcance en el plan aprobado).
  //
  // `upsells` también se precarga junto con `search()` (igual que mealPlans, ver mismo
  // motivo abajo): un composer que necesite mostrar el catálogo de extras ANTES de
  // "Agregar esta habitación" (no recién al llegar a UpsellsStep) puede confiar en que ya
  // está disponible, sin ida y vuelta adicional al backend en ese momento.
  const mealPlans = ref<PublicMealPlan[]>([])
  const mealPlansLoading = ref(false)

  // ─── Amenidades para niños/bebés (REQ-01 #233, step 1) ──────────────────────
  // Catálogo público ACTIVO del hotel (`GET /public/hotels/:slug/child-amenities`), precargado en
  // `search()` junto a mealPlans/upsells por el mismo motivo: el composer de cada tarjeta lo
  // necesita ANTES de "Agregar esta habitación". Nombres y precios vienen SIEMPRE del backend —
  // nunca hay lista ni precios en código. La selección NO vive acá sino en cada `CartLine`
  // (por habitación, ver `CartLine.childAmenities`). Fallo silencioso → `[]` (no se ofrecen).
  const childAmenities = ref<PublicChildAmenity[]>([])

  // ─── Amenidades de la habitación (REQ-01 #290, step 1) ───────────────────────
  // Catálogo público POR TIPO (`GET /public/hotels/:slug/room-amenities` → `byRoomType`): las
  // amenidades personalizadas (cuna, cama extra…) que el hotel configuró en cada habitación, con
  // el precio mínimo del tipo. Mismo criterio que `childAmenities`: precargado en `search()`, la
  // selección vive en cada `CartLine` (`CartLine.roomAmenities`), fallo silencioso → `{}`.
  const roomAmenities = ref<Record<string, PublicRoomAmenity[]>>({})

  /** Catálogo de amenidades de habitación de UN tipo (`rt.id`). `[]` si el tipo no ofrece. */
  function roomAmenitiesFor(roomTypeId: string): PublicRoomAmenity[] {
    const list = roomAmenities.value[roomTypeId]
    return Array.isArray(list) ? list : []
  }

  // ─── Guest (step 3) ───────────────────────────────────────────────────────────
  const guest = ref<BookingGuest>({ name: '', email: '', phone: '', estimatedArrival: '', specialRequests: '' })

  // ─── Promo (step 4) ───────────────────────────────────────────────────────────
  const promoCode = ref('')
  const promoResult = ref<PromoValidationResult | null>(null)
  const promoLoading = ref(false)

  // ─── Estado de la máquina ─────────────────────────────────────────────────────
  const status = ref<BookingStatus>('idle')
  const error = ref<string | null>(null)
  // #267 — localizador (8 chars del reservationId) cuando la reserva se creó SIN pasarela:
  // PayStep lo muestra como aviso "recibimos tu pedido" en lugar de un error rojo.
  const receivedUnpaidLocator = ref<string | null>(null)

  // ─── Multi-moneda (D10, task 2.15) ────────────────────────────────────────────
  // `currencyPreference` es lo que el usuario eligió en el switcher ('' = auto/detect).
  // `availableCurrencies` se populated al recibir la primera ratesResponse: incluye la
  // chargeCurrency del hotel + un puñado de monedas comunes para el switcher.
  const currencyPreference = ref('')
  const availableCurrencies = ref<string[]>([])

  // ─── Pago (step 4 → 5) ────────────────────────────────────────────────────────
  const reservation = ref<CreateBookingResponse | null>(null)
  const isSubmitting = ref(false)
  const idempotencyKey = ref('')

  // ═══ COMPUTED ═════════════════════════════════════════════════════════════════
  /** Índice del step actual para el stepper indicator (0-5). */
  const currentStep = computed(() => STEP_INDEX[status.value])

  /**
   * Ocupación FÍSICA por habitación = adultos + niños.
   *
   * FIX (bug de ocupación landing↔motor): `GET /rates` y `GET /calendar` filtran por
   * `rooms.capacity >= guests` y eligen la fila de `room_rates` por `occupancy` — un niño ocupa
   * una plaza igual que un adulto. El calendario de la landing ya consultaba con adultos+niños
   * (`HeroSearchBar.totalOccupancy`), pero `search()` mandaba solo adultos: con `children > 0`
   * el precio podía moverse entre el hero y el paso de habitaciones. Esta computed es el único
   * criterio de ocupación para consultar tarifas; `guests` (adultos) sigue siendo lo que se
   * manda como `adults` al crear la reserva.
   */
  const physicalGuests = computed(() => Math.max(1, guests.value + Math.max(0, children.value)))

  /** Moneda en la que se muestran los precios (display). D10: el cobro es en chargeCurrency.
   *
   *  Manda SIEMPRE lo que devolvió el backend, no lo que el usuario eligió. El backend degrada
   *  a la moneda base cuando no tiene tasa para la pedida (`configuration('currency_rates')`
   *  vacío o sin esa moneda) y lo declara en `currency`. Antes la preferencia pisaba esa
   *  respuesta: pedías EUR, el backend contestaba precios en USD, y el widget los rotulaba
   *  "€80.00" — el huésped veía un precio en una moneda que nadie convirtió, y Stripe le
   *  cobraba en chargeCurrency. Verificado en local pidiendo ?currency=EUR y ?currency=DOP.
   *  La preferencia solo se usa mientras todavía no hay respuesta (primer render). */
  const displayCurrency = computed(() => ratesResponse.value?.currency || currencyPreference.value || '')

  /** True cuando el backend NO pudo dar la moneda elegida y está mostrando otra. La UI lo avisa
   *  en vez de dejar creer que el precio está convertido. */
  const currencyUnavailable = computed(() => {
    const pref = currencyPreference.value
    const actual = ratesResponse.value?.currency
    return pref !== '' && !!actual && pref !== actual
  })

  /** Moneda en la que Stripe cobrará (siempre = hotels.currency). El botón de pago lo etiqueta. */
  const chargeCurrency = computed(() => ratesResponse.value?.chargeCurrency ?? '')

  const nights = computed(() => ratesResponse.value?.nights ?? 0)
  // FIX 2026-07-31 — antes el admin la escribía en /panel/booking-engine y nunca llegaba al
  // widget (el backend tampoco la exponía). Ver public-rates.ts.
  const cancellationPolicy = computed(() => ratesResponse.value?.cancellationPolicy ?? null)
  // F5 #627 — Política estructurada (tiers + ventana gratuita) para mostrar en PayStep.
  // Si el backend no la envió, cae a null → PayStep usa el texto libre `cancellationPolicy`.
  const cancellationSummary = computed<CancellationSummary | null>(
    () => ratesResponse.value?.cancellationSummary ?? null,
  )

  /** Cantidad total de habitaciones en el carrito (Σ quantity de todas las líneas). Es lo que
   *  el paso de resumen muestra como "habitaciones a reservar". */
  const cartTotalRooms = computed(() => cart.value.reduce((s, l) => s + l.quantity, 0))

  /** Huéspedes totales que el carrito aloja (Σ occupancy × quantity de cada línea) — lo que el
   *  paso de resumen muestra como "huéspedes totales". Los niños (`children`, trip-level, sin
   *  asignar a una habitación específica) NO están incluidos acá — ver nota en `pay()`. */
  const cartTotalGuests = computed(() => cart.value.reduce((s, l) => s + l.occupancy * l.quantity, 0))

  /** Niños TOTALES del carrito (libres + con plaza, Σ childrenAges.length × quantity de cada
   *  línea) — a diferencia de `cartTotalGuests` (que excluye a los niños libres, "no consumen
   *  plaza"), esto cuenta a TODOS: un bebé libre igual desayuna. Líneas legacy (sin
   *  `childrenAges`, `undefined`) no aportan — mismo criterio que `children` (contador trip-level)
   *  antes de esta feature: 0 si no se declaró ninguno. */
  const cartTotalChildren = computed(() => cart.value.reduce((s, l) => s + (l.childrenAges?.length ?? 0) * l.quantity, 0))

  /**
   * Requerimiento 7 (2026-09-03) — niños que NO consumen plaza (libres) en todo el carrito.
   *
   * FIX: `cartTotalGuests + cartTotalChildren` (usado antes acá para "por persona") CONTABA DOS
   * VECES a un niño con plaza — `cartTotalGuests` ya lo incluye (es ocupación CHARGEABLE =
   * adultos + niños con plaza), y `cartTotalChildren` lo vuelve a sumar porque cuenta TODOS los
   * niños sin distinguir. Solo los niños LIBRES son población física que `cartTotalGuests` deja
   * afuera — un niño libre igual desayuna, aunque no pague habitación. La fórmula correcta para
   * "ocupación física total" (extras por persona) es `cartTotalGuests + cartTotalFreeChildren`.
   */
  const cartTotalFreeChildren = computed(() => cart.value.reduce((s, l) => {
    if (!l.childrenAges || l.childrenAges.length === 0) return s
    const composition = resolveChildComposition(l.adults ?? 0, l.childrenAges, childPolicy.value)
    return s + composition.freeChildren * l.quantity
  }, 0))

  /** Subtotal de TODAS las habitaciones del carrito (antes de upsells/promo/impuestos). */
  const roomsSubtotal = computed(() => round2(
    cart.value.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
  ))

  /** Tasas del hotel (nombre + %), tal como las publica `/rates`. Si la respuesta no las trae
   *  (widget embebido contra un backend viejo), se deducen de las líneas del carrito. */
  const taxRates = computed<RoomTypeTaxItem[]>(() => {
    const fromRates = ratesResponse.value?.taxes
    if (Array.isArray(fromRates) && fromRates.length > 0) return fromRates.map((t) => ({ name: t.name, rate: t.rate, amount: 0 }))
    const seen = new Map<string, RoomTypeTaxItem>()
    for (const l of cart.value) for (const t of l.unitTaxBreakdown) if (!seen.has(t.name)) seen.set(t.name, { name: t.name, rate: t.rate, amount: 0 })
    return [...seen.values()]
  })

  /** Subtotal room(s)+upsells+amenidades infantiles+amenidades de habitación ANTES de promo e
   *  impuestos — misma cuenta que `totalBreakdown.subtotal` del backend. Promo se aplica sobre
   *  este monto. */
  const subtotal = computed(() => round2(
    roomsSubtotal.value + upsellsTotal.value + childAmenitiesTotal.value + roomAmenitiesTotal.value,
  ))

  /** Bebés del carrito (subconjunto de `cartTotalFreeChildren`, misma cuenta). No consumen
   *  desayuno ni transfer: se restan de las personas que multiplican un extra por persona. */
  const cartTotalBabies = computed(() => cart.value.reduce((s, l) => {
    if (!l.childrenAges || l.childrenAges.length === 0) return s
    const composition = resolveChildComposition(l.adults ?? 0, l.childrenAges, childPolicy.value)
    return s + composition.babies * l.quantity
  }, 0))

  /** MR-10 (#275) — personas que consumen un extra "por persona": adultos + niños con plaza +
   *  niños libres, SIN bebés. Misma cuenta que `ctx.persons` de `resolveUpsellLines` en el
   *  backend: si acá diera otro número el stepper dejaría pedir lo que el POST rechaza con 400. */
  const upsellPersons = computed(() => Math.max(0, cartTotalGuests.value + cartTotalFreeChildren.value - cartTotalBabies.value))

  /** Noches que multiplican un extra por noche: las de `/rates`; 1 si todavía no hay tarifas. */
  const upsellNights = computed(() => Math.max(1, nights.value))

  /**
   * MR-10 (#275) — tope de cantidad por `kind`, espejo de `upsellMaxQuantity` del backend
   * (`bookingengine/usecases/upsell-pricing.ts`): per_room ≤ habitaciones del carrito,
   * per_person ≤ personas sin bebés, per_stay/per_night/ppn = 1. Nunca baja de 1 para que el
   * stepper no quede clavado en 0 con el carrito vacío.
   */
  function upsellMaxQty(kind: UpsellKind): number {
    switch (kind) {
      case 'per_room': return Math.max(1, cartTotalRooms.value)
      case 'per_person': return Math.max(1, upsellPersons.value)
      default: return 1
    }
  }

  /** Cantidad efectiva de un extra: la pedida acotada al tope del kind (1 en los de cantidad fija). */
  function effectiveUpsellQty(kind: UpsellKind, requested: number): number {
    const qty = Math.max(1, Math.floor(Number(requested) || 1))
    return Math.min(qty, upsellMaxQty(kind))
  }

  /** Multiplicadores de estadía de un kind: noches y personas (sólo ppn). */
  function upsellStayFactors(kind: UpsellKind): { nights: number; persons?: number } {
    if (kind === 'per_night') return { nights: upsellNights.value }
    if (kind === 'per_person_per_night') return { nights: upsellNights.value, persons: upsellPersons.value }
    return { nights: 1 }
  }

  /**
   * MR-10 (#275) — precio de UNA unidad del extra para ESTA estadía: per_night → price × noches,
   * ppn → price × personas × noches, resto → price. Es lo que UpsellsStep muestra en la tarjeta
   * (el huésped ve lo que va a pagar, no el precio de catálogo "por noche").
   */
  function upsellStayPrice(upsell: Pick<Upsell, 'price' | 'kind'>): number {
    const f = upsellStayFactors(upsell.kind)
    return round2(Number(upsell.price) * f.nights * (f.persons ?? 1))
  }

  /** Extras elegidos, uno por línea con la matemática por `kind` (MR-10 #275, misma cuenta que
   *  `resolveUpsellLines` del backend: `unitPrice × quantity × nights × (persons ?? 1)`). La
   *  cantidad pedida se acota al tope del kind (1 en per_stay/per_night/ppn) — #88 pide verlos
   *  por separado en el resumen/pago. */
  const upsellLines = computed<UpsellLine[]>(() => {
    const byId = new Map(upsells.value.map((u) => [u.id, u]))
    // Mismo id repetido → una sola línea con Σ cantidades ANTES de acotar al tope (espejo exacto
    // de `upsell-pricing.ts`): `setSelectedUpsells` ya consolida, pero el computed no depende de
    // que todos los callers pasen por ahí — y `pay()` manda ESTAS líneas al POST.
    const requested = new Map<string, number>()
    for (const sel of selectedUpsells.value) {
      if (!sel || typeof sel.id !== 'string') continue
      requested.set(sel.id, (requested.get(sel.id) ?? 0) + Math.max(0, Math.floor(Number(sel.quantity) || 0)))
    }
    const lines: UpsellLine[] = []
    for (const [id, qty] of requested) {
      const found = byId.get(id)
      if (!found || qty <= 0) continue
      const quantity = effectiveUpsellQty(found.kind, qty)
      const unitPrice = Number(found.price)
      const f = upsellStayFactors(found.kind)
      const line: UpsellLine = {
        id: found.id,
        name: found.name,
        kind: found.kind,
        quantity,
        unitPrice,
        nights: f.nights,
        total: round2(unitPrice * quantity * f.nights * (f.persons ?? 1)),
      }
      if (f.persons !== undefined) line.persons = f.persons
      lines.push(line)
    }
    return lines
  })

  /** Suma de upsells seleccionados (Σ `upsellLines[].total`). En `hotels.currency` (chargeCurrency). */
  const upsellsTotal = computed(() => round2(upsellLines.value.reduce((s, l) => s + l.total, 0)))

  /** REQ-01 (#233) — Σ de amenidades infantiles de TODAS las líneas: (Σ price de la línea) ×
   *  quantity. Precios del snapshot de cada línea (en `chargeCurrency`, igual que upsells). */
  const childAmenitiesTotal = computed(() => round2(
    cart.value.reduce((s, l) => s + (l.childAmenities ?? []).reduce((a, am) => a + Number(am.price), 0) * l.quantity, 0),
  ))

  /** REQ-01 (#233) — amenidades infantiles elegidas, una fila por (habitación × amenidad), para
   *  verlas por separado en el resumen/pago (espejo de `upsellLines`, pero POR LÍNEA). */
  const childAmenityLines = computed<ChildAmenityLine[]>(() => {
    const lines: ChildAmenityLine[] = []
    for (const l of cart.value) {
      for (const am of l.childAmenities ?? []) {
        const unitPrice = Number(am.price)
        lines.push({
          lineKey: l.key, roomName: l.roomName, id: am.id, name: am.name,
          unitPrice, quantity: l.quantity, total: round2(unitPrice * l.quantity),
        })
      }
    }
    return lines
  })

  /** REQ-01 (#290) — Σ de amenidades de habitación de TODAS las líneas: (Σ price de la línea) ×
   *  quantity. Precios del snapshot de cada línea (en `chargeCurrency`, igual que upsells). */
  const roomAmenitiesTotal = computed(() => round2(
    cart.value.reduce((s, l) => s + (l.roomAmenities ?? []).reduce((a, am) => a + Number(am.price), 0) * l.quantity, 0),
  ))

  /** REQ-01 (#290) — amenidades de habitación elegidas, una fila por (línea × amenidad), para
   *  verlas por separado en el resumen/pago (espejo de `childAmenityLines`). */
  const roomAmenityLines = computed<RoomAmenityLine[]>(() => {
    const lines: RoomAmenityLine[] = []
    for (const l of cart.value) {
      for (const am of l.roomAmenities ?? []) {
        const price = Number(am.price)
        lines.push({
          lineKey: l.key, roomName: l.roomName, key: am.key, name: am.name,
          price, quantity: l.quantity, total: round2(price * l.quantity),
        })
      }
    }
    return lines
  })

  const promoDiscount = computed(() =>
    promoResult.value?.valid ? Number(promoResult.value.discount) || 0 : 0,
  )

  /** Base imponible (subtotal - promo). Sobre esto caen los impuestos. */
  const taxableBase = computed(() => round2(Math.max(0, subtotal.value - promoDiscount.value)))

  /** Tarea 24 (#88): impuesto por impuesto sobre la base imponible, con la MISMA cuenta que el
   *  backend (`hotel-taxes.ts:taxLinesOn`: cada línea `round2(base × rate / 100)`, y el total es la
   *  suma de las líneas). Por eso lo que el huésped ve antes de crear la reserva es, centavo por
   *  centavo, lo que `totalBreakdown` devuelve después y lo que Stripe cobra. */
  const estimatedTaxBreakdown = computed<RoomTypeTaxItem[]>(() => {
    if (cart.value.length === 0) return []
    const base = taxableBase.value
    return taxRates.value.map((t) => ({ name: t.name, rate: t.rate, amount: round2((base * t.rate) / 100) }))
  })

  const estimatedTaxes = computed(() => round2(estimatedTaxBreakdown.value.reduce((s, t) => s + t.amount, 0)))

  /** Total estimado pre-create. El step Pay muestra esto; el botón confía en `totalBreakdown.total`. */
  const estimatedTotal = computed(() =>
    round2(taxableBase.value + estimatedTaxes.value),
  )

  /** Desglose del total post-create (devuelto por el backend). Nulo hasta que se crea la reserva. */
  const totalBreakdown = computed<TotalBreakdown | null>(() => reservation.value?.totalBreakdown ?? null)

  // ═══ VALIDACIONES POR STEP ═══════════════════════════════════════════════════
  // Cada step valida antes de avanzar (acceptance 2.9). `stepValid(n)` returns true si el
  // step n tiene todo lo necesario para continuar.

  const searchValid = computed(() => {
    if (!checkIn.value || !checkOut.value) return false
    if (checkOut.value <= checkIn.value) return false
    // checkIn no en el pasado (permite hoy mismo — check-in del día).
    //
    // FIX 2026-07-31 (bug real encontrado por QA, timezones negativos ej. Santo Domingo
    // UTC-4) — `new Date('2026-08-05')` parsea el string date-only como MEDIANOCHE UTC, no
    // local. `today` se construía con `new Date()` + `setHours(0,0,0,0)`, que es medianoche
    // LOCAL. En UTC-4, medianoche local del 5 = las 04:00 UTC del 5, mientras que el checkIn
    // parseado da las 00:00 UTC del 5 — 00:00 UTC < 04:00 UTC, así que elegir HOY como
    // check-in se evaluaba como "en el pasado" y el botón de reservar quedaba deshabilitado
    // para cualquier huésped reservando el mismo día. Fix: comparar como strings 'YYYY-MM-DD'
    // (mismo formato que ya produce el calendario), sin pasar por Date en ningún lado — evita
    // el parseo UTC por completo.
    const t = new Date()
    const todayLocal = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    return checkIn.value >= todayLocal
  })

  /** Al menos 1 línea en el carrito. La disponibilidad real de cada línea ya se filtra al
   *  agregarla (`addToCart` solo agrega filas `available`) y se revalida server-side al crear
   *  la reserva — acá solo hace falta saber si hay algo que reservar. */
  const roomsValid = computed(() => cart.value.length > 0)

  /** Upsells step siempre es válido (selección opcional). */
  const upsellsValid = computed(() => upsellsLoading.value === false)

  const guestValid = computed(() => {
    const g = guest.value
    return g.name.trim().length >= 2 && EMAIL_RE.test(g.email.trim()) && g.phone.trim().length >= 5
  })

  /** Step actual válido (para habilitar el botón "Continuar"). */
  const currentStepValid = computed(() => {
    switch (status.value) {
      case 'idle':
      case 'searching':
        return searchValid.value
      case 'selecting':
        return roomsValid.value
      case 'upselling':
        return upsellsValid.value
      case 'checkingout':
        return guestValid.value
      default:
        return true
    }
  })

  // ═══ ACCIONES ═════════════════════════════════════════════════════════════════

  /** Inicializa el store para un hotel. Reset completo + lee query params de la URL
   *  (?checkIn=, ?checkOut=, ?guests=) para deep-link desde la landing CTA "Ver disponibilidad". */
  function init(
    hotelSlug: string,
    opts?: { checkIn?: string; checkOut?: string; guests?: number; children?: number; rooms?: number },
  ) {
    slug.value = hotelSlug
    if (opts?.checkIn) checkIn.value = opts.checkIn
    if (opts?.checkOut) checkOut.value = opts.checkOut
    if (typeof opts?.guests === 'number' && Number.isFinite(opts.guests)) guests.value = Math.max(1, opts.guests)
    if (typeof opts?.children === 'number' && Number.isFinite(opts.children)) children.value = Math.max(0, opts.children)
    if (typeof opts?.rooms === 'number' && Number.isFinite(opts.rooms)) rooms.value = Math.max(1, opts.rooms)
    status.value = 'idle'
    error.value = null
    receivedUnpaidLocator.value = null
  }

  /** Step 0 → 1: dispara GET /rates. Idempotente: si ya hay rates para las mismas fechas
   *  Y misma currencyPreference, no recarga. Setea status a 'selecting' al éxito.
   *  Multi-moneda (D10): pasa `currency` al backend si el usuario eligió una distinta de la
   *  chargeCurrency; el backend convierte server-side con `configuration('currency_rates')`. */
  async function search(): Promise<void> {
    if (!slug.value || !searchValid.value) return
    status.value = 'searching'
    ratesLoading.value = true
    ratesError.value = null
    // Regímenes: se muestran junto a la lista de habitaciones (RoomsStep), así que se piden EN
    // PARALELO con las tarifas — no secuencial después. Si se pidieran después de que `status`
    // ya pasa a 'selecting', RoomsStep monta con `store.mealPlans` todavía vacío y el eje entero
    // parpadea como "no disponible" un instante antes de asentarse en el estado real. Fallo
    // silencioso (degrada a array vacío) — nunca bloquea poder reservar el alojamiento.
    const needsMealPlans = mealPlans.value.length === 0
    if (needsMealPlans) mealPlansLoading.value = true
    // Envuelta en una función async: si `getMealPlans` explota de forma SÍNCRONA (mock de test
    // incompleto, o cualquier otro fallo antes del primer await), una función async lo convierte
    // en promesa rechazada en vez de tirar en el call site — Promise.all necesita que las DOS
    // ramas sean siempre promesas, nunca un throw directo.
    const fetchMealPlansSafe = async (): Promise<PublicMealPlan[]> => {
      try {
        return await BookingService.getMealPlans(slug.value)
      } catch {
        return []
      }
    }
    const mealPlansPromise = needsMealPlans ? fetchMealPlansSafe() : Promise.resolve(mealPlans.value)
    const needsUpsells = upsells.value.length === 0
    if (needsUpsells) upsellsLoading.value = true
    const fetchUpsellsSafe = async (): Promise<Upsell[]> => {
      try {
        return await BookingService.getUpsells(slug.value)
      } catch {
        return []
      }
    }
    const upsellsPromise = needsUpsells ? fetchUpsellsSafe() : Promise.resolve(upsells.value)
    // REQ-01 (#233) — catálogo de amenidades infantiles, mismo criterio que mealPlans/upsells:
    // en paralelo, fallo silencioso a `[]` (sin catálogo simplemente no se ofrecen).
    const needsChildAmenities = childAmenities.value.length === 0
    const fetchChildAmenitiesSafe = async (): Promise<PublicChildAmenity[]> => {
      try {
        return await BookingService.getChildAmenities(slug.value)
      } catch {
        return []
      }
    }
    const childAmenitiesPromise = needsChildAmenities ? fetchChildAmenitiesSafe() : Promise.resolve(childAmenities.value)
    // REQ-01 (#290) — catálogo de amenidades de habitación por tipo, mismo criterio: en paralelo,
    // fallo silencioso a `{}` (sin catálogo simplemente no se ofrecen).
    const needsRoomAmenities = Object.keys(roomAmenities.value).length === 0
    const fetchRoomAmenitiesSafe = async (): Promise<Record<string, PublicRoomAmenity[]>> => {
      try {
        return await BookingService.getRoomAmenities(slug.value)
      } catch {
        return {}
      }
    }
    const roomAmenitiesPromise = needsRoomAmenities ? fetchRoomAmenitiesSafe() : Promise.resolve(roomAmenities.value)
    try {
      const [res, mp, ups, cam, ram] = await Promise.all([
        BookingService.getRates(slug.value, {
          checkIn: checkIn.value,
          checkOut: checkOut.value,
          rooms: rooms.value,
          // Ocupación FÍSICA (adultos + niños) — mismo criterio que el calendario de la landing.
          guests: physicalGuests.value,
          ...(currencyPreference.value ? { currency: currencyPreference.value } : {}),
        }),
        mealPlansPromise,
        upsellsPromise,
        childAmenitiesPromise,
        roomAmenitiesPromise,
      ])
      ratesResponse.value = res
      if (needsMealPlans) mealPlans.value = mp
      if (needsUpsells) upsells.value = ups
      if (needsChildAmenities) childAmenities.value = Array.isArray(cam) ? cam : []
      if (needsRoomAmenities) roomAmenities.value = ram && typeof ram === 'object' && !Array.isArray(ram) ? ram : {}
      // Llenamos el switcher de monedas: la del cobro (base del hotel) + la última display
      // elegada + un puñado de monedas comunes para turistas. Dedupe + orden estable.
      availableCurrencies.value = buildCurrencyOptions(res.chargeCurrency, res.currency, currencyPreference.value)
      // Fechas nuevas invalidan el carrito anterior: precios/disponibilidad de la búsqueda vieja
      // ya no aplican (mismo criterio que antes con selectedRoom/selectedOccupancy).
      cart.value = []
      status.value = 'selecting'
    } catch (e) {
      ratesError.value = errMessage(e, 'No pudimos cargar la disponibilidad. Probá de nuevo.')
      // Volvemos a idle para que el usuario pueda reintentar la búsqueda.
      status.value = 'idle'
    } finally {
      ratesLoading.value = false
      mealPlansLoading.value = false
      upsellsLoading.value = false
    }
  }

  /** Cambia la moneda display. Si hay rates cargados para las fechas actuales, re-fetch
   *  (el backend convierte). Si no hay rates todavía, solo setea la preferencia — el próximo
   *  search() la va a mandar. Cumple acceptance 2.15: cambiar EUR→USD convierte sin recargar
   *  la página. Si code === '' volvemos a "auto" (la chargeCurrency del hotel). */
  async function setCurrency(code: string): Promise<void> {
    const normalized = code.trim().toUpperCase()
    if (normalized === currencyPreference.value) return
    currencyPreference.value = normalized
    // Si ya tenemos rates para estas fechas, re-fetch con la nueva currency. Sino, no hay
    // nada que convertir todavía — el próximo search() mandará la currency.
    if (ratesResponse.value && searchValid.value && (status.value === 'selecting' || status.value === 'upselling' || status.value === 'checkingout' || status.value === 'paying')) {
      // Re-fetch preservando selección de room/upsells (solo cambian precios, no disponibilidad).
      // No movemos status: el usuario sigue donde estaba.
      const prevStatus = status.value
      try {
        const res = await BookingService.getRates(slug.value, {
          checkIn: checkIn.value,
          checkOut: checkOut.value,
          rooms: rooms.value,
          guests: physicalGuests.value,
          ...(normalized ? { currency: normalized } : {}),
        })
        ratesResponse.value = res
        availableCurrencies.value = buildCurrencyOptions(res.chargeCurrency, res.currency, normalized)
        // Re-sincroniza el precio de CADA línea del carrito con la respuesta en la nueva moneda
        // (mismo tipo+ocupación, precio convertido). Una línea que ya no aparezca en la nueva
        // respuesta (caso raro: se vendió justo entre medio) queda con su último precio conocido
        // — la revalidación real es server-side al pagar, esto es solo display.
        for (const line of cart.value) {
          const updated = res.roomTypes.find((rt) => rt.id === line.roomType)
          const row = updated?.occupancies?.find((o) => o.occupancy === line.occupancy)
          if (row) {
            line.unitPrice = row.price
            line.unitTaxBreakdown = row.taxBreakdown
          } else if (updated) {
            line.unitPrice = updated.fromPrice
            line.unitTaxBreakdown = updated.taxBreakdown
          }
        }
        status.value = prevStatus
      } catch {
        // Si falla la conversión, no rompemos: dejamos la moneda anterior (el switcher revierte).
        currencyPreference.value = ratesResponse.value?.currency ?? ''
        status.value = prevStatus
      }
    }
  }

  /**
   * Step 1: agrega una línea al carrito — un tipo de habitación + una ocupación ("para N") + 1
   * unidad más. Reemplaza al viejo `selectRoom` (Tarea 10, QA 2026-08-20/21): el huésped puede
   * agregar VARIAS líneas (mismo tipo ×N y/o tipos distintos) antes de continuar — no avanza de
   * step automáticamente, el componente llama a `next()` cuando el huésped ya armó su selección.
   *
   * Si la MISMA combinación tipo+ocupación ya está en el carrito, suma 1 a su cantidad (tope
   * `rt.availableCount` — cota de UX; la autoridad real es el backend al crear la reserva,
   * `createPublicBookingGroup` revalida y devuelve 409 con el máximo real si quedó desactualizado).
   *
   * `occupancy` omitido = la tarjeta entera sin fila (fallback cuando el backend no manda
   * `occupancies`, comportamiento previo a la matriz): se agrega 1 unidad al precio publicado
   * (`fromPrice`), ocupación efectiva = 1 (no se puede saber cuánta gente sin la fila elegida).
   *
   * Feature adultos+niños+edades (2026-09-02): el segundo parámetro también acepta
   * `{adults, childrenAges}` — tanto RoomsStep.vue (widget) como BookingModal.vue (landing, desde
   * el Requerimiento 3) arman esa composición vía `useGuestComposer.addComposedRoom`, la ocupación
   * a cotizar sale de `resolveChildComposition` contra `childPolicy` (niños libres no suman). El
   * `occupancy` numérico plano es compat defensiva — ninguna de las dos entradas públicas lo llama
   * hoy (confirmado en la auditoría de paridad del Requerimiento 15, 2026-09-04).
   *
   * REQ-01 (#233): `childAmenityIds` (ids del catálogo `childAmenities`) se resuelven a un
   * SNAPSHOT `{id, name, price}` en la línea. Ids desconocidos se ignoran, y SOLO se guardan si la
   * composición tiene al menos un menor (`childrenAges.length > 0`) Y el hotel acepta niños
   * (`childPolicy.acceptChildren`) — mismo gateo que el backend (`public-booking.ts`), para que
   * ningún caller pueda mostrar un total con amenidades que después no se cobran.
   *
   * REQ-01 (#290): `roomAmenityKeys` (keys del catálogo por tipo, `roomAmenitiesFor(room.id)`) se
   * resuelven a un SNAPSHOT `{key, name, price}` en la línea. Keys desconocidas se ignoran. SIN
   * gateo por niños: una cuna o cama extra se pide para cualquier composición.
   */
  async function addToCart(
    room: RoomTypeRate,
    occupancy?: number | {
      adults: number; childrenAges: number[]
      // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No).
      needsCrib?: boolean; cribCount?: number
      // REQ-01 (#233) — amenidades para niños/bebés de ESTA habitación.
      childAmenityIds?: string[]
      // REQ-01 (#290) — amenidades DE la habitación (cuna, cama extra…) de ESTA línea.
      roomAmenityKeys?: string[]
    },
  ): Promise<void> {
    const isComposition = typeof occupancy === 'object' && occupancy !== null
    const composition = isComposition
      ? resolveChildComposition(occupancy.adults, occupancy.childrenAges, childPolicy.value)
      : null

    const occ = isComposition
      ? composition!.chargeableOccupancy
      : (typeof occupancy === 'number' && Number.isFinite(occupancy) && occupancy > 0 ? Math.floor(occupancy) : null)
    const row = occ !== null ? room.occupancies?.find((o) => o.occupancy === occ) : null
    // Defensa: no agregar una fila que el backend marcó no vendible (la UI ya la deshabilita —
    // esto cubre un estado viejo: deep-link, fechas cambiadas sin refrescar la matriz).
    if (row && !row.available) return

    let unitPrice = row?.price ?? room.fromPrice
    let unitTaxBreakdown = row?.taxBreakdown ?? room.taxBreakdown
    // Tarea "Cobro % niños" (2026-09-09) — el precio que SE MUESTRA en la tarjeta al componer
    // (`useGuestComposer.composedPrice`, MISMA fórmula) tiene que ser el que queda en el carrito:
    // sin esto, `roomsSubtotal`/el resumen/el pago seguían leyendo la fila plana de
    // `chargeableOccupancy` (la tarifa SIN descontar), aunque el composer ya mostraba el precio
    // correcto — el huésped vería un número al elegir y otro distinto al pagar. El impuesto se
    // reescala PROPORCIONALMENTE: la fila original trae el impuesto calculado sobre el precio
    // plano, no sobre el descontado. (Solo para la etiqueta de la tarjeta: el desglose que se
    // paga sale de `estimatedTaxBreakdown`, sobre la base imponible real.)
    if (isComposition && childPolicy.value.childrenDiscountEnabled && composition!.payingChildren > 0) {
      const adultsRow = room.occupancies?.find((o) => o.occupancy === composition!.effectiveAdults)
      if (adultsRow) {
        const perAdult = adultsRow.price / Math.max(1, composition!.effectiveAdults)
        const pct = Math.min(100, Math.max(1, childPolicy.value.childrenRatePercent)) / 100
        const discounted = round2(adultsRow.price + composition!.payingChildren * pct * perAdult)
        const ratio = unitPrice > 0 ? discounted / unitPrice : 1
        unitPrice = discounted
        unitTaxBreakdown = unitTaxBreakdown.map((t) => ({ ...t, amount: round2(t.amount * ratio) }))
      }
    }
    // Sin fila de ocupación explícita (fallback sin matriz): la ocupación real sigue siendo la
    // buscada (`physicalGuests` = adultos + niños), no un default fijo — si no, una búsqueda
    // "2 adultos, 2 niños" terminaría grabando la reserva para 1 sola persona.
    const effectiveOccupancy = occ ?? physicalGuests.value
    // REQ-01 (#233) — snapshot del catálogo para esta línea: solo ids conocidos, sin duplicados,
    // en el orden del catálogo (sortOrder), y únicamente si la habitación lleva menores y el
    // hotel acepta niños (espejo exacto del gate del backend).
    const lineChildAmenities: CartLineChildAmenity[] = isComposition && occupancy.childrenAges.length > 0 && childPolicy.value.acceptChildren
      ? resolveChildAmenities(occupancy.childAmenityIds)
      : []
    // REQ-01 (#290) — snapshot del catálogo POR TIPO para esta línea: solo keys conocidas, sin
    // duplicados, en el orden del catálogo. No depende de la composición.
    const lineRoomAmenities: CartLineRoomAmenity[] = isComposition ? resolveRoomAmenities(room.id, occupancy.roomAmenityKeys) : []
    const key = isComposition
      ? cartLineKeyForComposition(
        room.id, occupancy.adults, occupancy.childrenAges, occupancy.needsCrib,
        lineChildAmenities.map((a) => a.id), lineRoomAmenities.map((a) => a.key),
      )
      : cartLineKey(room.id, effectiveOccupancy)
    const cap = Math.max(1, room.availableCount)
    const existing = cart.value.find((l) => l.key === key)
    if (existing) {
      if (existing.quantity < cap) existing.quantity += 1
    } else {
      cart.value.push({
        key, roomType: room.id, roomName: room.name, occupancy: effectiveOccupancy, quantity: 1,
        unitPrice, unitTaxBreakdown, maxAvailable: cap, photoUrl: room.photoUrl ?? null,
        ...(isComposition ? { adults: occupancy.adults, childrenAges: [...occupancy.childrenAges] } : {}),
        // Tarea 22 — solo en líneas con composición; el flujo legacy (ocupación plana) no tiene
        // edades, así que tampoco puede tener bebé. Sí/No únicamente: cribCount siempre 1 cuando
        // needsCrib es true.
        ...(isComposition && occupancy.needsCrib ? { needsCrib: true, cribCount: 1 } : {}),
        // REQ-01 (#233) — solo cuando quedó al menos una amenidad resuelta (nunca `[]`).
        ...(lineChildAmenities.length > 0 ? { childAmenities: lineChildAmenities } : {}),
        // REQ-01 (#290) — ídem.
        ...(lineRoomAmenities.length > 0 ? { roomAmenities: lineRoomAmenities } : {}),
      })
    }

    if (upsells.value.length === 0) {
      upsellsLoading.value = true
      try {
        upsells.value = await BookingService.getUpsells(slug.value)
      } catch {
        upsells.value = []
      } finally {
        upsellsLoading.value = false
      }
    }
  }

  /** REQ-01 (#233) — resuelve ids elegidos contra el catálogo público cargado. Devuelve el
   *  snapshot `{id, name, price}` en el orden del catálogo; ids desconocidos (catálogo cambiado
   *  entre medio, deep-link viejo) se descartan en silencio — el backend igual los rechazaría. */
  function resolveChildAmenities(ids: string[] | undefined): CartLineChildAmenity[] {
    if (!Array.isArray(ids) || ids.length === 0) return []
    const wanted = new Set(ids)
    return childAmenities.value
      .filter((a) => wanted.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, price: Number(a.price) || 0 }))
  }

  /** REQ-01 (#290) — resuelve keys elegidas contra el catálogo por tipo cargado. Devuelve el
   *  snapshot `{key, name, price}` en el orden del catálogo; keys desconocidas (catálogo cambiado
   *  entre medio, tipo que no las ofrece) se descartan en silencio — el backend igual las ignoraría. */
  function resolveRoomAmenities(roomTypeId: string, keys: string[] | undefined): CartLineRoomAmenity[] {
    if (!Array.isArray(keys) || keys.length === 0) return []
    const wanted = new Set(keys)
    return roomAmenitiesFor(roomTypeId)
      .filter((a) => wanted.has(a.key))
      .map((a) => ({ key: a.key, name: a.name, price: Number(a.price) || 0 }))
  }

  /** Quita una línea entera del carrito (todas sus unidades) — sin afectar las demás. */
  function removeCartLine(key: string): void {
    cart.value = cart.value.filter((l) => l.key !== key)
  }

  /** REQ-02 (#234) — editar una habitación agregada devuelve UNA unidad al composer: si la línea
   *  tiene `quantity > 1` se descuenta una unidad (las demás siguen en el carrito tal cual); si
   *  era la última, la línea se quita entera (igual que `removeCartLine`). Nunca toca otras
   *  líneas. Key desconocida = no-op. */
  function removeCartLineUnit(key: string): void {
    const line = cart.value.find((l) => l.key === key)
    if (!line) return
    if (line.quantity > 1) line.quantity -= 1
    else removeCartLine(key)
  }

  /** Vacía el carrito (cambio de fechas, o el huésped quiere empezar de nuevo). */
  function clearCart(): void {
    cart.value = []
  }

  /** Step 2: actualiza la selección de upsells. */
  function setSelectedUpsells(items: SelectedUpsell[]): void {
    // MR-10 (#275) — un mismo id se CONSOLIDA (Σ cantidades) igual que hace el backend
    // (`upsell-pricing.ts`) antes de acotar al tope: si el store guardara dos entradas del mismo
    // extra, `upsellLines` las acotaría por separado (2 + 2 con tope 2 → mostraría 80) y el POST
    // las mandaría duplicadas → 400 `upsell_quantity_out_of_range` sobre un precio que el
    // huésped ya vio. Se conserva el orden de la primera aparición.
    const merged = new Map<string, number>()
    for (const i of items) {
      if (!i || typeof i.id !== 'string' || !(i.quantity > 0)) continue
      merged.set(i.id, (merged.get(i.id) ?? 0) + Math.floor(i.quantity))
    }
    selectedUpsells.value = [...merged].map(([id, quantity]) => ({ id, quantity }))
  }

  /** Step 3: actualiza datos del huésped. */
  function setGuest(patch: Partial<BookingGuest>): void {
    guest.value = { ...guest.value, ...patch }
  }

  /** Step 4: valida el promo code contra el backend (read-only, no incrementa uses). */
  async function applyPromo(): Promise<PromoValidationResult | null> {
    const code = promoCode.value.trim()
    if (!code) {
      promoResult.value = null
      return null
    }
    promoLoading.value = true
    try {
      const result = await BookingService.validatePromo(slug.value, code, subtotal.value)
      promoResult.value = result
      return result
    } catch (e) {
      // En caso de error de red, no invalidamos el promo (podría ser un 429 rate-limit).
      // Marcamos null para que la UI no muestre descuento sin confirmar.
      promoResult.value = { valid: false, discount: 0, reason: 'not_found' as PromoValidationReason }
      error.value = errMessage(e, 'No pudimos validar el código. Probá de nuevo.')
      return promoResult.value
    } finally {
      promoLoading.value = false
    }
  }

  function clearPromo(): void {
    promoCode.value = ''
    promoResult.value = null
  }

  /** Avanza al siguiente step. Solo si currentStepValid. No-op si está en el último step. */
  function next(): void {
    if (!currentStepValid.value || isSubmitting.value) return
    switch (status.value) {
      case 'idle':
        void search()
        return
      case 'selecting':
        if (cart.value.length === 0) return
        status.value = 'upselling'
        return
      case 'upselling':
        status.value = 'checkingout'
        return
      case 'checkingout':
        status.value = 'paying'
        return
      // paying → confirmed/failed se maneja en pay()
    }
  }

  /** Retrocede un step. No-op en el primero. */
  function back(): void {
    if (isSubmitting.value) return
    switch (status.value) {
      case 'selecting':
        status.value = 'idle'
        return
      case 'upselling':
        status.value = 'selecting'
        return
      case 'checkingout':
        status.value = 'upselling'
        return
      case 'paying':
        status.value = 'checkingout'
        return
      case 'failed':
        status.value = 'paying'
        return
    }
  }

  /** Salta a un step arbitrario (para "editar" desde el resumen del step Pay). Solo si el
   *  step destino ya fue completado antes (no saltar hacia adelante sin datos). */
  function goToStep(step: number): void {
    if (isSubmitting.value) return
    if (step < 0 || step > 4) return
    if (step > currentStep.value) return
    const map: Record<number, BookingStatus> = {
      0: 'idle',
      1: 'selecting',
      2: 'upselling',
      3: 'checkingout',
      4: 'paying',
    }
    status.value = map[step]
  }

  /** Step 4 → 5: crea la reserva pending y redirect a Stripe Checkout. Idempotente.
   *
   *  Estrategia anti-doble-submit:
   *    1. `isSubmitting` bloquea el botón al primer click (UI disabled + guard acá).
   *    2. `idempotencyKey` (UUID) se adjunta al body. El backend hoy no la consume (dedupea
   *       por reservation.id en el charge), pero la key queda como salvaguarda si se cablea
   *       dedup server-side. Se regenera SOLO tras un fallo (reintento = nuevo intento).
   *    3. Redirect inmediato a `checkoutUrl` apenas vuelve el 201 — no esperamos acción
   *       del usuario. La página se descarga; el finally corre antes del navigation.
   *
   *  Robustez: si Stripe falla, la reserva SE CREÓ pending (F0 0.16). Devolvemos status
   *  'failed' con el paymentError para que el usuario sepa que su reserva existe pero el
   *  cobro quedó pendiente.
   *
   *  NOTA sobre successUrl/cancelUrl: el backend pasa las URLs LITERALES a Stripe (no
   *  reemplaza `:id`/`:token`). El widget pasa placeholders conforme al spec R2
   *  (`/h/:slug?booking=:id&token=:token`) Y guarda el reservationId+accessToken en
   *  sessionStorage como backup para que la página de confirmación (F3 3.17) pueda
   *  reconstruir la reserva si los placeholders llegan literales a la URL de vuelta. */
  async function pay(): Promise<void> {
    if (isSubmitting.value) return
    if (cart.value.length === 0) {
      error.value = 'Agregá al menos una habitación primero.'
      status.value = 'failed'
      return
    }
    if (!guestValid.value) {
      error.value = 'Revisá los datos del huésped antes de pagar.'
      status.value = 'checkingout'
      return
    }
    isSubmitting.value = true
    error.value = null
    receivedUnpaidLocator.value = null
    if (!idempotencyKey.value) idempotencyKey.value = genIdempotencyKey()
    try {
      const base = window.location.origin
      // F3 3.17 — successUrl a `/h/:slug/confirm` (sub-ruta distinguible de la landing `/h/:slug`).
      // Los placeholders `:id`/`:token` son LITERALES — el backend stripe.ts no los reemplaza
      // (deuda conocida). La página /h/:slug/confirm reconstruye (id,token) desde sessionStorage
      // (backup que dejamos abajo en `storeReservation` ANTES del redirect off-site a Stripe).
      const successUrl = `${base}/h/${slug.value}/confirm?booking=:id&token=:token`
      const cancelUrl = `${base}/book/${slug.value}`
      const guestPayload = {
        name: guest.value.name.trim(),
        email: guest.value.email.trim(),
        phone: guest.value.phone.trim(),
        estimatedArrival: guest.value.estimatedArrival.trim() || undefined,
        specialRequests: guest.value.specialRequests.trim() || undefined,
      }
      const promoPayload = promoResult.value?.valid && promoCode.value
        ? { promoCode: promoResult.value.code ?? promoCode.value.trim().toUpperCase() }
        : {}
      // MR-10 (#275) — viaja la cantidad EFECTIVA (acotada al tope por kind, 1 en los de cantidad
      // fija): lo que el huésped vio en el resumen es lo que se pide, y el backend no devuelve
      // 400 `upsell_quantity_out_of_range` por un qty que el stepper ya no permite.
      const upsellsPayload = upsellLines.value.length > 0
        ? { upsells: upsellLines.value.map((l) => ({ id: l.id, quantity: l.quantity })) }
        : {}

      // Tarea 10 (QA 2026-08-20/21) — 1 sola línea × 1 unidad usa el endpoint de SIEMPRE
      // (`POST /api/public/booking`, sin crear una fila de Grupo innecesaria para el caso común).
      // Carrito con más de 1 unidad (mismo tipo ×N y/o tipos combinados) usa el endpoint de grupo.
      let res: CreateBookingResponse
      if (cart.value.length === 1 && cart.value[0]!.quantity === 1) {
        const line = cart.value[0]!
        // Feature adultos+niños+edades (2026-09-02): si la línea viene de la composición
        // (RoomsStep.vue y BookingModal.vue arman TODAS sus líneas así, desde el Requerimiento 3),
        // manda `adults` real + `childrenAges` — el backend recalcula todo contra la política del
        // hotel. Sin composición (línea del flujo legacy de ocupación plana, hoy inalcanzable
        // desde ninguna de las dos entradas públicas — ver Requerimiento 15): EXACTAMENTE el
        // cálculo de siempre, `line.occupancy - children.value`.
        const hasComposition = line.adults !== undefined && line.childrenAges !== undefined
        res = await BookingService.createBooking({
          slug: slug.value,
          // FIX 2026-07-30 (bug 404 "Habitación no encontrada" en el 100% de los intentos):
          // `roomType` (no `roomId`) porque `public-rates.ts` no tiene entidad RoomType propia
          // — el backend elige la unidad física libre al crear la reserva.
          roomType: line.roomType,
          checkIn: checkIn.value,
          checkOut: checkOut.value,
          adults: hasComposition ? line.adults! : Math.max(1, line.occupancy - Math.max(0, children.value)),
          ...(hasComposition
            ? (line.childrenAges!.length > 0 ? { childrenAges: line.childrenAges } : {})
            : (children.value > 0 ? { children: children.value } : {})),
          // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — el backend re-gatea
          // contra la composición real (nunca confía en esto), pero de este lado ya viene limpio:
          // el composer solo lo setea cuando la línea tiene un bebé (ver useGuestComposer.ts).
          ...(line.needsCrib ? { needsCrib: true, cribCount: 1 } : {}),
          // REQ-01 (#233) — solo ids: el backend re-resuelve precio contra su catálogo.
          ...(line.childAmenities && line.childAmenities.length > 0
            ? { childAmenities: line.childAmenities.map((a) => ({ id: a.id })) }
            : {}),
          // REQ-01 (#290) — solo keys: el backend cobra el precio real de la habitación asignada.
          ...(line.roomAmenities && line.roomAmenities.length > 0
            ? { roomAmenities: line.roomAmenities.map((a) => ({ key: a.key })) }
            : {}),
          guest: guestPayload,
          ...promoPayload,
          ...upsellsPayload,
          successUrl,
          cancelUrl,
          idempotencyKey: idempotencyKey.value,
        })
      } else {
        // Feature adultos+niños+edades (2026-09-02): cada línea del carrito manda SU propia
        // composición si la tiene (RoomsStep.vue) — el backend valida/cotiza cada habitación
        // del grupo con sus propios niños. Sin composición (flujo legacy): mismo criterio de
        // siempre, `line.occupancy` completo viaja como `adults` (el motor no distinguía niños).
        res = await BookingService.createBookingGroup({
          slug: slug.value,
          checkIn: checkIn.value,
          checkOut: checkOut.value,
          rooms: cart.value.map((l) => ({
            roomType: l.roomType,
            adults: l.adults !== undefined ? l.adults : l.occupancy,
            quantity: l.quantity,
            ...(l.childrenAges && l.childrenAges.length > 0 ? { childrenAges: l.childrenAges } : {}),
            // Tarea 22 — POR LÍNEA, no global al carrito (a diferencia de `upsellsPayload`).
            ...(l.needsCrib ? { needsCrib: true, cribCount: 1 } : {}),
            // REQ-01 (#233) — POR LÍNEA, igual que la cuna.
            ...(l.childAmenities && l.childAmenities.length > 0
              ? { childAmenities: l.childAmenities.map((a) => ({ id: a.id })) }
              : {}),
            // REQ-01 (#290) — POR LÍNEA, igual que las infantiles.
            ...(l.roomAmenities && l.roomAmenities.length > 0
              ? { roomAmenities: l.roomAmenities.map((a) => ({ key: a.key })) }
              : {}),
          })),
          guest: guestPayload,
          ...promoPayload,
          ...upsellsPayload,
          successUrl,
          cancelUrl,
          idempotencyKey: idempotencyKey.value,
        })
      }
      reservation.value = res
      storeReservation(slug.value, {
        reservationId: res.reservationId,
        accessToken: res.accessToken,
        at: Date.now(),
      })
      if (res.checkoutUrl) {
        // Redirect off-site a Stripe. La página se descarga; el botón queda disabled.
        window.location.href = res.checkoutUrl
        return
      }
      // Sin checkoutUrl: Stripe no configurado o gateway caído (`res.paymentError`). La reserva
      // existe (pending) y el backend (#267) ya le mandó al huésped el correo "recibimos tu
      // pedido"; el hotel lo contacta para coordinar el pago. NO es un error: se deja
      // status='failed' sólo para que el widget quede en PayStep, y PayStep muestra el
      // localizador en vez del texto rojo.
      status.value = 'failed'
      error.value = null
      receivedUnpaidLocator.value = String(res.reservationId).slice(0, 8)
    } catch (e) {
      status.value = 'failed'
      error.value = errMessage(e, 'No se pudo crear la reserva. Probá de nuevo.')
      // Reintento: nuevo idempotency key (el anterior podría haber llegado al backend en
      // una reserva half-created; uno nuevo evita reusar ese ciclo).
      idempotencyKey.value = ''
    } finally {
      isSubmitting.value = false
    }
  }

  /** Step 5: polling del estado de la reserva post-redirect. Lo dispara ConfirmStep al
   *  montarse. Devuelve el estado o null si el token no valida. */
  async function pollConfirmation(reservationId: string, token: string) {
    try {
      return await BookingService.getReservation(reservationId, token)
    } catch {
      return null
    }
  }

  /** Reset completo del store (al desmontar el widget o cambiar de hotel). */
  function reset(): void {
    checkIn.value = ''
    checkOut.value = ''
    // Default 1 (2026-08-20, ver comentario en la declaración de `guests` arriba) — reset()
    // tiene que volver al MISMO default que el store arranca, no al viejo valor de 2.
    guests.value = 1
    children.value = 0
    rooms.value = 1
    ratesResponse.value = null
    ratesLoading.value = false
    ratesError.value = null
    cart.value = []
    upsells.value = []
    upsellsLoading.value = false
    selectedUpsells.value = []
    mealPlans.value = []
    mealPlansLoading.value = false
    childAmenities.value = []
    roomAmenities.value = {}
    guest.value = { name: '', email: '', phone: '', estimatedArrival: '', specialRequests: '' }
    promoCode.value = ''
    promoResult.value = null
    promoLoading.value = false
    status.value = 'idle'
    error.value = null
    receivedUnpaidLocator.value = null
    reservation.value = null
    isSubmitting.value = false
    idempotencyKey.value = ''
    currencyPreference.value = ''
    availableCurrencies.value = []
  }

  return {
    // state
    slug,
    checkIn,
    checkOut,
    guests,
    children,
    childPolicy,
    rooms,
    ratesResponse,
    ratesLoading,
    ratesError,
    cart,
    upsells,
    upsellsLoading,
    selectedUpsells,
    mealPlans,
    mealPlansLoading,
    childAmenities,
    roomAmenities,
    guest,
    promoCode,
    promoResult,
    promoLoading,
    status,
    error,
    receivedUnpaidLocator,
    reservation,
    isSubmitting,
    idempotencyKey,
    currencyPreference,
    availableCurrencies,
    // computed
    currentStep,
    physicalGuests,
    displayCurrency,
    currencyUnavailable,
    chargeCurrency,
    nights,
    cancellationPolicy,
    cancellationSummary,
    cartTotalRooms,
    cartTotalGuests,
    cartTotalChildren,
    cartTotalFreeChildren,
    cartTotalBabies,
    upsellPersons,
    roomsSubtotal,
    subtotal,
    upsellsTotal,
    promoDiscount,
    taxableBase,
    taxRates,
    estimatedTaxBreakdown,
    estimatedTaxes,
    estimatedTotal,
    upsellLines,
    upsellMaxQty,
    upsellStayPrice,
    childAmenitiesTotal,
    childAmenityLines,
    roomAmenitiesTotal,
    roomAmenityLines,
    totalBreakdown,
    searchValid,
    roomsValid,
    upsellsValid,
    guestValid,
    currentStepValid,
    // actions
    init,
    search,
    roomAmenitiesFor,
    addToCart,
    removeCartLine,
    removeCartLineUnit,
    clearCart,
    setSelectedUpsells,
    setGuest,
    applyPromo,
    clearPromo,
    next,
    back,
    goToStep,
    pay,
    pollConfirmation,
    reset,
    setCurrency,
  }
})

// ─── helpers (privados del módulo) ──────────────────────────────────────────────

/**
 * Monedas comunes para el switcher del widget (turistas LATAM/caribe). Antes era una lista
 * suelta de 8 strings; ahora se derivan del enum global `CURRENCY_CODES` (source of truth en
 * types/currency.ts). El backend convierte lo que le pidamos si tiene rates; si una moneda no
 * está en `currency_rates`, degrada a chargeCurrency (no rompe).
 */
const COMMON_DISPLAY_CURRENCIES: readonly CurrencyCode[] = CURRENCY_CODES

/** Arma la lista de monedas del switcher: chargeCurrency siempre primero (es la base del
 *  cobro), después la última display (si difiere), luego las comunes dedupe. Orden estable. */
function buildCurrencyOptions(chargeCurrency: string, displayCurrency: string, preference: string): string[] {
  const out: string[] = []
  const push = (c: string) => {
    const up = c.trim().toUpperCase()
    if (up && !out.includes(up)) out.push(up)
  }
  push(chargeCurrency)
  push(displayCurrency)
  push(preference)
  for (const c of COMMON_DISPLAY_CURRENCIES) push(c)
  return out
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Reparte el impuesto del roomType (calculado sobre fromPrice) al taxableBase real
 *  (tras promo). Mantiene la proporción: si la base bajó por un descuento, el impuesto
 *  baja en la misma proporción. */
/** Extrae mensaje legible de un error del http client (ApiError) o de un Error genérico. */
function errMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}
