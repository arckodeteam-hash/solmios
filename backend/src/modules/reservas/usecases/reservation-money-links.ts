// reservas/usecases/reservation-money-links.ts — De una reserva a su dinero ya asentado.
//
// Los dos datos que hacen falta para resolver lo que un huésped pagó DE MÁS: por dónde entró la
// plata (para saber si se devuelve a la tarjeta o por caja) y si ya hay factura emitida (que
// obliga a una nota de crédito aparte). Los usa `connectors/reservas-reschedule-charge.ts`.
//
// Viven acá y no en el connector porque necesitan los mismos repos que ya alimentan `paidSource`,
// y no en el service porque ahí serían cuerpo de método en un archivo con tope de 200 líneas.

import { collectReservationPayments, type ReservationPaidRepos } from '../../../shared/usecases/reservation-paid'

/** Filas de `payments` de la reserva por sus tres vínculos (folio, factura y columna directa). */
export function paymentsOfReservation(
  repos: ReservationPaidRepos,
  hotelId: string,
  reservationId: string,
): Promise<Record<string, any>[]> {
  return collectReservationPayments(repos, hotelId, reservationId) as Promise<Record<string, any>[]>
}

/**
 * ¿La reserva ya tiene una factura emitida?
 *
 * Se cuentan solo las de tipo `invoice`: una `credit_note` es la anulación de otra, no una venta
 * viva. Sin ese filtro, una reserva ya anulada pediría otra nota de crédito.
 */
export async function hasInvoiceForReservation(
  repos: ReservationPaidRepos,
  hotelId: string,
  reservationId: string,
): Promise<boolean> {
  const rows = await repos.invoiceRepo.findMany({ hotelId, reservationId } as any)
  return (rows as Record<string, any>[]).some((i) => String(i?.type ?? 'invoice') === 'invoice')
}
