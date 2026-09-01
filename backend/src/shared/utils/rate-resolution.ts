// shared/utils/rate-resolution.ts — Resolución de PRECIO POR NOCHE (lógica PURA, sin DB ni HTTP).
//
// Por qué vive en `shared` y no en un módulo: la misma cadena de precio la necesitan DOS módulos
// que no se pueden importar entre sí:
//   - `bookingengine` (motor directo): `public-calendar.ts` (precio de CADA noche), `public-rates.ts`
//     (total de la estadía) y `stay-restrictions.ts` (minStay/maxStay/closed).
//   - `reservas` (planning del panel): `usecases/reprice.ts` — repricear una reserva que se mueve
//     de habitación o de fechas a la tarifa vigente del destino.
// Son funciones puras sin estado, así que no ameritan un connector: `shared/utils/` es el lugar
// canónico (mismo precedente que `daily-availability.ts`, `safe-parse.ts`, `push-availability.ts`).
//
// Origen: nació en `bookingengine/usecases/public-calendar.ts`, se extrajo a
// `bookingengine/usecases/rate-resolution.ts` y se movió acá cuando `reservas` la necesitó.
// Ese archivo ahora re-exporta desde este, para no tocar a sus callers ni a sus tests.
//
// ─── La cadena de precio ────────────────────────────────────────────────────────────────────
//   season_assignments {hotelId, date, season}
//     → room_rates {roomType, occupancy, season, channel, basePrice, percentage, price, closed,
//                   minStay, maxStay}
//     → si no hay temporada asignada a esa fecha, o la temporada no tiene fila para ese tipo:
//       FALLBACK a `rooms.basePrice` (lo decide el caller, ver `resolveNightlyPrice`).
//
// Reglas (heredadas del push a Channex, `canales/usecases/push-rates.ts`, sin acoplarse a él):
//   - Solo tarifas BASE (`channel` vacío). El motor directo no vende por un canal OTA: un
//     override de 'airbnb'/'booking' no se filtra al precio público.
//   - Ocupación: exacta = `guests` si existe; si no, la menor que cubra al grupo; si no, la
//     mayor disponible. En `per_room` hay una sola fila por tipo y las tres reglas colapsan.
//   - `price` de la fila es el precio efectivo (`pricing/service.ts` lo persiste como
//     `basePrice × (1 + percentage/100)`). Si viniera en 0 se recompone de base+percentage.

import { round2 } from './money'

/** Una temporada del catálogo con su rango propio (`seasons.startDate` / `endDate`). */
export interface SeasonRange {
  name: string
  startDate?: string | null
  endDate?: string | null
}

/**
 * `date (YYYY-MM-DD) → season`, con las DOS formas de asignar temporada que tiene el sistema:
 *
 *  1. el **rango del catálogo** (`seasons.startDate`/`endDate`) — cubre el año de una;
 *  2. los **días pintados en el planning** (`season_assignments`) — la excepción puntual.
 *
 * Los pintados van DESPUÉS y pisan al rango: es la misma precedencia que el push usa contra
 * Channex (el catálogo sale primero en el payload y los días pintados al final, y Channex aplica
 * el último). Sin esto las dos capas divergían: cargar el rango de una temporada publicaba su
 * precio a las OTAs pero el motor propio seguía cotizando el fallback `rooms.basePrice`, porque
 * acá solo se miraban los días pintados. Un hotel con temporadas por rango vendía a un precio en
 * Booking y a otro en su propia web.
 *
 * `dates` acota el trabajo a las noches consultadas: sin ellas no se expanden los rangos (un
 * caller que solo tenga los días pintados sigue funcionando igual que antes).
 */
export function buildSeasonByDate(
  assignments: any[],
  seasons: SeasonRange[] = [],
  dates: string[] = [],
): Map<string, string> {
  const out = new Map<string, string>()
  const ranged = seasons.filter((s) => s?.name && s.startDate && s.endDate)
  for (const date of dates) {
    // El rango MÁS CORTO que contenga la fecha: si dos se solapan, gana el más específico
    // (mismo criterio que las tarifas por fecha).
    let best: SeasonRange | null = null
    for (const s of ranged) {
      if (String(s.startDate) > date || String(s.endDate!) < date) continue
      if (!best || Date.parse(s.endDate!) - Date.parse(s.startDate!) < Date.parse(best.endDate!) - Date.parse(best.startDate!)) {
        best = s
      }
    }
    if (best) out.set(date, String(best.name))
  }
  for (const a of assignments) {
    if (!a?.date || !a?.season) continue
    out.set(String(a.date).slice(0, 10), String(a.season))
  }
  return out
}

/** Tarifas BASE del hotel (sin override de canal). Ver cabecera: el motor directo no vende por OTA. */
export function baseRatesOnly(rates: any[]): any[] {
  return rates.filter((r) => !r.channel)
}

/** Filas BASE de `room_rates` de un tipo para una temporada. Case-insensitive en `roomType`. */
function ratesFor(baseRates: any[], roomType: string, season: string): any[] {
  const want = String(roomType).toLowerCase()
  return baseRates.filter((r) =>
    String(r.roomType ?? '').toLowerCase() === want && String(r.season ?? '') === season)
}

/**
 * Fila que CUBRE a `guests`: ocupación exacta, o la menor ocupación >= guests.
 * `null` si el tipo no tiene ninguna fila que alcance para ese grupo en esa temporada.
 *
 * Es la mitad "honesta" de `pickRate`: no incluye el último recurso (la fila de MAYOR ocupación
 * aunque sea menor que `guests`), que sirve para no dejar sin cotizar a un grupo grande pero NO
 * significa que el hotel haya cargado un precio para esa ocupación. La matriz de ocupaciones de
 * `/rates` usa esta función para distinguir "hay tarifa para 3 personas" de "hay tarifa para 2 y
 * la estamos estirando".
 */
export function pickCoveringRate(
  baseRates: any[],
  roomType: string,
  season: string | null,
  guests: number,
): any | null {
  if (!season) return null
  const candidates = ratesFor(baseRates, roomType, season)
  if (candidates.length === 0) return null
  const exact = candidates.find((r) => Number(r.occupancy) === guests)
  if (exact) return exact
  return candidates
    .filter((r) => Number(r.occupancy) >= guests)
    .sort((a, b) => Number(a.occupancy) - Number(b.occupancy))[0] ?? null
}

/**
 * Elige la fila de `room_rates` para (roomType, season, guests) entre las tarifas BASE.
 * `null` si no hay temporada asignada a esa fecha o el tipo no tiene tarifa cargada → el caller
 * cae a `rooms.basePrice`.
 */
export function pickRate(baseRates: any[], roomType: string, season: string | null, guests: number): any | null {
  const covering = pickCoveringRate(baseRates, roomType, season, guests)
  if (covering) return covering
  if (!season) return null
  const candidates = ratesFor(baseRates, roomType, season)
  if (candidates.length === 0) return null
  return candidates.sort((a, b) => Number(b.occupancy) - Number(a.occupancy))[0] ?? null
}

/** Temporadas que REALMENTE aplican a las noches consultadas. Una noche sin asignación no
 *  aporta ninguna: esa noche cotiza por el fallback `rooms.basePrice`, no por la grilla. */
function seasonsOfStay(nightDates: string[], seasonByDate: Map<string, string>): Set<string> {
  const out = new Set<string>()
  for (const date of nightDates) {
    const season = seasonByDate.get(date)
    if (season) out.add(season)
  }
  return out
}

/**
 * Ocupaciones (> 0) con fila BASE cargada para un tipo **en las temporadas que aplican a
 * `nightDates`**, ordenadas asc.
 *
 * ⚠️ El scope por temporada NO es un detalle: una grilla global (todas las temporadas del hotel)
 * describe un producto que estas fechas no venden. Un tipo con una única fila de la temporada
 * 'alta' consultado para fechas SIN temporada asignada cotiza por `rooms.basePrice` para
 * CUALQUIER ocupación — decir "falta la tarifa de 3" mirando esa fila es contradecir al propio
 * precio que devuelve `sumStayPrice` (y a lo que `POST /api/public/booking` acepta vender).
 *
 * Vacío significa que estas noches no tienen grilla por ocupación:
 *  - ninguna noche tiene temporada asignada, o la temporada no tiene filas para el tipo → todo
 *    va al fallback `rooms.basePrice`;
 *  - las filas existen pero sin `occupancy` (modo `per_room`: un precio por habitación,
 *    independiente de cuánta gente entre) → también todo al mismo precio.
 * En ambos casos NO se puede decir "falta la tarifa de 3 personas", porque no hay grilla por
 * ocupación contra la cual comparar.
 */
export function occupanciesForStay(
  baseRates: any[],
  roomType: string,
  nightDates: string[],
  seasonByDate: Map<string, string>,
): number[] {
  const want = String(roomType).toLowerCase()
  const seasons = seasonsOfStay(nightDates, seasonByDate)
  const out = new Set<number>()
  for (const r of baseRates) {
    if (String(r?.roomType ?? '').toLowerCase() !== want) continue
    if (!seasons.has(String(r?.season ?? ''))) continue
    const occ = Number(r?.occupancy)
    if (Number.isFinite(occ) && occ > 0) out.add(occ)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * ¿La ocupación se puede COTIZAR DE VERDAD para esas noches? Se decide NOCHE POR NOCHE, con la
 * misma cadena de precio que `sumStayPrice` — es la contracara honesta de ese resolver.
 *
 * Una noche es cotizable para `occupancy` cuando:
 *  - no tiene temporada asignada, o su temporada no tiene NINGUNA fila para el tipo → cae al
 *    fallback `rooms.basePrice`, que no distingue ocupaciones (el hotel no cargó grilla para esa
 *    noche, así que no puede "faltarle" la fila de 3 personas); o
 *  - su temporada tiene filas y alguna CUBRE la ocupación (`pickCoveringRate`).
 *
 * `false` ⟺ hay al menos una noche donde el hotel SÍ cargó grilla y ninguna fila llega a esa
 * cantidad de gente. Solo en ese caso la ocupación es un producto que el hotel no puso en venta.
 */
export function isOccupancyQuotable(
  baseRates: any[],
  roomType: string,
  nightDates: string[],
  seasonByDate: Map<string, string>,
  occupancy: number,
): boolean {
  for (const date of nightDates) {
    const season = seasonByDate.get(date) ?? null
    if (!season) continue
    if (ratesFor(baseRates, roomType, season).length === 0) continue
    if (!pickCoveringRate(baseRates, roomType, season, occupancy)) return false
  }
  return true
}

/** Precio efectivo de una fila de `room_rates`. `price` ya viene calculado por `pricing`; si
 *  llegara en 0 (fila legacy / derivada), se recompone desde `basePrice` + `percentage`. */
export function ratePrice(rate: any): number {
  const price = Number(rate?.price) || 0
  if (price > 0) return price
  const base = Number(rate?.basePrice) || 0
  const pct = Number(rate?.percentage) || 0
  return base > 0 ? round2(base * (1 + pct / 100)) : 0
}

/**
 * Precio de UNA noche para un tipo de habitación.
 *
 * `fallbackPrice` es el precio "sin temporadas" del tipo (`rooms.basePrice`) y se usa cuando esa
 * fecha no tiene temporada asignada, cuando la temporada no tiene fila para el tipo, o cuando la
 * fila existe pero no resuelve a un importe > 0. Ese fallback es lo que hace que un hotel SIN
 * temporadas cargadas (el caso de casi todos hoy) cotice exactamente igual que antes.
 */
export function resolveNightlyPrice(
  baseRates: any[],
  roomType: string,
  season: string | null,
  guests: number,
  fallbackPrice: number,
): number {
  const rate = pickRate(baseRates, roomType, season, guests)
  const price = rate ? ratePrice(rate) : 0
  return price > 0 ? price : fallbackPrice
}

/**
 * Un override de `rate_overrides` visto desde la cadena de precio. Solo interesan las dimensiones
 * que cambian el importe; las restricciones (stop sell, CTA/CTD) las mira `stay-restrictions.ts`.
 */
export interface NightlyRateOverride {
  roomType: string
  ratePlan: string
  dateFrom: string
  dateTo: string
  rate: number
}

/**
 * El plan que vende el motor DIRECTO: la tarifa base, sin markup de plan.
 *
 * Un override cargado sobre `bb` (Bed & Breakfast) es un precio de canal — el hotel lo vende con
 * desayuno a través de una OTA — y no debe filtrarse al precio de la web propia, igual que ya pasa
 * con los overrides por canal de `room_rates` (ver `baseRatesOnly`).
 */
export const DIRECT_RATE_PLAN = 'bar'

/**
 * Precio del override que aplica a una fecha, o 0 si no hay ninguno.
 *
 * Gana el MÁS ESPECÍFICO (el rango más corto): "todo diciembre a 432" y encima "el 24 y 25 a 900"
 * tiene que dar 900 esos dos días. Es la misma regla que `pricing/usecases/rate-overrides.ts`
 * aplica del lado del panel y que el orden del payload reproduce del lado de Channex — las tres
 * capas tienen que coincidir o el hotel ve un precio y el huésped paga otro.
 */
export function overrideRateFor(
  overrides: NightlyRateOverride[],
  roomType: string,
  date: string,
  ratePlan: string = DIRECT_RATE_PLAN,
): number {
  const rt = String(roomType).toLowerCase()
  const rp = String(ratePlan).toLowerCase()
  let best: NightlyRateOverride | null = null
  for (const o of overrides) {
    if (!(Number(o?.rate) > 0)) continue
    if (String(o.roomType).toLowerCase() !== rt || String(o.ratePlan).toLowerCase() !== rp) continue
    if (o.dateFrom > date || o.dateTo < date) continue
    if (!best || Date.parse(o.dateTo) - Date.parse(o.dateFrom) < Date.parse(best.dateTo) - Date.parse(best.dateFrom)) {
      best = o
    }
  }
  return best ? Number(best.rate) : 0
}

/**
 * Total de la estadía para un tipo: SUMA del precio de cada noche, no `precio × noches`.
 * `nightDates` son las noches reales (`[checkIn, checkOut)` — la noche del checkout no existe).
 */
export function sumStayPrice(
  nightDates: string[],
  baseRates: any[],
  roomType: string,
  seasonByDate: Map<string, string>,
  guests: number,
  fallbackPrice: number,
  /** Tarifas por fecha (`rate_overrides`). Pisan a la temporada. Vacío = comportamiento de siempre. */
  overrides: NightlyRateOverride[] = [],
): number {
  let total = 0
  for (const date of nightDates) {
    // El override es la capa MÁS específica: si fija precio para esa noche, no se mira la temporada.
    const override = overrideRateFor(overrides, roomType, date)
    total += override > 0
      ? override
      : resolveNightlyPrice(baseRates, roomType, seasonByDate.get(date) ?? null, guests, fallbackPrice)
  }
  // round2 al final: sumar N veces el mismo float puede dejar cola binaria (33.33 × 3 = 99.99000…1).
  return round2(total)
}

// STR-1: `round2` NO se re-exporta desde acá — se importa de `shared/utils/money.ts`, su único
// origen. Ver la nota equivalente en `reservation-balance.ts`.
