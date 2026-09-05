// pricing/usecases/update-rates.ts — Guardado de la grilla de tarifas. Extraído del service por el
// gate de 200 líneas del analyzer; la regla de qué precio se guarda vive en `shared/utils/season-price.ts`.

import type { RepositoryAdapter } from 'arckode-framework'
import { indexBasePrices, basePriceFor, type RoomTypeRow } from '../../../shared/utils/base-price'
import { applyBasePrices, type BasePricePort, type BasePriceInput } from './base-price-port'
import { indexSeasonPrices, mergeIncomingSeasonPrices, resolveRateWrite } from '../../../shared/utils/season-price'
import type { RateChange } from './audit'

export interface UpdateRatesDeps {
  repo: RepositoryAdapter<any>
  /** Tipos con su precio base (`PricingQueries.roomTypesFor`). Vacío si el service no tiene queries. */
  roomTypes: (hotelId: string) => Promise<RoomTypeRow[]>
  basePricePort: BasePricePort | null
}

export interface UpdateRatesResult { saved: number; changes: RateChange[] }

/**
 * Guarda las filas de la grilla y devuelve qué cambió realmente (el grid manda TODAS las celdas en
 * cada guardado; auditar y republicar todo sería ruido).
 *
 * Las dos capas se guardan distinto — la global lleva el IMPORTE que escribió el hotel, la de canal
 * el porcentaje aplicado sobre ese importe. Ver `shared/utils/season-price.ts`.
 */
export async function updateRates(
  deps: UpdateRatesDeps, hotelId: string, rates: any[], basePrices?: BasePriceInput[],
): Promise<UpdateRatesResult> {
  // El base del TIPO no sale de la fila de tarifas: vive en la habitación (ver base-price.ts). Se
  // escribe ANTES de derivar, o las filas guardarían el viejo.
  await applyBasePrices(deps.basePricePort, hotelId, basePrices)
  const bases = indexBasePrices(await deps.roomTypes(hotelId))
  const typeBaseOf = (roomType: unknown) => basePriceFor(bases, String(roomType || ''), 0)
  // El precio de cada temporada es un IMPORTE de la grilla global; el canal solo le suma su
  // porcentaje encima. Se arma ANTES del loop para que el orden de las filas del payload no decida
  // de qué precio deriva el canal.
  const seasonPrices = mergeIncomingSeasonPrices(
    indexSeasonPrices(await deps.repo.findMany({ hotelId }) as any[]), rates, typeBaseOf,
  )

  let saved = 0
  const changes: RateChange[] = []
  for (const r of rates) {
    if (!r.roomType || !r.season || r.occupancy === undefined) continue
    const channel = typeof r.channel === 'string' ? r.channel : ''
    const { basePrice, percentage, price } =
      resolveRateWrite(r, basePriceFor(bases, r.roomType, r.basePrice), seasonPrices)
    const closed = r.closed ? 1 : 0
    const minStay = Number(r.minStay) || 0
    const maxStay = Number(r.maxStay) || 0
    const existing = (await deps.repo.findMany({ hotelId, roomType: r.roomType, occupancy: r.occupancy, season: r.season, channel }))[0] as any
    const change: RateChange = { roomType: r.roomType, season: r.season, occupancy: r.occupancy, from: null, to: price, closed }
    if (existing) {
      await deps.repo.update(existing.id, { basePrice, percentage, price, closed, minStay, maxStay })
      const moved = Number(existing.price ?? 0) !== price || Number(existing.closed ?? 0) !== closed
      if (moved) changes.push({ ...change, from: Number(existing.price ?? 0) })
    } else {
      await deps.repo.create({ id: crypto.randomUUID(), hotelId, roomType: r.roomType, occupancy: r.occupancy, season: r.season, channel, basePrice, percentage, price, closed, minStay, maxStay })
      changes.push(change)
    }
    saved++
  }
  return { saved, changes }
}
