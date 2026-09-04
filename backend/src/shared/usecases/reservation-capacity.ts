// shared/usecases/reservation-capacity.ts — Auditoría de integridad (cierre, 2026-09-04).
//
// Hallazgo: `POST/PUT /api/reservas` (Administración manual) y los agentes de IA (`ai-gerente`,
// `ai-recepcionista`, que escriben directo con `reservationRepo.create`) podían crear/editar una
// reserva que excede la capacidad real de la habitación — sin ningún aviso. El motor público
// (`bookingengine/usecases/public-booking{,-group}.ts`) y el reagendado (`reservas/usecases/
// reschedule.ts`) ya validan esto; el panel y los agentes nunca lo hicieron.
//
// Decisión de producto (explícita, no inventada acá): el staff DEBE respetar `capacity`/
// `maxAdults`/`maxChildren` — sin excepción, sin override/overbooking manual en esta tarea. La
// excepción de `child_policy` (reclasificación de edad) para el panel SIGUE vigente (ver
// `validators/schema.ts`) — esta validación es de CAPACIDAD, un eje distinto.
//
// Reutiliza EXACTAMENTE lo que ya usa el flujo público: `fitsRoomCapacity`/`effectiveRoomCapacity`
// (capacidad por tipo, `room_type_capacity`) — cero reglas nuevas, cero copias.

import { ConflictError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { resolveChildPolicy, resolveAdminCapacityComposition, fitsRoomCapacity } from './child-composition'
import { resolveRoomTypeCapacityMap, effectiveRoomCapacity } from './room-type-capacity'

export interface ReservationCapacityParams {
  hotelId: string
  adults: number
  children: number
  /** Presente y no vacío → composición real (`resolveChildComposition`). Ausente/vacío → cada
   *  niño declarado consume plaza, conservador (ver `resolveAdminCapacityComposition`). */
  childrenAges?: readonly unknown[] | null
}

/**
 * Valida que `params` entre en `room` — misma composición/capacidad que el motor público, con el
 * fallback conservador de `resolveAdminCapacityComposition` cuando no hay `childrenAges`.
 *
 * `room` YA RESUELTO por el caller (no lo fetchea esta función): cada caller ya tiene su propio
 * fetch de la habitación para otras validaciones (pertenencia al hotel, disponibilidad) — pedirlo
 * de nuevo acá sería una query redundante. `room` ausente/null → no-op (el caller ya rechazó la
 * reserva por "habitación no encontrada" antes de llegar acá; esta función no duplica ese error).
 */
export async function assertReservationFitsCapacity(
  configRepo: RepositoryAdapter<any> | undefined,
  room: { type?: string | null; capacity?: number | null; maxAdults?: number | null; maxChildren?: number | null } | null | undefined,
  params: ReservationCapacityParams,
): Promise<void> {
  if (!room) return
  const [policy, roomTypeCapacityMap] = await Promise.all([
    resolveChildPolicy(configRepo, params.hotelId),
    resolveRoomTypeCapacityMap(configRepo, params.hotelId),
  ])
  const composition = resolveAdminCapacityComposition(params.adults, params.children, params.childrenAges, policy)
  const capacity = effectiveRoomCapacity(roomTypeCapacityMap, {
    type: room.type, capacity: Number(room.capacity) || composition.chargeableOccupancy,
    maxAdults: room.maxAdults, maxChildren: room.maxChildren,
  })
  if (!fitsRoomCapacity(capacity, composition)) {
    throw new ConflictError(`Esta habitación admite hasta ${capacity.capacity} huésped(es); la reserva tiene ${composition.chargeableOccupancy}`)
  }
}
