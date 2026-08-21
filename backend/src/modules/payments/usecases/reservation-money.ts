// payments/usecases/reservation-money.ts — Filas de `payments` colgadas de una reserva.
//
// `payments` es la ÚNICA fuente de verdad del dinero (CLAUDE.md) y la tabla es de este módulo: el
// camino reserva → dinero se lee acá y sale por el puerto de `connectors/reservas-money`. Antes lo
// hacía `reservas/usecases/reservas-queries.ts` con `orm.findMany('Payment', ...)`.

import type { RepositoryAdapter } from 'arckode-framework'
import type { PaymentDTO } from '../types'

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
