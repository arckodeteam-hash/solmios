// payments/usecases/refund-flows.ts — Los cuatro caminos por los que SALE plata, con lo que tienen en común:
// el asiento (`refund.ts` / `refund-direct.ts`), el audit `payment.refund` y el evento `onRefundProcessed`.
//
// `onRefundProcessed` es EL evento de una devolución: lo escuchan contabilidad (DR Clientes / CR Caja), la caja
// (egreso del cajón si fue efectivo, connectors/payments-caja.ts), reservas (resync del saldo) y los webhooks
// externos (`payment.refunded`). Un `payment type:'refund'` nace `completed` pero NUNCA dispara
// `onPaymentCompleted` (createPayment lo excluye, #214 COR-D): antes un refund cash/transfer salía hacia caja y
// los webhooks como si fuera un cobro. Por eso toda devolución pasa por acá y no por `createPayment` a secas.
import type { PaymentDTO, CreatePaymentDTO } from '../types'
import type { PaymentCrudUseCase } from './payment-crud'
import type { StripeUseCase } from './stripe'
import { refundPayment as refundViaStripe } from './refund'
import { refundDirectPayment, recordDirectRefund, type DirectRefundInput } from './refund-direct'
import { refundEntry, type AuditEntry, type Actor } from './audit'

export interface RefundFlowDeps {
  crud: PaymentCrudUseCase
  stripe: StripeUseCase
  createPayment(dto: CreatePaymentDTO): Promise<PaymentDTO>
  audit(entry: AuditEntry): Promise<void>
  onRefundProcessed(refund: PaymentDTO): Promise<void>
}

async function settle(deps: RefundFlowDeps, refund: PaymentDTO, amount: number | undefined, user: Actor): Promise<PaymentDTO> {
  await deps.audit(refundEntry(refund, amount, user))
  await deps.onRefundProcessed(refund)
  return refund
}

/** Tarjeta: reembolso real por Stripe (total o parcial). */
export async function refundStripe(deps: RefundFlowDeps, paymentId: string, amount: number | undefined, user: Actor): Promise<PaymentDTO> {
  return settle(deps, await refundViaStripe(deps, paymentId, amount, user), amount, user)
}

/** #214 (COR-5): efectivo/transferencia — asiento `refund` sin pasarela, el cobro pasa a `refunded`. */
export async function refundDirect(deps: RefundFlowDeps, paymentId: string, user: Actor): Promise<PaymentDTO> {
  return settle(deps, await refundDirectPayment(deps, paymentId, user), undefined, user)
}

/**
 * Devolución por caja de un monto SIN cobro de origen (el excedente de una reserva reprogramada, connector
 * `reservas-reschedule-charge`). Mismo asiento y mismo evento que `refundDirect`.
 */
export async function recordDirect(deps: RefundFlowDeps, input: DirectRefundInput, user: Actor): Promise<PaymentDTO> {
  return settle(deps, await recordDirectRefund(deps, { ...input, createdBy: input.createdBy ?? user?.id }), undefined, user)
}

/** Devolución total por método (tarjeta → Stripe; cash/transfer → asiento directo). Lo usa el POS: payments es quien sabe el método de cada cobro. */
export async function refundByMethod(deps: RefundFlowDeps, paymentId: string, user: Actor): Promise<PaymentDTO> {
  const payment = await deps.crud.getById(paymentId, user?.id, user?.role)
  return payment.method === 'card' ? refundStripe(deps, paymentId, undefined, user) : refundDirect(deps, paymentId, user)
}
