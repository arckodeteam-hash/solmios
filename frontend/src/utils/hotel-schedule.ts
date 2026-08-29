// utils/hotel-schedule.ts — Fuente ÚNICA del horario de entrada/salida en el frontend.
// Espeja `backend/src/shared/utils/hotel-schedule.ts` (mismos defaults, misma precedencia).
//
// Por qué existe (2026-08-29): dos componentes leían `hotel.checkInTime` / `hotel.checkOutTime`,
// campos que NO existen —el registro es `hotel.checkIn` / `hotel.checkOut`— y caían siempre al
// literal '14:00'. El mensaje de WhatsApp que le manda el código de la cerradura al huésped le
// anunciaba una hora de entrada que el hotel nunca configuró. Un `as any` sobre `HotelData`
// (que sí declara `checkIn`) impidió que vue-tsc lo detectara.

/** Defaults ALINEADOS con `backend/src/modules/hoteles/model.ts`. */
export const DEFAULT_CHECK_IN_TIME = '15:00'
export const DEFAULT_CHECK_OUT_TIME = '12:00'

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Normaliza 'HH:MM' (acepta 'H:MM' y 'HH:MM:SS'). Null si no es una hora válida. */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const [h, m] = trimmed.split(':')
  if (h === undefined || m === undefined) return null
  const padded = `${h.padStart(2, '0')}:${m.slice(0, 2)}`
  return HHMM.test(padded) ? padded : null
}

type HotelLike = { checkIn?: string | null; checkOut?: string | null } | null | undefined
type ReservationLike = { checkInTime?: string | null; checkOutTime?: string | null } | null | undefined

export function hotelCheckInTime(hotel: HotelLike): string {
  return normalizeTime(hotel?.checkIn) ?? DEFAULT_CHECK_IN_TIME
}

export function hotelCheckOutTime(hotel: HotelLike): string {
  return normalizeTime(hotel?.checkOut) ?? DEFAULT_CHECK_OUT_TIME
}

/** Horario EFECTIVO: el acordado con esta reserva pisa el del hotel. */
export function effectiveCheckInTime(reservation: ReservationLike, hotel: HotelLike): string {
  return normalizeTime(reservation?.checkInTime) ?? hotelCheckInTime(hotel)
}

export function effectiveCheckOutTime(reservation: ReservationLike, hotel: HotelLike): string {
  return normalizeTime(reservation?.checkOutTime) ?? hotelCheckOutTime(hotel)
}

/** ¿Esta reserva tiene un horario propio distinto del general del hotel? */
export function hasCustomSchedule(reservation: ReservationLike): boolean {
  return !!(normalizeTime(reservation?.checkInTime) || normalizeTime(reservation?.checkOutTime))
}
