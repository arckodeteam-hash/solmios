// reservas/usecases/cancellation-refund.ts — Devolverle al huésped lo que la política de cancelación
// dice que le corresponde (POST /api/reservas/:id/cancellation-refund).
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────────────────
// Cancelar desde el panel calcula y guarda `refundAmount`, pero hasta el 2026-09-15 ahí se terminaba:
// no salía plata, no se asentaba nada en `payments`, la reserva seguía "Pagada" y el detalle no
// mostraba que había USD X por devolver (verificado en el panel). La devolución dependía de que
// alguien se acordara. La cancelación desde la WEB sí devolvía (#272, `web-booking-refund`); la del
// panel no tenía camino.
//
// ── POR DÓNDE SALE LA PLATA ───────────────────────────────────────────────────────────────
// No se decide acá: se reusa `shared/usecases/settle-reschedule-credit` (el puerto
// `creditReschedule`), la regla que ya aplica la reprogramación cuando el huésped pagó de más:
//   · cobro con tarjeta por Stripe (cargo real) → reembolso a la tarjeta;
//   · efectivo, transferencia, tarjeta del POS o Stripe que rechaza → devolución por caja
//     (`payments.recordDirectRefund`: asiento `refund` + `onRefundProcessed` para el arqueo);
//   · factura ya emitida → se avisa que falta la nota de crédito.
//
// ── LO QUE CUIDA ──────────────────────────────────────────────────────────────────────────
//   · Doble clic / dos pestañas: `claimRefund` (compare-and-swap → `refundStatus: 'pending'`), el mismo
//     candado del reembolso web. El segundo recibe 409 sin mover plata.
//   · Devolución ya hecha a mano desde Finanzas: lo ya devuelto se descuenta. Se reconstruye con lo
//     cobrado al cancelar (`refundAmount + cancellationFee`) menos lo cobrado ahora.
//   · Si la devolución falla, `refundStatus` vuelve a como estaba: no se deja un `failed` que el
//     panel ofrecería reintentar por el camino WEB (Stripe), que no aplica a un cobro en efectivo.
import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { Auth, Logger, RepositoryAdapter } from 'arckode-framework'
import type { PaidSource } from '../../../shared/usecases/reservation-paid'
import { BALANCE_EPSILON, round2 } from '../../../shared/utils/money'
import { isRefundInFlight } from '../../../shared/usecases/web-booking-refund'
import type { RescheduleCreditPort, RescheduleCreditResult } from './reschedule'
import type { ReservationChangedNotifier } from './reservation-changed'

export interface CancellationRefundDeps {
  repo: RepositoryAdapter<any>
  auth: Auth
  logger: Logger
  paidOf: PaidSource
  claimRefund: (id: string) => Promise<boolean>
  /** `connectors/reservas-reschedule-charge.ts` → `settleRescheduleCredit`. */
  credit: RescheduleCreditPort | undefined
  notifyChanged: ReservationChangedNotifier
  audit: (entry: { hotelId: string; userId: string; detail: string }) => Promise<unknown> | unknown
}

export interface CancellationRefundResult {
  reservationId: string
  amount: number
  /** Por dónde salió: `card` = Stripe, `cash` = caja del turno. */
  target: RescheduleCreditResult['target']
  refundPaymentId: string | null
  refundStatus: 'done'
  /** Qué tiene que hacer la persona (entregar efectivo, emitir nota de crédito). */
  message: string
  needsCreditNote: boolean
}

/** Estados en los que el panel puede ejecutar la devolución (los de la web tienen su reintento). */
const REFUNDABLE_FROM = new Set(['', 'none'])

/**
 * 404 inexistente/otro hotel · 409 no cancelada, nada que devolver, ya devuelta o en curso ·
 * 400 sin puerto cableado · 200 con la vía usada y el mensaje para el operador.
 */
export async function refundCancelledReservation(
  deps: CancellationRefundDeps,
  id: string,
  currentUser: { id: string; role: string; hotelId?: string },
): Promise<CancellationRefundResult> {
  const item = await deps.repo.findById(id)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  deps.auth.assertOwnership(item.hotelId, currentUser.hotelId ?? '', currentUser.role, 'super_admin')

  if (item.status !== 'cancelled') throw new ConflictError('Sólo se devuelve el dinero de una reserva cancelada')
  const owed = round2(Number(item.refundAmount) || 0)
  if (owed <= 0) throw new ConflictError('La cancelación no dejó dinero para devolver')
  const status = String(item.refundStatus ?? '')
  if (status === 'done') throw new ConflictError('El dinero de esta cancelación ya se devolvió')
  if (isRefundInFlight(item)) throw new ConflictError('Ya hay una devolución en curso para esta reserva; esperá unos minutos')
  if (!REFUNDABLE_FROM.has(status)) {
    throw new ConflictError('Esta devolución la gestiona la cancelación web: usá "Reintentar reembolso"')
  }
  if (!deps.credit) throw new ValidationError('Devolución no disponible (payments no conectado)')

  // Lo que ya salió por otro lado (p. ej. una devolución cargada a mano en Finanzas) no se repite.
  const paidAtCancel = round2(owed + (Number(item.cancellationFee) || 0))
  const paidNow = round2(await deps.paidOf(String(item.id), item))
  const alreadyReturned = Math.max(0, round2(paidAtCancel - paidNow))
  const amount = round2(owed - alreadyReturned)
  if (amount <= BALANCE_EPSILON) {
    throw new ConflictError('Ya se devolvió este monto desde Finanzas: no queda nada por devolver')
  }

  if (!(await deps.claimRefund(String(item.id)))) {
    throw new ConflictError('Ya hay una devolución en curso para esta reserva; esperá unos minutos')
  }

  let outcome: RescheduleCreditResult
  try {
    outcome = await deps.credit({
      reservationId: String(item.id),
      hotelId: String(item.hotelId),
      guestId: item.guestId ?? null,
      currency: String(item.currency || 'USD'),
      amount,
      action: 'refund',
      reason: String(item.cancellationReason ?? '').trim() || undefined,
      description: 'Devolución por cancelación',
    }, currentUser)
  } catch (e) {
    await deps.repo.update(item.id, { refundStatus: status || 'none' })
    throw e
  }

  const refundedAt = new Date().toISOString()
  const updated = await deps.repo.update(item.id, {
    refundStatus: 'done',
    refundedAt,
    refundPaymentId: outcome.paymentId ?? null,
  })
  await deps.notifyChanged(updated)

  try {
    await deps.audit({
      hotelId: String(item.hotelId),
      userId: currentUser.id,
      detail: JSON.stringify({ amount, target: outcome.target, refundPaymentId: outcome.paymentId ?? null, alreadyReturned }),
    })
  } catch (e) {
    deps.logger.warn('[cancellation-refund] no se pudo registrar la devolución en el historial', {
      reservationId: id,
      error: e instanceof Error ? e.message : String(e),
    })
  }

  return {
    reservationId: String(item.id),
    amount,
    target: outcome.target,
    refundPaymentId: outcome.paymentId ?? null,
    refundStatus: 'done',
    message: outcome.message ?? '',
    needsCreditNote: !!outcome.needsCreditNote,
  }
}
