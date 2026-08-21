// payments/usecases/charge-card.ts — Cobro con tarjeta vía Stripe Checkout.
//
// Orden que importa: el payment se asienta ANTES de abrir la sesión de Stripe, así el cobro
// queda registrado aunque el huésped abandone el checkout (el estado 'processing' lo refleja).
// Si Stripe no está configurado, falla explícito: cobrar con tarjeta sin proveedor no es un
// caso silencioso.

import { ValidationError } from 'arckode-framework'
import type { ChargeCardDTO, CreatePaymentDTO, PaymentDTO } from '../types'
import type { StripeUseCase } from './stripe'
import type { PaymentCrudUseCase } from './payment-crud'

export interface ChargeCardDeps {
  stripe: StripeUseCase
  crud: PaymentCrudUseCase
  createPayment: (dto: CreatePaymentDTO) => Promise<PaymentDTO>
}

export async function chargeCard(
  deps: ChargeCardDeps,
  dto: ChargeCardDTO,
): Promise<{ payment: PaymentDTO; checkoutUrl: string }> {
  const payment = await deps.createPayment({
    hotelId: dto.hotelId,
    type: 'charge',
    method: 'card',
    amount: dto.amount,
    currency: dto.currency,
    description: dto.description,
    folioId: dto.folioId,
    // Sin esto el cobro con tarjeta de una reprogramación queda sin vínculo con la reserva y es
    // invisible para el techo de `payment-requests` (BUG-ceiling-bypass).
    reservationId: dto.reservationId,
    guestId: dto.guestId,
    // fix-refund-pos-card: `reference`/`metadata` viajaban perdidos — sin ellos, el POS no podía
    // reclamar la idempotencia de idempotencia-settlement-pos ('pos:'+orderId) ni el conector
    // reconocer de qué módulo es el cobro al escuchar onPaymentCompleted/onPaymentExpired.
    reference: dto.reference,
    metadata: dto.metadata,
  } as CreatePaymentDTO)

  // La pasarela se resuelve para ESTE hotel: cobra contra su cuenta, no contra una global.
  if (!(await deps.stripe.isConfigured(dto.hotelId))) {
    throw new ValidationError('El hotel no tiene pasarela de pago configurada — usá efectivo o transferencia')
  }

  const session = await deps.stripe.createCheckoutSession({
    hotelId: dto.hotelId,
    amount: dto.amount,
    currency: dto.currency ?? 'USD',
    description: dto.description,
    // El client_reference_id de la sesión SIEMPRE es el payment.id — es lo que settle-webhook.ts usa
    // para encontrar el payment a confirmar/expirar. dto.reference (ej. 'pos:'+orderId) es la
    // idempotency key del payment en SÍ, un concepto distinto.
    reference: payment.id,
    metadata: { paymentId: payment.id, hotelId: dto.hotelId, ...(dto.metadata || {}) },
    successUrl: dto.successUrl,
    cancelUrl: dto.cancelUrl,
    expiresInMinutes: dto.expiresInMinutes,
  })

  await deps.crud.updateStatus(payment.id, 'processing')

  return { payment, checkoutUrl: session.url }
}
