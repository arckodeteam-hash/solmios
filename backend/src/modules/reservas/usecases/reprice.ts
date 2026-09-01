// reservas/usecases/reprice.ts — Repreciar una estadía a la tarifa VIGENTE del destino.
//
// Lo usa el reagendado del planning (`reschedule.ts`, modo `pricingMode: 'reprice'`): cuando la
// reserva se mueve a otra habitación o a otras fechas, el total no se puede calcular como
// "noches agregadas × basePrice" (lo que hace el modo `keep`), porque eso da 0 si el movimiento
// no cambia la cantidad de noches — aunque la habitación destino valga el doble — y además
// ignora las temporadas por completo.
//
// La cadena de precio es la MISMA que la del motor de reservas público (`bookingengine`):
//   season_assignments (fecha → temporada) → room_rates (roomType, occupancy, season, channel)
//     → fallback `rooms.basePrice`
// y vive en `shared/utils/rate-resolution.ts` justamente para no duplicarla acá. Si el panel
// repreciara con otra fórmula, mover una reserva daría un total distinto al que el mismo hotel
// publica en su propia web para esas fechas.
//
// ⚠️ DEGRADACIÓN EXPLÍCITA (no silenciosa): los repos `seasonAssignmentRepo`/`roomRateRepo` son
// OPCIONALES. Si no están cableados (o su lectura falla), el reprice cae a
// `rooms.basePrice × noches` y lo INFORMA en `fromRates: false`, que `reschedule.ts` propaga al
// quote como `repricedFromRates`. El frontend puede entonces avisar "tarifa base, sin temporadas"
// en vez de presentar un total repreciado que en realidad no consultó ninguna tarifa.

import { eachDayExclusive } from '../../../shared/utils/daily-availability'
import { baseRatesOnly, buildSeasonByDate, sumStayPrice } from '../../../shared/utils/rate-resolution'

export interface RepriceRepos {
  /** Repo de `SeasonAssignments` (modelo compartido). Opcional — ver degradación en la cabecera. */
  seasonAssignmentRepo?: any
  /** Repo de `RoomRates` (modelo compartido). Opcional — ver degradación en la cabecera. */
  roomRateRepo?: any
  /** Repo de `RateOverrides` — tarifa por FECHA, pisa a la temporada. Opcional (misma degradación). */
  rateOverrideRepo?: any
  /** Catálogo `Seasons` — su rango también asigna temporada. Opcional (misma degradación). */
  seasonsRepo?: any
}

export interface RepriceParams {
  hotelId: string
  /** `rooms.type` de la habitación DESTINO ('standard', 'double', …). */
  roomType: string
  checkIn: string
  checkOut: string
  /** Ocupación para elegir la fila de `room_rates` — ver `guestsOfReservation`. */
  guests: number
  /** `rooms.basePrice` de la habitación DESTINO: precio por noche sin temporadas. */
  fallbackPrice: number
}

export interface RepriceResult {
  /** Total de la estadía nueva, SUMA noche a noche (no `precio × noches`). */
  total: number
  /** `true` si el total salió de `room_rates`/temporadas; `false` si degradó a `basePrice`. */
  fromRates: boolean
}

/**
 * Total de la estadía nueva a tarifa vigente. Noche a noche, con la temporada de cada fecha.
 * NO escribe nada ni cobra: solo calcula (el que decide qué hacer con la diferencia es el caller).
 */
export async function repriceStay(repos: RepriceRepos, params: RepriceParams): Promise<RepriceResult> {
  const nightDates = eachDayExclusive(params.checkIn, params.checkOut)
  const fallbackTotal = round2(params.fallbackPrice * nightDates.length)
  if (!repos.seasonAssignmentRepo || !repos.roomRateRepo) return { total: fallbackTotal, fromRates: false }

  try {
    const [assignments, rates, overrides, seasons] = await Promise.all([
      repos.seasonAssignmentRepo.findMany({ hotelId: params.hotelId }),
      repos.roomRateRepo.findMany({ hotelId: params.hotelId }),
      repos.rateOverrideRepo ? repos.rateOverrideRepo.findMany({ hotelId: params.hotelId }) : Promise.resolve([]),
      repos.seasonsRepo ? repos.seasonsRepo.findMany({ hotelId: params.hotelId }) : Promise.resolve([]),
    ])
    const seasonByDate = buildSeasonByDate((assignments ?? []) as any[], (seasons ?? []) as any[], nightDates)
    const baseRates = baseRatesOnly((rates ?? []) as any[])
    const total = sumStayPrice(nightDates, baseRates, params.roomType, seasonByDate, params.guests, params.fallbackPrice, (overrides ?? []) as any[])
    return { total, fromRates: true }
  } catch {
    // Leer tarifas no puede tumbar un reagendado: se degrada al fallback y se avisa con fromRates.
    return { total: fallbackTotal, fromRates: false }
  }
}

/**
 * Ocupación de la reserva para elegir la fila de `room_rates`. Mismo criterio que el motor
 * público (`bookingengine`): cuenta ADULTOS, no adultos+niños — `room_rates.occupancy` es la
 * ocupación tarifada y los niños suelen no pagar tarifa de adulto. `guests` está soportado por
 * si el caller trae reservas de otra fuente (OTA) que lo usen en vez de `adults`.
 */
export function guestsOfReservation(reservation: any): number {
  const adults = Number(reservation?.adults)
  if (Number.isFinite(adults) && adults > 0) return adults
  const guests = Number(reservation?.guests)
  if (Number.isFinite(guests) && guests > 0) return guests
  return DEFAULT_OCCUPANCY
}

/** Mismo default que `reservations.adults` (model.ts) y que `availability.check` del motor. */
const DEFAULT_OCCUPANCY = 2

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
