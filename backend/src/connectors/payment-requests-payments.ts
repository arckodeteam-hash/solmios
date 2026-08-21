// connectors/payment-requests-payments.ts — Conector entre módulos
// Cobrar un Link de Pago por Stripe asienta el dinero en `payments`, además de bajar el saldo del
// folio y actualizar el depósito de la reserva.
//
// Sin este conector, un cobro por Stripe existía solo en `payment_requests` y `folio_charges`:
// nunca aparecía en `payments`, así que quedaba fuera de la conciliación bancaria. (Deuda F10.)
//
// No impacta caja: `payments-caja` solo asienta el efectivo, y un cobro Stripe ya está bancarizado.

import type { ConnectorContext } from 'arckode-framework'
import { stripeChargeDto, type RecordStripePaymentInput, type StripeChargeDto } from '../modules/payment-requests'

interface PaymentDoc {
  id: string
  status: string
}

interface PaymentsModule {
  createPayment: (dto: StripeChargeDto) => Promise<PaymentDoc>
  findByStripeSession: (hotelId: string, stripeSessionId: string) => Promise<PaymentDoc | null>
}

export function paymentRequestsPaymentsConnector(ctx: ConnectorContext): void {
  const paymentRequests = ctx.resolveModule<{ setPaymentDeps: (p: any) => void }>('payment-requests')
  const payments = ctx.resolveModule<PaymentsModule>('payments')

  paymentRequests.setPaymentDeps({
    paymentPort: {
      findBySession: async (hotelId: string, stripeSessionId: string) => {
        const found = await payments.findByStripeSession(hotelId, stripeSessionId)
        return found ? { id: found.id, status: found.status } : null
      },

      recordPayment: async (input: RecordStripePaymentInput) => {
        // El mapeo vive en `usecases/payment-port.ts` (`stripeChargeDto`): el banco de pruebas del
        // techo usa el MISMO, así no vuelve a haber un doble que asiente distinto que producción.
        const payment = await payments.createPayment(stripeChargeDto(input))
        return { id: payment.id, status: payment.status }
      },
    },
  })
}
