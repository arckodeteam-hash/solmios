// shared/utils/season-price.ts — El precio de una temporada es un IMPORTE, no un porcentaje.
//
// Cómo quedan las dos capas, y por qué son distintas:
//
//   1. TEMPORADAS (globales, /panel/config/tarifas). Cada celda (tipo × ocupación × temporada) lleva
//      un precio en $ que el hotel escribe. Ese importe ES el precio de esa temporada. Antes se
//      cargaba un porcentaje sobre el precio del tipo, y no había forma de decir "la suite en alta
//      cuesta 200": había que despejar qué porcentaje daba 200 y escribirlo, con el redondeo en
//      contra. Es la capa que el hotel piensa en pesos.
//
//   2. CANAL (/panel/channel/:id). Ahí sí un PORCENTAJE, aplicado sobre el precio de esa temporada:
//      "Booking me cobra comisión, le sumo 15% a lo que ya vale". El canal nunca fija un importe
//      absoluto — eso lo hacen las tarifas por fecha (`rate_overrides`), que son otra cosa.
//
// `rooms.basePrice` (el precio base del tipo, uno solo) sigue existiendo y sirve para lo que no cubre
// ninguna temporada: las fechas sin temporada asignada, el "desde $X" del motor público, y el valor
// por defecto de una celda que el hotel todavía no cargó. Ver ./base-price.ts.
//
// Vive en `shared` y no en `pricing` porque lo necesitan dos módulos: pricing (guardar y leer la
// grilla) y canales (publicar a las OTAs), y un módulo no importa de otro (CLAUDE #3).

import { effectiveRate } from './base-price'

/** Precio por (tipo | ocupación | temporada) de la grilla GLOBAL. */
export type SeasonPriceIndex = Map<string, number>

export function seasonRateKey(roomType: unknown, occupancy: unknown, season: unknown): string {
  return `${String(roomType || '')}|${Number(occupancy) || 0}|${String(season || '')}`
}

/** Índice de precios de temporada. Solo entran las filas GLOBALES: las de canal son derivadas. */
export function indexSeasonPrices(rows: readonly any[]): SeasonPriceIndex {
  const out: SeasonPriceIndex = new Map()
  for (const r of rows) {
    if (r?.channel) continue
    const price = resolveSeasonPrice(r, 0)
    if (price > 0) out.set(seasonRateKey(r.roomType, r.occupancy, r.season), price)
  }
  return out
}

/**
 * Precio de esa celda en la grilla global. Si el hotel no cargó esa temporada todavía, cae al precio
 * base del tipo — igual que una noche sin temporada asignada. Un 0 guardado es "sin cargar", no
 * "gratis" (misma convención que `rate_overrides`).
 */
export function seasonPriceFor(
  index: SeasonPriceIndex, roomType: unknown, occupancy: unknown, season: unknown, typeBasePrice: number,
): number {
  return index.get(seasonRateKey(roomType, occupancy, season)) || Number(typeBasePrice) || 0
}

/** Precio de una celda de CANAL: el de la temporada, con el porcentaje del canal encima. */
export function channelPriceFor(seasonPrice: number, percentage: unknown): number {
  return effectiveRate(Number(seasonPrice) || 0, Number(percentage) || 0)
}

/**
 * El porcentaje que ese importe representa sobre el precio base del tipo. Se sigue guardando en
 * `room_rates.percentage` de las filas globales para no dejar ciegos a los lectores que todavía
 * recomponen el precio desde `basePrice` + `percentage` (`shared/utils/rate-resolution.ts:ratePrice`
 * lo hace cuando `price` viene en 0). Es un ESPEJO: el dato que manda es el importe.
 */
export function percentageOfBase(price: number, typeBasePrice: number): number {
  const base = Number(typeBasePrice) || 0
  if (base <= 0) return 0
  return Math.round(((Number(price) || 0) / base - 1) * 10000) / 100
}

/**
 * El importe de una celda global, en orden de precedencia:
 *
 *  1. el `price` que el hotel cargó;
 *  2. si no hay, `basePrice × (1 + percentage/100)` — filas guardadas antes de que la grilla se
 *     editara en pesos, y clientes de la API que todavía mandan la forma vieja. Perder ese recargo
 *     bajaría el precio de esas temporadas sin que nadie lo pidiera;
 *  3. si tampoco hay, el precio base del tipo (celda que nunca se cargó).
 *
 * Mismo criterio que `shared/utils/rate-resolution.ts:ratePrice`, que ya recomponía así.
 */
export function resolveSeasonPrice(
  row: { price?: unknown; basePrice?: unknown; percentage?: unknown } | undefined,
  typeBasePrice: number,
): number {
  const price = Number(row?.price)
  if (Number.isFinite(price) && price > 0) return Math.round(price * 100) / 100
  const legacyBase = Number(row?.basePrice) || 0
  const pct = Number(row?.percentage) || 0
  if (legacyBase > 0 && pct !== 0) return effectiveRate(legacyBase, pct)
  return Number(typeBasePrice) || 0
}

/** El importe que el hotel cargó, o el precio base del tipo si dejó la celda vacía. */
export function normalizeSeasonPrice(value: unknown, typeBasePrice: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return Number(typeBasePrice) || 0
  return Math.round(n * 100) / 100
}

/** Lo que se escribe en `room_rates` para una fila. */
export interface RateWrite { basePrice: number; percentage: number; price: number }

/**
 * El índice a usar DURANTE un guardado: lo que ya estaba, con las filas globales de este payload
 * encima. Sin esto, guardar el precio de una temporada y el porcentaje de un canal en la misma
 * llamada derivaría el canal del precio VIEJO, y el orden de las filas del payload decidiría el
 * resultado.
 */
export function mergeIncomingSeasonPrices(
  index: SeasonPriceIndex,
  incoming: readonly any[],
  typeBasePriceOf: (roomType: unknown) => number,
): SeasonPriceIndex {
  const out: SeasonPriceIndex = new Map(index)
  for (const r of incoming) {
    if (r?.channel) continue
    if (!r?.roomType || !r?.season || r.occupancy === undefined) continue
    out.set(seasonRateKey(r.roomType, r.occupancy, r.season), resolveSeasonPrice(r, typeBasePriceOf(r.roomType)))
  }
  return out
}

/**
 * Qué precio guardar para una fila, según la capa a la que pertenece:
 *
 *  - GLOBAL (`channel` vacío): el importe que mandó el hotel. `percentage` se guarda derivado, como
 *    espejo (ver `percentageOfBase`).
 *  - CANAL: el porcentaje que mandó el hotel, aplicado sobre el precio de esa temporada.
 *
 * `basePrice` es en las dos el precio del TIPO: sigue siendo el espejo que leen el push, el motor
 * público y las ~39 referencias a esa columna.
 */
export function resolveRateWrite(
  row: { channel?: unknown; roomType?: unknown; occupancy?: unknown; season?: unknown; price?: unknown; percentage?: unknown },
  typeBasePrice: number,
  seasonPrices: SeasonPriceIndex,
): RateWrite {
  const isChannel = !!(typeof row.channel === 'string' ? row.channel : '')
  if (!isChannel) {
    const price = resolveSeasonPrice(row, typeBasePrice)
    return { basePrice: typeBasePrice, percentage: percentageOfBase(price, typeBasePrice), price }
  }
  const seasonPrice = seasonPriceFor(seasonPrices, row.roomType, row.occupancy, row.season, typeBasePrice)
  const percentage = Number(row.percentage) || 0
  return { basePrice: typeBasePrice, percentage, price: channelPriceFor(seasonPrice, percentage) }
}
