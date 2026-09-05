// habitaciones/usecases/assert-deletable.ts — Integridad referencial al borrar una habitación.
//
// A-1 (auditoría 2026-08-19). El ORM crea las tablas SIN FKs físicos y borra con DELETE FROM crudo:
// sin este guard, borrar dejaba reservas activas, cerraduras TTLock, blocks y amenities apuntando a
// una habitación inexistente, y planning/detalle/checkout rompían en silencio.
//
// Acceso por nombre de modelo global (patrón bookingengine — el ORM ya estaba cableado en el service
// para la transacción de batch). Sin `orm` (tests mínimos) el delete sigue como antes.

import { ConflictError } from 'arckode-framework'
import type { ORM } from 'arckode-framework'

/** Estados que NO bloquean el borrado: la habitación ya no los está sirviendo. */
const INACTIVE = ['cancelled', 'no_show', 'checked_out']

/**
 * Corta el borrado si la habitación todavía tiene algo vivo colgando, y limpia las referencias que
 * no valen nada sin ella (bloqueos y amenities de un cuarto que ya no existe).
 */
export async function assertRoomDeletable(orm: ORM | undefined, roomId: string): Promise<void> {
  if (!orm) return
  const reservas = (await orm.findMany('Reservations', { roomId })) as any[]
  const activas = reservas.filter((r) => !INACTIVE.includes(String(r.status)))
  if (activas.length > 0) {
    throw new ConflictError(`No se puede eliminar: la habitación tiene ${activas.length} reserva(s) activa(s). Cancelá o mové las reservas primero (el historial pasado no bloquea).`)
  }
  const locks = (await orm.findMany('LockDevices', { roomId })) as any[]
  if (locks.length > 0) {
    throw new ConflictError('No se puede eliminar: hay cerraduras TTLock vinculadas a esta habitación. Desvinculalas primero desde la vista de cerraduras.')
  }
  await orm.deleteMany('RoomBlocks', { roomId }).catch(() => 0)
  await orm.deleteMany('RoomAmenities', { roomId }).catch(() => 0)
}
