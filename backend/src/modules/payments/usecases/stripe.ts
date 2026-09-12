// payments/usecases/stripe.ts — Puente entre `payments` y la pasarela DEL HOTEL.
//
// ANTES: esta clase creaba su propio cliente de Stripe con process.env.STRIPE_SECRET_KEY, o sea
// UNA cuenta global para todos los hoteles. El cobro del Hotel A se procesaba contra la cuenta
// configurada en el servidor, no contra la suya. Con dos hoteles con llaves cargadas, la plata
// de uno podía terminar en la cuenta del otro.
//
// AHORA: cada operación recibe el `hotelId` y el registry resuelve LA pasarela de ESE hotel.
// Ninguna operación de dinero puede ejecutarse sin decir de qué hotel es.

import type { Logger } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import type { PaymentOutcome } from '../../../services/payment-gateway/types'
import { isRefundable } from '../../../services/payment-gateway/types'
import type { StripeGateway } from '../../../services/payment-gateway/stripe-gateway'

export class StripeUseCase {
  constructor(
    private readonly registry: PaymentGatewayRegistry,
    private readonly logger: Logger,
  ) {}

  async isConfigured(hotelId: string): Promise<boolean> {
    return this.registry.isConfigured(hotelId)
  }

  private async gatewayOf(hotelId: string) {
    const gw = await this.registry.resolve(hotelId)
    if (!gw) throw new ValidationError('El hotel no tiene una pasarela de pago configurada')
    return gw
  }

  async createCheckoutSession(params: {
    hotelId: string
    amount: number
    currency: string
    description: string
    metadata: Record<string, string>
    successUrl: string
    cancelUrl: string
    reference: string
    // fix-refund-pos-card: expiración corta opcional (el POS la usa; folios/reservas siguen con el
    // default de Stripe si no la pasan). El adapter (StripeGateway) clampea al mínimo/máximo reales
    // que la API de Stripe acepta.
    expiresInMinutes?: number
  }): Promise<{ id: string; url: string }> {
    const gw = await this.gatewayOf(params.hotelId)
    const result = await gw.createCharge({
      hotelId: params.hotelId,
      // El puerto habla en unidades menores (centavos). La conversión ocurre UNA vez, acá.
      amountMinor: Math.round(params.amount * 100),
      currency: params.currency,
      description: params.description,
      reference: params.reference,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      metadata: params.metadata,
      expiresInMinutes: params.expiresInMinutes,
    })

    if (result.status === 'redirect') return { id: result.providerRef, url: result.redirectUrl }
    if (result.status === 'succeeded') return { id: result.providerRef, url: '' }
    if (result.status === 'failed') throw new ValidationError(result.reason)
    throw new ValidationError('La pasarela pidió un paso adicional que todavía no está soportado')
  }

  async refund(params: { hotelId: string; paymentId: string; amount?: number; idempotencyKey?: string }): Promise<{ id: string; status: string }> {
    const gw = await this.gatewayOf(params.hotelId)
    if (!isRefundable(gw)) {
      // Azul Payment Page, por ejemplo, no soporta reembolsos: mejor decirlo que fallar raro.
      throw new ValidationError(`La pasarela ${gw.provider} no soporta reembolsos`)
    }
    // #272: la clave de idempotencia viaja tal cual a la pasarela (ver RefundableGateway.refund).
    const r = await gw.refund(params.paymentId, params.amount ? Math.round(params.amount * 100) : undefined, params.idempotencyKey)
    return { id: r.refundId, status: r.status }
  }

  /**
   * Verifica la firma contra el secreto DE ESE HOTEL. Devuelve null si el evento no es auténtico
   * — un webhook no verificado no puede mover dinero.
   */
  async handleWebhook(hotelId: string, rawBody: Buffer | string, signature: string): Promise<PaymentOutcome | null> {
    const gw = await this.gatewayOf(hotelId)
    return gw.confirm({ hotelId, rawBody, headers: { 'stripe-signature': signature } })
  }

  /** Payment Links: capacidad propia de Stripe, no del puerto (Azul/CardNet no la tienen). */
  async createPaymentLink(params: {
    hotelId: string
    amount: number
    currency: string
    description: string
  }): Promise<{ id: string; url: string }> {
    const gw = await this.gatewayOf(params.hotelId)
    if (!gw.capabilities.paymentLinks) {
      throw new ValidationError(`La pasarela ${gw.provider} no soporta links de pago`)
    }
    return (gw as StripeGateway).createPaymentLink({
      amountMinor: Math.round(params.amount * 100),
      currency: params.currency,
      description: params.description,
    })
  }
}
