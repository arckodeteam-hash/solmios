// payments/usecases/live-charges.ts — RTC-8.2/8.3: las sesiones de checkout de ESTA vía,
// visibles para el techo del cobro.
//
// Hallazgo RTC-8 (2026-08-21, dos auditores independientes): `chargeCard` abre Checkout Sessions
// reales que el techo de `payment-requests` no veía — `committedPending` sólo sumaba filas de
// `payment_requests` (la sesión no contaba como comprometida) y `paidForReservation` sólo cuenta
// `completed|refunded` mientras este pago nace `pending` y pasa a `processing` (tampoco bajaba el
// saldo). N llamadas = N sesiones vivas por el saldo completo.
//
// La tabla `payments` es de ESTE módulo: la pregunta "¿qué sesiones de checkout hay vivas a nombre
// de esta reserva?" se contesta acá y sale por el puerto `connectors/payment-requests-money`,
// igual que `settledNetOfReservation` (RTC-7.4). El techo suma este número a los links `pending`.
//
// Qué cuenta como VIVA: un cobro `type:'charge'` en `pending`/`processing` con vínculo directo
// `reservationId`. Cuando el webhook confirma pasa a `completed` (deja de comprometer, empieza a
// pagar); cuando expira/falla pasa a `cancelled`/`failed` (libera el techo). Los `type:'refund'`
// nacen `pending` pero no son exposición — devuelven plata, no la prometen.

import type { RepositoryAdapter } from 'arckode-framework'
import { StripeService } from '../../../services/stripe-service'
import type { PaymentDTO } from '../types'
import { round2 } from '../../../shared/utils/money'

/** El puerto RTC-8.2/8.3 que el service expone a `connectors/payment-requests-money`.
 *  Se arma acá (y no inline en el service) por la regla GOD_SERVICE del analyzer: el service
 *  wirea, el usecase decide — mismo patrón que `pendingAfterPaymentDeps` en `reservas`. */
export interface LiveChargesPort {
  liveChargesOfReservation(hotelId: string, reservationId: string, excludePaymentId?: string): Promise<number>
  liveChargeRowsOfReservation(hotelId: string, reservationId: string): Promise<PaymentDTO[]>
  cancelLiveChargeOf(hotelId: string, chargeId: string): Promise<'cancelled' | 'paid'>
}

export function liveChargesPort(
  repo: Pick<RepositoryAdapter<PaymentDTO>, 'findMany'>,
  crud: { getById(id: string): Promise<PaymentDTO | null>; updateStatus(id: string, status: string): Promise<PaymentDTO> },
): LiveChargesPort {
  return {
    liveChargesOfReservation: (hotelId, reservationId, excludePaymentId) => liveChargesOf(repo, hotelId, reservationId, excludePaymentId),
    liveChargeRowsOfReservation: (hotelId, reservationId) => liveChargeRowsOf(repo, hotelId, reservationId),
    // Mata UNA sesión viva por id: se busca la fila y se exige que siga viva y del hotel.
    cancelLiveChargeOf: async (hotelId, chargeId) => {
      const row = await crud.getById(chargeId)
      if (!row || String(row.hotelId ?? '') !== hotelId) return 'cancelled' // ya no está (o nunca fue): nada que matar
      if (row.status !== 'pending' && row.status !== 'processing') return 'cancelled' // el webhook la liquidó/canceló antes
      return cancelLiveCharge({ crud }, hotelId, row)
    },
  }
}

/** Estados de un cobro cuya sesión de checkout todavía puede terminar pagándose. */
const LIVE_STATUSES = new Set(['pending', 'processing'])

/** Lo mínimo que el clamp de `payment-requests` necesita de una sesión viva para recortarla. */
export interface LiveChargeRow {
  id: string
  amount: number
  createdAt?: string | null
}

/**
 * Sesiones vivas de la reserva, la más antigua primero (FIFO — mismo criterio que
 * `pendingRowsOf` en el clamp: si hay que recortar, se recorta lo último en llegar).
 */
export async function liveChargeRowsOf(
  repo: Pick<RepositoryAdapter<PaymentDTO>, 'findMany'>, hotelId: string, reservationId: string,
): Promise<PaymentDTO[]> {
  if (!hotelId) throw new Error('payments: liveChargeRowsOf sin hotelId (multi-tenancy)')
  if (!reservationId) return []
  const rows = await repo.findMany({ hotelId, reservationId } as any)
  return (rows as PaymentDTO[])
    .filter((p) => p.type === 'charge' && LIVE_STATUSES.has(String(p.status)))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id))
}

/**
 * Importe comprometido en sesiones vivas de esta reserva (RTC-8.2: el lado derecho del techo ya
 * no es sólo los links `pending` de `payment-requests`). `excludePaymentId` es para la
 * re-verificación post-commit de `charge-card`: el cobro recién creado no se cuenta a sí mismo,
 * igual que `excludeRequestId` en `assertCeilingAfterCommit`.
 */
export async function liveChargesOf(
  repo: Pick<RepositoryAdapter<PaymentDTO>, 'findMany'>, hotelId: string, reservationId: string,
  excludePaymentId?: string,
): Promise<number> {
  const rows = await liveChargeRowsOf(repo, hotelId, reservationId)
  return round2(rows.filter((p) => p.id !== excludePaymentId).reduce((sum, p) => sum + (Number(p.amount) || 0), 0))
}

export interface CancelLiveChargeDeps {
  crud: Pick<PaymentCrudLike, 'updateStatus'>
}
interface PaymentCrudLike { updateStatus(id: string, status: string, stripePaymentId?: string): Promise<PaymentDTO> }

/**
 * Mata UNA sesión viva: expira la sesión de Stripe PRIMERO (si el huésped ya abonó, no hay nada
 * que matar — el webhook va a liquidar sobre esa misma fila) y marca el asiento `cancelled`.
 *
 * Es el símetra de `retireRow` en `clamp-to-ceiling.ts`: sesión muerta antes que la fila, y un
 * `'paid'` NO se toca (sigue comprometiendo el techo, que es lo correcto: esa plata está en camino).
 * Sin `stripeSessionId` (cobro registrado sin checkout) no hay link vivo que proteger: se cancela
 * el asiento directo.
 *
 * NO emite `onPaymentExpired` a propósito: este usecase corre DENTRO del lock del clamp, y ese
 * socket dispararía `syncPendingAfterPayment` → `clampRequestsToCeiling` → el MISMO lock no
 * reentrante = deadlock (medido: los tests del clamp cuelgan a los 5s). Además el socket sería
 * un no-op para el saldo — la sesión viva nunca bajó `pendingAmount` (sólo `completed` cuenta
 * como pagado), así que cancelarla tampoco lo mueve. `onPaymentExpired` queda para el webhook
 * del proveedor (`settle-webhook.ts`), que corre fuera de todo lock.
 */
export async function cancelLiveCharge(
  deps: CancelLiveChargeDeps, hotelId: string, charge: { id: string; stripeSessionId?: string | null },
): Promise<'cancelled' | 'paid'> {
  if (charge.stripeSessionId) {
    const outcome = await StripeService.expireCheckoutSession(charge.stripeSessionId, hotelId)
    if (outcome === 'paid') return 'paid'
  }
  await deps.crud.updateStatus(charge.id, 'cancelled')
  return 'cancelled'
}
