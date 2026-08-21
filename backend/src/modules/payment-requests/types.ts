// payment-requests/types.ts — Contratos de API (no de BD). model.ts describe la tabla.

/**
 * Estados válidos de una solicitud de cobro. Es la ÚNICA lista: el schema de entrada
 * (`validators/schema.ts`) la usa como `enum`. Sin ese enum, un `PUT {status:'x'}` sacaba el
 * link de `pending` y burlaba el techo agregado de `usecases/charge-ceiling.ts` (SEC-1).
 */
export const PAYMENT_REQUEST_STATUSES = ['pending', 'paid', 'expired', 'cancelled'] as const

export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number]

export interface PaymentRequestDTO {
  id: string
  hotelId: string
  reservationId: string
  amount: number
  currency?: string
  stripeSessionId?: string
  stripePaymentUrl?: string
  status: PaymentRequestStatus | string
  sentTo?: string
  sentVia?: string
  paidAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface CreatePaymentRequestDTO {
  hotelId?: string
  reservationId: string
  amount: number
  currency?: string
  sentTo?: string
  sentVia?: string
}

/**
 * Lo que el CLIENTE puede pedir que cambie. `stripeSessionId`, `stripePaymentUrl` y `paidAt` NO
 * están: son estado interno del servidor (los escriben `usecases/create-checkout.ts` y
 * `usecases/stripe-webhook.ts` contra el repo). Ver `validators/schema.ts` — BUG-ceiling-bypass.
 */
export interface UpdatePaymentRequestDTO {
  amount?: number
  status?: string
  sentTo?: string
  sentVia?: string
}

export interface PaymentRequestQuery {
  hotelId?: string
  reservationId?: string
}

/** Usuario autenticado extraído del JWT. */
export interface CurrentUser {
  id: string
  hotelId?: string
  role: string
}

export interface StripeStatusResult {
  configured: boolean
  publishableKey: string
  currency: string
}

export interface CheckoutResult {
  url: string
  sessionId: string
}

export interface WebhookResult {
  received?: boolean
  error?: string
  detail?: string
}
