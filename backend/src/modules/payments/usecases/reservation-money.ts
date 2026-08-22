// payments/usecases/reservation-money.ts — Filas de `payments` colgadas de una reserva.
//
// `payments` es la ÚNICA fuente de verdad del dinero (CLAUDE.md) y la tabla es de este módulo: el
// camino reserva → dinero se lee acá y sale por el puerto de `connectors/reservas-money`. Antes lo
// hacía `reservas/usecases/reservas-queries.ts` con `orm.findMany('Payment', ...)`.

import type { RepositoryAdapter } from 'arckode-framework'
import type { PaymentDTO } from '../types'
import { sumPayments, type PaymentRowLike } from '../../../shared/usecases/reservation-paid'

/** Los tres vínculos de una fila de `payments` con una reserva. */
export interface PaymentReservationRef {
  folioId?: string | null
  invoiceId?: string | null
  /** Vínculo directo — lo escribe `shared/usecases/charge-reschedule-diff.ts` (BUG-ceiling-bypass). */
  reservationId?: string | null
}

/**
 * Cobros colgados de UNO de los vínculos. `hotelId` obligatorio: el id del folio/factura llega
 * desde otra fila y no puede autorizar una lectura cross-tenant. Sin ningún vínculo devuelve vacío
 * — traer la tabla entera del hotel inflaría el saldo de la reserva con plata de todas las demás.
 */
export async function paymentsLinkedTo(
  repo: Pick<RepositoryAdapter<PaymentDTO>, 'findMany'>, hotelId: string, ref: PaymentReservationRef,
): Promise<PaymentDTO[]> {
  if (!hotelId) throw new Error('payments: paymentsLinkedTo sin hotelId (multi-tenancy)')
  const where: Record<string, unknown> = { hotelId }
  if (ref?.folioId) where.folioId = ref.folioId
  else if (ref?.invoiceId) where.invoiceId = ref.invoiceId
  else if (ref?.reservationId) where.reservationId = ref.reservationId
  else return []
  return await repo.findMany(where as any)
}

/**
 * Dinero NETO ya asentado de una reserva por el vínculo DIRECTO (`payments.reservationId`).
 *
 * RTC-7.4: `payment-requests/usecases/clamp-to-ceiling.ts` preguntaba esto con
 * `deps.paidRepos.paymentRepo.findMany({ hotelId, reservationId } as any)`. `paidRepos` es un shim
 * de compatibilidad de `reservas/usecases/money-port.ts` (documentado ahí como tal, sólo para
 * `reservation-paid`): usarlo como repo genérico desde otro módulo reabre la lectura cruda
 * cross-módulo que se cerró por puerto, y el `as any` era el síntoma de que el puerto no tenía la
 * pregunta. La tabla `payments` es de ESTE módulo: la pregunta se contesta acá.
 *
 * NO es `paidForReservation`: eso incluye `reservations.deposit` (un anticipo cargado a mano que el
 * sistema nunca cobró) y el dinero que llega por folio/factura. Acá se pregunta por lo que la
 * reserva tiene asentado a su nombre y no sobrevive a su borrado — ver `assertNoSettledCharge`.
 */
export async function settledNetOfReservation(
  repo: Pick<RepositoryAdapter<PaymentDTO>, 'findMany'>, hotelId: string, reservationId: string,
): Promise<number> {
  if (!hotelId) throw new Error('payments: settledNetOfReservation sin hotelId (multi-tenancy)')
  if (!reservationId) return 0
  const rows = await paymentsLinkedTo(repo, hotelId, { reservationId })
  return sumPayments(rows as PaymentRowLike[])
}
