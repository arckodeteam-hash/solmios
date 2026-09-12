// bookingengine/usecases/public-ota-prices.ts — GET /api/public/hotels/:slug/ota-prices (F3 3.15).
//
// Compara la tarifa directa del hotel (availabilityUseCase + room rates) vs las tarifas OTA
// (StayAPI: Booking + Airbnb) para las mismas fechas. Devuelve el badge "Mejor precio
// garantizado: ahorrás $X" SOLO si directo es más barato. Si no, NO promociona OTAs.
//
// Decisiones de diseño (spec D11 + paridad):
//
//  1. **directPrice** = mínimo `fromPrice` entre los room types disponibles para las fechas
//     (mismo cálculo que public-rates.ts). Es lo más barato que el hotel ofrece directo.
//
//  2. **otaPrice** = mínimo precio entre las OTAs que StayAPI devuelve. Convertimos la
//     currency de la OTA a la currency del hotel si hace falta (usando configuration('currency_rates')).
//
//  3. **showComparison** = true solo si `directPrice < otaPrice - EPSILON` (directo estrictamente
//     más barato; empatar no cuenta — el badge "ahorrás" no aplica). Si empatan o directo es
//     más caro, devolvemos `{showComparison:false}` SIN revelar el precio OTA (anti-promoción
//     cruzada: no mandes al huésped a la OTA porque es más barata).
//
//  4. **Graceful**: si StayAPI no está configurado, falla, o devuelve vacío → `{showComparison:false}`.
//     La landing NUNCA se rompe por una API externa caída (R3).
//
//  5. **savings** = diferencia (otaPrice - directPrice), en la currency del hotel. Redondeado a 2.
//
// Anti-enumeración: mismo 404 plano para "hotel no existe" y "no activo" (criterio de public-hotel-info).
//
// Anti-patrón ORM: NO toca modelos. Lee `Hotels` vía repo, `Configuration` vía repo, llama al
// usecase de availability. Mismo molde que public-rates.ts.

import type { RepositoryAdapter } from 'arckode-framework'
import type { AvailabilityQuery, AvailabilityResult } from '../types'
import {
  fetchStayApiOtaPrices,
  type OtaPriceQuote,
  type StayApiPricesConfig,
  type StayApiPricesFetcher,
} from '../../../connectors/stayapi-ota-prices'
import type { StayApiOta } from '../../external-reviews/types'
import { isEngineOpen, engineClosed } from '../../../shared/usecases/booking-engine-gate'

const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60 * MS_PER_SECOND
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR
const PRICE_EPSILON = 0.01 // 1 centavo de la currency base; por debajo de esto se consideran iguales

export interface PublicOtaPricesDeps {
  hotels: RepositoryAdapter<any>
  /** Use case de disponibilidad (cacheado) — mismo que usa public-rates. */
  availability: { checkAvailability(q: AvailabilityQuery): Promise<AvailabilityResult> }
  /** Repo de Configuration (lee stayapi_api_key, stayapi_hotel_ids, currency_rates). */
  config: RepositoryAdapter<any>
  /** Fetcher inyectable (tests). Default = HTTP real a StayAPI. */
  otaFetcher?: StayApiPricesFetcher
  /**
   * FIX 2026-07-31 — Repo de `BookingConfig`. Antes el toggle "Comparar con OTAs" del admin
   * (`showComparison`) se guardaba pero esta comparación corría SIEMPRE, sin mirarlo — apagarlo
   * no apagaba nada. Opcional: sin cablear, degrada a "comparación siempre activa" (compat).
   */
  bookingConfig?: RepositoryAdapter<any>
}

export interface PublicOtaPricesQuery {
  checkIn: string
  checkOut: string
  guests?: number
}

/** Respuesta del endpoint — shape siempre el mismo, mismo contrato ahora y cuando no haya
 *  comparación. El frontend solo necesita saber si mostrar el badge o no. */
export interface PublicOtaPricesResponse {
  /** True si directo es más barato que al menos una OTA — mostrar el badge. */
  showComparison: boolean
  /** Cuánto ahorrás reservando directo (en la currency del hotel). null si showComparison=false. */
  savings: number | null
  /** Moneda ISO del `savings` (siempre = hotels.currency). */
  currency: string
  /** Cuál OTA fue la más cara (la referencia del ahorro). Solo si showComparison=true. */
  vsSource?: 'booking' | 'airbnb'
}

/** Calcula el precio más bajo que el hotel ofrece directo para las fechas (mínimo por type
 *  × noches). Mismo cómputo que public-rates.ts pero simplificado (sin taxes, sin conversión:
 *  comparamos base contra base, lo que cuenta es si directo pega más bajo que OTA). */
async function computeDirectPrice(
  availability: AvailabilityResult,
  nights: number,
): Promise<number> {
  if (!availability?.roomTypes || availability.roomTypes.length === 0) return 0
  // Solo tipos con unidades libres para la consulta. Antes el filtro era implícito (el motor no
  // devolvía tipos con `available: 0`); desde que un tipo agotado para el grupo consultado sigue
  // viajando —para poder pintar su fila en gris— hay que explicitarlo, o la comparación contra
  // las OTAs anunciaría un "precio directo" de un producto que no se puede comprar.
  const cheapest = availability.roomTypes.reduce((min: number, rt: any) => {
    // `available` ausente = caller que no lo informa (tests/fixtures viejos): no se descarta nada
    // que antes contara. Solo un 0 EXPLÍCITO saca al tipo de la comparación.
    if (rt.available !== undefined && (Number(rt.available) || 0) <= 0) return min
    const p = Number(rt.price) || 0
    return p > 0 && (min === 0 || p < min) ? p : min
  }, 0)
  return round2(cheapest * nights)
}

/** Lee stayapi creds del configuration del hotel. Devuelve null si no hay creds. */
async function readStayApiConfig(
  configRepo: RepositoryAdapter<any>,
  hotelId: string,
): Promise<Partial<StayApiPricesConfig> | null> {
  try {
    const rows = await configRepo.findMany({ hotelId }) as Array<{ key: string; value: any }>
    const byKey = new Map<string, any>()
    for (const r of rows) byKey.set(r.key, r.value)
    const apiKey = byKey.get('stayapi_api_key')
    const rawHotelIds = byKey.get('stayapi_hotel_ids')
    let hotelIds: Partial<Record<StayApiOta, string>> | undefined
    if (rawHotelIds && typeof rawHotelIds === 'object') {
      hotelIds = rawHotelIds as Partial<Record<StayApiOta, string>>
    } else if (typeof rawHotelIds === 'string') {
      try { hotelIds = JSON.parse(rawHotelIds) as Partial<Record<StayApiOta, string>> } catch { hotelIds = undefined }
    }
    if (!apiKey) return null
    return { apiKey, hotelIds }
  } catch {
    return null
  }
}

/** Lee rates para conversión OTA currency → hotel currency. Mismo formato que public-rates. */
async function readCurrencyRates(
  configRepo: RepositoryAdapter<any>,
): Promise<Record<string, number> | null> {
  try {
    const rows = await configRepo.findMany({ hotelId: 'platform', key: 'currency_rates' }) as Array<{ value: any }>
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

/** Convierte un monto desde `fromCurrency` a `toCurrency` usando rates base-USD. */
function convertAmount(amount: number, fromCurrency: string, toCurrency: string, rates: Record<string, number> | null): number {
  if (!rates) return amount
  const from = fromCurrency.toUpperCase()
  const to = toCurrency.toUpperCase()
  if (from === to) return amount
  const rFrom = rates[from]
  const rTo = rates[to]
  if (typeof rFrom !== 'number' || typeof rTo !== 'number') return amount // degrada a sin conversión
  const inUsd = amount / rFrom
  return round2(inUsd * rTo)
}

export async function getPublicOtaPrices(
  deps: PublicOtaPricesDeps,
  slug: string,
  query: PublicOtaPricesQuery,
): Promise<{ status: number; body: PublicOtaPricesResponse | { error: string } }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }
  if (!query.checkIn || !query.checkOut) {
    return { status: 400, body: { error: 'checkIn y checkOut son requeridos' } }
  }
  if (query.checkIn >= query.checkOut) {
    return { status: 400, body: { error: 'checkOut debe ser posterior a checkIn' } }
  }

  // #276 (MR-11) — un solo interruptor del motor público (`shared/usecases/booking-engine-gate.ts`):
  // `hotels.onlineBookingStatus` (plataforma) + `booking_config.enabled` (hotel), mismo 404.
  // `bookingConfig` se lee UNA vez: el gate y `showComparison` comparten el fetch.
  const hotel = await deps.hotels.findOne({ slug })
  const bookingConfig = hotel && deps.bookingConfig ? await deps.bookingConfig.findOne({ hotelId: hotel.id }) : null
  if (!isEngineOpen(hotel, bookingConfig)) return engineClosed()
  const hotelCurrency = String(hotel.currency || 'USD').toUpperCase()

  // FIX — respeta el toggle del admin. Corta ANTES de llamar a StayAPI (ahorra la request
  // externa si el hotel decidió no comparar).
  if (bookingConfig && bookingConfig.showComparison === false) {
    return { status: 200, body: { showComparison: false, savings: null, currency: hotelCurrency } }
  }

  const nights = Math.max(1, Math.round(
    (new Date(query.checkOut).getTime() - new Date(query.checkIn).getTime()) / MS_PER_DAY,
  ))
  const adults = typeof query.guests === 'number' && query.guests > 0 ? query.guests : 2

  // 1) Tarifa directa del hotel (availability aggregate ya trae el precio más bajo por type).
  const availability = await deps.availability.checkAvailability({
    hotelId: hotel.id, checkIn: query.checkIn, checkOut: query.checkOut, adults,
  })
  const directPrice = await computeDirectPrice(availability, nights)
  if (directPrice <= 0) {
    // Sin disponibilidad directa para esas fechas → no tiene sentido comparar.
    return { status: 200, body: { showComparison: false, savings: null, currency: hotelCurrency } }
  }

  // 2) Tarifas OTA desde StayAPI.
  const stayApiConfig = await readStayApiConfig(deps.config, hotel.id)
  if (!stayApiConfig) {
    return { status: 200, body: { showComparison: false, savings: null, currency: hotelCurrency } }
  }
  const rates = await readCurrencyRates(deps.config)
  const otaQuotes = await fetchStayApiOtaPrices(
    stayApiConfig,
    { checkIn: query.checkIn, checkOut: query.checkOut },
    nights,
    deps.otaFetcher,
  )
  if (otaQuotes.length === 0) {
    return { status: 200, body: { showComparison: false, savings: null, currency: hotelCurrency } }
  }

  // 3) Buscar la OTA MÁS CARA (para maximizar el ahorro reportado, pero también chequear
  //    si la MÁS BARATA sigue siendo más cara que directo — si alguna OTA nos pega más bajo,
  //    mejor no mostrar el badge porque el usuario podría irse ahí). Decisión: comparamos
  //    contra la OTA más barata. Si directo < otaMin → estamos más baratos que TODAS.
  const otaInHotelCurrency: OtaPriceQuote[] = otaQuotes.map((q) => ({
    source: q.source,
    amount: convertAmount(q.amount, q.currency, hotelCurrency, rates),
    currency: hotelCurrency,
  }))
  const otaMin = otaInHotelCurrency.reduce(
    (min: OtaPriceQuote, q: OtaPriceQuote) => (q.amount < min.amount ? q : min),
    otaInHotelCurrency[0],
  )

  const savings = round2(otaMin.amount - directPrice)
  if (savings > PRICE_EPSILON) {
    return {
      status: 200,
      body: {
        showComparison: true,
        savings,
        currency: hotelCurrency,
        vsSource: otaMin.source,
      },
    }
  }
  // Directo NO es más barato → no promover OTAs, no revelar el precio OTA.
  return { status: 200, body: { showComparison: false, savings: null, currency: hotelCurrency } }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export const __test__ = { computeDirectPrice, convertAmount, PRICE_EPSILON }
