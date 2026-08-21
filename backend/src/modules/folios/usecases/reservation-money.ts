// folios/usecases/reservation-money.ts — Lectura del camino reserva ↔ folio para otros módulos.
//
// `reservas` necesita los folios de una reserva para saber cuánto se cobró, pero la tabla `folios`
// es de ESTE módulo: la lectura vive acá y sale por el puerto que cablea `connectors/reservas-money`
// (regla del proyecto: nunca acceso directo a otro módulo). Antes lo hacía
// `reservas/usecases/reservas-queries.ts` con `orm.findMany('Folios', ...)`.
//
// Sin `user`: el caller no es un request HTTP sino el propio servidor recalculando el saldo de una
// reserva cuya ownership ya validó. El aislamiento lo da el `hotelId` OBLIGATORIO — el
// `reservationId` puede venir de un payload y estos importes son el techo con el que
// `payment-requests` autoriza una Checkout Session de Stripe.

import type { RepositoryAdapter } from 'arckode-framework'
import type { FolioDTO } from '../types'

/** Folios de una reserva. */
export async function foliosOfReservation(
  repo: Pick<RepositoryAdapter<FolioDTO>, 'findMany'>, hotelId: string, reservationId: string,
): Promise<FolioDTO[]> {
  if (!hotelId) throw new Error('folios: foliosOfReservation sin hotelId (multi-tenancy)')
  if (!reservationId) return []
  return await repo.findMany({ hotelId, reservationId } as any)
}

/** Reserva dueña de un folio — camino inverso (COR-1). `null` si el folio no es de este hotel. */
export async function reservationIdOfFolio(
  repo: Pick<RepositoryAdapter<FolioDTO>, 'findMany'>, hotelId: string, folioId: string,
): Promise<string | null> {
  if (!hotelId || !folioId) return null
  const [folio] = await repo.findMany({ id: folioId, hotelId } as any)
  const rid = (folio as any)?.reservationId
  return rid ? String(rid) : null
}
