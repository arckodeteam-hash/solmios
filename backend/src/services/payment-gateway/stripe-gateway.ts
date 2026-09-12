// services/payment-gateway/stripe-gateway.ts — Adapter de Stripe sobre el puerto PaymentGateway.
//
// Reemplaza a las DOS clases StripeUseCase duplicadas (payments y bookingengine), que además
// usaban apiVersions distintas de Stripe. Una sola implementación, una sola apiVersion.

import Stripe from 'stripe'
import type { Logger } from 'arckode-framework'
import type {
  ChargeRequest, ChargeResult, ConfirmContext, GatewayCapabilities, GatewayMode,
  PaymentOutcome, PaymentProvider, RefundResult, RefundableGateway,
} from './types'

/** Una sola apiVersion para todo el sistema (antes: 2026-05-27.dahlia vs 2025-08-27.basil). */
const STRIPE_API_VERSION = '2025-08-27.basil'

// fix-refund-pos-card: rango real que la API de Stripe acepta para `expires_at` en una Checkout
// Session (documentado por Stripe: mínimo 30 minutos, máximo 24 horas desde `created`). El producto
// pidió 15 minutos para el POS de restaurante — Stripe lo RECHAZARÍA (400, "expires_at too soon") —
// así que se usa el mínimo real de 30 minutos, no el valor pedido. Ver proposal.md, sección "Decisiones
// de diseño".
const STRIPE_CHECKOUT_EXPIRY_MIN_MINUTES = 30
const STRIPE_CHECKOUT_EXPIRY_MAX_MINUTES = 24 * 60

export interface StripeCredentials {
  secretKey: string
  publishableKey?: string
  webhookSecret?: string
  currency?: string
}

/** Extrae SOLO marca + últimos 4 de un objeto `card` de Stripe. Cualquier otro campo se descarta. */
function pickCard(card: any): PaymentOutcome['card'] | undefined {
  if (!card || typeof card !== 'object') return undefined
  const brand = typeof card.brand === 'string' ? card.brand : undefined
  const last4 = typeof card.last4 === 'string' ? card.last4 : undefined
  if (!brand && !last4) return undefined
  return { brand, last4 }
}

// Epic #265 — Knob SÓLO para pruebas: si `STRIPE_API_HOST` está seteado, el SDK apunta a ese host
// (un doble HTTP local de la API de Stripe que levanta el e2e) en vez de api.stripe.com. Sin la var
// no agrega NADA a las opciones del SDK, así que en producción (donde nunca se setea) el cliente
// queda exactamente como antes. Y sólo aplica con claves de prueba (`sk_test_` / `rk_test_`): con
// cualquier otra (live, restringida, formato desconocido) se ignora aunque esté seteada — una var
// olvidada no puede mandar una clave real (va en `Authorization: Bearer`) a un host ajeno.
type StripeHostConfig = Pick<NonNullable<ConstructorParameters<typeof Stripe>[1]>, 'host' | 'port' | 'protocol'>
function stripeTestHostOverride(secretKey: string): StripeHostConfig {
  const host = process.env.STRIPE_API_HOST
  if (!host || !/^(sk|rk)_test_/.test(secretKey)) return {}
  const port = process.env.STRIPE_API_PORT
  const protocol = (process.env.STRIPE_API_PROTOCOL || 'http') as StripeHostConfig['protocol']
  return { host, ...(port ? { port } : {}), protocol }
}

export class StripeGateway implements RefundableGateway {
  readonly provider: PaymentProvider = 'stripe'
  readonly capabilities: GatewayCapabilities = {
    refund: true,
    void: true,
    paymentLinks: true,
    confirmation: 'push', // webhook firmado (HMAC sobre el body crudo)
  }

  private readonly stripe: Stripe

  constructor(
    private readonly creds: StripeCredentials,
    readonly mode: GatewayMode,
    /** Opcional: sólo se usa para avisar cuando la lectura best-effort del charge falla. */
    private readonly logger?: Pick<Logger, 'warn'>,
  ) {
    if (!creds.secretKey) throw new Error('Stripe: falta secretKey')
    this.stripe = new Stripe(creds.secretKey, {
      // El tipo de apiVersion está clavado a la versión del SDK; fijamos la nuestra a propósito.
      apiVersion: STRIPE_API_VERSION as any,
      appInfo: { name: 'SolmiOS', version: '1.0.0' },
      ...stripeTestHostOverride(creds.secretKey),
    })
  }

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    try {
      // F0 0.15 — Idempotencia a nivel proveedor. Sin esto, un doble submit del huesped o un
      // reintento del webhook abre DOS Checkout Sessions y cobra dos veces. La clave es el
      // `reservationId` (única por reserva) — ver spec booking-unification §7. Stripe reusa la
      // sesión existente si la misma key llega de nuevo dentro de las 24h.
      const options = req.idempotencyKey ? { idempotencyKey: req.idempotencyKey } : undefined
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: (req.currency || this.creds.currency || 'usd').toLowerCase(),
            product_data: { name: req.description },
            // amountMinor YA viene en centavos: no multiplicar de nuevo.
            unit_amount: req.amountMinor,
          },
          quantity: 1,
        }],
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        customer_email: req.customerEmail,
        client_reference_id: req.reference,
        metadata: { reference: req.reference, hotelId: req.hotelId, ...(req.metadata || {}) },
        // Sin esto, el PaymentIntent subyacente NO hereda el metadata de la Session. El webhook
        // payment_intent.payment_failed llega con el PaymentIntent como payload — sin este
        // metadata, mapStatus mapea status:'failed' pero reference queda '' (client_reference_id
        // no existe en PaymentIntent) y settle-webhook no sabe qué payment actualizar.
        payment_intent_data: { metadata: { reference: req.reference, hotelId: req.hotelId } },
      }
      // fix-refund-pos-card: clampeado al rango real de Stripe (30min–24h) — un valor pedido fuera
      // de rango (ej. los 15min que pidió el producto) se ajusta en vez de dejar que Stripe rechace
      // la sesión con 400.
      if (req.expiresInMinutes) {
        const minutes = Math.min(
          Math.max(req.expiresInMinutes, STRIPE_CHECKOUT_EXPIRY_MIN_MINUTES),
          STRIPE_CHECKOUT_EXPIRY_MAX_MINUTES,
        )
        sessionParams.expires_at = Math.floor(Date.now() / 1000) + minutes * 60
      }
      const session = await this.stripe.checkout.sessions.create(sessionParams, options as any)
      if (!session.url) return { status: 'failed', reason: 'Stripe no devolvió URL de checkout' }
      return { status: 'redirect', redirectUrl: session.url, providerRef: session.id }
    } catch (e: any) {
      return { status: 'failed', reason: e?.message || 'Stripe rechazó el cobro' }
    }
  }

  /**
   * Verifica la firma del webhook contra el secreto DE ESTE HOTEL y traduce el evento.
   * Devuelve null si la firma no valida: un evento no autenticado no puede mover dinero.
   *
   * Requiere los bytes CRUDOS. `JSON.stringify(body)` no reproduce la firma (orden de claves,
   * espacios, unicode) — de ahí que el webhook devolviera 400 a todo evento mientras el
   * framework descartaba el rawBody.
   */
  async confirm(ctx: ConfirmContext): Promise<PaymentOutcome | null> {
    const signature = ctx.headers?.['stripe-signature']
    if (!signature) return null
    if (!this.creds.webhookSecret) {
      throw new Error('Stripe: falta webhookSecret para verificar la firma del webhook')
    }
    if (!ctx.rawBody) {
      throw new Error(
        'Stripe: no hay rawBody. La firma se calcula sobre los bytes crudos y el framework ' +
        'los descarta al parsear el JSON (ver PG-0). Sin esto la firma NUNCA valida.',
      )
    }

    let event: Stripe.Event
    try {
      // `constructEventAsync`, NO `constructEvent`: bajo Bun el sincrónico lanza
      // "SubtleCryptoProvider cannot be used in a synchronous context" y rechaza TODO evento.
      event = await this.stripe.webhooks.constructEventAsync(ctx.rawBody, signature, this.creds.webhookSecret)
    } catch {
      return null // firma inválida → impostor
    }

    const obj = event.data.object as any
    const status = this.mapStatus(event.type, obj)
    if (!status) return null // evento que no nos interesa

    const outcome: PaymentOutcome = {
      eventId: event.id,
      providerRef: obj.id,
      status,
      amountMinor: Number(obj.amount_total ?? obj.amount ?? 0),
      currency: String(obj.currency ?? this.creds.currency ?? 'usd'),
      reference: String(obj.client_reference_id ?? obj.metadata?.reference ?? ''),
      raw: event,
    }
    if (typeof event.created === 'number') {
      outcome.occurredAt = new Date(event.created * 1000).toISOString()
    }

    // REQ-RWP-01: detalle del outcome para payment_attempts. Sólo marca + last4, nunca el PAN.
    switch (event.type) {
      case 'payment_intent.payment_failed': {
        const err = obj.last_payment_error
        if (err) {
          outcome.failureCode = err.code ?? err.decline_code ?? undefined
          outcome.failureMessage = err.message ?? undefined
          const card = pickCard(err.payment_method?.card)
          if (card) outcome.card = card
        }
        break
      }
      case 'checkout.session.completed': {
        if (status === 'paid' && typeof obj.payment_intent === 'string') {
          Object.assign(outcome, await this.enrichFromCharge(obj.payment_intent))
        }
        break
      }
      case 'charge.refunded':
      case 'refund.created': {
        if (typeof obj.receipt_url === 'string') outcome.receiptUrl = obj.receipt_url
        break
      }
    }

    return outcome
  }

  /**
   * Lectura BEST-EFFORT del charge detrás de una Checkout Session pagada: marca/last4 y recibo.
   * La sesión no trae esos datos; hay que ir a buscarlos. Si la llamada falla, el outcome sale
   * igual (status 'paid' intacto) sin `card`/`receiptUrl`: un dato decorativo no puede tumbar
   * ni retrasar el asiento de un cobro que ya entró.
   */
  private async enrichFromCharge(
    paymentIntentId: string,
  ): Promise<Pick<PaymentOutcome, 'card' | 'receiptUrl'>> {
    try {
      const pi: any = await this.stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
      const charge = pi?.latest_charge
      if (!charge || typeof charge !== 'object') return {}
      const out: Pick<PaymentOutcome, 'card' | 'receiptUrl'> = {}
      const card = pickCard(charge.payment_method_details?.card)
      if (card) out.card = card
      if (typeof charge.receipt_url === 'string') out.receiptUrl = charge.receipt_url
      return out
    } catch (e: any) {
      this.logger?.warn(`Stripe: no se pudo leer el charge de ${paymentIntentId} (${e?.message || e}); outcome sin tarjeta/recibo`)
      return {}
    }
  }

  private mapStatus(type: string, obj: any): PaymentOutcome['status'] | null {
    switch (type) {
      case 'checkout.session.completed':
        return obj.payment_status === 'paid' ? 'paid' : 'pending'
      case 'payment_intent.succeeded':
        return 'paid'
      case 'payment_intent.payment_failed':
        return 'failed'
      case 'charge.refunded':
      case 'refund.created':
        return 'refunded'
      // fix-refund-pos-card: la Checkout Session se agotó sin que nadie pagara (ver `expires_at` en
      // createCharge). Distinto de 'failed': acá no hubo intento de cobro rechazado.
      case 'checkout.session.expired':
        return 'expired'
      default:
        return null
    }
  }

  async refund(providerRef: string, amountMinor?: number, idempotencyKey?: string): Promise<RefundResult> {
    // #272: misma clave → Stripe devuelve el refund original (24 h) en vez de crear un segundo.
    const options = idempotencyKey ? { idempotencyKey } : undefined
    const r = await this.stripe.refunds.create({
      payment_intent: await this.paymentIntentOf(providerRef),
      ...(amountMinor ? { amount: amountMinor } : {}),
    }, options as any)
    return { refundId: r.id, status: r.status || 'unknown' }
  }

  /**
   * #271 MR-06: `refunds.create` sólo acepta un PaymentIntent, pero lo que se guarda como
   * referencia de un cobro por Checkout es el id de la SESIÓN (`cs_...`): settle-webhook.ts
   * persiste `outcome.providerRef` y post-booking-payment.ts guarda `stripeSessionId`. Acá se
   * resuelve la sesión → su `payment_intent`; un `pi_` (cobro directo) pasa tal cual.
   */
  private async paymentIntentOf(providerRef: string): Promise<string> {
    if (!providerRef.startsWith('cs_')) return providerRef
    const s = await this.stripe.checkout.sessions.retrieve(providerRef)
    const pi = s.payment_intent
    const id = typeof pi === 'string' ? pi : pi?.id
    if (!id) throw new Error(`Stripe: la sesión de checkout ${providerRef} no tiene cargo asociado (sin payment_intent)`)
    return id
  }

  async voidCharge(providerRef: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(providerRef)
  }

  /** Link de pago reutilizable. Capacidad propia de Stripe: Azul y CardNet no la tienen. */
  async createPaymentLink(params: {
    amountMinor: number
    currency: string
    description: string
  }): Promise<{ id: string; url: string }> {
    const link = await this.stripe.paymentLinks.create({
      line_items: [{
        price_data: {
          currency: (params.currency || this.creds.currency || 'usd').toLowerCase(),
          product_data: { name: params.description },
          unit_amount: params.amountMinor,
        },
        quantity: 1,
      }] as any,
    })
    return { id: link.id, url: link.url }
  }

  /**
   * Golpea la API para validar las credenciales de verdad. Que una llave se haya guardado no
   * significa que sirva: puede estar revocada, ser de otra cuenta, o tener el prefijo cambiado.
   */
  async retrieveAccount(): Promise<{ id: string; name?: string }> {
    // Sin argumentos devuelve la cuenta dueña de la API key (el typing pide un id, la API no).
    const acct: any = await (this.stripe.accounts as any).retrieve()
    return {
      id: String(acct?.id ?? ''),
      name: acct?.settings?.dashboard?.display_name || acct?.business_profile?.name || undefined,
    }
  }

  /** Consulta puntual de una sesión (reconciliación / fallback si el webhook no llegó). */
  async getSession(sessionId: string): Promise<Stripe.Checkout.Session | null> {
    try {
      return await this.stripe.checkout.sessions.retrieve(sessionId)
    } catch {
      return null
    }
  }
}
