// bookingengine/usecases/public-rates.ts — GET /api/public/hotels/:slug/rates (F2 2.4).
//
// Devuelve room types disponibles con la tarifa derivada (precio lowest del type × noches)
// + impuestos desglosados (ITBIS desde configuration('taxes')) + availableCount por type
// (urgencia D11: el widget muestra "Pocas habitaciones a este precio" si availableCount<=3).
//
// Multi-moneda (D10): si ?currency=X difiere de hotels.currency, convierte usando
// `configuration(key='currency_rates', hotelId='platform')` poblado por el cron nightly
// (`shared/usecases/currency-rates-cron.ts`). Si no hay rates o falta la moneda origen/destino,
// degrada silenciosamente a hotels.currency (mejor mostrar precio correcto en la moneda base
// que inventear un 0 o un 1). El cobro SIEMPRE es en hotels.currency — esto es display only.
//
// Anti-enumeración: si el hotel no existe o no tiene onlineBookingStatus='active', MISMO 404
// (no revelar paused/inactive hotels desde la ruta pública — mismo criterio que public-hotel-info).
//
// ─── Precio por fecha (temporadas) ──────────────────────────────────────────────────────────
// `fromPrice` es la SUMA del precio de cada noche del rango, no `precio fijo × noches`. La
// resolución por fecha (season_assignments → room_rates → fallback `rooms.basePrice`) vive en
// `usecases/rate-resolution.ts` y es la MISMA que usa `/calendar`. Antes `/rates` multiplicaba
// `min(rooms.basePrice)` × noches ignorando las temporadas: en un hotel con temporadas cargadas
// el calendario de la landing anunciaba un precio y el buscador cotizaba otro para las mismas
// fechas. El fallback garantiza que un hotel SIN temporadas cotice exactamente igual que antes.
//
// Los repos `seasonAssignments`/`roomRates` son OPCIONALES: sin cablear, cada noche cae al
// fallback y el total vuelve a ser `price × nights` (compat con callers/tests viejos).
//
// ✅ RESUELTO (era follow-up): el stop-sell de la tarifa (`room_rates.closed`) y los bloqueos de
// habitación (`room_blocks`) YA se aplican — no acá, sino donde corresponde: sacar un room type
// de la respuesta es una decisión de DISPONIBILIDAD, así que vive en `AvailabilityUseCase`
// (`usecases/availability.ts` + `usecases/stay-restrictions.ts`), de cuyo resultado se deriva
// esta respuesta. `/rates`, `/calendar` y `POST /api/public/booking` comparten ahora el mismo
// criterio: lo que el calendario pinta cerrado no se cotiza ni se vende.
//
// ⚠️ Caché: `/rates` NO cachea su propia respuesta; solo hereda el de `AvailabilityUseCase`
// (`availability:{hotelId}:{checkIn}:{checkOut}:{adults}`, TTL 60s). Esa clave sigue siendo
// correcta: identifica la CONSULTA, no los datos, y todas sus fuentes (rooms, reservas,
// `room_blocks`, `room_rates`) comparten la misma cota de staleness de 60s. OJO con la asimetría
// que eso introduce: el PRECIO de `/rates` se lee fresco en cada request (`season_assignments` y
// `room_rates` se releen acá abajo), pero el CIERRE de un tipo viene del resultado cacheado —
// editar una tarifa se ve al instante, cerrar una noche puede tardar hasta 60s, igual que
// bloquear o vender una habitación. Meter tarifas/bloqueos en la clave no cambiaría ningún
// resultado, solo bajaría el hit-rate.
//
// Decisiones visibles (spec abierto, documentadas acá y en el reporte):
//  - `fromPrice` = TOTAL de la estadía (no por noche) y PRE-impuestos. El spec scenario muestra
//    "From $354 total ($100 × 3 + $54 ITBIS)" → total.
//  - `taxBreakdown` = Array<{ name, rate, amount }>. amount es el monto de ese impuesto sobre
//    fromPrice. Múltiples impuestos soportados (configuration('taxes') puede traer >1).
//  - `id` y `name` del room type usan ambos el slug del `roomType` (no hay entidad RoomType
//    propia en este PMS — `room.type` es un string libre: 'standard', 'double', etc.). El
//    frontend puede prettify/localizar.
//
// ─── Matriz de ocupaciones (`roomTypes[].occupancies`) ──────────────────────────────────────
// Cada tipo trae además UNA FILA POR OCUPACIÓN (1 → capacidad), igual que el motor de la
// competencia: "para 1 / para 2 / para 4", cada una con su precio. Las ocupaciones que el hotel
// NO puede vender **no se ocultan**: viajan con `available:false` + `unavailableReason` para que
// el widget las muestre en gris (el huésped tiene que ver que la opción existe). La construcción
// y la precedencia de motivos viven en `usecases/occupancy-matrix.ts`.
//
// Es ADITIVO y no toca la compatibilidad: `fromPrice`, `availableCount`, `capacity`,
// `surfaceArea`, `taxBreakdown` y `photoUrl` se siguen calculando con el mismo código de antes y
// valen exactamente lo mismo — el widget y la landing en producción no ven ningún cambio.
import { NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import type { AvailabilityQuery, AvailabilityResult, OccupancyRate } from '../types'
import { resolvePolicy } from '../../../shared/usecases/cancellation-math'
import type { Tier } from '../../cancellation/types'
import { eachDayExclusive } from '../../../shared/utils/daily-availability'
import { baseRatesOnly, buildSeasonByDate, sumStayPrice } from './rate-resolution'
import { buildOccupancyMatrix } from './occupancy-matrix'
import { MAX_STAY_NIGHTS } from '../validators/schema'

const MS_PER_DAY = 1000 * 60 * 60 * 24

export interface PublicRatesDeps {
  hotels: RepositoryAdapter<any>
  /**
   * Use case de disponibilidad existente (cacheado). Lo pasamos como dep para testear sin orm.
   * Toma el mismo shape que `BookingengineService.checkAvailability` (la firma pública del svc).
   */
  availability: { checkAvailability(q: AvailabilityQuery): Promise<AvailabilityResult> }
  /** Repo de `Configuration` (KV por hotel). Lee `taxes` (por hotel) y `currency_rates` (global). */
  config: RepositoryAdapter<any>
  /**
   * FIX 2026-07-31 — Repo de `BookingConfig` (tabla `booking_config`, la que edita el admin en
   * `/panel/booking-engine`). Antes NINGÚN campo de esa pantalla (enabled/minNights/maxNights/
   * cancellationPolicy) se leía acá — el toggle "Activo/Inactivo" y los límites de estadía eran
   * pura decoración, guardaban en la DB pero no afectaban el motor público. Opcional: si no se
   * cablea, degrada a "todo permitido" (compat con callers/tests viejos).
   */
  bookingConfig?: RepositoryAdapter<any>
  /**
   * Repo de `Rooms` (tabla física de habitaciones) — para resolver `photoUrl` por type.
   * Mismo precedente que `BookingengineService` (roomsRepo directo, no connector: la
   * disponibilidad/fotos salen de las habitaciones reales, no hay entidad RoomType propia).
   * Opcional (compat callers/tests viejos, mismo criterio que `bookingConfig`): sin cablear,
   * `photoUrl` degrada a `null` en todos los room types.
   */
  rooms?: RepositoryAdapter<any>
  /** Repo de `HotelMedia` — fotos `type='room'` con `roomId` opcional hacia una room física.
   *  Opcional, mismo criterio que `rooms` de arriba. */
  hotelMedia?: RepositoryAdapter<any>
  /** F5 #627 — Repo de `CancellationPolicies` para resolver la política estructurada que se
   *  muestra al huésped en PayStep (tiers + ventana gratuita + penalidad). Opcional: sin
   *  cablear, `cancellationSummary` queda null y el widget cae al texto libre `cancellationPolicy`. */
  policies?: RepositoryAdapter<any>
  /**
   * Precio por fecha — MISMOS repos que usa `/calendar` (`SeasonAssignments` + `RoomRates`,
   * modelos compartidos). Opcionales: sin cablear, cada noche cae al fallback `rooms.basePrice`
   * y el total vuelve a ser `price × nights` (comportamiento previo, compat con callers viejos).
   * Van juntos o ninguno: con temporadas pero sin tarifas no hay nada que resolver.
   */
  seasonAssignments?: RepositoryAdapter<any>
  roomRates?: RepositoryAdapter<any>
  /** Catálogo `Seasons` — el RANGO de cada temporada. Sin él solo cuentan los días pintados. */
  seasons?: RepositoryAdapter<any>
  /** Repo de `RateOverrides` — tarifa por FECHA, la capa que pisa a la temporada. Opcional: sin
   *  cablear, el motor cotiza solo por temporada (comportamiento previo). */
  rateOverrides?: RepositoryAdapter<any>
}

export interface PublicRatesQuery {
  checkIn: string
  checkOut: string
  /** Cantidad de habitaciones requeridas — informativo; la disponibilidad se calcula por type. */
  rooms?: number
  /** Huéspedes (adults). Default 2 (mismo default que availability.check). */
  guests?: number
  /** Moneda en la que el cliente quiere ver los precios. Default = hotels.currency. */
  currency?: string
}

interface TaxRow { name: string; rate: number }

/**
 * No usamos `NotFoundError` para el 404 del hotel: el endpoint es público y la respuesta
 * es un objeto `{status, body}` que el controller devuelve as-is (mismo patrón que
 * `public-booking.ts:getPublicBookingBySlug`). Lanzar NotFoundError acá rompería la
 * simetría con el resto de los handlers públicos.
 */
export async function getPublicRates(
  deps: PublicRatesDeps,
  slug: string,
  query: PublicRatesQuery,
): Promise<{ status: number; body: any }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }
  if (!query.checkIn || !query.checkOut) {
    return { status: 400, body: { error: 'checkIn y checkOut son requeridos' } }
  }
  // B-3 (auditoría 2026-08-19): el query del GET no pasa por validateSchema — una fecha no
  // parseable hacía `nights` = NaN y el techo de MAX_STAY_NIGHTS se salteaba. Mismo criterio
  // que validatePublicCalendarQuery: formato estricto + parse real ANTES de computar.
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  if (!ISO_DATE_RE.test(String(query.checkIn)) || !ISO_DATE_RE.test(String(query.checkOut))
    || !Number.isFinite(Date.parse(String(query.checkIn))) || !Number.isFinite(Date.parse(String(query.checkOut)))) {
    return { status: 400, body: { error: 'checkIn y checkOut deben tener formato YYYY-MM-DD' } }
  }
  if (query.checkIn >= query.checkOut) {
    return { status: 400, body: { error: 'checkOut debe ser posterior a checkIn' } }
  }

  // Anti-enumeración: idéntico 404 para "no existe" y "no activo".
  const hotel = await deps.hotels.findOne({ slug })
  if (!hotel || hotel.onlineBookingStatus !== 'active') {
    return { status: 404, body: { error: 'Hotel not found' } }
  }

  // FIX — toggle "Activo/Inactivo" del admin (`/panel/booking-engine`) ahora sí apaga el
  // motor. Mismo 404 anti-enumeración que `onlineBookingStatus` (no revelar por qué está
  // apagado). `enabled` default es `true` (config.ts get()) — un hotel que nunca tocó esta
  // pantalla no se ve afectado.
  const bookingConfig = deps.bookingConfig ? await deps.bookingConfig.findOne({ hotelId: hotel.id }) : null
  if (bookingConfig && bookingConfig.enabled === false) {
    return { status: 404, body: { error: 'Hotel not found' } }
  }

  const sourceCurrency = String(hotel.currency || 'USD').toUpperCase()
  const nights = Math.max(1, Math.round(
    (new Date(query.checkOut).getTime() - new Date(query.checkIn).getTime()) / MS_PER_DAY,
  ))
  const adults = typeof query.guests === 'number' && query.guests > 0 ? query.guests : 2

  // FIX — minNights/maxNights configurados por el admin, antes decorativos. 400 claro (no
  // 404: el hotel SÍ existe y está activo, solo el rango de fechas no cumple la política).
  const minNights = Number(bookingConfig?.minNights) || 1
  const maxNights = Number(bookingConfig?.maxNights) || Infinity
  if (nights < minNights) {
    return { status: 400, body: { error: `Estadía mínima: ${minNights} noche${minNights === 1 ? '' : 's'}` } }
  }
  if (nights > maxNights) {
    return { status: 400, body: { error: `Estadía máxima: ${maxNights} noches` } }
  }
  // Techo DURO del sistema, no de la configuración del hotel (cuyo `maxNights` default es
  // `Infinity`). Va ANTES de la disponibilidad y de la matriz de ocupaciones: es exactamente el
  // trabajo que crece con el rango, en una ruta pública sin auth. Mismo criterio y mismo 400 que
  // el calendario (`MAX_CALENDAR_DAYS`). La política del hotel, si es más chica, ya disparó arriba.
  if (nights > MAX_STAY_NIGHTS) {
    return { status: 400, body: { error: `La estadía no puede superar ${MAX_STAY_NIGHTS} noches` } }
  }

  // Disponibilidad via usecase existente (cacheado 60s).
  const availability = await deps.availability.checkAvailability({
    hotelId: hotel.id, checkIn: query.checkIn, checkOut: query.checkOut, adults,
  })

  // Tasas del hotel. Mismo fallback que folios/usecases/folio-math.ts:taxRateFor — si la
  // configuration('taxes') no está poblada, caemos a hotels.taxRate / hotels.taxName.
  const taxes = await readTaxes(deps.config, hotel.id, hotel)

  // Conversión de moneda. Si no hay rates o faltan monedas, degradamos a currency base.
  const targetCurrency = (query.currency && typeof query.currency === 'string')
    ? query.currency.toUpperCase()
    : sourceCurrency
  const rates = await readCurrencyRates(deps.config)
  const canConvert = !!rates && targetCurrency !== sourceCurrency &&
    typeof rates[sourceCurrency] === 'number' && typeof rates[targetCurrency] === 'number'
  const displayCurrency = canConvert ? targetCurrency : sourceCurrency
  const convert = (amount: number): number => {
    if (!canConvert || !rates) return round2(amount)
    // rates es base USD (openexchangerates free tier): rates.USD=1, rates.EUR=0.92, ...
    // amount_source → USD → target.
    const amountInUsd = amount / rates[sourceCurrency]
    return round2(amountInUsd * rates[targetCurrency])
  }

  const photoByType = await resolvePhotoByType(deps, hotel.id)

  // Noches REALES de la estadía: `[checkIn, checkOut)` — la noche del checkout no se cobra.
  // Son exactamente las mismas celdas que pinta `/calendar` entre `from=checkIn` y
  // `to=checkOut - 1 día`, así que los dos endpoints suman sobre el mismo conjunto de fechas.
  const nightDates = eachDayExclusive(query.checkIn, query.checkOut)
  const { seasonByDate, baseRates, overrides } = await readSeasonPricing(deps, hotel.id, nightDates)

  /** Impuestos de un total. Un solo lugar: `fromPrice` y cada fila de `occupancies` los computan igual. */
  const breakdownOf = (total: number) => taxes.map((t) => ({
    name: t.name,
    rate: t.rate,
    amount: round2((total * t.rate) / 100),
  }))

  const roomTypes = availability.roomTypes.map((rt) => {
    // `rt.price` es el precio por noche más bajo del type (availability.aggregate lo calcula) y
    // es el FALLBACK de cada noche sin temporada/tarifa. Se suma noche a noche en vez de
    // multiplicar por `nights`: así una estadía que cruza dos temporadas cobra cada una a su
    // precio, y un hotel sin temporadas da idéntico total al de antes (N veces el mismo número).
    const fallbackNightly = Number(rt.price) || 0
    const stayTotal = nightDates.length > 0
      ? sumStayPrice(nightDates, baseRates, rt.roomType, seasonByDate, adults, fallbackNightly, overrides)
      // Defensa: `nights` nunca es < 1 (se valida checkOut > checkIn arriba), pero si
      // `eachDayExclusive` no pudiera parsear las fechas no se puede devolver 0 en silencio.
      : round2(fallbackNightly * nights)
    const fromPrice = convert(stayTotal)
    const taxBreakdown = breakdownOf(fromPrice)

    // Matriz de ocupaciones: una fila por cada cantidad de huéspedes, de 1 a la capacidad del
    // tipo. Las que el hotel no puede vender NO se filtran — viajan con `available:false` y el
    // motivo, para que el widget las muestre en gris (ver `usecases/occupancy-matrix.ts`).
    // Es ADITIVO: `fromPrice`, `availableCount` y `capacity` siguen valiendo exactamente lo
    // mismo que antes, porque se calculan con el mismo código de siempre acá arriba.
    const occupancies: OccupancyRate[] = buildOccupancyMatrix({
      roomType: rt.roomType,
      capacity: rt.capacity,
      availableByOccupancy: rt.availableByOccupancy,
      availableCount: rt.available,
      nightDates,
      nights,
      baseRates,
      seasonByDate,
      overrides,
      fallbackNightly,
      guests: adults,
    }).map((o) => {
      const price = o.stayTotal > 0 ? convert(o.stayTotal) : 0
      return {
        occupancy: o.occupancy,
        price,
        pricePerNight: nights > 0 ? round2(price / nights) : price,
        available: o.available,
        unavailableReason: o.unavailableReason,
        taxBreakdown: breakdownOf(price),
      }
    })

    return {
      id: rt.roomType,
      name: rt.roomType,
      fromPrice,
      availableCount: rt.available,
      capacity: rt.capacity,
      maxAdults: rt.maxAdults,
      maxChildren: rt.maxChildren,
      surfaceArea: rt.surfaceArea,
      taxBreakdown,
      photoUrl: photoByType.get(rt.roomType) ?? null,
      occupancies,
    }
  })

  return {
    status: 200,
    body: {
      roomTypes,
      currency: displayCurrency,
      taxes: taxes.map((t) => ({ name: t.name, rate: t.rate })),
      nights,
      // D10 — El cobro SIEMPRE es en hotels.currency. El widget muestra prices en displayCurrency
      // pero al pagar, Stripe cobra en chargeCurrency. El frontend lo necesita para etiquetar el
      // botón de pago ("Se cobrará en DOP") y evitar sorpresas.
      chargeCurrency: sourceCurrency,
      // Eco de los params para que el frontend pueda validar lo que el backend computó.
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      // FIX — antes se guardaba en booking_config y nunca se exponía; el widget no tenía
      // forma de mostrarla aunque el admin la hubiera escrito.
      cancellationPolicy: bookingConfig?.cancellationPolicy || null,
      // F5 #627 — Política estructurada para mostrar al huésped (tiers + ventana gratuita).
      // resolvePolicy trae TODAS las políticas del hotel y aplica channel > base > preset > default.
      // Si no hay repo cableado o falla, queda null → el widget cae al texto libre de arriba.
      cancellationSummary: deps.policies
        ? await buildCancellationSummary(deps.policies, hotel.id, hotel.cancellationType)
        : null,
    },
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Lee las temporadas del hotel y sus tarifas base. Mismas dos tablas y mismo filtro por hotel
 * que `/calendar` (`seasonAssignments`/`roomRates` de `shared/models.ts`).
 *
 * Degradación graceful — devuelve vacío (todas las noches al fallback `rooms.basePrice`) si:
 *  - los repos no están cableados (callers/tests viejos), o
 *  - la lectura falla. Un error leyendo temporadas NO puede tumbar la cotización pública: el
 *    peor caso es cotizar al precio base, que es exactamente lo que hacía antes este endpoint.
 */
async function readSeasonPricing(
  deps: Pick<PublicRatesDeps, 'seasonAssignments' | 'roomRates' | 'rateOverrides' | 'seasons'>,
  hotelId: string,
  nightDates: string[],
): Promise<{ seasonByDate: Map<string, string>; baseRates: any[]; overrides: any[] }> {
  const empty = { seasonByDate: new Map<string, string>(), baseRates: [] as any[], overrides: [] as any[] }
  if (!deps.seasonAssignments || !deps.roomRates) return empty
  try {
    const [assignments, rates, overrides, seasons] = await Promise.all([
      deps.seasonAssignments.findMany({ hotelId }),
      deps.roomRates.findMany({ hotelId }),
      // Repo opcional: un caller viejo que no lo inyecte sigue cotizando por temporada.
      deps.rateOverrides ? deps.rateOverrides.findMany({ hotelId }) : Promise.resolve([]),
      deps.seasons ? deps.seasons.findMany({ hotelId }) : Promise.resolve([]),
    ])
    return {
      seasonByDate: buildSeasonByDate(assignments as any[], (seasons ?? []) as any[], nightDates),
      baseRates: baseRatesOnly(rates as any[]),
      overrides: (overrides ?? []) as any[],
    }
  } catch {
    return empty
  }
}

/**
 * Lee `configuration(key='taxes')` del hotel. Mismo shape que folio-math/facturas/billing:
 * array de `{ activo|active, tasa|rate, nombre|name }`. Si no hay config o está vacía, cae a
 * `hotels.taxRate` + `hotels.taxName` (lo que Configuración → Impuestos SÍ guarda).
 */
async function readTaxes(
  config: RepositoryAdapter<any>,
  hotelId: string,
  hotel: any,
): Promise<TaxRow[]> {
  try {
    const rows = await config.findMany({ hotelId, key: 'taxes' })
    const arr: any[] = rows?.[0]?.value ?? []
    const configured: TaxRow[] = arr
      .filter((t) => t && (t.activo ?? t.active) !== false)
      .map((t) => ({
        name: String(t.nombre ?? t.name ?? 'Tax'),
        rate: Number(t.tasa ?? t.rate ?? 0),
      }))
      .filter((t) => t.rate > 0)
    if (configured.length > 0) return configured
  } catch { /* cae al fallback */ }
  const rate = Number(hotel?.taxRate) || 0
  if (rate > 0) return [{ name: String(hotel?.taxName ?? 'Tax'), rate }]
  return []
}

/**
 * Lee `configuration(key='currency_rates', hotelId='platform')` escrito por el cron nightly.
 * Shape: `{ base: 'USD', rates: { USD: 1, EUR: 0.92, DOP: 58, ... } }`. Si no está poblado
 * (cron sin correr, sin OPENEXCHANGERATES_APP_ID), devuelve null → el caller degrada a la
 * currency base del hotel.
 *
 * Exportada (sin cambiar su lógica) para que `public-calendar.ts` convierta con EXACTAMENTE la
 * misma tabla y el mismo criterio de degradación que `/rates` — dos lecturas distintas del mismo
 * `currency_rates` darían precios que no cierran entre el calendario y el selector.
 */
export async function readCurrencyRates(config: RepositoryAdapter<any>): Promise<Record<string, number> | null> {
  try {
    const rows = await config.findMany({ hotelId: 'platform', key: 'currency_rates' })
    const raw = rows?.[0]?.value
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const rates = parsed?.rates
    if (!rates || typeof rates !== 'object') return null
    return rates as Record<string, number>
  } catch {
    return null
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Resuelve una foto representativa por `room.type` string. No hay entidad RoomType propia
 * (ver comment de arriba): agrupa las rooms físicas del hotel por `type`, y para cada type
 * busca la primera `hotel_media(type='room')` entre esas rooms (ordenada por `sortOrder`
 * asc si una room tiene más de una foto). Sin foto asignada a ninguna room del type → no
 * está en el Map, el caller cae a `null` (no se inventa un placeholder acá).
 */
export async function resolvePhotoByType(
  deps: Pick<PublicRatesDeps, 'rooms' | 'hotelMedia'>,
  hotelId: string,
): Promise<Map<string, string>> {
  if (!deps.rooms || !deps.hotelMedia) return new Map()
  const [rooms, media] = await Promise.all([
    deps.rooms.findMany({ hotelId }),
    deps.hotelMedia.findMany({ hotelId, type: 'room' }),
  ])

  const roomIdToPhoto = new Map<string, string>()
  const sortedMedia = [...(media as any[])].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0),
  )
  for (const m of sortedMedia) {
    if (!m.roomId || roomIdToPhoto.has(m.roomId)) continue
    roomIdToPhoto.set(m.roomId, m.url)
  }

  const typeToRoomIds = new Map<string, string[]>()
  for (const r of rooms as any[]) {
    if (!r.type) continue
    const list = typeToRoomIds.get(r.type) ?? []
    list.push(r.id)
    typeToRoomIds.set(r.type, list)
  }

  const photoByType = new Map<string, string>()
  for (const [type, roomIds] of typeToRoomIds) {
    const photo = roomIds.map((id) => roomIdToPhoto.get(id)).find((url) => !!url)
    if (photo) photoByType.set(type, photo)
  }
  return photoByType
}

// Exportamos los helpers para tests (sin exponerlos vía el index del módulo — solo acá).
export const __test__ = { readTaxes, readCurrencyRates, round2, resolvePhotoByType, buildCancellationSummary }

// ─── F5 #627 — Cancellation Summary ──────────────────────────────────────────

/** Shape público del resumen de cancelación. Solo lo que el widget necesita para mostrar. */
export interface CancellationSummary {
  tiers: Tier[]
  /** Horas antes del checkIn hasta las cuales se puede cancelar gratis (penaltyPercent=0).
   *  null si no hay ventana gratuita (non_refundable: 100% siempre). */
  freeUntilHours: number | null
  /** Descripción legible de qué pasa después de la ventana gratuita. */
  penaltyDescription: string
  /** Fuente: 'custom' (política propia del hotel) | 'preset' (mapeada de cancellationType) | 'default'. */
  source: 'custom' | 'preset' | 'default'
}

/**
 * Resuelve la política de cancelación del hotel y la formatea para display público.
 *
 * `freeUntilHours` = deadlineHours del tier con penaltyPercent=0 más generoso (mayor deadlineHours).
 * `penaltyDescription` = resumen legible de los tiers con penalty > 0.
 *
 * Degradación graceful: si el repo falla o no hay políticas, devuelve null (el caller cae al
 * texto libre `cancellationPolicy` del booking_config).
 */
async function buildCancellationSummary(
  policyRepo: RepositoryAdapter<any>,
  hotelId: string,
  hotelCancellationType?: string | null,
): Promise<CancellationSummary | null> {
  try {
    const policy = await resolvePolicy(policyRepo, hotelId, undefined, hotelCancellationType)
    const freeTiers = policy.tiers.filter((t) => t.penaltyPercent === 0)
    // El tier gratuito más generoso: mayor deadlineHours (más tiempo para cancelar gratis).
    const freeUntilHours = freeTiers.length > 0
      ? Math.max(...freeTiers.map((t) => t.deadlineHours))
      : null

    // Descripción legible de la penalidad.
    const penaltyTiers = policy.tiers.filter((t) => t.penaltyPercent > 0)
    let penaltyDescription: string
    if (penaltyTiers.length === 0) {
      penaltyDescription = 'Cancelación gratuita en cualquier momento'
    } else if (penaltyTiers.some((t) => t.penaltyPercent >= 100 && !t.refundable)) {
      penaltyDescription = 'No reembolsable'
    } else {
      const max = Math.max(...penaltyTiers.map((t) => t.penaltyPercent))
      penaltyDescription = `Después: hasta ${max}% de penalización`
    }

    return {
      tiers: policy.tiers,
      freeUntilHours,
      penaltyDescription,
      source: policy.source,
    }
  } catch {
    return null
  }
}
