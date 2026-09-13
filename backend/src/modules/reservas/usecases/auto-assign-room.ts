// reservas/usecases/auto-assign-room.ts — Auto-asignación de una unidad por el sistema.
//
// Dos llamadores:
//   · Al NACER una reserva web (widget 1 habitación y grupo) u OTA (ingesta Channex) — connectors
//     `reservas-bookingengine.ts` y `canales-reservas.ts`. Corrección 2026-09-13 a REQ-HAC-05 (#260):
//     la venta sigue siendo por TIPO (`availableOfType`, la fila se inserta con `roomId: null`), pero
//     el hotel quiere ver la habitación asignada en el sistema desde que la reserva entra, no recién
//     al check-in. Recepción la puede cambiar cuando haga falta (`assign-room.ts`, #258) — asignar acá
//     no le quita nada; sólo le ahorra el paso cuando la sugerida sirve.
//   · La víspera de la llegada, con `booking_config.autoAssignBeforeArrivalHours > 0`, el cron de
//     pre-llegada (shared/usecases/prearrival-pass-cron.ts) para las que sigan sin unidad (REQ-HAC-07, #262).
//
// Sin usuario logueado: actúa `system` (queda en `roomAssignedBy` y en la auditoría) con rol NO admin,
// así `assertOwnership` compara de verdad el `hotelId` del llamador con el de la reserva (403 si difieren).
// Delega en `assignRoom`, que valida, audita (`reservation.room_assigned`) y emite `onRoomAssigned`
// (TTLock genera el código sólo si la reserva ya está confirmada/pagada — ver connectors/reservas-ttlock.ts).
//
// Criterio de elección entre las libres del tipo (`listAssignableRooms` ya filtró vendibles, sin
// solape ni bloqueo, y ordenó limpias+available primero):
//   1. que la composición de la reserva ENTRE en la unidad (`fitsRoomCapacity` con la política del
//      tipo o la capacidad física de la unidad; una unidad sin capacidad cargada no descarta);
//   2. con `needsCrib`, una unidad que tenga cuna (`RoomAmenities` activa reconocida por
//      `isCribAmenityKey`) antes que una sin;
//   3. el orden de `listAssignableRooms` (limpia + available, número).
// Si ninguna entra por capacidad, NO se fuerza una chica: queda sin asignar (`no_fit`) para que
// recepción decida — el tipo ya está vendido (HAC-02), así que la banda "Sin asignar" la muestra.

import { assignRoom, listAssignableRooms, CLOSED_STATUSES, type AssignableRoom, type CurrentUser, type RoomAssignmentDeps } from './assign-room'
import { composeFromPersistedReservation, fitsRoomCapacity, resolveChildPolicy } from '../../../shared/usecases/child-composition'
import { effectiveRoomCapacity, resolveRoomTypeCapacityMap } from '../../../shared/usecases/room-type-capacity'
import { isCribAmenityKey } from '../../../shared/usecases/crib-amenity'

export type AutoAssignResult =
  | { assigned: true; roomId: string; roomNumber: string }
  | { assigned: false; reason: 'already_assigned' | 'closed' | 'no_rooms' | 'no_fit' | 'not_found' }

/** `userId` con el que el sistema firma la asignación (roomAssignedBy + audit). */
export const SYSTEM_ASSIGNER = 'system'
/** Rol distinto de `super_admin` a propósito: que el scoping por hotel no se saltee. */
const SYSTEM_ROLE = 'system'

/**
 * Asigna una unidad libre del tipo vendido a una reserva sin habitación (ver criterio arriba).
 * No-op si ya tiene habitación o la estadía está cerrada. No atrapa errores (403 de otro hotel,
 * 409 de solape/tipo en `assignRoom`, etc.): el llamador decide qué hacer con ellos.
 */
export async function autoAssignSuggestedRoom(deps: RoomAssignmentDeps, reservationId: string, hotelId: string): Promise<AutoAssignResult> {
  const user: CurrentUser = { id: SYSTEM_ASSIGNER, role: SYSTEM_ROLE, hotelId }
  const existing: any = await deps.repo.findById(reservationId)
  if (!existing) return { assigned: false, reason: 'not_found' }
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings. Post-findById.
  deps.auth.assertOwnership(existing.hotelId, hotelId, user.role, 'super_admin')
  if (existing.roomId) return { assigned: false, reason: 'already_assigned' }
  if (CLOSED_STATUSES.has(existing.status)) return { assigned: false, reason: 'closed' }

  const candidates = await listAssignableRooms(deps, reservationId, { allTypes: false }, user)
  if (candidates.length === 0) return { assigned: false, reason: 'no_rooms' }

  const candidate = await pickUnit(deps, existing, candidates)
  if (!candidate) return { assigned: false, reason: 'no_fit' }

  await assignRoom(deps, reservationId, { roomId: candidate.id }, user)
  return { assigned: true, roomId: candidate.id, roomNumber: candidate.number }
}

/** Elige la unidad según capacidad → cuna → orden de `listAssignableRooms`. `null` si ninguna entra. */
async function pickUnit(deps: RoomAssignmentDeps, existing: any, candidates: AssignableRoom[]): Promise<AssignableRoom | null> {
  const hotelId = String(existing.hotelId)
  const byId = new Map<string, any>()
  for (const room of (await deps.roomRepo.findMany({ hotelId } as any)) as any[]) byId.set(String(room.id), room)

  const [policy, capacityMap] = await Promise.all([
    resolveChildPolicy(deps.configRepo, hotelId),
    resolveRoomTypeCapacityMap(deps.configRepo, hotelId),
  ])
  const composition = composeFromPersistedReservation(existing, policy)

  const fitting = candidates.filter((c) => {
    const room = byId.get(c.id)
    const physical = Number(room?.capacity)
    // Unidad sin capacidad cargada (o política del tipo ausente y capacidad 0): no hay dato para
    // descartarla — mismo criterio que el panel, que deja asignar cualquier libre del tipo.
    if (!Number.isFinite(physical) || physical <= 0) {
      const typePolicy = room?.type ? capacityMap.get(String(room.type)) : undefined
      return typePolicy ? fitsRoomCapacity(typePolicy, composition) : true
    }
    return fitsRoomCapacity(effectiveRoomCapacity(capacityMap, { type: room?.type, capacity: physical, maxAdults: room?.maxAdults, maxChildren: room?.maxChildren }), composition)
  })
  if (fitting.length === 0) return null

  const needsCrib = existing.needsCrib === true || existing.needsCrib === 1 || Number(existing.cribCount) > 0
  if (!needsCrib || !deps.roomAmenityRepo) return fitting[0]

  const withCrib = await roomsWithCrib(deps, fitting.map((c) => c.id))
  return fitting.find((c) => withCrib.has(c.id)) ?? fitting[0]
}

/** Ids (entre `roomIds`) con al menos una fila `RoomAmenities` activa que sea cuna. */
async function roomsWithCrib(deps: RoomAssignmentDeps, roomIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  // `buildWhere` del ORM sólo arma igualdades (sin IN): una consulta por unidad candidata.
  const rows = await Promise.all(roomIds.map((roomId) => deps.roomAmenityRepo!.findMany({ roomId } as any).catch(() => [] as any[])))
  rows.forEach((amenities, i) => {
    const active = (amenities as any[]).filter((a) => a.isActive !== false && a.isActive !== 0)
    if (active.some((a) => isCribAmenityKey(a.amenityKey, a.name))) out.add(roomIds[i])
  })
  return out
}
