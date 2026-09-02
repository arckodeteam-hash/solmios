// canales/usecases/push-overrides.ts — Push DELTA de tarifas por rango de fechas a Channex.
//
// Es la mitad "delta" del push de ARI: `push-rates.ts` publica el mapa completo de temporadas
// (arranque y recuperación), esto publica SOLO las celdas que el usuario acaba de tocar en la
// grilla de tarifas por fecha. Es lo que pide el test 13 de la certificación PMS ("send only
// changed data") y lo que hace que los tests 2 a 8 salgan en UNA sola llamada por guardado.
//
// Decisión de diseño: el precio del override es el precio FINAL de ese rate plan, sin el markup
// del plan. Un override sobre `bb` publica su número tal cual, no `bar × 1.2`. Sin esto el test 3
// es imposible: pide Double BAR 444 y Double B&B 456.23 el mismo día, que no son proporcionales.
// El markup sigue vivo donde tiene sentido — en la tarifa por temporada, que es una regla, no un
// precio puntual.

import { matchRatePlan, type RatePlanDef } from './rate-plans'
import type { CanalesDTO } from '../types'
import { lookupRoomTypeId, type AriTargets } from './channex-mapping'

/** Una celda de la grilla lista para publicar. `cleared` = dimensiones que se APAGARON al guardar. */
export interface OverridePushItem {
  roomType: string
  ratePlan: string
  dateFrom: string
  dateTo: string
  rate?: number
  minStay?: number
  maxStay?: number
  stopSell?: number
  closedToArrival?: number
  closedToDeparture?: number
  minStayThrough?: number
  cleared?: readonly string[]
}

/** Motivos por los que una celda no se pudo publicar. Se devuelven para que la UI los muestre. */
export interface OverridePushSkips {
  roomTypesWithoutRatePlan: string[]
  ratePlansUnknown: string[]
  expiredRanges: number
}

/** Channex expresa "sin mínimo de estadía" con 1, no con 0. Apagar un minStay es volver a 1. */
const NO_MIN_STAY = 1
/** "Sin máximo" sí es 0 en Channex (0 = ilimitado). */
const NO_MAX_STAY = 0

/**
 * Traduce las celdas guardadas a entries de `POST /restrictions`.
 *
 * Reglas:
 *  - nunca fechas pasadas (Channex las rechaza): el rango se recorta desde `today` y si terminó, se descarta;
 *  - solo se mandan las dimensiones que el override fija (update parcial de Channex), MÁS las que
 *    se acaban de apagar — omitir una dimensión apagada dejaría el cierre/mínimo viejo vivo en la OTA;
 *  - un room type sin counterpart en Channex, o un código de plan que el hotel no tiene, se saltea
 *    con motivo en vez de romper el push del resto.
 */
export function buildOverrideValues(
  items: OverridePushItem[],
  propertyId: string,
  targets: AriTargets,
  ratePlans: RatePlanDef[],
  today: string,
): { values: any[]; skips: OverridePushSkips } {
  const values: any[] = []
  const roomTypesWithoutRatePlan = new Set<string>()
  const ratePlansUnknown = new Set<string>()
  let expiredRanges = 0
  const planByCode = new Map(ratePlans.map((p) => [p.code.toLowerCase(), p]))

  for (const item of items || []) {
    const plan = planByCode.get(String(item.ratePlan).toLowerCase())
    if (!plan) { ratePlansUnknown.add(String(item.ratePlan)); continue }

    const rtId = lookupRoomTypeId(targets.rtIdByTitle, String(item.roomType))
    const rtRps = rtId ? targets.rpsByRt.get(rtId) : undefined
    const rpId = rtRps?.length ? matchRatePlan(rtRps, plan) : undefined
    if (!rpId) { roomTypesWithoutRatePlan.add(String(item.roomType)); continue }

    const from = item.dateFrom < today ? today : item.dateFrom
    if (item.dateTo < from) { expiredRanges++; continue }

    const cleared = new Set(item.cleared || [])
    const entry: any = { property_id: propertyId, rate_plan_id: rpId, date_from: from, date_to: item.dateTo }

    // Precio: en centavos, tal cual lo cargó el usuario para ESE plan (ver cabecera).
    if (Number(item.rate) > 0) entry.rate = Math.round(Number(item.rate) * 100)

    if (Number(item.minStay) > 0) entry.min_stay_arrival = Number(item.minStay)
    else if (cleared.has('minStay')) entry.min_stay_arrival = NO_MIN_STAY

    if (Number(item.maxStay) > 0) entry.max_stay = Number(item.maxStay)
    else if (cleared.has('maxStay')) entry.max_stay = NO_MAX_STAY

    if (Number(item.minStayThrough) > 0) entry.min_stay_through = Number(item.minStayThrough)
    else if (cleared.has('minStayThrough')) entry.min_stay_through = NO_MIN_STAY

    if (Number(item.stopSell) > 0) entry.stop_sell = true
    else if (cleared.has('stopSell')) entry.stop_sell = false

    if (Number(item.closedToArrival) > 0) entry.closed_to_arrival = true
    else if (cleared.has('closedToArrival')) entry.closed_to_arrival = false

    if (Number(item.closedToDeparture) > 0) entry.closed_to_departure = true
    else if (cleared.has('closedToDeparture')) entry.closed_to_departure = false

    values.push(entry)
  }

  return {
    values,
    skips: {
      roomTypesWithoutRatePlan: [...roomTypesWithoutRatePlan],
      ratePlansUnknown: [...ratePlansUnknown],
      expiredRanges,
    },
  }
}

/** Resultado del push delta: cuántos entries y en cuántas llamadas (siempre 0 o 1). */
export interface OverridePushResult {
  pushed: number
  calls: number
  skips: OverridePushSkips
  /** Ids de las tareas que encoló Channex — el rastro del push (ver `ari-tasks.ts`). */
  taskIds?: string[]
}

/** Dependencias que el service inyecta: nada de DB ni de HTTP directo acá. */
export interface OverridePushDeps {
  getConfig: (hotelId: string) => Promise<CanalesDTO | undefined>
  getRatePlans: (hotelId: string) => Promise<RatePlanDef[]>
  push: (cfg: CanalesDTO | undefined, items: OverridePushItem[], ratePlans: RatePlanDef[]) => Promise<OverridePushResult>
}

/** Resuelve config + planes del hotel y delega el push. Molde de `pushSeasonalRatesToChannex`. */
export async function pushRateOverridesFor(
  deps: OverridePushDeps, hotelId: string, items: OverridePushItem[],
): Promise<OverridePushResult> {
  const [cfg, ratePlans] = await Promise.all([deps.getConfig(hotelId), deps.getRatePlans(hotelId)])
  return deps.push(cfg, items, ratePlans)
}
