// restaurant/usecases/business-date.ts — Sello de cierre de una comanda (#213, auditoría).
//
// Toda transición que cierra la comanda (cobro directo, confirmación del webhook de tarjeta, cargo a
// habitación, cancelación) escribe el MISMO par: `closedAt` (instante ISO) + `businessDate` (día
// contable 'YYYY-MM-DD' en la zona del hotel). El cierre del día consulta por `businessDate` (el ORM
// solo hace igualdades); sin este sello la comanda no aparece en ningún cierre.
import type { RepositoryAdapter } from 'arckode-framework'
import { hotelTimezone } from '../../../shared/utils/hotel-schedule'
import { businessDateOf } from '../../../shared/utils/business-date'

/** Zona horaria del hotel (findOne por el id ya validado por ownership; default de hotel-schedule si no existe). */
export async function timezoneOfHotel(hotels: RepositoryAdapter<any> | undefined, hotelId: string): Promise<string> {
  const hotel = hotels ? await hotels.findOne({ id: hotelId }).catch(() => null) : null
  return hotelTimezone(hotel)
}

export async function closingStamp(
  hotels: RepositoryAdapter<any> | undefined,
  hotelId: string,
  now: Date = new Date(),
): Promise<{ closedAt: string; businessDate: string }> {
  const timezone = await timezoneOfHotel(hotels, hotelId)
  return { closedAt: now.toISOString(), businessDate: businessDateOf(now, timezone) as string }
}
