import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { SubscriptionsService } from './service'
import { SignupSchema, CheckoutSchema } from './validators/schema'

// Mismo fallback que payment-requests/service.ts:DEFAULT_PORT (dev sin header Origin).
const DEFAULT_PORT = 3000

/** Origin del navegador para armar success/cancel/return URLs (mismo patrón que
 * payment-requests/service.ts:createCheckout — sin env var de frontend que el proyecto no tiene). */
function originOf(req: HttpRequest): string {
  const origin = (req.headers?.origin as string) || ''
  return origin || `http://localhost:${process.env.PORT || DEFAULT_PORT}`
}

export class SubscriptionsController {
  constructor(
    private readonly service: SubscriptionsService,
    private readonly logger: Logger,
  ) {}

  /**
   * Alta pública: sin token, cualquiera crea su hotel y arranca la prueba.
   * La ruta va con rate-limit porque es la única puerta abierta que escribe.
   */
  async signup(req: HttpRequest) {
    const data = validateSchema(SignupSchema, req.body ?? {}) as any
    const result = await this.service.signup(data)
    return { status: 201, body: { data: result } }
  }

  /** Planes visibles para quien todavía no es cliente (la landing y el registro). */
  async publicPlans(_req: HttpRequest) {
    return { status: 200, body: { data: await this.service.publicPlans() } }
  }

  /** CFG-1: el % del programa Fundador sale de la base, no del build del frontend. */
  async publicFounderDiscount(_req: HttpRequest) {
    return { status: 200, body: { discountPct: await this.service.publicFounderDiscount() } }
  }

  /** Guía de primeros pasos: qué le falta configurar al hotel. */
  async onboarding(req: HttpRequest) {
    const hotelId = (req.user as any)?.hotelId
    return { status: 200, body: { data: await this.service.onboarding(hotelId) } }
  }

  /** Estado de la suscripción del hotel logueado: qué le queda y si tiene que pagar. */
  async myStatus(req: HttpRequest) {
    const hotelId = (req.user as any)?.hotelId
    return { status: 200, body: { data: await this.service.statusOf(hotelId) } }
  }

  /** El hotel elige un plan y arranca a pagar: Checkout Session de Stripe. */
  async checkout(req: HttpRequest) {
    const hotelId = (req.user as any)?.hotelId
    const data = validateSchema(CheckoutSchema, req.body ?? {}) as { planId: string }
    const result = await this.service.createCheckout(hotelId, data.planId, originOf(req))
    return { status: 200, body: result }
  }

  /** El hotel gestiona su método de pago / ve facturas: Billing Portal de Stripe. */
  async portal(req: HttpRequest) {
    const hotelId = (req.user as any)?.hotelId
    const result = await this.service.createPortal(hotelId, originOf(req))
    return { status: 200, body: result }
  }

  /**
   * Webhook de la cuenta de PLATAFORMA. Sin auth: la autoridad es la firma de Stripe
   * (mismo patrón que payment-requests/controller.ts:webhook).
   */
  async webhookPlatform(req: HttpRequest) {
    const signature = (req.headers as any)?.['stripe-signature'] || ''
    const rawBody = (req as any).rawBody
    if (!rawBody) return { status: 400, body: { error: 'Webhook sin body' } }
    const result = await this.service.handlePlatformWebhook(rawBody, signature)
    if (result && typeof (result as any).status === 'number') return result as { status: number; body: any }
    return { status: 200, body: result }
  }
}
