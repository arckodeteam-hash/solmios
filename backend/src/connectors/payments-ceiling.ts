// connectors/payments-ceiling.ts — RTC-8.1: la vía charge-card cobra bajo el MISMO techo.
//
// `payments.chargeCard` abre Checkout Sessions reales por `POST /api/payments/charge` (permiso
// `billing:create`, que tiene `receptionist`). Hasta RTC-8 ninguna de esas sesiones pasaba por
// `assertChargeableAmount` — cero callers en `modules/payments` — así que N llamadas dejaban N
// sesiones vivas por el saldo completo: la octava puerta del mismo bug, y la primera fuera de
// `payment-requests`.
//
// El guard se cablea de payment-requests → payments (el techo es de ese módulo, con sus repos);
// la dirección inversa (los datos de `payments` que el techo lee) la cablea
// `connectors/payment-requests-money`.

import type { ConnectorContext } from 'arckode-framework'

interface PaymentRequestsCeiling {
  /** Ver `usecases/charge-ceiling.ts` — techo agregado: saldo − links `pending` − sesiones vivas. */
  assertChargeableFor(params: { hotelId: string; reservationId: string; amount: number; excludePaymentId?: string }): Promise<void>
}

interface PaymentsWiring {
  setCeilingGuard(port: {
    assertChargeable(params: { hotelId: string; reservationId: string; amount: number; excludePaymentId?: string }): Promise<void>
  }): void
}

export function paymentsCeilingConnector(ctx: ConnectorContext): void {
  const paymentRequests = ctx.resolveModule<PaymentRequestsCeiling>('payment-requests')
  const payments = ctx.resolveModule<PaymentsWiring>('payments')
  payments.setCeilingGuard({
    assertChargeable: (p) => paymentRequests.assertChargeableFor(p),
  })
}
