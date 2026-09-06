// shared/usecases/room-charge-rate.ts — Cuánto cuesta UNA noche de habitación en el folio.
//
// El folio es lo que se le cobra al huésped, así que este número tiene que ser el mismo que cotizó
// la reserva. Hasta ahora los dos lugares que postean la habitación usaban `rooms.basePrice` a
// secas —`reservas/usecases/checkin.ts` la noche del ingreso y `folios/usecases/night-audit.ts` las
// siguientes—, y eso ignora la temporada por completo: en el Hotel Boutique Palma, medido el
// 2026-09-05, una Double reservada en temporada Media a 111,35 se facturaba 85, 110 o 135 según qué
// habitación física le tocara. Tres importes, ninguno el pactado.
//
// Acá se usa la MISMA cadena que cotiza el motor y que reprecia el planning
// (`shared/utils/rate-resolution.ts`): temporada del día → `room_rates` → fallback
// `rooms.basePrice`. Si el folio cobrara con otra fórmula, el hotel facturaría distinto de lo que
// publica en su propia web para esas mismas fechas.
//
// DEGRADACIÓN: si no se puede leer la grilla (tablas vacías, error), cae a `rooms.basePrice`, que es
// exactamente el comportamiento anterior. Nunca devuelve 0 por un fallo de lectura: un cargo en 0
// sería una noche regalada y nadie lo notaría hasta la auditoría.

import { baseRatesOnly, buildSeasonByDate, resolveNightlyPrice } from '../utils/rate-resolution'

export interface RoomChargeRateInput {
  hotelId: string
  /** Fecha de la noche a cobrar (YYYY-MM-DD). */
  date: string
  /** `rooms.type` de la habitación ocupada. */
  roomType: string
  /** Ocupación tarifada: elige la fila de `room_rates`. */
  guests: number
  /** `rooms.basePrice` de la habitación — el fallback y lo único que se usaba antes. */
  fallbackPrice: number
}

/**
 * Precio de esa noche para el folio. `orm` es el ORM del módulo que llama; se leen los mismos
 * modelos compartidos que usa el motor público.
 */
export async function roomChargeRate(orm: any, input: RoomChargeRateInput): Promise<number> {
  const fallback = Number(input.fallbackPrice) || 0
  const date = String(input.date || '').slice(0, 10)
  if (!date || !input.roomType) return fallback
  try {
    const [assignments, seasons, rates] = await Promise.all([
      orm.findMany('SeasonAssignments', { hotelId: input.hotelId }) as Promise<any[]>,
      orm.findMany('Seasons', { hotelId: input.hotelId }) as Promise<any[]>,
      orm.findMany('RoomRates', { hotelId: input.hotelId }) as Promise<any[]>,
    ])
    const seasonByDate = buildSeasonByDate(assignments || [], seasons || [], [date])
    const price = resolveNightlyPrice(
      baseRatesOnly(rates || []), input.roomType, seasonByDate.get(date) ?? null,
      Math.max(1, Number(input.guests) || 1), fallback,
    )
    return price > 0 ? price : fallback
  } catch {
    // Un fallo leyendo la grilla no puede dejar la noche sin cobrar ni frenar el check-in.
    return fallback
  }
}
