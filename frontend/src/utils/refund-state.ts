// refund-state.ts — cuándo se puede volver a pedir el reembolso web de una reserva cancelada (#272).
//
// Espejo de `backend/src/shared/usecases/web-booking-refund.ts` (`isRefundInFlight` /
// `REFUND_PENDING_STALE_MS`) y de `reservas/usecases/retry-refund.ts`: el servidor acepta el reintento
// con `failed` y también con un `pending` VIEJO (el proceso murió después de reclamar el reembolso y
// nadie lo va a terminar). Un `pending` escrito hace menos de 10 min es un reembolso en vuelo
// esperando a Stripe: el botón no se ofrece porque el backend lo rechazaría con 409.
//
// El umbral se mide sobre `updatedAt` de la reserva, que es el mismo campo que mira el backend
// (`setRefundState` pisa `updatedAt` al escribir `pending`). Sin fecha válida cuenta como viejo:
// igual que en el servidor, una fecha rota no puede dejar el reembolso colgado para siempre.

/** Mismo valor que `REFUND_PENDING_STALE_MS` del backend. */
export const REFUND_PENDING_STALE_MS = 10 * 60_000

export function isRefundRetryable(
  r: { status?: string | null; refundStatus?: string | null; updatedAt?: string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  if (r?.status !== 'cancelled') return false
  if (r.refundStatus === 'failed') return true
  if (r.refundStatus !== 'pending') return false
  const at = Date.parse(String(r.updatedAt ?? ''))
  return !Number.isFinite(at) || now - at >= REFUND_PENDING_STALE_MS
}
