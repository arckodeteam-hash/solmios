// reservas/usecases/type-availability-list.ts — Disponibilidad por TIPO para el wizard del panel
// (REQ-HAC-05, #260): GET /api/reservas/type-availability?hotelId=&checkIn=&checkOut=.
//
// Desde HAC-05 el alta del panel vende un TIPO y la unidad se asigna después: el wizard necesita
// ver, para cada tipo del hotel, cuántas unidades quedan noche a noche antes de elegir. La cuenta
// es la MISMA que usa `createReservation` para rebotar con `type_sold_out`
// (`shared/usecases/type-availability.ts`, fuente única) — lo que el wizard muestra es exactamente
// lo que el alta va a aceptar. No escribe nada.
//
// Se lee UNA vez por hotel (`rooms`, `reservations`, `blocks`) y se cuenta en memoria por tipo con
// `countAvailableOfType` (pura): N tipos no son N×3 consultas. El volumen es el mismo que
// `availableOfType` por tipo, que trae todas las reservas del tipo sin acotar por fecha.

import { ConflictError } from 'arckode-framework'
import {
  countAvailableOfType,
  roomTypeProfileOf,
  type TypeAvailabilityPort,
  type TypeNightAvailability,
} from '../../../shared/usecases/type-availability'

export interface TypeAvailabilityListParams {
  hotelId: string
  checkIn: string
  checkOut: string
  /** Al editar una reserva: no contarla a sí misma. */
  excludeReservationId?: string
}

/** Una fila por tipo distinto de `Rooms {hotelId}`, ordenadas por `roomType`. */
export interface TypeAvailabilityItem {
  roomType: string
  /** Unidades VENDIBLES del tipo (las que están en mantenimiento no cuentan). */
  rooms: number
  /** Máximo de unidades tomadas en una noche de la estadía. */
  booked: number
  /** Mínimo de `rooms − booked` entre las noches: la reserva entra si `available ≥ 1`. */
  available: number
  perNight: TypeNightAvailability[]
  /** Mínimo `basePrice` > 0 entre las unidades vendibles (el "desde"); 0 si ninguna tiene precio. */
  minBasePrice: number
  /** Capacidad MÁXIMA entre las unidades vendibles (entra si entra en alguna). */
  capacity: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function listTypeAvailability(port: TypeAvailabilityPort, params: TypeAvailabilityListParams): Promise<TypeAvailabilityItem[]> {
  const { hotelId, checkIn, checkOut } = params
  if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) throw new ConflictError('Fechas inválidas (YYYY-MM-DD)')
  if (checkIn >= checkOut) throw new ConflictError('checkIn debe ser anterior a checkOut')

  const [rooms, reservations, blocks] = await Promise.all([
    port.rooms.findMany({ hotelId }),
    port.reservations.findMany({ hotelId }),
    port.blocks ? port.blocks.findMany({ hotelId }) : Promise.resolve([] as any[]),
  ])
  const allRooms = (rooms ?? []).filter((r: any) => r && r.type != null && String(r.type) !== '')
  // Tipos distintos SIN distinguir mayúsculas (`roomsOfType`/`reservationOccupiesType` comparan en
  // minúsculas): "Doble" y "doble" son el mismo inventario y saldrían dos veces con las mismas cuentas.
  const byLower = new Map<string, string>()
  for (const r of allRooms) {
    const t = String(r.type)
    if (!byLower.has(t.toLowerCase())) byLower.set(t.toLowerCase(), t)
  }
  const types = Array.from(byLower.values()).sort((a, b) => a.localeCompare(b))
  const opts = params.excludeReservationId ? { excludeReservationId: params.excludeReservationId } : {}

  return types.map((roomType) => {
    const avail = countAvailableOfType(roomType, allRooms, reservations ?? [], blocks ?? [], checkIn, checkOut, opts)
    const profile = roomTypeProfileOf(roomType, avail.sellableRooms)
    return {
      roomType,
      rooms: avail.rooms,
      booked: avail.booked,
      available: avail.available,
      perNight: avail.perNight,
      minBasePrice: profile.minBasePrice,
      capacity: profile.capacity,
    }
  })
}
