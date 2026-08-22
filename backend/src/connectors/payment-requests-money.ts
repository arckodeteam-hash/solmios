// connectors/payment-requests-money.ts — `payment-requests` lee el dinero de una reserva SIN
// abrir repos de tablas ajenas.
//
// STR-A (gate, 3ª ronda): el mismo diff que sacaba de `reservas` la lectura cruda de
// `invoices`/`payments` (connectors/reservas-money.ts) la AGREGABA acá — dos arquitecturas
// contradictorias para el mismo camino reserva→dinero. Ahora el techo del cobro
// (usecases/charge-ceiling.ts) y el bridge del webhook (usecases/stripe-webhook.ts) consumen el
// MISMO puerto que `reservas`, armado por los módulos dueños.
//
// Acá sólo se wirea: la lectura la hacen `folios`/`facturas`/`payments` (cada uno en su
// usecases/reservation-money.ts) y el shim `RepositoryAdapter` lo arma `paidReposFrom`.
//
// RTC-8.2/8.3: además del dinero asentado (`settledNet`), por acá salen las sesiones de checkout
// VIVAS de la vía charge-card — el techo las suma a los links `pending` y el clamp las recorta,
// porque `payment-requests` no puede alcanzar (ni ver) una sesión que vive en `payments`.

import type { ConnectorContext } from 'arckode-framework'
import { buildReservationMoneyPort, paidReposFrom, type MoneyOwners } from '../modules/reservas/usecases/money-port'

interface PaymentRequestsModule {
  setMoneyDeps(deps: {
    paidRepos: ReturnType<typeof paidReposFrom>
    /** RTC-7.4: "dinero neto asentado a nombre de una reserva", contestado por `payments`. */
    settledNet: (hotelId: string, reservationId: string) => Promise<number>
    /** RTC-8.2 — sesiones de checkout vivas de la vía charge-card, para el lado derecho del techo. */
    liveCharges: (hotelId: string, reservationId: string, excludePaymentId?: string) => Promise<number>
    /** RTC-8.3 — las filas de esas sesiones y su retirada, para el clamp. */
    liveChargeRows: (hotelId: string, reservationId: string) => Promise<Array<{ id: string; amount: number; createdAt?: string | null }>>
    cancelLiveCharge: (hotelId: string, chargeId: string) => Promise<'cancelled' | 'paid'>
  }): void
}

/** Lo que este connector necesita de `payments` además de lo que ya pide `MoneyOwners`. */
interface PaymentsSettled {
  settledNetOfReservation(hotelId: string, reservationId: string): Promise<number>
  /** RTC-8.2/8.3 — ver `payments/usecases/live-charges.ts`. */
  liveChargePort: {
    liveChargesOfReservation(hotelId: string, reservationId: string, excludePaymentId?: string): Promise<number>
    liveChargeRowsOfReservation(hotelId: string, reservationId: string): Promise<Array<{ id: string; amount: number; createdAt?: string | null }>>
    cancelLiveChargeOf(hotelId: string, chargeId: string): Promise<'cancelled' | 'paid'>
  }
}

export function paymentRequestsMoneyConnector(ctx: ConnectorContext): void {
  const owners: MoneyOwners = {
    folios: ctx.resolveModule<MoneyOwners['folios']>('folios'),
    facturas: ctx.resolveModule<MoneyOwners['facturas']>('facturas'),
    payments: ctx.resolveModule<MoneyOwners['payments']>('payments'),
  }
  const payments = ctx.resolveModule<PaymentsSettled>('payments')
  ctx.resolveModule<PaymentRequestsModule>('payment-requests').setMoneyDeps({
    paidRepos: paidReposFrom(buildReservationMoneyPort(owners)),
    // RTC-7.4: el borrado de una reserva pregunta por el dinero al dueño de la tabla, no lee
    // `payments` con el shim `paidRepos` (ver `usecases/clamp-to-ceiling.ts`).
    settledNet: (hotelId, reservationId) => payments.settledNetOfReservation(hotelId, reservationId),
    // RTC-8.2/8.3: el techo y el clamp alcanzan las sesiones de la vía charge-card por el dueño
    // de la tabla — sin estos puertos el service de payment-requests es fail-closed y tira.
    liveCharges: (hotelId, reservationId, excludePaymentId) => payments.liveChargePort.liveChargesOfReservation(hotelId, reservationId, excludePaymentId),
    liveChargeRows: (hotelId, reservationId) => payments.liveChargePort.liveChargeRowsOfReservation(hotelId, reservationId),
    cancelLiveCharge: (hotelId, chargeId) => payments.liveChargePort.cancelLiveChargeOf(hotelId, chargeId),
  })
}
