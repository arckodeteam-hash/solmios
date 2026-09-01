import type { CanalesDTO, PushRatesResultDTO, DateRange } from '../types'
import { readRatePlans, type RatePlanDef } from './rate-plans'

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

/** Modo de tarificación del hotel: precio por habitación o por persona (ocupación). */
export type PricingMode = 'per_room' | 'per_person'

/** Una fila de tarifa a empujar. `occupancy` importa solo en per_person. */
export interface PushRate {
  roomType: string
  season: string
  occupancy: number
  basePrice: number
  percentage: number
  closed?: number
  minStay?: number
  maxStay?: number
}

interface PushRatesDeps {
  getConfig: (hotelId: string) => Promise<CanalesDTO | undefined>
  findMany: (model: string, query: any) => Promise<any[]>
  /** Modo del hotel. per_person → se empujan todas las ocupaciones; per_room → una por room type. */
  getPricingMode: (hotelId: string) => Promise<PricingMode>
  pushSeasonalRates: (
    cfg: CanalesDTO | undefined,
    rates: PushRate[],
    seasons: Array<{ name: string; label?: string; startDate?: string; endDate?: string }>,
    assignedRanges: Map<string, DateRange[]>,
    pricingMode: PricingMode,
    ratePlans: RatePlanDef[],
    restrictions: SeasonRestriction[],
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
 * (la primaria/per_room). El push va a los rate plans de la propiedad (Channex los distribuye a los canales).
 */
export async function pushSeasonalRatesToChannex(
  deps: PushRatesDeps,
  hotelId: string,
  channel?: string,
): Promise<PushRatesResultDTO> {
  const [cfg, allRates, seasons, assignments, pricingMode, ratePlans, restrictions] = await Promise.all([
    deps.getConfig(hotelId),
    deps.findMany('RoomRates', { hotelId }),
    deps.findMany('Seasons', { hotelId }),
    // Temporada pintada día-a-día en el planning: da el rango de las temporadas sin fechas propias.
    deps.findMany('SeasonAssignments', { hotelId }),
    deps.getPricingMode(hotelId),
    // Planes del hotel (BAR + B&B por defecto, configuration key='rate_plans') — P5.
    readRatePlans(deps.findMany, hotelId),
    // Closures/through por (roomType, season) — tabla rate_restrictions — P4.
    deps.findMany('RateRestrictions', { hotelId }),
  ])
  const assignedRanges = groupAssignmentsIntoRanges(assignments as Array<{ date: string; season: string }>)
  const wanted = channel || ''

  // Primero elegir, por room type + temporada + OCUPACIÓN, la mejor fila (override del canal pedido
  // por sobre la base). En per_room hay una ocupación por room type; en per_person hay varias.
  const byOcc = new Map<string, any>()
  for (const r of allRates) {
    if (r.channel !== wanted && r.channel) continue // solo el canal pedido + la base
    const k = `${r.roomType}|${r.season}|${r.occupancy}`
    const cur = byOcc.get(k)
    const better = !cur || (r.channel === wanted && cur.channel !== wanted)
    if (better) byOcc.set(k, r)
  }

  let selected: any[]
  if (pricingMode === 'per_person') {
    // OBP: se empujan TODAS las ocupaciones. Antes se descartaban las menores y la OTA solo veía
    // el precio de la ocupación máxima → el precio por persona nunca llegaba al canal (#404).
    selected = [...byOcc.values()]
  } else {
    // per_room: un precio por room type/temporada. Se queda la de mayor ocupación (la "llena").
    const byRoom = new Map<string, any>()
    for (const r of byOcc.values()) {
      const k = `${r.roomType}|${r.season}`
      const cur = byRoom.get(k)
      if (!cur || Number(r.occupancy) > Number(cur.occupancy)) byRoom.set(k, r)
    }
    selected = [...byRoom.values()]
  }

  const rates: PushRate[] = selected.map((r) => ({
    roomType: r.roomType, season: r.season, occupancy: Number(r.occupancy) || 0,
    basePrice: r.basePrice, percentage: r.percentage, closed: r.closed, minStay: r.minStay, maxStay: r.maxStay,
  }))
  return deps.pushSeasonalRates(cfg, rates, seasons, assignedRanges, pricingMode, ratePlans, restrictions as SeasonRestriction[])
}
