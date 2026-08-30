// bookingengine/usecases/public-calendar.ts — GET /api/public/hotels/:slug/calendar
//
// Alimenta el calendario de la landing: por cada día del rango, el "precio desde" de ESA noche
// y las unidades realmente libres. Es el complemento de `/rates` (que responde por estadía
// completa una vez que el huésped ya eligió checkIn/checkOut): acá el huésped todavía está
// eligiendo fechas y necesita ver dónde hay lugar y cuánto sale cada noche.
//
// ─── Precio ────────────────────────────────────────────────────────────────────────────────
// La resolución (season_assignments → room_rates → fallback a `rooms.basePrice`) vive en
// `usecases/rate-resolution.ts`, compartida con `/rates`: si cada endpoint la resolviera por su
// cuenta, el calendario anunciaría un precio y el buscador cotizaría otro para las mismas
// fechas. Ver ese archivo para el criterio de canal/ocupación y el porqué del fallback.
//
// ⚠️ Impuestos: `fromPrice` va SIN impuestos, igual que el `fromPrice` de `/rates` (que los
// devuelve aparte en `taxBreakdown`). Mostrar acá un precio con ITBIS y allá uno sin ITBIS haría
// que el precio "suba" al pasar del calendario al selector de habitación. Mismo criterio a
// propósito; si algún día se decide mostrar precio final, se cambia en LOS DOS lados.
//
// ─── Disponibilidad ────────────────────────────────────────────────────────────────────────
// Se calcula día a día con `shared/utils/daily-availability.ts` (misma cuenta pura que usa el
// push ARI a Channex), pero con el criterio de estados del MOTOR PÚBLICO
// (`confirmed|checked_in|pending|guaranteed`, idéntico a `AvailabilityUseCase`), no el laxo de
// canales. Si el calendario usara el laxo mostraría noches libres que después
// `POST /api/public/booking` rechaza.
// Los `room_blocks` (bloqueos de mantenimiento/uso interno) se descuentan acá y —desde el fix de
// `usecases/stay-restrictions.ts`— también en `AvailabilityUseCase`, que antes los ignoraba: el
// calendario cerraba la noche y el buscador la vendía igual.
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { isRoomSellable } from '../../../shared/usecases/room-status'
import {
  computeDailyAvailability,
  eachDayInclusive,
} from '../../../shared/utils/daily-availability'
import { readCurrencyRates } from './public-rates'
import { baseRatesOnly, buildSeasonByDate, pickRate, ratePrice } from './rate-resolution'
import { round2 } from '../../../shared/utils/money'
import { isRateClosed } from './stay-restrictions'
import { validatePublicCalendarQuery, MAX_CALENDAR_DAYS } from '../validators/schema'

/** Re-export por compatibilidad: nacieron acá y los tests del calendario los importan de acá.
 *  La implementación canónica vive en `rate-resolution.ts` (compartida con `/rates`). */
export { pickRate, ratePrice }

/** Máximo de días por llamada. Vive en `validators/schema.ts` (única fuente de verdad, la usa
 *  también el mensaje de error) y se re-exporta acá para los callers del usecase. */
export { MAX_CALENDAR_DAYS }

/** TTL del calendario. Igual de corto que `availability:*`: dos personas mirando el mismo mes
 *  no pueden ver stock que se vendió hace cinco minutos.
 *  NO se invalida por clave: `CacheAdapter.delete()` solo borra claves exactas (no hay glob ni
 *  prefijo), y las claves llevan rango + guests + moneda. Si alguna vez hiciera falta invalidar
 *  en el acto, la salida es un token de versión como `facturas/usecases/cache.ts`, nunca un
 *  `delete('rate-calendar:*')` que no borra nada. */
const CACHE_TTL_SECONDS = 60

/** Estados en los que una habitación NO se puede vender (idéntico a `usecases/availability.ts`). */

/** Reservas que ocupan la habitación en el motor público. Whitelist, no "todo lo no cancelado". */
const BLOCKING_RESERVATION_STATUS = new Set(['confirmed', 'checked_in', 'pending', 'guaranteed'])

export interface PublicCalendarDeps {
  hotels: RepositoryAdapter<any>
  rooms: RepositoryAdapter<any>
  reservations: RepositoryAdapter<any>
  roomBlocks: RepositoryAdapter<any>
  seasonAssignments: RepositoryAdapter<any>
  roomRates: RepositoryAdapter<any>
  /** `Configuration` KV — solo para `currency_rates` (hotelId='platform'). Opcional: sin él
   *  el calendario responde en la moneda base del hotel. */
  config?: RepositoryAdapter<any>
  /** Tabla `booking_config` — el toggle Activo/Inactivo del admin apaga también el calendario. */
  bookingConfig?: RepositoryAdapter<any>
  /** Cache de listado. Opcional (los tests corren sin ella). */
  cache?: CacheAdapter
}

export interface PublicCalendarQuery {
  from: string
  to: string
  /** Huéspedes por habitación. Default 2 (mismo default que `/rates` y `availability.check`). */
  guests?: number
  /** Moneda de display. Default = `hotels.currency`. El cobro siempre es en la del hotel. */
  currency?: string
}

export interface CalendarDay {
  /** YYYY-MM-DD. */
  date: string
  /** Precio de ESA noche (no total de estadía), el más bajo entre los tipos vendibles. Sin impuestos. */
  fromPrice: number
  /** Unidades libres ese día (suma de los tipos vendibles y no cerrados). */
  available: number
  /** Stop-sell: sin disponibilidad, o todas las tarifas del día marcadas `closed`. */
  closed: boolean
  /** Estadía mínima para entrar ESE día, si la tarifa que da el `fromPrice` la impone. */
  minStay?: number
}

export interface PublicCalendarBody {
  currency: string
  /** Moneda real del cobro (= `hotels.currency`). `currency` puede ser solo display. */
  chargeCurrency: string
  from: string
  to: string
  guests: number
  days: CalendarDay[]
}

/**
 * Mismo contrato que el resto de los handlers públicos del módulo: devuelve `{status, body}`
 * en vez de lanzar (`public-rates.ts` documenta el porqué).
 */
export async function getPublicCalendar(
  deps: PublicCalendarDeps,
  slug: string,
  query: PublicCalendarQuery,
): Promise<{ status: number; body: any }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }

  // Validación del query ANTES de tocar la DB: un rango absurdo no debe costar una lectura.
  const validated = validatePublicCalendarQuery(query)
  if ('error' in validated) return { status: 400, body: { error: validated.error } }
  const { from, to, guests } = validated.value

  // Anti-enumeración: idéntico 404 para "no existe" y "no activo" (mismo criterio que /rates).
  const hotel = await deps.hotels.findOne({ slug })
  if (!hotel || hotel.onlineBookingStatus !== 'active') {
    return { status: 404, body: { error: 'Hotel not found' } }
  }
  const bookingConfig = deps.bookingConfig ? await deps.bookingConfig.findOne({ hotelId: hotel.id }) : null
  if (bookingConfig && bookingConfig.enabled === false) {
    return { status: 404, body: { error: 'Hotel not found' } }
  }

  const sourceCurrency = String(hotel.currency || 'USD').toUpperCase()
  const targetCurrency = validated.value.currency || sourceCurrency

  const cacheKey = `rate-calendar:${hotel.id}:${from}:${to}:${guests}:${targetCurrency}`
  if (deps.cache) {
    const cached = await deps.cache.get<PublicCalendarBody>(cacheKey)
    if (cached) return { status: 200, body: cached }
  }

  const [rooms, reservations, blocks, assignments, rates] = await Promise.all([
    deps.rooms.findMany({ hotelId: hotel.id }),
    deps.reservations.findMany({ hotelId: hotel.id }),
    deps.roomBlocks.findMany({ hotelId: hotel.id }),
    deps.seasonAssignments.findMany({ hotelId: hotel.id }),
    deps.roomRates.findMany({ hotelId: hotel.id }),
  ])

  const days = eachDayInclusive(from, to)
  const seasonByDate = buildSeasonByDate(assignments as any[])
  const types = buildTypeBuckets(rooms as any[], guests)

  // Índices por roomId para no re-filtrar el array completo por cada tipo.
  const resByRoom = groupReservationsByRoom(reservations as any[])
  const blocksByRoom = groupBlocksByRoom(blocks as any[])

  // Disponibilidad día a día por tipo.
  const availabilityByType = new Map<string, Map<string, number>>()
  for (const [type, bucket] of types) {
    const perDay = computeDailyAvailability(
      days,
      bucket.roomIds.length,
      bucket.roomIds.flatMap((id) => resByRoom.get(id) ?? []),
      bucket.roomIds.flatMap((id) => blocksByRoom.get(id) ?? []),
    )
    availabilityByType.set(type, new Map(perDay.map((d) => [d.date, d.available])))
  }

  const currencyRates = deps.config ? await readCurrencyRates(deps.config) : null
  const canConvert = !!currencyRates && targetCurrency !== sourceCurrency &&
    typeof currencyRates[sourceCurrency] === 'number' && typeof currencyRates[targetCurrency] === 'number'
  const displayCurrency = canConvert ? targetCurrency : sourceCurrency
  const convert = (amount: number): number => {
    if (!canConvert || !currencyRates) return round2(amount)
    // rates base USD (openexchangerates free tier): amount_source → USD → target.
    return round2((amount / currencyRates[sourceCurrency]!) * currencyRates[targetCurrency]!)
  }

  const baseRates = baseRatesOnly(rates as any[])

  const out: CalendarDay[] = days.map((date) => {
    const season = seasonByDate.get(date) ?? null
    let available = 0
    let best: { price: number; minStay: number } | null = null

    for (const [type, bucket] of types) {
      const free = availabilityByType.get(type)?.get(date) ?? 0
      const rate = pickRate(baseRates, type, season, guests)
      // Stop-sell del tipo para esa temporada: no suma unidades ni compite por el fromPrice.
      // El criterio vive en `stay-restrictions.ts`, compartido con `AvailabilityUseCase` (que lo
      // aplica al rango entero) — una sola definición de "cerrado" para calendario y motor.
      if (isRateClosed(rate)) continue
      if (free <= 0) continue
      available += free

      const price = rate ? ratePrice(rate) : 0
      // Fallback: sin temporada asignada o sin fila de tarifa → `rooms.basePrice` del tipo.
      const effective = price > 0 ? price : bucket.basePrice
      if (effective <= 0) continue
      if (!best || effective < best.price) {
        best = { price: effective, minStay: rate ? Math.max(0, Number(rate.minStay) || 0) : 0 }
      }
    }

    const day: CalendarDay = {
      date,
      // 0 = no se pudo derivar un precio (hotel sin tarifas y sin `rooms.basePrice` cargado).
      // NO implica que el día esté cerrado: el huésped tiene que poder elegir fechas igual.
      fromPrice: best ? convert(best.price) : 0,
      available,
      // Cerrado = no queda NADA vendible ese día: sin stock libre, o todo el stock con `closed`
      // (el `continue` del stop-sell evita que esas unidades sumen a `available`).
      // Ojo: NO se cierra por falta de precio. Un hotel recién dado de alta, con habitaciones
      // pero sin tarifas, publicaba el mes entero como "Lleno" y no se podía reservar nada.
      closed: available <= 0,
    }
    if (best && best.minStay > 1) day.minStay = best.minStay
    return day
  })

  const body: PublicCalendarBody = {
    currency: displayCurrency,
    chargeCurrency: sourceCurrency,
    from,
    to,
    guests,
    days: out,
  }
  if (deps.cache) await deps.cache.set(cacheKey, body, CACHE_TTL_SECONDS)
  return { status: 200, body }
}

// ─── helpers ───────────────────────────────────────────────────────────────

interface TypeBucket {
  /** Habitaciones vendibles del tipo que además entran el grupo (`capacity >= guests`). */
  roomIds: string[]
  /** `min(rooms.basePrice)` del tipo — fallback de precio cuando no hay tarifa por temporada. */
  basePrice: number
}

/**
 * Agrupa las habitaciones por `type`, descartando las no vendibles (`out_of_order`,
 * `out_of_service`, `maintenance`) y las que no entran el grupo — mismos filtros que
 * `usecases/availability.ts:aggregate`, para que el calendario y el motor coincidan.
 */
function buildTypeBuckets(rooms: any[], guests: number): Map<string, TypeBucket> {
  const out = new Map<string, TypeBucket>()
  for (const room of rooms) {
    const type = room.type || 'standard'
    if (!isRoomSellable(room.status)) continue
    if (Number(room.capacity ?? guests) < guests) continue
    const bucket = out.get(type) ?? { roomIds: [], basePrice: 0 }
    bucket.roomIds.push(room.id)
    const price = Number(room.basePrice ?? room.price ?? 0)
    if (price > 0 && (bucket.basePrice === 0 || price < bucket.basePrice)) bucket.basePrice = price
    out.set(type, bucket)
  }
  return out
}

function groupReservationsByRoom(reservations: any[]): Map<string, { checkIn: string; checkOut: string }[]> {
  const out = new Map<string, { checkIn: string; checkOut: string }[]>()
  for (const r of reservations) {
    if (!r.roomId) continue
    const status = String(r.status ?? '').toLowerCase()
    // Sin estado se asume que ocupa (mismo criterio defensivo que `AvailabilityUseCase`).
    if (status && !BLOCKING_RESERVATION_STATUS.has(status)) continue
    const checkIn = String(r.checkIn ?? '').slice(0, 10)
    const checkOut = String(r.checkOut ?? '').slice(0, 10)
    if (!checkIn || !checkOut) continue
    const list = out.get(r.roomId) ?? []
    list.push({ checkIn, checkOut })
    out.set(r.roomId, list)
  }
  return out
}

function groupBlocksByRoom(blocks: any[]): Map<string, { startDate: string; endDate: string }[]> {
  const out = new Map<string, { startDate: string; endDate: string }[]>()
  for (const b of blocks) {
    if (!b.roomId) continue
    const startDate = String(b.startDate ?? '').slice(0, 10)
    const endDate = String(b.endDate ?? '').slice(0, 10)
    if (!startDate || !endDate) continue
    const list = out.get(b.roomId) ?? []
    list.push({ startDate, endDate })
    out.set(b.roomId, list)
  }
  return out
}

