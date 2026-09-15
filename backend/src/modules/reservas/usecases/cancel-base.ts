// reservas/usecases/cancel-base.ts — Sobre qué monto se calcula la penalidad de una cancelación.
//
// La penalidad y el reembolso son un porcentaje de LO QUE EL HUÉSPED YA PAGÓ. Antes se tomaba la
// columna `reservations.deposit`, que NO es el libro del dinero (ver el encabezado de
// `shared/usecases/reservation-paid.ts`): un cobro en efectivo registrado con "Marcar pagada",
// por folio, factura o caja vive en `payments` y nunca toca `deposit`. Resultado verificado en la
// corrida E2E del 2026-09-15: reserva cobrada 400 en efectivo, política 50% → el modal decía
// "Depósito recibido 0 · Penalidad 0 · Se le devuelve 0" y así quedaba persistido.
//
// Preview (`cancel-preview.ts`) y cancelación real (`cancel-core.ts`) llaman a ESTA función: si
// usaran fuentes distintas, lo que el recepcionista ve antes de confirmar no sería lo que se guarda.
import type { Logger } from 'arckode-framework'
import type { PaidSource } from '../../../shared/usecases/reservation-paid'

/**
 * Lo cobrado de la reserva (`paidForReservation`: `deposit` + `payments` − devoluciones).
 *
 * Sin `paidOf` (tests/wiring viejo) o si la lectura de pagos falla, cae a la columna `deposit`:
 * una cancelación de OTA que entra por el cron no puede quedar trabada porque `payments` no
 * respondió. La caída se loguea para que no pase en silencio.
 */
export async function cancellationBaseOf(
  paidOf: PaidSource | undefined,
  item: { id: string; hotelId?: string | null; deposit?: number | null },
  logger?: Pick<Logger, 'warn'>,
): Promise<number> {
  const depositColumn = Number(item.deposit ?? 0) || 0
  if (!paidOf) return depositColumn
  try {
    const paid = Number(await paidOf(String(item.id), item))
    return Number.isFinite(paid) ? paid : depositColumn
  } catch (e) {
    logger?.warn?.('[cancel] no se pudo leer lo cobrado; se usa la columna deposit', {
      reservationId: item.id,
      error: e instanceof Error ? e.message : String(e),
    })
    return depositColumn
  }
}
