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
  PublicMealPlan,
  PublicRatesResponse,
  RoomOccupancyRate,
  RoomTypeRate,
  RoomTypeTaxItem,
  SelectedUpsell,
  TotalBreakdown,
  Upsell,
} from '@/types/booking'
// Refactor cross-cutting: monedas del enum global (types/currency.ts — source of truth único).
import { CURRENCY_CODES, type CurrencyCode } from '@/types/currency'

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
  interface CartLine {
    key: string
    roomType: string
    roomName: string
    occupancy: number
    quantity: number
    /** Precio de UNA unidad a esta ocupación, la estadía completa (no por noche). */
    unitPrice: number
    unitTaxBreakdown: RoomTypeTaxItem[]
    /** Tope de cantidad al agregar — `rt.availableCount` en el momento de agregar. Es una cota
     *  de UX, no la autoridad: el backend revalida disponibilidad real al crear la reserva
     *  (`createPublicBookingGroup`, 409 con el máximo real si la cotización quedó vieja). */
    maxAvailable: number
    photoUrl: string | null
  }

  const cart = ref<CartLine[]>([])

  function cartLineKey(roomType: string, occupancy: number): string {
    return `${roomType}|${occupancy}`
  }

  // ─── Upsells (step 2) ─────────────────────────────────────────────────────────
  const upsells = ref<Upsell[]>([])
  const upsellsLoading = ref(false)
  const selectedUpsells = ref<SelectedUpsell[]>([])

  // ─── Regímenes de alimentación (step 1, tasks.md 2.2/2.4) ──────────────────────
  // A diferencia de `upsells` (se cargan recién al agregar la primera línea al carrito),
  // los regímenes se muestran DESDE que aparece la lista de habitaciones (RoomsStep) —
  // se cargan junto con `search()`. Solo informativo esta fase: "Solo alojamiento" es la
  // base implícita (no viene del backend); `priceMode:'per_person_per_night'` se muestra
  // con precio pero NO es seleccionable todavía (ver alcance en el plan aprobado).
  const mealPlans = ref<PublicMealPlan[]>([])
  const mealPlansLoading = ref(false)

  // ─── Guest (step 3) ───────────────────────────────────────────────────────────
  const guest = ref<BookingGuest>({ name: '', email: '', phone: '', estimatedArrival: '', specialRequests: '' })

  // ─── Promo (step 4) ───────────────────────────────────────────────────────────
  const promoCode = ref('')
  const promoResult = ref<PromoValidationResult | null>(null)
  const promoLoading = ref(false)

  // ─── Estado de la máquina ─────────────────────────────────────────────────────
  const status = ref<BookingStatus>('idle')
  const error = ref<string | null>(null)

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

  /** Subtotal de TODAS las habitaciones del carrito (antes de upsells/promo/impuestos). */
  const roomsSubtotal = computed(() => round2(
    cart.value.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
  ))

  /** Impuestos "de etiqueta" del carrito (suma de cada línea × su cantidad), ANTES de escalar
   *  proporcionalmente por promo — ver `estimatedTaxes`, mismo criterio que tenía la versión de
   *  1 sola habitación, ahora agregado línea por línea. */
  const roomsTaxesRaw = computed(() => round2(
    cart.value.reduce((s, l) => s + l.unitTaxBreakdown.reduce((ts, t) => ts + t.amount, 0) * l.quantity, 0),
  ))

  /** Subtotal room(s)+upsells ANTES de promo e impuestos. Promo se aplica sobre este monto. */
  const subtotal = computed(() => round2(roomsSubtotal.value + upsellsTotal.value))

  /** Suma de upsells seleccionados (precio × qty). En `hotels.currency` (chargeCurrency). */
  const upsellsTotal = computed(() => {
    const byId = new Map(upsells.value.map((u) => [u.id, u]))
    let total = 0
    for (const sel of selectedUpsells.value) {
      const found = byId.get(sel.id)
      if (!found) continue
      total += Number(found.price) * Math.max(1, Math.floor(sel.quantity))
    }
    return round2(total)
  })

  const promoDiscount = computed(() =>
    promoResult.value?.valid ? Number(promoResult.value.discount) || 0 : 0,
  )

  /** Base imponible (subtotal - promo). Sobre esto caen los impuestos. */
  const taxableBase = computed(() => round2(Math.max(0, subtotal.value - promoDiscount.value)))

  /** Impuestos estimados pre-create: escala el impuesto "de etiqueta" de las habitaciones del
   *  carrito a la base imponible real (tras promo). El total DEFINITIVO lo calcula el backend y
   *  lo devuelve en `totalBreakdown` tras crear. Si hay promo, el backend recalcula impuestos
   *  sobre la base ya descontada — coincide. */
  const estimatedTaxes = computed(() => {
    if (cart.value.length === 0) return 0
    return round2(taxOnBase(roomsTaxesRaw.value, roomsSubtotal.value, taxableBase.value))
  })

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
    try {
      const [res, mp] = await Promise.all([
        BookingService.getRates(slug.value, {
          checkIn: checkIn.value,
          checkOut: checkOut.value,
          rooms: rooms.value,
          // Ocupación FÍSICA (adultos + niños) — mismo criterio que el calendario de la landing.
          guests: physicalGuests.value,
          ...(currencyPreference.value ? { currency: currencyPreference.value } : {}),
        }),
        mealPlansPromise,
      ])
      ratesResponse.value = res
      if (needsMealPlans) mealPlans.value = mp
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
   */
  async function addToCart(room: RoomTypeRate, occupancy?: number): Promise<void> {
    const occ = typeof occupancy === 'number' && Number.isFinite(occupancy) && occupancy > 0
      ? Math.floor(occupancy)
      : null
    const row = occ !== null ? room.occupancies?.find((o) => o.occupancy === occ) : null
    // Defensa: no agregar una fila que el backend marcó no vendible (la UI ya la deshabilita —
    // esto cubre un estado viejo: deep-link, fechas cambiadas sin refrescar la matriz).
    if (row && !row.available) return

    const unitPrice = row?.price ?? room.fromPrice
    const unitTaxBreakdown = row?.taxBreakdown ?? room.taxBreakdown
    // Sin fila de ocupación explícita (fallback sin matriz): la ocupación real sigue siendo la
    // buscada (`physicalGuests` = adultos + niños), no un default fijo — si no, una búsqueda
    // "2 adultos, 2 niños" terminaría grabando la reserva para 1 sola persona.
    const effectiveOccupancy = occ ?? physicalGuests.value
    const key = cartLineKey(room.id, effectiveOccupancy)
    const cap = Math.max(1, room.availableCount)
    const existing = cart.value.find((l) => l.key === key)
    if (existing) {
      if (existing.quantity < cap) existing.quantity += 1
    } else {
      cart.value.push({
        key, roomType: room.id, roomName: room.name, occupancy: effectiveOccupancy, quantity: 1,
        unitPrice, unitTaxBreakdown, maxAvailable: cap, photoUrl: room.photoUrl ?? null,
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

  /** Quita una línea entera del carrito (todas sus unidades). */
  function removeCartLine(key: string): void {
    cart.value = cart.value.filter((l) => l.key !== key)
  }

  /** Cambia la cantidad de una línea existente (acotada a 1..maxAvailable). 0 o negativo la
   *  elimina — mismo resultado que `removeCartLine`, más cómodo desde un stepper "−". */
  function setCartLineQuantity(key: string, quantity: number): void {
    const q = Math.floor(quantity)
    if (q <= 0) { removeCartLine(key); return }
    const line = cart.value.find((l) => l.key === key)
    if (!line) return
    line.quantity = Math.min(line.maxAvailable, q)
  }

  /** Vacía el carrito (cambio de fechas, o el huésped quiere empezar de nuevo). */
  function clearCart(): void {
    cart.value = []
  }

  /** Step 2: actualiza la selección de upsells. */
  function setSelectedUpsells(items: SelectedUpsell[]): void {
    selectedUpsells.value = items.filter((i) => i.quantity > 0)
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
      const upsellsPayload = selectedUpsells.value.length > 0 ? { upsells: selectedUpsells.value } : {}

      // Tarea 10 (QA 2026-08-20/21) — 1 sola línea × 1 unidad usa el endpoint de SIEMPRE
      // (`POST /api/public/booking`, sin crear una fila de Grupo innecesaria para el caso común).
      // Carrito con más de 1 unidad (mismo tipo ×N y/o tipos combinados) usa el endpoint de grupo.
      let res: CreateBookingResponse
      if (cart.value.length === 1 && cart.value[0]!.quantity === 1) {
        const line = cart.value[0]!
        res = await BookingService.createBooking({
          slug: slug.value,
          // FIX 2026-07-30 (bug 404 "Habitación no encontrada" en el 100% de los intentos):
          // `roomType` (no `roomId`) porque `public-rates.ts` no tiene entidad RoomType propia
          // — el backend elige la unidad física libre al crear la reserva.
          roomType: line.roomType,
          checkIn: checkIn.value,
          checkOut: checkOut.value,
          // Ocupación elegida ("para 4") menos los niños ya declarados aparte — se cotizó una
          // tarifa para 4 personas, la reserva tiene que decir eso.
          adults: Math.max(1, line.occupancy - Math.max(0, children.value)),
          ...(children.value > 0 ? { children: children.value } : {}),
          guest: guestPayload,
          ...promoPayload,
          ...upsellsPayload,
          successUrl,
          cancelUrl,
          idempotencyKey: idempotencyKey.value,
        })
      } else {
        // NOTA — "children" en reservas de grupo: el campo solo suma al conteo total de
        // ocupación (capacidad de la habitación); no tiene precio ni lógica propia por edad
        // (mismo criterio que el flujo de 1 habitación: `adults` + `children` combinados son
        // "personas", el motor no distingue). Cada línea del carrito ya lleva su ocupación
        // TOTAL (`line.occupancy`, la fila "para N" elegida) y eso es lo que se manda como
        // `adults` — correcto para capacidad y precio, no hace falta "repartir" niños entre
        // habitaciones porque el producto no trata a los niños distinto de un adulto más.
        res = await BookingService.createBookingGroup({
          slug: slug.value,
          checkIn: checkIn.value,
          checkOut: checkOut.value,
          rooms: cart.value.map((l) => ({
            roomType: l.roomType,
            adults: l.occupancy,
            quantity: l.quantity,
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
      // Sin checkoutUrl: Stripe no configurado o gateway caído. Reserva creada pending.
      status.value = 'failed'
      error.value = res.paymentError
        ? `Tu reserva quedó creada pero el pago no se pudo iniciar (${res.paymentError}). Te contactaremos.`
        : 'Tu reserva quedó creada pero el pago online no está disponible. Te contactaremos.'
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
    guest.value = { name: '', email: '', phone: '', estimatedArrival: '', specialRequests: '' }
    promoCode.value = ''
    promoResult.value = null
    promoLoading.value = false
    status.value = 'idle'
    error.value = null
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
    guest,
    promoCode,
    promoResult,
    promoLoading,
    status,
    error,
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
    roomsSubtotal,
    subtotal,
    upsellsTotal,
    promoDiscount,
    taxableBase,
    estimatedTaxes,
    estimatedTotal,
    totalBreakdown,
    searchValid,
    roomsValid,
    upsellsValid,
    guestValid,
    currentStepValid,
    // actions
    init,
    search,
    addToCart,
    removeCartLine,
    setCartLineQuantity,
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
function taxOnBase(taxAmountOnFromPrice: number, fromPrice: number, base: number): number {
  if (fromPrice <= 0) return 0
  return round2((taxAmountOnFromPrice * base) / fromPrice)
}

/** Extrae mensaje legible de un error del http client (ApiError) o de un Error genérico. */
function errMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return fallback
}
