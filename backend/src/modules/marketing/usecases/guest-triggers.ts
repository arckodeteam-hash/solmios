// marketing/usecases/guest-triggers.ts — Triggers que dependen del HUÉSPED, no de una
// reserva en curso (spec guest-triggers de crm-campanas-v1): cumpleaños y win-back por
// inactividad. Selectores PUROS (testeables sin DB); el cron solo pasa los datos.
//
// El dedupe mismo-día lo hace `triggerAutoMessages` (log `auto:{event}:{msgId}`); acá se
// garantiza además que la selección sea exacta (un solo día posible por huésped).

const DAY_MS = 86_400_000

/** Mes y día del birthDate coinciden con HOY (sin año — es cumpleaños, no edad). */
export function isBirthdayToday(birthDate: string | null | undefined, today: Date): boolean {
  if (!birthDate) return false
  const [y, m, d] = birthDate.split('-').map(Number)
  if (!y || !m || !d) return false
  return m === today.getMonth() + 1 && d === today.getDate()
}

/** Última checkOut (pasada) de un huésped a partir de sus reservas — '' si nunca alojó. */
export function lastStayCheckout(reservations: Array<{ guestId: string; checkOut?: string | null; status?: string }>, guestId: string): string {
  const past = reservations
    .filter((r) => r.guestId === guestId && r.checkOut && ['checked_out', 'checked_in', 'confirmed'].includes(String(r.status)))
    .map((r) => String(r.checkOut))
    .sort()
  return past[past.length - 1] ?? ''
}

/** Tiene ALGUNA reserva con checkIn futuro (ya volvió — el win-back sería ruido). */
export function hasFutureStay(reservations: Array<{ guestId: string; checkIn?: string | null; status?: string }>, guestId: string, today: Date): boolean {
  const todayStr = today.toISOString().slice(0, 10)
  return reservations.some((r) => r.guestId === guestId && r.checkIn && String(r.checkIn) >= todayStr
    && ['confirmed', 'checked_in'].includes(String(r.status)))
}

/**
 * Win-back: huéspedes cuya última estadía terminó EXACTAMENTE hace `offsetDays` días.
 * La condición exacta + cron diario = un único día posible de envío (sin spam, sin semanal).
 */
export function isInactiveSince(reservations: Array<{ guestId: string; checkIn?: string | null; checkOut?: string | null; status?: string }>, guestId: string, offsetDays: number, today: Date): boolean {
  if (hasFutureStay(reservations, guestId, today)) return false
  const last = lastStayCheckout(reservations, guestId)
  if (!last) return false // nunca alojó: no es "inactivo", es desconocido
  const target = new Date(today.getTime() - offsetDays * DAY_MS).toISOString().slice(0, 10)
  return last === target
}

/** Variables extra para el cuerpo del win-back ({last_visit}). */
export const lastVisitVar = (reservations: Array<{ guestId: string; checkOut?: string | null; status?: string }>, guestId: string): string =>
  lastStayCheckout(reservations, guestId)
