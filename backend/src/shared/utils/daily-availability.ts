// shared/utils/daily-availability.ts — Disponibilidad día a día (lógica PURA, sin DB ni HTTP).
//
// Por qué vive en `shared` y no en un módulo: la misma cuenta la necesitan DOS módulos que no
// se pueden importar entre sí (`canales` para el push ARI a Channex, `bookingengine` para el
// calendario público de tarifas). Son funciones puras sin estado, así que no ameritan un
// connector: `shared/utils/` es el lugar canónico (mismo precedente que `safe-parse.ts`,
// `push-availability.ts`).
//
// Origen: extraído de `canales/usecases/availability.ts` (que ahora re-exporta desde acá para
// no romper a sus callers ni a sus tests).
//
// ⚠️ Criterio de estados de reserva: NO se hardcodea. Cada caller decide qué reserva ocupa
// una habitación, porque los dos consumidores usan criterios distintos y ambos son correctos
// en su contexto:
//   - `canales` (push a OTAs): todo lo que NO esté 'cancelled' ocupa → conservador, no vende
//     de más en un canal externo.
//   - `bookingengine` (motor público): whitelist `confirmed|checked_in|pending|guaranteed`,
//     idéntica a la que aplica `AvailabilityUseCase` al momento de reservar. Si el calendario
//     usara el criterio laxo mostraría noches libres que después `POST /api/public/booking`
//     rechaza.

export const MS_PER_DAY = 86_400_000

/** Horizonte del push de availability a Channex: hoy → +N días. */
export const AVAILABILITY_HORIZON_DAYS = 90

export interface AvailabilityRange {
  dateFrom: string
  dateTo: string
  availability: number
}

/** Unidades libres en una fecha concreta (YYYY-MM-DD). */
export interface DailyAvailability {
  date: string
  available: number
}

/** Reserva mínima que ocupa una habitación durante `[checkIn, checkOut)`. */
export interface OccupyingReservation {
  checkIn: string
  checkOut: string
}

/** Bloqueo mínimo que ocupa una habitación durante `[startDate, endDate]` (inclusivo). */
export interface OccupyingBlock {
  startDate: string
  endDate: string
}

/**
 * Días `YYYY-MM-DD` de `[start, end)` — el día de `end` NO se incluye (semántica de estadía:
 * quien se va el 10 no ocupa la noche del 10).
 */
export function eachDayExclusive(start: string, end: string): string[] {
  const days: string[] = []
  const from = Date.parse(`${String(start).slice(0, 10)}T00:00:00Z`)
  const to = Date.parse(`${String(end).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return days
  for (let t = from; t < to; t += MS_PER_DAY) days.push(new Date(t).toISOString().slice(0, 10))
  return days
}

/**
 * Días `YYYY-MM-DD` de `[start, end]` — ambos extremos incluidos. Lo usa el calendario público:
 * ahí cada día es una CELDA que se pinta (una noche vendible), no un rango de estadía.
 */
export function eachDayInclusive(start: string, end: string): string[] {
  return eachDayExclusive(start, addDays(end, 1))
}

/** Suma `n` días a una fecha `YYYY-MM-DD` en UTC (sin líos de timezone / DST). */
export function addDays(date: string, n: number): string {
  const t = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(t)) return String(date).slice(0, 10)
  return new Date(t + n * MS_PER_DAY).toISOString().slice(0, 10)
}

/** Días enteros entre dos fechas `YYYY-MM-DD` (b - a). Negativo si b < a. */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`)
  const tb = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return NaN
  return Math.round((tb - ta) / MS_PER_DAY)
}

/**
 * `available[día] = count − ocupadas`, clampeado a 0 (overbook → 0).
 * Ocupación del día D:
 *  - Reserva: `checkIn <= D < checkOut` (el día de salida queda libre — turnover).
 *  - Bloqueo: `startDate <= D <= endDate` (inclusivo — bloquea de inicio a fin).
 *
 * Los arrays llegan YA FILTRADOS por el caller (room type, estado de reserva, hotel).
 */
export function computeDailyAvailability(
  days: string[],
  count: number,
  reservations: OccupyingReservation[],
  blocks: OccupyingBlock[],
): DailyAvailability[] {
  return days.map((d) => {
    let occupied = 0
    for (const r of reservations) if (r.checkIn <= d && r.checkOut > d) occupied++
    for (const b of blocks) if (b.startDate <= d && b.endDate >= d) occupied++
    return { date: d, available: Math.max(0, count - occupied) }
  })
}

/** Comprime días consecutivos de igual disponibilidad (run-length encoding). */
export function compressToRanges(perDay: DailyAvailability[]): AvailabilityRange[] {
  const ranges: AvailabilityRange[] = []
  for (const a of perDay) {
    const last = ranges[ranges.length - 1]
    if (last && last.availability === a.available) last.dateTo = a.date
    else ranges.push({ dateFrom: a.date, dateTo: a.date, availability: a.available })
  }
  return ranges
}

/**
 * Rangos comprimidos de disponibilidad para `[start, end)`. Firma histórica (canales/Channex).
 */
export function computeAvailabilityRanges(
  start: string,
  end: string,
  count: number,
  reservations: OccupyingReservation[],
  blocks: OccupyingBlock[],
): AvailabilityRange[] {
  return compressToRanges(computeDailyAvailability(eachDayExclusive(start, end), count, reservations, blocks))
}

/** Habitaciones del tipo pedido (comparación case-insensitive, igual que el push a Channex). */
export function roomsOfType<R extends { type: string }>(roomType: string, rooms: R[]): R[] {
  const want = String(roomType).toLowerCase()
  return rooms.filter((r) => String(r.type).toLowerCase() === want)
}

/** Criterio por defecto de canales: ocupa todo lo que no esté cancelado. */
const NOT_CANCELLED = (status: string): boolean => status !== 'cancelled'

/**
 * Filtra rooms/reservas/bloqueos del roomType indicado y devuelve los rangos de availability
 * para hoy → +horizonDays. Default 90 (delta por evento); el full sync de certificación pide 500.
 * Devuelve null si el hotel no tiene rooms de ese tipo (nada que empujar).
 *
 * `isBlockingStatus` decide qué reserva ocupa. Default = criterio de canales (≠ 'cancelled').
 */
export function buildAvailabilityRanges(
  roomType: string,
  rooms: { id: string; type: string }[],
  reservations: { roomId: string; status: string; checkIn: string; checkOut: string }[],
  blocks: { roomId: string; startDate: string; endDate: string }[],
  isBlockingStatus: (status: string) => boolean = NOT_CANCELLED,
  horizonDays: number = AVAILABILITY_HORIZON_DAYS,
): AvailabilityRange[] | null {
  const typeRooms = roomsOfType(roomType, rooms)
  if (typeRooms.length === 0) return null
  const typeRoomIds = new Set(typeRooms.map((r) => r.id))

  const today = new Date().toISOString().split('T')[0]!
  const end = new Date(Date.now() + horizonDays * MS_PER_DAY).toISOString().split('T')[0]!

  const relRes = reservations.filter((r) =>
    typeRoomIds.has(r.roomId) && isBlockingStatus(r.status) && r.checkIn && r.checkOut && r.checkIn < end && r.checkOut > today)
  const relBlocks = blocks.filter((b) =>
    typeRoomIds.has(b.roomId) && b.startDate && b.endDate && b.startDate <= end && b.endDate >= today)

  return computeAvailabilityRanges(today, end, typeRooms.length, relRes, relBlocks)
}
