// reservas/usecases/approve.ts — Aprobación manual de una reserva pública (Tarea 3.4,
// corrección 2026-08-25).
//
// Cuando el hotel apaga "Confirmación instantánea" (booking_config.instantConfirmation),
// `createPublicBookingDirect`/`createPublicBookingGroup` (bookingengine) crean la reserva con
// `approvalStatus: 'pending'` — la reserva YA ocupa la habitación y YA cobró (eso no cambia:
// `status` sigue su ciclo normal), pero queda marcada para que un humano del hotel la revise
// antes de darla por buena. Este usecase es ese "dar por buena": solo mueve
// `approvalStatus: 'pending' → 'approved'`. No toca `status`, folio, ni disponibilidad.
//
// #271 (MR-06): tras aprobar, dos efectos blandos que NUNCA deshacen la aprobación:
//   · email `reservation_approved` al huésped (usecases/approval-email.ts, fire-and-forget);
//   · cierra la campanita del hotel ("Nueva reserva web" pendiente de revisar) — el connector
//     `reservas-notificaciones` marca como leídas las notificaciones de la reserva.
import { ConflictError, NotFoundError } from 'arckode-framework'
import type { Auth, CacheAdapter, Logger, RepositoryAdapter } from 'arckode-framework'
import { invalidateReservasCaches } from './cache'
import type { RejectNotifyPort } from './reject'

export interface ApproveReservationDeps {
  repo: RepositoryAdapter<any>
  cache: CacheAdapter
  logger?: Logger
  /** Email al huésped (approval-email.ts). Fire-and-forget: su falla no rompe la aprobación. */
  notifyGuest?: RejectNotifyPort
  /** connectors/reservas-notificaciones.ts — marca leídas las campanitas de esta reserva. Best-effort. */
  closeHotelNotifications?: (hotelId: string, reservationId: string) => Promise<void>
}

interface SystemActor { id: string; role: string; hotelId?: string }

/** Lo que `closeReservationNotifications` usa del módulo `notificaciones` (acciones públicas, no su tabla). */
export interface HotelNotificationsPort {
  list(query: Record<string, unknown>, user: SystemActor): Promise<{ data: Array<Record<string, any>> }>
  update(id: string, dto: Record<string, unknown>, user: SystemActor): Promise<unknown>
  /** Usuarios del hotel (módulo `usuarios`): las campanitas de reserva son POR USUARIO (una fila por viewer). */
  listUsers(hotelId: string): Promise<Array<{ id: string }>>
}

/** `metadata` sale del ORM como objeto (type 'json') pero puede venir serializada de una fila vieja. */
function metadataOf(n: Record<string, any>): Record<string, unknown> {
  const m = n?.metadata
  if (!m) return {}
  if (typeof m !== 'string') return typeof m === 'object' ? m : {}
  try { return JSON.parse(m) ?? {} } catch { return {} }
}

/**
 * Marca leídas las campanitas "Nueva reserva web" del hotel para esta reserva (las crea
 * notifyReservationReceived con `type: 'reservation'` y `metadata.reservationId`, UNA FILA POR
 * USUARIO con permiso). `notificaciones.list` scopea en memoria a "broadcast + las del target
 * (`query.userId`)": con el actor de sistema solo devolvería los broadcast, así que se consulta
 * por cada usuario del hotel. El filtro por reserva es en memoria: `metadata` es JSON y el ORM no
 * lo filtra por WHERE; el volumen por hotel es acotado. Lo cablea connectors/reservas-notificaciones.ts.
 */
export async function closeReservationNotifications(port: HotelNotificationsPort, hotelId: string, reservationId: string): Promise<void> {
  const actor: SystemActor = { id: 'system', role: 'super_admin', hotelId }
  const users = await port.listUsers(hotelId)
  const seen = new Set<string>()
  for (const u of users) {
    const { data } = await port.list({ hotelId, type: 'reservation', userId: String(u.id), limit: 100 }, actor)
    for (const n of data) {
      const id = String(n.id)
      if (seen.has(id) || n.read || String(metadataOf(n).reservationId ?? '') !== reservationId) continue
      seen.add(id)
      await port.update(id, { read: 1 }, actor)
    }
  }
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

  // Efectos blandos (#271): la reserva YA está aprobada; nada de esto la deshace.
  deps.notifyGuest?.({
    reservationId: String(item.id),
    hotelId: String(item.hotelId),
    guestId: item.guestId ?? undefined,
    roomId: item.roomId ?? undefined,
    checkIn: String(item.checkIn ?? ''),
    checkOut: String(item.checkOut ?? ''),
    event: 'reservation_approved',
    variables: {},
  }).catch((e: any) => deps.logger?.warn(`approve: falló el email al huésped de ${item.id}: ${e?.message ?? e}`))
  try {
    await deps.closeHotelNotifications?.(String(item.hotelId), String(item.id))
  } catch (e: any) {
    deps.logger?.warn(`approve: no se pudo cerrar la campanita de ${item.id}: ${e?.message ?? e}`)
  }
  return updated
}
