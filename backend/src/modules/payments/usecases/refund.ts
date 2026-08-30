// payments/usecases/refund.ts — Devolución de un cobro con tarjeta.
//
// Una devolución NO borra ni edita el cobro original: asienta un `payment` nuevo de tipo `refund`.
// El rastro de los dos movimientos es lo que permite conciliar contra el extracto del banco, donde
// el cobro y la devolución también figuran por separado.

import { ValidationError, ConflictError } from 'arckode-framework'
import type { PaymentDTO, CreatePaymentDTO } from '../types'
import type { PaymentCrudUseCase } from './payment-crud'
import type { StripeUseCase } from './stripe'

export interface RefundDeps {
  crud: PaymentCrudUseCase
  stripe: StripeUseCase
  createPayment(dto: CreatePaymentDTO): Promise<PaymentDTO>
}

export async function refundPayment(
  deps: RefundDeps,
  paymentId: string,
  amount?: number,
  user?: { id?: string; role?: string },
): Promise<PaymentDTO> {
  const payment = await deps.crud.getById(paymentId, user?.id, user?.role)
  if (payment.status !== 'completed') throw new ValidationError('Payment not completed')
  if (payment.method !== 'card') throw new ValidationError('Only card payments can be refunded via Stripe')
  // El reembolso sale de la cuenta DEL HOTEL que cobró, no de una cuenta global.
  if (!(await deps.stripe.isConfigured(payment.hotelId))) {
    throw new ValidationError('El hotel no tiene pasarela de pago configurada')
  }

  // Deuda refund-orden-pos: los cobros POS con tarjeta se registran como manuales (pago en mostrador),
  // sin un cargo real de Stripe → `stripePaymentId=''`. El refund via Stripe requiere ese cargo. Hasta
  // que el flujo `payOrder(card)` cree una Checkout Session que el webhook confirme y asocie el PI
  // (openspec `fix-refund-pos-card`), estos cobros NO son reembolsables por acá: se devuelven manualmente
  // desde el panel de Stripe. Sin este guard, `stripe.refund` recibe `payment_intent=''` y Stripe tira
  // un error críptico de PI inválido.
  if (!payment.stripePaymentId) {
    throw new ConflictError(
      'Este cobro con tarjeta no tiene un cargo de Stripe asociado (los cobros POS se registran como pago manual). ' +
      'Reembolsalo manualmente desde el panel de Stripe y registrá la devolución. ' +
      'Deuda: refund-orden-pos (openspec fix-refund-pos-card).'
    )
  }

  const refund = await deps.stripe.refund({
    hotelId: payment.hotelId,
    paymentId: payment.stripePaymentId,
    amount,
  })

  // El reembolso ya está confirmado por Stripe síncronamente (deps.stripe.refund retornó con
  // refund.id acá arriba), así que el documento de reembolso nace `completed`. Si cayera al default
  // (`pending` por method=card) nunca llegaría a `completed` — el webhook sólo actúa en `paid` (ver
  // settle-webhook.ts) — y entonces el cashFlow y los reportes (ambos filtran status==='completed')
  // no lo restarían → ingresos inflados: un cobro de 1000 con devolución de 1000 figuraba como 1000.
  const refundPaymentDoc = await deps.createPayment({
    hotelId: payment.hotelId,
    type: 'refund',
    method: 'card',
    status: 'completed',
    amount: amount ?? payment.amount,
    currency: payment.currency,
    description: `Refund for payment ${paymentId}`,
    reference: refund.id,
    // COR-2: la devolución hereda LOS TRES vínculos del cobro original, no sólo `folioId`.
    // `shared/usecases/reservation-paid` llega a `payments` por `folioId`, por `invoiceId` Y por
    // `reservationId` (el tercer vínculo, BUG-ceiling-bypass). Los cobros de factura nacen con
    // `invoiceId` y sin `folioId` (connectors/facturas-payments.ts:24); los de reprogramación
    // (shared/usecases/charge-reschedule-diff.ts) nacen SOLO con `reservationId`. Copiar sólo
    // `folioId` dejaba el refund huérfano: el cargo original seguía sumando (`refunded` está en
    // COUNTED_STATUSES) y la devolución no restaba → `paid` inflado y el hotel cobrándole de
    // menos al huésped.
    folioId: payment.folioId,
    invoiceId: payment.invoiceId,
    reservationId: payment.reservationId,
    guestId: payment.guestId,
    // Quién ordenó la devolución. En el historial de la reserva importa más que en el cobro:
    // un reembolso siempre lo decide una persona.
    createdBy: user?.id ?? '',
  })

  // Una devolución parcial deja el cobro original `completed`: todavía queda dinero retenido.
  if (!amount || amount >= payment.amount) {
    await deps.crud.updateStatus(paymentId, 'refunded')
  }

  return refundPaymentDoc
}
