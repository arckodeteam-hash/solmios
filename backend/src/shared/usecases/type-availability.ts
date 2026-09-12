// shared/usecases/type-availability.ts — Disponibilidad por TIPO de habitación. Fuente ÚNICA (REQ-HAC-02).
//
// Desde HAC-01 (#256) la habitación se asigna al check-in: una reserva `confirmed` puede vivir
// con `roomId` null y sólo `roomType`. El chequeo histórico ("¿hay alguna unidad del tipo sin
// una reserva solapada?") mira reserva-por-habitación, así que una reserva sin unidad NO la ve:
// con 3 unidades y 3 confirmadas sin asignar seguía diciendo que las 3 estaban libres y se
// vendía de más. Los callers (widget, grupo, alta desde el panel, reschedule, ingesta OTA)
// tenían además cada uno su propia copia del criterio, y no coincidían.
//
// Acá la pregunta cambia de unidad a inventario: `available = rooms − booked` por noche, donde
// `rooms` son las unidades VENDIBLES del tipo (`isRoomSellable`) y `booked` cuenta reservas
// bloqueantes del tipo — asignadas o no — más bloqueos (`room_blocks`). Una estadía de `n`
// habitaciones entra si `min(available por noche) ≥ n`.
//
// El solape POR HABITACIÓN (qué unidad concreta está libre) ya no es una pregunta de venta:
// queda sólo en `reservas/usecases/assign-room.ts`, al momento de asignar. `busyRoomIds` se
// devuelve para los callers que todavía eligen unidad física (ingesta OTA), no para decidir si
// se vende.
//
// Regla de arquitectura: `shared` no importa `modules/`. Los primitivos día a día viven en
// `shared/utils/daily-availability.ts` (compartidos con el push ARI de canales y el calendario
// público); acá sólo se los compone para una estadía concreta.
import {
  computeDailyAvailability,
  eachDayExclusive,
  reservationOccupiesType,
  roomsOfType,
  type AvailabilityReservation,
} from '../utils/daily-availability'
import { isRoomSellable } from './room-status'

/**
 * Estados de reserva que consumen inventario. Es la misma whitelist que aplicaba el motor
 * público (`bookingengine/usecases/availability.ts`): `cancelled`, `no_show` y `checked_out`
 * liberan la unidad; todo lo demás la retiene.
 */
export const BLOCKING_RESERVATION_STATUS: ReadonlySet<string> = new Set(['pending', 'confirmed', 'checked_in', 'guaranteed'])

/**
 * ¿La reserva ocupa? Un `status` vacío o null cuenta como BLOQUEANTE a propósito (criterio
 * heredado del motor público): un dato incompleto no debe liberar inventario en silencio.
 * Comparación en minúsculas — hay filas con el estado en mayúsculas.
 */
export function isBlockingStatus(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase()
  if (s && !BLOCKING_RESERVATION_STATUS.has(s)) return false
  return true
}

/** Reserva mínima para `stayOverlaps`: estado + rango de estadía. */
export interface StayCandidate {
  status?: string | null
  checkIn?: string | null
  checkOut?: string | null
}

/**
 * Estado que ocupa + solape con `[checkIn, checkOut)` — el día de salida no cuenta (turnover).
 * Las fechas se recortan a `YYYY-MM-DD` (hay filas con hora). Sin fechas → no solapa.
 */
export function stayOverlaps(r: StayCandidate, checkIn: string, checkOut: string): boolean {
  if (!isBlockingStatus(r.status)) return false
  const from = String(r.checkIn ?? '').slice(0, 10)
  const to = String(r.checkOut ?? '').slice(0, 10)
  const start = String(checkIn ?? '').slice(0, 10)
  const end = String(checkOut ?? '').slice(0, 10)
  if (!from || !to || !start || !end) return false
  return from < end && to > start
}

export interface TypeAvailabilityOpts {
  /** Reserva que se está modificando (reschedule / cambio de tipo): no se cuenta a sí misma. */
  excludeReservationId?: string
}

/** Una noche de la estadía: cuántas unidades del tipo están tomadas y cuántas quedan. */
export interface TypeNightAvailability {
  date: string
  booked: number
  available: number
}

export interface TypeAvailabilityResult {
  /** Unidades VENDIBLES del tipo (`isRoomSellable(status)`): las que están en mantenimiento no cuentan. */
  rooms: number
  /** Máximo de unidades tomadas en una noche de la estadía. */
  booked: number
  /** Mínimo de `rooms − booked` entre las noches (0 si no hay noches). La estadía de `n` entra si `available ≥ n`. */
  available: number
  /** Detalle noche a noche (`eachDayExclusive(checkIn, checkOut)`). */
  perNight: TypeNightAvailability[]
  /** Unidades vendibles del tipo, filas completas (para quien necesita precio/capacidad/id). */
  sellableRooms: any[]
  /**
   * Ids de unidades del tipo con una reserva bloqueante ASIGNADA que solapa la estadía (sin
   * `excludeReservationId`). Sólo para los callers que aún eligen unidad física; NO decide venta.
   */
  busyRoomIds: Set<string>
}

/** Bloqueo de una unidad (`room_blocks`): `[startDate, endDate]` inclusivo. */
export interface TypeAvailabilityBlock {
  roomId: string
  startDate: string
  endDate: string
}

/** Reserva tal como la cuenta la disponibilidad por tipo. */
export interface TypeAvailabilityReservation extends AvailabilityReservation {
  id?: string
}

/**
 * Disponibilidad del tipo `roomType` para la estadía `[checkIn, checkOut)`. Función PURA:
 * filtra EN MEMORIA por tipo, así que los callers pueden pasar todas las filas del hotel (y los
 * mocks de tests devolver todo ignorando filtros).
 *
 * Por noche: `booked` = reservas que la ocupan (`checkIn <= d < checkOut`) + bloqueos
 * (`startDate <= d <= endDate`); `available = max(0, rooms − booked)`.
 *
 * Reservas: `reservationOccupiesType` contra los ids de TODAS las unidades del tipo — también
 * las que están en mantenimiento: una reserva asignada a una unidad fuera de servicio igual
 * consume una del tipo (no se la puede mover a otra sin que alguien lo decida). `rooms`, en
 * cambio, sólo cuenta las vendibles. Bloqueos: los de una unidad del tipo.
 */
export function countAvailableOfType(
  roomType: string,
  rooms: any[],
  reservations: TypeAvailabilityReservation[],
  blocks: TypeAvailabilityBlock[],
  checkIn: string,
  checkOut: string,
  opts: TypeAvailabilityOpts = {},
): TypeAvailabilityResult {
  const typeRooms = roomsOfType(roomType, (rooms ?? []).filter((r) => r && r.type != null))
  const typeRoomIds: ReadonlySet<string> = new Set(typeRooms.map((r) => String(r.id)))
  const sellableRooms = typeRooms.filter((r) => isRoomSellable(r.status))
  const exclude = opts.excludeReservationId

  // Fechas recortadas a `YYYY-MM-DD`: hay filas con hora (`2026-10-10T00:00:00.000Z`) y la
  // cuenta por noche compara strings — sin recortar, la noche del propio check-in quedaba libre.
  const day = (v: unknown): string => String(v ?? '').slice(0, 10)
  const relRes = (reservations ?? [])
    .filter((r) =>
      r && !(exclude && r.id === exclude)
      && r.checkIn && r.checkOut
      && reservationOccupiesType(r, roomType, typeRoomIds, isBlockingStatus))
    .map((r) => ({ ...r, checkIn: day(r.checkIn), checkOut: day(r.checkOut) }))
  const relBlocks = (blocks ?? [])
    .filter((b) => b && typeRoomIds.has(String(b.roomId)) && b.startDate && b.endDate)
    .map((b) => ({ ...b, startDate: day(b.startDate), endDate: day(b.endDate) }))

  const days = eachDayExclusive(checkIn, checkOut)
  const nightly = computeDailyAvailability(days, sellableRooms.length, relRes, relBlocks)
  const perNight: TypeNightAvailability[] = nightly.map((n) => ({
    date: n.date,
    booked: bookedOn(n.date, relRes, relBlocks),
    available: n.available,
  }))

  const booked = perNight.reduce((max, n) => Math.max(max, n.booked), 0)
  const available = perNight.length === 0 ? 0 : perNight.reduce((min, n) => Math.min(min, n.available), Infinity)

  const busyRoomIds = new Set<string>()
  for (const r of relRes) {
    if (r.roomId && typeRoomIds.has(String(r.roomId)) && stayOverlaps(r, checkIn, checkOut)) busyRoomIds.add(String(r.roomId))
  }

  return { rooms: sellableRooms.length, booked, available, perNight, sellableRooms, busyRoomIds }
}

/** Unidades tomadas la noche `d` (misma regla que `computeDailyAvailability`, sin el clamp). */
function bookedOn(d: string, reservations: TypeAvailabilityReservation[], blocks: TypeAvailabilityBlock[]): number {
  let n = 0
  for (const r of reservations) if (r.checkIn <= d && r.checkOut > d) n++
  for (const b of blocks) if (b.startDate <= d && b.endDate >= d) n++
  return n
}

/** Repos mínimos que necesita `availableOfType`. `blocks` es opcional (hoteles sin `room_blocks`). */
export interface TypeAvailabilityPort {
  rooms: { findMany(q: any): Promise<any[]> }
  reservations: { findMany(q: any): Promise<any[]> }
  blocks?: { findMany(q: any): Promise<any[]> }
}

/** Port a partir del ORM del framework (modelos `Rooms`, `Reservations`, `RoomBlocks`). */
export function typeAvailabilityPortFromOrm(orm: { findMany(model: string, q: any): Promise<any[]> }): TypeAvailabilityPort {
  return {
    rooms: { findMany: (q) => orm.findMany('Rooms', q) },
    reservations: { findMany: (q) => orm.findMany('Reservations', q) },
    blocks: { findMany: (q) => orm.findMany('RoomBlocks', q) },
  }
}

/**
 * `countAvailableOfType` leyendo de los repos. Consultas ACOTADAS por hotel y tipo — nunca la
 * tabla entera: `rooms {hotelId, type}`, `reservations {hotelId, roomType}` (el índice de
 * `roomType` existe para esto), `blocks {hotelId}`. Los repos pueden devolver null/undefined.
 *
 * Nota: la consulta por `roomType` depende del backfill de HAC-01
 * (`scripts/backfill-reservation-room-type.ts`): una fila vieja con unidad asignada y sin
 * `roomType` no entra en el resultado. El filtro en memoria de `countAvailableOfType` sigue
 * siendo por unidad, así que pasarle todas las reservas del hotel también es correcto.
 */
export async function availableOfType(
  port: TypeAvailabilityPort,
  hotelId: string,
  roomType: string,
  checkIn: string,
  checkOut: string,
  opts: TypeAvailabilityOpts = {},
): Promise<TypeAvailabilityResult> {
  const [rooms, reservations, blocks] = await Promise.all([
    port.rooms.findMany({ hotelId, type: roomType }),
    port.reservations.findMany({ hotelId, roomType }),
    port.blocks ? port.blocks.findMany({ hotelId }) : Promise.resolve([] as any[]),
  ])
  return countAvailableOfType(roomType, rooms ?? [], reservations ?? [], blocks ?? [], checkIn, checkOut, opts)
}
