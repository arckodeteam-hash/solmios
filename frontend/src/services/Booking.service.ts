// services/Booking.service.ts — Cliente API del flujo de RESERVA pública (F0 0.20 +
// F2 2.8-2.10, solmi-direct-booking).
//
// Cinco endpoints públicos (sin auth, rate-limited por IP en el backend):
//   - GET  /api/public/hotels/:slug/rates          → tarifa derivada + availableCount (D11)
//   - GET  /api/public/hotels/:slug/upsells         → upsells activos
//   - GET  /api/public/hotels/:slug/meal-plans      → regímenes activos (tasks.md 2.2/2.4)
//   - POST /api/public/hotels/:slug/promo/validate  → {valid, discount, reason?}
//   - POST /api/public/booking                      → crea reserva pending + redirige a Stripe
//   - GET  /api/public/reservations/:id             → polling post-redirect (valida token HMAC)
//
// El service acepta DTOs "friendly" (slug + guest anidado) y los aplana al shape que
// requiere el backend (ExtendedPublicBookingSchema). El response crudo del backend
// (`{reservation, guest, checkoutUrl, totalBreakdown, paymentError?}`) se aplana al contract
// limpio del spec booking-unification R-1: `{reservationId, accessToken, checkoutUrl, totalBreakdown}`.
//
// ROBUSTEZ F0 (public-booking.ts:152-171): si Stripe falla (no configurado / gateway caído),
// la reserva SE CREA igual con status='pending' y el backend devuelve 201 con
// `checkoutUrl: null` + `paymentError`. El service NO relanza — el widget muestra el error
// y la reserva sigue viviendo en el panel del hotelero.

import { http } from './http'
import { PublicHotelService } from './PublicHotel.service'
import { clampSpan, MAX_CALENDAR_DAYS } from '@/utils/rate-calendar'
import type {
  CreateBookingDTO,
  CreateBookingGroupDTO,
  CreateBookingResponse,
  CancelReservationResponse,
  PublicCalendarQuery,
  PublicCalendarResponse,
  PublicMealPlan,
  PublicRatesQuery,
  PublicRatesResponse,
  PublicReservationResponse,
  PromoValidationResult,
  TotalBreakdown,
  Upsell,
} from '@/types/booking'

function build(qs: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/**
 * Respuesta cruda del backend (espejo de public-booking.ts return body). El service la
 * transforma a `CreateBookingResponse` (spec booking-unification R-1, shape plana).
 */
interface RawCreateBookingResponse {
  reservation: { id: string; accessToken: string; [k: string]: unknown }
  guest: unknown
  checkoutUrl: string | null
  totalBreakdown: TotalBreakdown
  paymentError?: string
}

/** Respuesta cruda de `POST /api/public/booking/group` (`createPublicBookingGroup`) — YA plana
 *  (a diferencia de la de arriba), más `group`/`reservations`/`guest` que este service ignora. */
interface RawCreateBookingGroupResponse {
  reservationId: string
  accessToken: string
  checkoutUrl: string | null
  totalBreakdown: TotalBreakdown
  paymentError?: string
}

export const BookingService = {
  /**
   * Crea una reserva pública y dispara el Checkout Session de Stripe.
   *
   * Pasos:
   *   1. Resuelve `dto.slug` → `hotelId` vía `PublicHotelService.getBySlug` (una request
   *      extra; deja el DTO del widget limpio: el widget sabe el slug, no el id interno).
   *   2. Mapea `guest:{name,email,phone,estimatedArrival,specialRequests}` →
   *      `guestName/guestEmail/guestPhone/estimatedArrival/specialRequests` (schema backend).
   *   3. POST /api/public/booking con el body plano + upsells/promoCode/successUrl/cancelUrl
   *      + idempotencyKey client-side.
   *   4. Aplana la respuesta a `{reservationId, accessToken, checkoutUrl, totalBreakdown, paymentError?}`.
   *
   * El `accessToken` se devuelve al frontend para que arme la URL de vuelta
   * `/h/:slug?booking=:id&token=:token` (spec R2) — Stripe vuelve a esa URL tras el pago.
   */
  async createBooking(dto: CreateBookingDTO): Promise<CreateBookingResponse> {
    const hotel = await PublicHotelService.getBySlug(dto.slug)
    const body: Record<string, unknown> = {
      hotelId: hotel.id,
      roomType: dto.roomType,
      guestName: dto.guest.name,
      guestEmail: dto.guest.email,
      guestPhone: dto.guest.phone,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      adults: dto.adults,
    }
    // `roomId` es opcional (FIX 2026-07-30): el widget público no lo manda, el backend resuelve
    // la unidad física a partir de `roomType`. Solo se manda si un caller lo pasó explícito.
    if (dto.roomId) body.roomId = dto.roomId
    if (dto.children !== undefined) body.children = dto.children
    if (dto.guest.estimatedArrival) body.estimatedArrival = dto.guest.estimatedArrival
    if (dto.guest.specialRequests) body.specialRequests = dto.guest.specialRequests
    if (dto.promoCode) body.promoCode = dto.promoCode
    if (dto.upsells && dto.upsells.length > 0) body.upsells = dto.upsells
    if (dto.successUrl) body.successUrl = dto.successUrl
    if (dto.cancelUrl) body.cancelUrl = dto.cancelUrl
    if (dto.idempotencyKey) body.idempotencyKey = dto.idempotencyKey

    const raw = await http.post<RawCreateBookingResponse>('/public/booking', body)
    const response: CreateBookingResponse = {
      reservationId: raw.reservation.id,
      accessToken: raw.reservation.accessToken,
      checkoutUrl: raw.checkoutUrl,
      totalBreakdown: raw.totalBreakdown,
    }
    if (raw.paymentError) response.paymentError = raw.paymentError
    return response
  },

  /**
   * Tarea 10 (QA 2026-08-20/21) — reserva de VARIAS habitaciones (mismo tipo ×N y/o tipos
   * distintos combinados) en una sola operación. Mismo criterio que `createBooking`: resuelve
   * slug→hotelId, aplana `guest`, postea a `POST /api/public/booking/group`.
   *
   * A diferencia de `createBooking`, el backend YA devuelve la respuesta plana
   * (`{reservationId, accessToken, checkoutUrl, totalBreakdown, paymentError?}`, más `group`/
   * `reservations`/`guest` que este service no necesita) — no hay que desanidar `reservation.id`.
   * `reservationId`/`accessToken` son los de la reserva LÍDER: la única sobre la que se abrió
   * la Checkout Session, por el total combinado del grupo.
   */
  async createBookingGroup(dto: CreateBookingGroupDTO): Promise<CreateBookingResponse> {
    const hotel = await PublicHotelService.getBySlug(dto.slug)
    const body: Record<string, unknown> = {
      hotelId: hotel.id,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      rooms: dto.rooms,
      guestName: dto.guest.name,
      guestEmail: dto.guest.email,
      guestPhone: dto.guest.phone,
    }
    if (dto.guest.estimatedArrival) body.estimatedArrival = dto.guest.estimatedArrival
    if (dto.guest.specialRequests) body.specialRequests = dto.guest.specialRequests
    if (dto.promoCode) body.promoCode = dto.promoCode
    if (dto.upsells && dto.upsells.length > 0) body.upsells = dto.upsells
    if (dto.successUrl) body.successUrl = dto.successUrl
    if (dto.cancelUrl) body.cancelUrl = dto.cancelUrl
    if (dto.idempotencyKey) body.idempotencyKey = dto.idempotencyKey

    const raw = await http.post<RawCreateBookingGroupResponse>('/public/booking/group', body)
    const response: CreateBookingResponse = {
      reservationId: raw.reservationId,
      accessToken: raw.accessToken,
      checkoutUrl: raw.checkoutUrl,
      totalBreakdown: raw.totalBreakdown,
    }
    if (raw.paymentError) response.paymentError = raw.paymentError
    return response
  },

  /**
   * Consulta pública de reserva por id + token HMAC (anti-IDOR, spec booking-unification).
   *
   * Token = `accessToken` que devolvió `createBooking`. Sin token, token incorrecto, o
   * reserva creada desde panel (accessToken=null) → 404 con mismo body (no revelar existencia).
   * El widget usa esto para hacer polling del estado tras volver de Stripe (confirmed/pending/failed).
   */
  getReservation(id: string, token: string): Promise<PublicReservationResponse> {
    const qs = new URLSearchParams({ token })
    const path = `/public/reservations/${encodeURIComponent(id)}?${qs.toString()}`
    return http.get<PublicReservationResponse>(path)
  },

  /**
   * F4 #627 — Auto-cancelación pública del huésped.
   * POST /api/public/reservations/:id/cancel?token=X con body { reason }.
   * Token = accessToken (HMAC + timingSafeEqual). Anti-enumeración: 404 mismo body para
   * no-existe / sin-token / token-inválido. 409 si checked_in/checked_out.
   * Idempotente: ya cancelled → 200 con idempotent=true.
   */
  cancelReservation(id: string, token: string, reason?: string): Promise<CancelReservationResponse> {
    const qs = new URLSearchParams({ token })
    const path = `/public/reservations/${encodeURIComponent(id)}/cancel?${qs.toString()}`
    return http.post<CancelReservationResponse>(path, reason ? { reason } : {})
  },

  /**
   * Tarifas derivadas + disponibles (F2 2.4). Devuelve room types con `fromPrice` TOTAL de
   * la estadía (no por noche) + `availableCount` para urgencia D11 + impuestos desglosados.
   *
   * Multi-moneda (D10): si `query.currency` difiere de `hotels.currency`, el backend convierte
   * usando `configuration('currency_rates')`. `response.currency` es la moneda display,
   * `response.chargeCurrency` es la del cobro (siempre `hotels.currency`). Si no hay rates,
   * el backend degrada a la currency base — el widget muestra lo que recibe.
   *
   * Anti-enumeración: hotel inexistente o no-activo → MISMO 404 (no revelar paused hotels).
   */
  getRates(slug: string, query: PublicRatesQuery): Promise<PublicRatesResponse> {
    const path = `/public/hotels/${encodeURIComponent(slug)}/rates${build({
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      rooms: query.rooms,
      guests: query.guests,
      currency: query.currency,
    })}`
    return http.get<PublicRatesResponse>(path)
  },

  /**
   * Calendario de tarifas y disponibilidad noche a noche
   * (`GET /api/public/hotels/:slug/calendar`). Alimenta el calendario de rango del buscador de
   * la landing, ANTES de que el huésped haya elegido fechas — por eso responde por día y no por
   * estadía como `getRates`.
   *
   * `guests` es la ocupación FÍSICA por habitación (adultos + niños): el backend filtra
   * `rooms.capacity >= guests` y elige la fila de `room_rates` por `occupancy`.
   *
   * `fromPrice` viene SIN impuestos (idéntico criterio que `getRates`, que los devuelve aparte
   * en `taxBreakdown`); mostrar acá el precio con ITBIS haría que "suba" al pasar al selector
   * de habitación.
   *
   * El rango [from, to] es inclusivo y el backend rechaza con 400 todo lo que supere
   * `MAX_CALENDAR_DAYS` (90). Se clampea `to` acá adentro a propósito: un 400 dejaría el
   * calendario de la landing sin precios por un error de cálculo del caller, y el caller pide
   * de a un mes — recortar es siempre lo correcto.
   */
  getCalendar(slug: string, query: PublicCalendarQuery): Promise<PublicCalendarResponse> {
    const path = `/public/hotels/${encodeURIComponent(slug)}/calendar${build({
      from: query.from,
      to: clampSpan(query.from, query.to, MAX_CALENDAR_DAYS),
      guests: query.guests,
      currency: query.currency,
    })}`
    return http.get<PublicCalendarResponse>(path)
  },

  /**
   * Upsells activos del hotel (F2 2.6). Públicos, sin auth. Orden: `sortOrder` ASC.
   * Filtrado opcional por `kind` ('per_room' | 'per_person' | 'per_stay').
   */
  getUpsells(slug: string, kind?: string): Promise<Upsell[]> {
    const path = `/public/hotels/${encodeURIComponent(slug)}/upsells${build({ kind })}`
    return http.get<Upsell[]>(path)
  },

  /** Regímenes de alimentación activos del hotel (tasks.md 2.2/2.4). Solo los `active` — "Solo
   *  alojamiento" NO viene, es la base implícita que arma el widget. */
  getMealPlans(slug: string): Promise<PublicMealPlan[]> {
    return http.get<PublicMealPlan[]>(`/public/hotels/${encodeURIComponent(slug)}/meal-plans`)
  },

  /**
   * Valida un promo code público (F2 2.2). NO incrementa `uses` — solo calcula descuento.
   * El incremento ocurre en el POST /public/booking atómicamente al crear la reserva.
   *
   * `subtotal` debe ser el subtotal pre-descuento sobre el que se aplica el % o el monto
   * fijo. El widget lo calcula como `room.fromPrice + upsellsTotal` (antes de impuestos).
   */
  validatePromo(slug: string, code: string, subtotal: number): Promise<PromoValidationResult> {
    return http.post<PromoValidationResult>(
      `/public/hotels/${encodeURIComponent(slug)}/promo/validate`,
      { code, subtotal },
    )
  },
}
