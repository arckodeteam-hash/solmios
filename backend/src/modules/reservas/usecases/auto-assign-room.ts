// reservas/usecases/auto-assign-room.ts — Auto-asignación de la habitación sugerida (REQ-HAC-07, #262).
//
// La víspera de la llegada, con `booking_config.autoAssignBeforeArrivalHours > 0`, el cron de
// pre-llegada (shared/usecases/prearrival-pass-cron.ts) asigna la sugerida de `listAssignableRooms`
// a las reservas confirmadas sin unidad para poder mandar el pase COMPLETO con código de cerradura.
// Sin usuario logueado: actúa `system` (queda en `roomAssignedBy` y en la auditoría) con rol NO admin,
// así `assertOwnership` compara de verdad el `hotelId` del cron con el de la reserva (403 si difieren).
// Delega en `assignRoom`, que valida, audita (`reservation.room_assigned`) y emite `onRoomAssigned`.

import { assignRoom, listAssignableRooms, CLOSED_STATUSES, type CurrentUser, type RoomAssignmentDeps } from './assign-room'

export type AutoAssignResult =
  | { assigned: true; roomId: string; roomNumber: string }
  | { assigned: false; reason: 'already_assigned' | 'closed' | 'no_rooms' | 'not_found' }

/** `userId` con el que el sistema firma la asignación (roomAssignedBy + audit). */
export const SYSTEM_ASSIGNER = 'system'
/** Rol distinto de `super_admin` a propósito: que el scoping por hotel no se saltee. */
const SYSTEM_ROLE = 'system'

/**
 * Asigna la habitación sugerida (o la primera libre del tipo vendido) a una reserva sin unidad.
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
  const candidate = candidates.find((r) => r.suggested) ?? candidates[0]
  if (!candidate) return { assigned: false, reason: 'no_rooms' }

  await assignRoom(deps, reservationId, { roomId: candidate.id }, user)
  return { assigned: true, roomId: candidate.id, roomNumber: candidate.number }
}
