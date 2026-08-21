// payment-requests/usecases/stripe-status.ts — Estado de la pasarela del hotel para el panel.
// Extraído del service para mantenerlo <200 líneas (regla del analyzer: un service >200 es un
// God Object). No devuelve la secret key: sólo si hay una configurada.

import { StripeService } from '../../../services/stripe-service'
import type { StripeStatusResult } from '../types'

export async function getStripeStatus(hotelId: string): Promise<StripeStatusResult> {
  const cfg = await StripeService.getConfig(hotelId)
  return {
    configured: !!cfg.secretKey,
    publishableKey: cfg.publishableKey || '',
    currency: cfg.currency || 'usd',
  }
}
