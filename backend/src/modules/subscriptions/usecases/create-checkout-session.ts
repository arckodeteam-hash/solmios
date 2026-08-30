// subscriptions/usecases/create-checkout-session.ts — El HOTEL paga a la PLATAFORMA.
//
// Ojo con la confusión de cuentas Stripe: `StripeService.getClient(hotelId)` con un hotelId
// resuelve las keys DE ESE HOTEL (lo que cobra a sus huéspedes). Acá se llama sin argumento
// a propósito: el cobro de la suscripción SaaS siempre corre contra la cuenta de la
// PLATAFORMA (env STRIPE_SECRET_KEY), nunca contra la cuenta del hotel.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ValidationError, NotFoundError, ConflictError } from 'arckode-framework'
import { StripeService } from '../../../services/stripe-service'

export interface CreateCheckoutDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  hotelsRepo: RepositoryAdapter<any>
  plansRepo: RepositoryAdapter<any>
  logger: Logger
}

export interface CreateCheckoutResult {
  url: string
}

/**
 * Crea (o reutiliza) el Customer de Stripe del hotel y arma la Checkout Session de la
 * suscripción. `origin` viene del header `Origin` del request (mismo patrón que
 * payment-requests/service.ts:createCheckout) — evita depender de una env var de frontend
 * que el proyecto no tiene hoy.
 */
export async function createCheckoutSession(
  deps: CreateCheckoutDeps,
  hotelId: string,
  planId: string,
  origin: string,
  /**
   * Días de prueba a arrancar DENTRO del Checkout (#28). Solo lo manda el alta cuando la
   * plataforma exige tarjeta antes de la prueba: Stripe guarda el método de pago, no cobra nada
   * durante el trial y factura solo al vencer. `undefined` = conversión normal a plan pago
   * (cobro inmediato), que es el camino del botón "Suscribirse" del panel.
   */
  trialDays?: number,
): Promise<CreateCheckoutResult> {
  const { subscriptionsRepo, hotelsRepo, plansRepo, logger } = deps
  if (!hotelId) throw new ValidationError('Falta el hotel')
  if (!planId) throw new ValidationError('Falta el plan')

  const plan = await plansRepo.findById(planId) as any
  if (!plan) throw new NotFoundError('Plan no encontrado')
  if (!plan.stripePriceId) {
    throw new ValidationError('Plan sin precio configurado en Stripe')
  }

  const hotel = await hotelsRepo.findById(hotelId) as any
  if (!hotel) throw new NotFoundError('Hotel no encontrado')

  const stripe = await StripeService.getClient()
  if (!stripe) throw new ValidationError('Stripe no está configurado en la plataforma')

  let sub = (await subscriptionsRepo.findMany({ hotelId }))[0] as any

  // Estados con una suscripción VIVA en Stripe. `trialing` NO entra: la prueba todavía no
  // tiene suscripción en Stripe y el Checkout es la única vía de conversión a plan pago.
  const LIVE_STRIPE_STATUSES = ['active', 'past_due']

  // BUG-9 (doble cobro): lanzar otro Checkout `mode:'subscription'` con una suscripción viva
  // crea una SEGUNDA suscripción en Stripe que cobra en paralelo y huérfana la vieja — el
  // webhook (`handle-stripe-event.ts` checkout.session.completed) pisa `stripeSubscriptionId`
  // con la nueva y la anterior queda activa en Stripe sin rastro local. Aplica a CUALQUIER
  // plan (el mismo o uno distinto): todo Checkout nuevo mientras el status esté vivo genera
  // una segunda suscripción. El camino correcto es cancelar la actual o esperar el fin del
  // ciclo desde el Billing Portal; la migración de plan con proration es otro feature.
  if (sub && LIVE_STRIPE_STATUSES.includes(sub.status)) {
    throw new ConflictError(
      'Ya tenés una suscripción activa. Para cambiar de plan, cancelá la actual o esperá a que termine el ciclo desde el portal de facturación.',
    )
  }

  let stripeCustomerId: string | undefined = sub?.stripeCustomerId
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      name: hotel.name,
      email: hotel.email || undefined,
      metadata: { hotelId },
    })
    stripeCustomerId = customer.id

    if (sub) {
      await subscriptionsRepo.update(sub.id, { stripeCustomerId })
    } else {
      // Hotel sin fila en `subscriptions` todavía (altas viejas, previas a este módulo).
      sub = await subscriptionsRepo.create({
        id: crypto.randomUUID(),
        hotelId,
        planId,
        status: 'trialing',
        stripeCustomerId,
      } as any)
    }
  }

  const base = origin.replace(/\/$/, '')
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${base}/panel/suscripcion?checkout=success`,
    cancel_url: `${base}/panel/suscripcion?checkout=cancelled`,
    metadata: { hotelId, planId },
    subscription_data: {
      metadata: { hotelId, planId },
      // Stripe cobra solo al vencer el trial. `trial_period_days` va únicamente con días > 0:
      // mandarlo en 0 o negativo es un 400 de la API, y `undefined` es "sin prueba".
      ...(trialDays && trialDays > 0 ? { trial_period_days: Math.floor(trialDays) } : {}),
    },
    // La tarjeta se pide SIEMPRE, incluso con trial: es el punto del #28 — sin método de pago
    // guardado no hay cobro automático al día siguiente del vencimiento.
    payment_method_collection: 'always',
  })

  if (!session.url) throw new Error('Stripe no devolvió una URL de checkout')
  logger.info('Checkout de suscripción creado', { hotelId, planId })
  return { url: session.url }
}
