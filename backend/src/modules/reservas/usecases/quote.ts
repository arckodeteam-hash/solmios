// reservas/usecases/quote.ts — Cotización de estadía para el PANEL (wizard de reservas).
//
// El wizard cotizaba `rooms.basePrice × noches` en el frontend (ReservationWizardModal), sin
// pasar por temporadas: una reserva manual para fechas de temporada alta se creaba al precio
// base aunque la grilla `room_rates` tuviera otro precio. Este usecase expone al panel la
// MISMA cadena de precio que el motor público y el reprice del reagendado:
//   season_assignments (fecha → temporada) → room_rates (roomType × occupancy × season, BASE)
//     → fallback `rooms.basePrice`
// La lógica pura vive en `shared/utils/rate-resolution.ts` (única fuente de verdad); acá solo
// se orquestan los repos y se arma el desglose NOCHE A NOCHE con la temporada de cada fecha
// (label + color incluidos, desde el catálogo `Seasons` — modelo compartido, no un import del
// módulo pricing) para que el operador vea exactamente qué tarifa aplica a cada noche.
//
// ⚠️ `closed`: `pickRate` NO filtra filas cerradas (mismo criterio que el motor público al
// cotizar) — una fila `closed=1` igual cotiza su precio. Se informa `closedNights` para que la
// UI pueda advertir "N noche(s) con tarifa cerrada", pero NO se bloquea la cotización: cerrar
// una tarifa es una decisión de venta del canal, no del panel interno.

import { ConflictError, NotFoundError } from 'arckode-framework'
import { eachDayExclusive } from '../../../shared/utils/daily-availability'
import { baseRatesOnly, buildSeasonByDate, pickRate, ratePrice } from '../../../shared/utils/rate-resolution'
import { round2 } from '../../../shared/utils/money'

export interface QuoteRepos {
  roomRepo: any
  /** Repo de `SeasonAssignments` (modelo compartido). Opcional — sin él cada noche va al fallback. */
  seasonAssignmentRepo?: any
  /** Repo de `RoomRates` (modelo compartido). Opcional — sin él cada noche va al fallback. */
  roomRateRepo?: any
  /** Repo de `Seasons` (catálogo, modelo compartido). Opcional — sin él no hay label/color. */
  seasonsRepo?: any
}

export interface QuoteParams {
  hotelId: string
  roomId: string
  checkIn: string
  checkOut: string
  /** Ocupación tarifada (adultos). Mismo default que `guestsOfReservation` (reprice.ts). */
  guests: number
}

export interface QuoteNight {
  date: string
  /** Nombre de la temporada asignada a la fecha (null = sin temporada → precio base). */
  season: string | null
  seasonLabel: string | null
  seasonColor: string | null
  price: number
  /** `true` si el precio salió de la grilla `room_rates` (no del fallback basePrice). */
  fromRate: boolean
}

export interface StayQuote {
  roomId: string
  roomType: string
  /** Precio por noche sin temporadas (`rooms.basePrice`) — lo que cotizaba el wizard antes. */
  basePrice: number
  nights: QuoteNight[]
  nightsCount: number
  /** Suma noche a noche (no `precio × noches`). */
  subtotal: number
  /** Promedio redondeado, solo para mostrar "N noches × $X" cuando todas valen lo mismo. */
  pricePerNight: number | null
  /** `true` si AL MENOS una noche salió de la grilla. `false` = todo a precio base. */
  fromRates: boolean
  /** Noches cuya fila elegida está `closed=1` en la grilla (aviso, no bloqueo). */
  closedNights: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Cotiza la estadía de UNA habitación. No escribe nada: es el quote que el wizard muestra y
 * el que `createReservation` recalcula server-side cuando el alta viene con `priceFrom:'rates'`.
 */
export async function quoteStay(repos: QuoteRepos, params: QuoteParams): Promise<StayQuote> {
  const { hotelId, roomId, checkIn, checkOut } = params
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) throw new ConflictError('Fechas inválidas (YYYY-MM-DD)')
  if (checkIn >= checkOut) throw new ConflictError('checkIn debe ser anterior a checkOut')

  const room = await repos.roomRepo.findOne({ id: roomId })
  if (!room) throw new NotFoundError('Habitación no encontrada')
  if (room.hotelId !== hotelId) throw new ConflictError('La habitación no pertenece a este hotel')

  const roomType = String(room.type ?? '')
  const fallbackPrice = Number(room.basePrice) || 0
  const nightDates = eachDayExclusive(checkIn, checkOut)
  const guests = Number.isFinite(params.guests) && params.guests > 0 ? Math.floor(params.guests) : 2

  // Sin repos de tarifas (o si la lectura falla) cada noche cae al fallback — misma degradación
  // explícita que reprice.ts: `fromRates:false` le avisa a la UI que no se consultó ninguna grilla.
  let assignments: any[] = []
  let rates: any[] = []
  if (repos.seasonAssignmentRepo && repos.roomRateRepo) {
    try {
      ;[assignments, rates] = await Promise.all([
        repos.seasonAssignmentRepo.findMany({ hotelId }) as Promise<any[]>,
        repos.roomRateRepo.findMany({ hotelId }) as Promise<any[]>,
      ])
    } catch {
      assignments = []
      rates = []
    }
  }
  const seasonByDate = buildSeasonByDate(assignments)
  const baseRates = baseRatesOnly(rates)

  let seasonMeta = new Map<string, { label: string | null; color: string | null }>()
  if (repos.seasonsRepo) {
    try {
      const seasons = (await repos.seasonsRepo.findMany({ hotelId })) as any[]
      seasonMeta = new Map(seasons.map((s: any) => [String(s.name), {
        label: s.label ? String(s.label) : null,
        color: s.color ? String(s.color) : null,
      }]))
    } catch { /* sin metadatos: badges sin label/color, el nombre siempre está */ }
  }

  const nights: QuoteNight[] = []
  let subtotal = 0
  let closedNights = 0
  for (const date of nightDates) {
    const season = seasonByDate.get(date) ?? null
    const rate = season ? pickRate(baseRates, roomType, season, guests) : null
    const fromRate = !!(rate && ratePrice(rate) > 0)
    const price = fromRate ? ratePrice(rate) : fallbackPrice
    if (fromRate && Number(rate.closed) === 1) closedNights++
    const meta = season ? seasonMeta.get(season) : undefined
    nights.push({
      date, season,
      seasonLabel: season ? (meta?.label ?? season) : null,
      seasonColor: meta?.color ?? null,
      price: round2(price),
      fromRate,
    })
    subtotal += price
  }

  const uniqPrices = new Set(nights.map((n) => n.price))
  return {
    roomId, roomType, basePrice: fallbackPrice,
    nights,
    nightsCount: nights.length,
    subtotal: round2(subtotal),
    // Un solo precio distinto en toda la estadía → promedio exacto para el "N noches × $X".
    pricePerNight: uniqPrices.size === 1 && nights.length > 0 ? nights[0].price : null,
    fromRates: nights.some((n) => n.fromRate),
    closedNights,
  }
}
