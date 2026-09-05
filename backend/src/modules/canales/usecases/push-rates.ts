import type { CanalesDTO, PushRatesResultDTO, DateRange } from '../types'
import { readRatePlans, type RatePlanDef } from './rate-plans'
import type { OverridePushItem } from './push-overrides'
import { indexBasePrices, basePriceFor } from '../../../shared/utils/base-price'
// `pricing` no se importa desde acá (CLAUDE #3): la regla de las dos capas vive en shared.
import { indexSeasonPrices, seasonPriceFor, channelPriceFor } from '../../../shared/utils/season-price'

/** Restricciones por (roomType, season) — la capa de closures/through que edita PUT /api/rate-restrictions. */
export interface SeasonRestriction {
  roomType: string
  season: string
  cta?: number
  ctd?: number
  closedToArrival?: number
  closedToDeparture?: number
  minStayThrough?: number
}

/** Una fila de tarifa a empujar. `occupancy` importa solo en per_person. */
export interface PushRate {
  roomType: string
  season: string
  occupancy: number
  /** Precio del TIPO (`rooms.basePrice`). Es lo que cubre el horizonte SIN temporada. */
  basePrice: number
  percentage: number
  /**
   * Lo que se publica para esa temporada: el importe de la grilla global, con el porcentaje del
   * canal encima si lo hay. Se manda ya resuelto porque desde que la grilla se edita en pesos,
   * `basePrice × (1 + percentage/100)` dejó de dar el precio real (ver
   * `shared/utils/season-price.ts`): la temporada vale lo que el hotel escribió, no lo que
   * salga de un porcentaje sobre el precio del tipo.
   */
  price: number
  closed?: number
  minStay?: number
  maxStay?: number
}

interface PushRatesDeps {
  getConfig: (hotelId: string) => Promise<CanalesDTO | undefined>
  findMany: (model: string, query: any) => Promise<any[]>
  pushSeasonalRates: (
    cfg: CanalesDTO | undefined,
    rates: PushRate[],
    seasons: Array<{ name: string; label?: string; startDate?: string; endDate?: string }>,
    assignedRanges: Map<string, DateRange[]>,
    ratePlans: RatePlanDef[],
    restrictions: SeasonRestriction[],
    overrides: OverridePushItem[],
  ) => Promise<PushRatesResultDTO>
}

const MS_PER_DAY = 86_400_000

/** Día siguiente a una fecha YYYY-MM-DD (UTC). Para detectar contigüidad sin líos de timezone. */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + MS_PER_DAY).toISOString().slice(0, 10)
}

/**
 * Agrupa las asignaciones día-a-día de `season_assignments` en rangos contiguos por temporada.
 *
 * Por qué existe: una temporada como 'especial' (Semana Santa, Navidad) NO tiene un rango obvio y el
 * usuario la carga pintando días en el planning, no llenando un formulario de fechas. Channex, en
 * cambio, sólo publica por rango (`date_from`/`date_to`), así que los días pintados SON el rango.
 * Sin esto, una temporada sin fechas era impublicable aunque el hotel la tuviera asignada.
 */
export function groupAssignmentsIntoRanges(
  assignments: Array<{ date: string; season: string }>,
): Map<string, DateRange[]> {
  const bySeason = new Map<string, string[]>()
  for (const a of assignments) {
    if (!a?.date || !a?.season) continue
    const list = bySeason.get(a.season)
    if (list) list.push(a.date)
    else bySeason.set(a.season, [a.date])
  }
  const out = new Map<string, DateRange[]>()
  for (const [season, dates] of bySeason) {
    // Dedup + orden lexicográfico (YYYY-MM-DD ordena bien como string).
    const sorted = [...new Set(dates)].sort()
    const ranges: DateRange[] = []
    let start = sorted[0]!
    let prev = start
    for (const d of sorted.slice(1)) {
      if (d === nextDay(prev)) { prev = d; continue }   // sigue el tramo
      ranges.push({ startDate: start, endDate: prev })  // corte: se cierra el tramo
      start = d
      prev = d
    }
    ranges.push({ startDate: start, endDate: prev })
    out.set(season, ranges)
  }
  return out
}

/**
 * Lee las tarifas del hotel y las empuja a Channex por temporada. Elige UNA tarifa por (roomType, season):
 * prefiere el override del canal pedido sobre la base, y dentro del mismo origen la de mayor ocupación
 * (la primaria). El push va a los rate plans de la propiedad (Channex los distribuye a los canales).
 */
export async function pushSeasonalRatesToChannex(
  deps: PushRatesDeps,
  hotelId: string,
  channel?: string,
): Promise<PushRatesResultDTO> {
  const [cfg, allRates, seasons, assignments, ratePlans, restrictions, overrides, rooms] = await Promise.all([
    deps.getConfig(hotelId),
    deps.findMany('RoomRates', { hotelId }),
    deps.findMany('Seasons', { hotelId }),
    // Temporada pintada día-a-día en el planning: da el rango de las temporadas sin fechas propias.
    deps.findMany('SeasonAssignments', { hotelId }),
    // Planes del hotel (BAR + B&B por defecto, configuration key='rate_plans') — P5.
    readRatePlans(deps.findMany, hotelId),
    // Closures/through por (roomType, season) — tabla rate_restrictions — P4.
    deps.findMany('RateRestrictions', { hotelId }),
    // Tarifas por FECHA: viajan en el MISMO payload, al final, para que no las pise el
    // consolidado. Ver la nota de `overrides` en `channex.pushSeasonalRates`.
    deps.findMany('RateOverrides', { hotelId }),
    // El precio base es de la HABITACIÓN, uno solo por tipo — no el que la fila de tarifas tenga
    // grabado (ver `pricing/usecases/base-price.ts`). Sin esto, el panel deriva del precio nuevo y
    // la OTA sigue publicando el viejo: la misma discrepancia que el fix vino a cerrar, movida un
    // paso más adelante. Pasa igual cuando el precio se cambia desde `/panel/habitaciones`, que no
    // reescribe `room_rates`.
    deps.findMany('Rooms', { hotelId }),
  ])
  const assignedRanges = groupAssignmentsIntoRanges(assignments as Array<{ date: string; season: string }>)
  const bases = indexBasePrices((rooms as Array<{ type?: string; basePrice?: number }>)
    .map((r) => ({ type: String(r.type || 'standard'), basePrice: Number(r.basePrice) || 0 })))
  const wanted = channel || ''

  // Primero elegir, por room type + temporada + OCUPACIÓN, la mejor fila (override del canal pedido
  // por sobre la base). Hay una fila por cada ocupación 1..capacidad del tipo.
  const byOcc = new Map<string, any>()
  for (const r of allRates) {
    if (r.channel !== wanted && r.channel) continue // solo el canal pedido + la base
    const k = `${r.roomType}|${r.season}|${r.occupancy}`
    const cur = byOcc.get(k)
    const better = !cur || (r.channel === wanted && cur.channel !== wanted)
    if (better) byOcc.set(k, r)
  }

  // OBP: se empujan TODAS las ocupaciones. Antes, en el modo por habitación, se descartaban las
  // menores y la OTA solo veía el precio de la ocupación máxima — el precio por persona se podía
  // cargar en el panel y nunca llegaba al canal (#404). Ese modo ya no existe.
  const selected: any[] = [...byOcc.values()]

  // Precio de cada temporada en la grilla GLOBAL: es sobre ese importe que el canal aplica su %.
  const seasonPrices = indexSeasonPrices(allRates)

  const rates: PushRate[] = selected.map((r) => {
    const basePrice = basePriceFor(bases, r.roomType, r.basePrice)
    const seasonPrice = seasonPriceFor(seasonPrices, r.roomType, r.occupancy, r.season, basePrice)
    // La fila elegida es la del canal (con su %) o la global (que ya trae el importe).
    const price = r.channel
      ? channelPriceFor(seasonPrice, r.percentage)
      : (Number(r.price) || seasonPrice)
    return {
      roomType: r.roomType, season: r.season, occupancy: Number(r.occupancy) || 0,
      basePrice, price,
      percentage: r.percentage, closed: r.closed, minStay: r.minStay, maxStay: r.maxStay,
    }
  })
  return deps.pushSeasonalRates(cfg, rates, seasons, assignedRanges, ratePlans, restrictions as SeasonRestriction[], overrides as OverridePushItem[])
}
