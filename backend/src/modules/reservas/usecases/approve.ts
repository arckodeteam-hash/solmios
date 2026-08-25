// reservas/usecases/approve.ts — Aprobación manual de una reserva pública (Tarea 3.4,
// corrección 2026-08-25).
//
// Cuando el hotel apaga "Confirmación instantánea" (booking_config.instantConfirmation),
// `createPublicBookingDirect`/`createPublicBookingGroup` (bookingengine) crean la reserva con
// `approvalStatus: 'pending'` — la reserva YA ocupa la habitación y YA cobró (eso no cambia:
// `status` sigue su ciclo normal), pero queda marcada para que un humano del hotel la revise
// antes de darla por buena. Este usecase es ese "dar por buena": solo mueve
// `approvalStatus: 'pending' → 'approved'`. No toca `status`, folio, ni disponibilidad.
import { ConflictError, NotFoundError } from 'arckode-framework'
import type { Auth, CacheAdapter, RepositoryAdapter } from 'arckode-framework'
import { invalidateReservasCaches } from './cache'

export interface ApproveReservationDeps {
  repo: RepositoryAdapter<any>
  cache: CacheAdapter
}

/**
 * Aprueba una reserva pendiente de revisión del hotel.
 * 404 si no existe o es de otro hotel (ownership). 409 si la reserva no tiene nada pendiente
 * de aprobar (`approvalStatus` no es `'pending'`) — no hay nada que "aprobar dos veces".
 */
export async function approveReservation(
  deps: ApproveReservationDeps,
  id: string,
  currentUser: { id: string; role: string; hotelId?: string },
  auth: Auth,
): Promise<any> {
  const item = await deps.repo.findById(id)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings (mem
  // ownership-bug). Post-findById obligatorio (regla CLAUDE.md + analyzer).
  auth.assertOwnership(item.hotelId, currentUser.hotelId ?? '', currentUser.role, 'super_admin')

  if (item.approvalStatus !== 'pending') {
    throw new ConflictError('Esta reserva no tiene una aprobación pendiente')
  }

  const updated = await deps.repo.update(id, { approvalStatus: 'approved' })
  // Sin esto, el listado del panel (`reservasListCacheKey`, TTL 300s) seguía sirviendo la
  // versión con `approvalStatus: 'pending'` — el badge/KPI "Por aprobar" no bajaba tras
  // aprobar hasta que el cache expirara solo. Mismo patrón que crud.ts/cancel-core.ts.
  await invalidateReservasCaches(deps.cache, item.hotelId)
  return updated
}
