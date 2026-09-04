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
import { composeFromPersistedReservation, type ChildPolicy } from '../../../shared/usecases/child-composition'

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
 * Ocupación de la reserva para elegir la fila de `room_rates` (Requerimiento 7, 2026-09-03:
 * MISMA fórmula que el motor público — `adults` + niños que consumen plaza, nunca la cuenta
 * plana de `children`, que mezcla libres y con plaza).
 *
 * FIX (auditoría Requerimiento 7): antes esta función devolvía SOLO `reservation.adults`, sin
 * tocar `childrenAges` — `reservation.adults` ya viene post-reclasificación (`effectiveAdults`
 * de la reserva original: un niño mayor a `maxChildAge` YA está adentro), así que el único dato
 * que faltaba era `payingChildren`. Reagendar/repreciar una reserva con niños con plaza cotizaba
 * la estadía nueva a una ocupación MENOR de la que el motor público usó para crear la reserva —
 * silenciosamente por debajo de precio.
 *
 * `childPolicy` se resuelve FRESCO contra la Configuration actual del hotel (mismo criterio que
 * el resto del sistema — nunca se congela una política al momento de la reserva). Se calcula
 * `payingChildren` corriendo `childrenAges` solo (adults=1 descartable, no se usa `effectiveAdults`
 * de este llamado: sumarlo de nuevo duplicaría a un niño ya reclasificado como adulto en
 * `reservation.adults`). Sin `childPolicy` (reserva sin `childrenAges`, o caller que no la resolvió)
 * cae exactamente al comportamiento de siempre: solo adultos.
 *
 * La reconstrucción segura (sin duplicar a un reclasificado) vive en
 * `composeFromPersistedReservation` (`shared/usecases/child-composition.ts`), compartida con la
 * revalidación de capacidad del reagendado (Requerimiento 12).
 *
 * `targetCheckIn` (Requerimiento 12 — edad de referencia, 2026-09-03): cuando se pasa junto con
 * `childrenAgesAsOf` en la reserva, las edades se proyectan al check-in NUEVO antes de clasificar
 * — un niño puede cruzar `maxFreeAge`/`maxChildAge` por el paso del tiempo, no solo por un cambio
 * de política. Sin `targetCheckIn` (o sin `childrenAgesAsOf` persistido) se cotiza con la edad
 * declarada tal cual, igual que antes de este requerimiento.
 */
export function guestsOfReservation(reservation: any, childPolicy?: ChildPolicy | null, targetCheckIn?: string | null): number {
  const adults = Number(reservation?.adults)
  const baseAdults = Number.isFinite(adults) && adults > 0
    ? adults
    : (Number.isFinite(Number(reservation?.guests)) && Number(reservation?.guests) > 0 ? Number(reservation.guests) : DEFAULT_OCCUPANCY)
  if (!childPolicy) return baseAdults
  return composeFromPersistedReservation(
    { adults: baseAdults, children: reservation?.children, childrenAges: reservation?.childrenAges, childrenAgesAsOf: reservation?.childrenAgesAsOf },
    childPolicy,
    targetCheckIn,
  ).chargeableOccupancy
}

/** Mismo default que `reservations.adults` (model.ts) y que `availability.check` del motor. */
const DEFAULT_OCCUPANCY = 2

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
