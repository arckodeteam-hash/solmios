// connectors/reservas-notificaciones.ts — Wire: reservas → notificaciones (#271, MR-06).
//
// Cuando el hotel aprueba una reserva web pendiente de revisión, la campanita "Nueva reserva
// web" que le avisó (bookingengine-notificaciones → notifyReservationReceived) ya no tiene
// sentido: se marca como leída para que el contador baje sin que alguien tenga que buscarla.
//
// Sólo wirea: la lógica (filtrar por `metadata.reservationId`, marcar `read: 1`) vive en
// reservas/usecases/approve.ts (`closeReservationNotifications`). Se habla con el MÓDULO
// `notificaciones` (list/update con un actor de sistema), nunca con su tabla, y se resuelve en cada
// aprobación, no al cablear (mismo criterio que bookingengine-notificaciones). Best-effort: el
// usecase `approveReservation` envuelve la llamada en try/catch + warn; un fallo acá no deshace nada.

import type { ConnectorContext } from 'arckode-framework'
import { closeReservationNotifications, type HotelNotificationsPort } from '../modules/reservas/usecases/approve'

export function reservasNotificacionesConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<{ setOrchestrationDeps: (deps: any) => void }>('reservas')

  reservas.setOrchestrationDeps({
    closeApprovalNotifications: (hotelId: string, reservationId: string) => {
      const notificaciones = ctx.resolveModule<Omit<HotelNotificationsPort, 'listUsers'>>('notificaciones')
      const usuarios = ctx.resolveModule<{ list(hotelId?: string): Promise<Array<{ id: string }>> }>('usuarios')
      return closeReservationNotifications({ list: (q, u) => notificaciones.list(q, u), update: (id, dto, u) => notificaciones.update(id, dto, u), listUsers: (h) => usuarios.list(h) }, hotelId, reservationId)
    },
  })
}
