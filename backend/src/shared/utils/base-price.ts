// pricing/usecases/base-price.ts — El precio base es UNO SOLO por tipo de habitación.
//
// Por qué existe este archivo. `room_rates` tiene una columna `basePrice` por FILA, y una fila es
// (tipo × ocupación × temporada × canal). Para una suite con 4 temporadas, 2 ocupaciones y un canal
// eso son 16 copias del mismo número, sin nada que las obligue a coincidir. Medido en producción el
// 2026-09-05, el Hotel Boutique Palma tenía TRES precios base distintos para la misma suite: 120 en
// `rooms`, 120 en la grilla base y 250/220 en el canal. El editor mostraba uno y el motor cobraba
// otro, sin ninguna señal.
//
// El modelo correcto —y el que la UI ya intentaba imponer sola desde el frontend
// (`frontend/src/pages/tarifas/index.vue`, `setBasePrice` escribía el mismo valor en todas las
// temporadas del tipo)— es: un precio base por habitación, y todo lo demás derivado de él por
// porcentaje. La temporada sube o baja un %, el canal sube o baja un %. Nada más define un precio
// absoluto salvo `rate_overrides`, que es el precio por día y sigue siendo absoluto a propósito.
//
// La columna `room_rates.basePrice` NO se borra: la leen ~39 archivos, incluido el push a Channex
// (`canales/usecases/channex.ts:458`). Queda como ESPEJO derivado — se sigue escribiendo, pero
// siempre con el valor del tipo, nunca con lo que mande el cliente.

/** Precio base por tipo: el MÍNIMO POSITIVO entre las unidades del tipo — mismo criterio que
 *  `PricingQueries.roomTypesFor`, que `sync-property.ts:summarizeRoomTypes` y que el motor público
 *  para publicar "desde $X". */
export type BasePriceByType = ReadonlyMap<string, number>

export interface RoomTypeRow { type: string; basePrice: number }

/**
 * Índice tipo → precio base.
 *
 * Se queda con el MÍNIMO POSITIVO, no con la primera fila. Los dos llamadores le pasan cosas
 * distintas y por eso el criterio importa:
 *
 *  - `pricing/service.ts` le pasa la salida de `roomTypesFor`, ya agregada: una fila por ocupación,
 *    todas con el mismo base del tipo. Mínimo o primera dan lo mismo.
 *  - `canales/usecases/push-rates.ts` le pasa las filas CRUDAS de `Rooms`, una por habitación
 *    física. Ahí un tipo con dos unidades a precios distintos —alta de una habitación nueva, o
 *    edición de una sola desde `/panel/habitaciones`— publicaba el de "la primera que devolviera la
 *    query", cuyo orden no está garantizado, mientras el panel mostraba el mínimo: el editor decía
 *    120 y la OTA salía con 200. Un tipo con una unidad en 0 era peor todavía — el índice guardaba
 *    el 0, `basePriceFor` lo descartaba y el push caía al `basePrice` grabado en la fila.
 *
 * Las unidades en 0 (habitación cargada sin precio) NO entran: si ninguna del tipo tiene precio, el
 * tipo queda fuera del índice y `basePriceFor` cae al fallback, igual que antes.
 */
export function indexBasePrices(roomTypes: readonly RoomTypeRow[]): BasePriceByType {
  const out = new Map<string, number>()
  for (const rt of roomTypes) {
    const type = String(rt.type || '')
    const price = Number(rt.basePrice) || 0
    if (!type || price <= 0) continue
    const current = out.get(type)
    if (current === undefined || price < current) out.set(type, price)
  }
  return out
}

/**
 * El base que le corresponde a una fila de tarifas.
 *
 * `fallback` es el `basePrice` que la fila trae guardado, y se usa SOLO cuando el tipo no está en el
 * índice: un tipo de habitación borrado deja filas huérfanas que el editor sigue mostrando (ver
 * `fillRateGrid`, sección "orphans"), y ponerlas en 0 las publicaría gratis.
 */
export function basePriceFor(
  index: BasePriceByType, roomType: string, fallback: number | undefined,
): number {
  const derived = index.get(String(roomType || ''))
  if (derived !== undefined && derived > 0) return derived
  return Number(fallback) || 0
}

/** Precio resultante de aplicar el porcentaje de temporada/canal al base. Un porcentaje negativo
 *  BAJA el precio (hasta -100% = gratis); el validador acota el rango. */
export function effectiveRate(basePrice: number, percentage: number): number {
  return Math.round(basePrice * (1 + (Number(percentage) || 0) / 100) * 100) / 100
}

/**
 * El porcentaje que preserva un precio ya publicado cuando cambia el base debajo.
 *
 * Lo usa la migración: pasar de "cada fila con su propio base" a "un base único" mueve todos los
 * precios de las OTAs si se hace a lo bruto (en Palma, la suite habría caído de 374 a 204 en vivo).
 * Convirtiendo el base viejo en porcentaje, el precio efectivo no se mueve ni un centavo.
 *
 * Con `newBase` en 0 no hay porcentaje que valga (0 × cualquier cosa = 0): devuelve 0 en vez de
 * dividir por cero, y el llamador decide.
 */
export function percentagePreserving(oldPrice: number, newBase: number): number {
  const base = Number(newBase) || 0
  if (base <= 0) return 0
  return Math.round(((Number(oldPrice) || 0) / base - 1) * 10000) / 100
}
