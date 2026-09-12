// shared/usecases/reservation-group-rows.ts — Filas sobre las que se calcula la plata de un correo.
//
// Una reserva del motor público puede ser una de GRUPO (varias habitaciones, una por fila,
// unidas por `groupId`): el total que ve el huésped es la suma de las hermanas vivas, no el de la
// líder sola. `booking-paid-email.ts` (#276 MR-11) y `booking-received-unpaid-email.ts` (#267)
// arman el monto con la misma regla, así que vive acá una sola vez.

import type { RepositoryAdapter, Logger } from 'arckode-framework'

/**
 * La reserva sola, o ella más sus hermanas no canceladas si pertenece a un grupo. Best-effort:
 * si la consulta falla, se usa sólo la reserva. La líder siempre está (Map por id).
 * `label` identifica al llamador en el log.
 */
export async function reservationGroupRows(
  reservationsRepo: RepositoryAdapter<any>,
  reservation: any,
  logger: Logger,
  label: string,
): Promise<any[]> {
  if (!reservation.groupId) return [reservation]
  const byId = new Map<string, any>([[String(reservation.id), reservation]])
  try {
    const siblings = await reservationsRepo.findMany({
      hotelId: reservation.hotelId, groupId: reservation.groupId,
    })
    for (const s of siblings ?? []) {
      if (!s || s.status === 'cancelled') continue
      byId.set(String(s.id), s)
    }
  } catch (e) {
    logger.warn(`${label}: no se pudieron cargar las hermanas del grupo`, {
      reservationId: reservation.id, groupId: reservation.groupId, error: (e as Error).message,
    })
  }
  return [...byId.values()]
}
