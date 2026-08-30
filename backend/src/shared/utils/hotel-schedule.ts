// shared/utils/hotel-schedule.ts — Fuente ÚNICA del horario de entrada/salida.
//
// Por qué existe (auditoría 2026-08-29, reporte de cliente):
// El hotel configura su horario en `hotels.checkIn` / `hotels.checkOut` (Settings → tab Hotel),
// pero CUATRO lugares leían `hotel.checkInTime` / `hotel.checkOutTime` — campos que NO existen en
// el modelo — y caían siempre al literal '14:00'. Un hotel con 15:00 configurado le anunciaba
// 14:00 al huésped por WhatsApp, por el email de check-in y por el recepcionista IA.
// Peor: `ttlock-config.ts` no leía horario NINGUNO y hacía `new Date('2026-09-12').getTime()`,
// que es medianoche UTC. En America/Santo_Domingo (UTC-4) el código de la cerradura pasaba a
// valer el día ANTERIOR a las 20:00 y moría a las 20:00 del día previo a la salida: el huésped
// se quedaba sin acceso a su habitación durante su última noche.
//
// REGLA: nada de horarios literales sueltos. Todo pasa por acá.

/** Defaults ALINEADOS con `hoteles/model.ts` (`checkIn: '15:00'`, `checkOut: '12:00'`). */
export const DEFAULT_CHECK_IN_TIME = '15:00'
export const DEFAULT_CHECK_OUT_TIME = '12:00'
/** Default alineado con `hoteles/model.ts` (`timezone`). */
export const DEFAULT_TIMEZONE = 'America/Santo_Domingo'

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

type HotelLike = { checkIn?: unknown; checkOut?: unknown; timezone?: unknown } | null | undefined
type ReservationLike = { checkInTime?: unknown; checkOutTime?: unknown } | null | undefined

/** Hora de entrada del hotel; el default solo aplica si el registro está vacío o corrupto. */
export function hotelCheckInTime(hotel: HotelLike): string {
  return normalizeTime(hotel?.checkIn) ?? DEFAULT_CHECK_IN_TIME
}

/** Hora de salida del hotel; el default solo aplica si el registro está vacío o corrupto. */
export function hotelCheckOutTime(hotel: HotelLike): string {
  return normalizeTime(hotel?.checkOut) ?? DEFAULT_CHECK_OUT_TIME
}

export function hotelTimezone(hotel: HotelLike): string {
  const tz = hotel?.timezone
  return typeof tz === 'string' && tz.trim() ? tz.trim() : DEFAULT_TIMEZONE
}

/**
 * Horario EFECTIVO de una reserva: el override de la reserva (early check-in / late checkout)
 * pisa el horario del hotel. Sin override, manda el del hotel.
 */
export function effectiveCheckInTime(reservation: ReservationLike, hotel: HotelLike): string {
  return normalizeTime(reservation?.checkInTime) ?? hotelCheckInTime(hotel)
}

export function effectiveCheckOutTime(reservation: ReservationLike, hotel: HotelLike): string {
  return normalizeTime(reservation?.checkOutTime) ?? hotelCheckOutTime(hotel)
}

/** Desfase de `timeZone` respecto de UTC, en ms, para el instante dado (contempla DST). */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)
  const at = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'))
  return asUtc - instant.getTime()
}

/**
 * Convierte una fecha ('YYYY-MM-DD') + hora ('HH:MM') EN LA ZONA DEL HOTEL al instante UTC real.
 *
 * Sin esto, `new Date('2026-09-12')` da medianoche UTC — la fuente del bug de la cerradura.
 * Dos pasadas: la primera estima el offset, la segunda lo corrige en los saltos de DST (donde
 * el offset del instante estimado difiere del offset del instante real).
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, mo, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  const time = normalizeTime(timeStr) ?? '00:00'
  const [hh, mm] = time.split(':').map(Number)
  if (!y || !mo || !d) return new Date(NaN)
  const wallClock = Date.UTC(y, mo - 1, d, hh, mm, 0, 0)
  let instant = wallClock - tzOffsetMs(new Date(wallClock), timeZone)
  instant = wallClock - tzOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

export interface AccessWindow {
  startMs: number
  endMs: number
  checkInTime: string
  checkOutTime: string
  timezone: string
}

/**
 * Ventana de validez del código de la cerradura para una reserva, en epoch ms UTC.
 * `reservation.checkIn`/`checkOut` son fechas ('YYYY-MM-DD'); la hora sale del override de la
 * reserva o del horario del hotel, interpretada en la zona del hotel.
 */
export function reservationAccessWindow(reservation: any, hotel: HotelLike): AccessWindow {
  const timezone = hotelTimezone(hotel)
  const checkInTime = effectiveCheckInTime(reservation, hotel)
  const checkOutTime = effectiveCheckOutTime(reservation, hotel)
  return {
    startMs: zonedTimeToUtc(String(reservation?.checkIn ?? ''), checkInTime, timezone).getTime(),
    endMs: zonedTimeToUtc(String(reservation?.checkOut ?? ''), checkOutTime, timezone).getTime(),
    checkInTime,
    checkOutTime,
    timezone,
  }
}
