// utils/hotel-datetime.ts — fecha y hora de un instante en la zona del HOTEL (#282, M1).
//
// Los timestamps del server son ISO en UTC (`…Z`). Mostrarlos con `slice(0, 16)` es mostrar la hora de
// Londres: en Caja un cobro de las 17:39 (America/Santo_Domingo) salía como 21:39, distinto del ticket,
// que ya imprime en la zona del hotel. La zona viene de `hotels.timezone` (`HotelService.settings()`).
//
// Un valor SIN zona (`2026-08-22T08:00:00`, filas viejas o fixtures) se muestra tal cual vino: no se
// sabe de qué zona es y convertirlo sería inventar una hora.

const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i

export interface HotelDateTime { date: string; time: string }

/** 'YYYY-MM-DD' y 'HH:mm' del instante `iso` en `timeZone` (IANA). Sin zona válida → la del navegador. */
export function hotelDateTime(iso: string | null | undefined, timeZone?: string): HotelDateTime {
  const s = String(iso || '')
  if (!s) return { date: '', time: '' }
  const d = new Date(s)
  if (Number.isNaN(d.getTime()) || !HAS_ZONE.test(s)) return { date: s.slice(0, 10), time: s.slice(11, 16) }
  const zones = [timeZone || undefined, undefined]
  for (const tz of zones) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
      const at = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
      return { date: `${at('year')}-${at('month')}-${at('day')}`, time: `${at('hour')}:${at('minute')}` }
    } catch { /* zona inválida: se reintenta con la del navegador */ }
  }
  return { date: s.slice(0, 10), time: s.slice(11, 16) }
}

/** 'YYYY-MM-DD HH:mm' en la zona del hotel ('' si no hay valor). */
export function hotelDateTimeText(iso: string | null | undefined, timeZone?: string): string {
  const { date, time } = hotelDateTime(iso, timeZone)
  return date ? `${date} ${time}`.trim() : ''
}
