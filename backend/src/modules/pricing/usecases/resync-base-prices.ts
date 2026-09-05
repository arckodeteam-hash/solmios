// pricing/usecases/resync-base-prices.ts — Devolverle a `room_rates` el precio base de la habitación.
//
// Por qué existe. El precio base es UNO SOLO por tipo y vive en `rooms.basePrice`
// (ver `shared/utils/base-price.ts`); `room_rates.basePrice`/`price` son un ESPEJO. Tres de los
// cuatro caminos derivan ese espejo al vuelo —guardar la grilla (`service.updateRates`), leerla
// (`pricing-queries.ts`) y publicar a las OTAs (`canales/usecases/push-rates.ts`)—, pero el cuarto
// NO: el motor de reservas cotiza la fila tal como está guardada (`shared/utils/rate-resolution.ts`
// → `ratePrice`, que toma `rate.price` y solo cae a `basePrice`+`percentage` si viene en 0). Lo usan
// el motor público (`bookingengine`), el wizard del panel (`reservas/usecases/quote.ts`) y el
// repricing (`reservas/usecases/reprice.ts`).
//
// El agujero se abre al cambiar el precio desde `/panel/habitaciones`, que escribe `rooms` y no
// toca `room_rates`. Ese mismo cambio SÍ dispara el push a Channex
// (`canales/usecases/room-events.ts:onRoomUpdated`), que deriva: con base 220 → 120 y una temporada
// de +70%, la OTA pasaba a publicar 204 mientras la web propia seguía cobrando 374. La misma
// discrepancia que el espejo vino a cerrar, del otro lado del mostrador.
//
// La salida es hacer el espejo REAL en vez de nominal: cuando cambia el precio de una habitación,
// se reescriben las filas de tarifas de ese hotel. Lo dispara el connector `habitaciones-pricing`.

import { indexBasePrices, effectiveRate, type RoomTypeRow } from '../../../shared/utils/base-price'

export interface ResyncBasePricesDeps {
  /** Tipos del hotel con su base derivado — `PricingQueries.roomTypesFor`. */
  roomTypes: (hotelId: string) => Promise<RoomTypeRow[]>
  /** TODAS las filas de `room_rates` del hotel: la base y las de cada canal. */
  listRates: (hotelId: string) => Promise<any[]>
  updateRate: (id: string, patch: { basePrice: number; price: number }) => Promise<unknown>
}

/**
 * Reescribe `basePrice` y `price` de las filas cuyo tipo tiene precio cargado. Devuelve cuántas
 * cambiaron — 0 significa que ya estaban alineadas (el caso normal cuando el cambio vino de la
 * grilla, que ya deriva al guardar).
 *
 * Las filas HUÉRFANAS se dejan como están: un tipo de habitación borrado no está en el índice, y
 * pisarles el precio con un 0 las publicaría gratis (misma regla que `basePriceFor`). Tampoco se
 * toca nada si el hotel no tiene ninguna habitación con precio.
 */
export async function resyncBasePrices(deps: ResyncBasePricesDeps, hotelId: string): Promise<number> {
  const [types, rates] = await Promise.all([deps.roomTypes(hotelId), deps.listRates(hotelId)])
  const bases = indexBasePrices(types)
  if (bases.size === 0) return 0
  let touched = 0
  for (const r of rates) {
    if (!r?.id) continue
    const base = bases.get(String(r.roomType || ''))
    if (base === undefined || base <= 0) continue
    const price = effectiveRate(base, Number(r.percentage) || 0)
    if (Number(r.basePrice) === base && Number(r.price) === price) continue
    await deps.updateRate(String(r.id), { basePrice: base, price })
    touched++
  }
  return touched
}
