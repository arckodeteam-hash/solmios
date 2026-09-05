// services/payment-gateway/paypal-gateway.ts — Adapter de PayPal (Orders v2 + Payments v2) sobre
// el puerto PaymentGateway.
//
// PayPal confirma en modo push, como Stripe, pero con dos diferencias que mandan sobre el diseño
// de este archivo:
//
//   1. No hay SDK: se pega a la REST API con `fetch` crudo (mismo criterio que cardnet-gateway).
//      Toda llamada necesita un access token OAuth2 que se pide con client_id/client_secret y
//      dura ~9 horas: se cachea en la instancia, porque pedir uno por cobro es un round-trip
//      extra por cada huésped que aprieta "Pagar".
//   2. Los montos viajan como STRING DECIMAL ('250.00'), no en unidades menores. La traducción
//      va y viene por `toPayPalAmount`/`fromPayPalAmount`, que respetan los decimales REALES de
//      cada moneda: dividir siempre por 100 cobraría 100 veces de menos en yenes o pesos chilenos.
//
// La firma del webhook NO se verifica acá: eso vive en `paypal-webhook.ts` (verificación offline
// RSA). Este adapter sólo la invoca y decide qué hacer con el resultado.

import type {
  ChargeRequest, ChargeResult, ConfirmContext, GatewayCapabilities, GatewayMode,
  PaymentOutcome, PaymentProvider, RefundResult, RefundableGateway,
} from './types'
import { verifyPayPalWebhookSignature } from './paypal-webhook'

export interface PayPalCredentials {
  /** Client ID de la app REST de PayPal (público: viaja en el SDK del navegador). */
  clientId: string
  /** Client Secret de la app REST. Con esto solo se cobra y se reembolsa: nunca sale de acá. */
  clientSecret: string
  /** Id de la SUSCRIPCIÓN al webhook (WH-...). Va firmado dentro del mensaje que valida la firma. */
  webhookId: string
  currency?: string
}

/**
 * Traduce el JSON genérico de `payment_gateways.credentials` (secretKey/publishableKey/
 * webhookSecret — ver usecases/build-credentials.ts) al shape propio de PayPal. Mismo criterio
 * que `toAzulCredentials`/`toCardnetCredentials`: el mapeo vive junto al adapter para que
 * `registry.ts` y el usecase de `testConnection` no lo dupliquen ni lo hagan divergir.
 */
export function toPayPalCredentials(stored: Record<string, unknown>): PayPalCredentials {
  return {
    clientId: String(stored.publishableKey || ''),   // "llave pública" genérica = Client ID
    clientSecret: String(stored.secretKey || ''),    // "llave secreta" genérica = Client Secret
    webhookId: String(stored.webhookSecret || ''),   // "secreto del webhook" genérico = Webhook Id
    currency: stored.currency ? String(stored.currency) : undefined,
  }
}

const PAYPAL_API_BASE: Record<GatewayMode, string> = {
  test: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
}

/**
 * Monedas que PayPal cobra SIN decimales: mandar '50.00' en JPY es un 422 ("DECIMALS_NOT_SUPPORTED")
 * y dividir por 100 igual que en USD cobraría 100 veces menos de lo debido. Lista chica y explícita
 * porque el error es silencioso en plata.
 *
 * Son EXACTAMENTE estas tres (PayPal REST: "currencies that do not support decimals"). Ojo con
 * copiar la lista de Stripe: ahí KRW/CLP/VND también son de cero decimales, pero PayPal las cobra
 * con dos, y meterlas acá multiplicaría por 100 cada cobro en esas monedas.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(['HUF', 'JPY', 'TWD'])

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has((currency || '').toUpperCase()) ? 0 : 2
}

/** Unidades menores (entero) → string decimal de PayPal. 12345 USD → '123.45'; 5000 JPY → '5000'. */
export function toPayPalAmount(amountMinor: number, currency: string): string {
  const decimals = currencyDecimals(currency)
  const sign = amountMinor < 0 ? '-' : ''
  const abs = Math.round(Math.abs(amountMinor))
  if (decimals === 0) return `${sign}${abs}`
  const factor = 10 ** decimals
  const whole = Math.floor(abs / factor)
  const frac = String(abs % factor).padStart(decimals, '0')
  return `${sign}${whole}.${frac}`
}

/**
 * String decimal de PayPal → unidades menores. Se parsea el string a mano (no `parseFloat * 100`):
 * un float intermedio convierte '119.95' en 11994.999… y redondear tarde deja diferencias de un
 * centavo entre lo cobrado y lo asentado.
 */
export function fromPayPalAmount(value: string | number | undefined, currency: string): number {
  if (value === undefined || value === null) return 0
  const raw = String(value).trim()
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(raw)
  if (!m) return 0
  const decimals = currencyDecimals(currency)
  const sign = m[1] === '-' ? -1 : 1
  const whole = m[2] || '0'
  const frac = (m[3] || '').slice(0, decimals).padEnd(decimals, '0')
  return sign * Number(`${whole}${frac}`)
}

/** Margen para no usar un token que expira mientras el request está en vuelo. */
const TOKEN_EXPIRY_SKEW_SECONDS = 60

/** Búsqueda de header case-insensitive: HTTP no garantiza el casing y PayPal lo cambió alguna vez. */
function header(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return ''
  const direct = headers[name]
  if (typeof direct === 'string' && direct) return direct
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name && typeof v === 'string') return v
  }
  return ''
}

/**
 * Saca monto, referencia y id de captura del `resource` del webhook, que NO tiene una sola forma:
 *
 *   - PAYMENT.CAPTURE.* → el resource ES la captura: `amount` y `custom_id` cuelgan de la raíz.
 *   - CHECKOUT.ORDER.COMPLETED / APPROVED / VOIDED → el resource es la ORDEN: lo que importa vive
 *     en `purchase_units[0]` (`amount`, `custom_id`, y la captura en `payments.captures[0]`).
 *
 * Leer sólo la raíz — que es lo que se hacía — dejaba los eventos de orden con `amountMinor: 0` y
 * `reference: ''`: un pago confirmado que no se puede conciliar con ninguna reserva.
 */
function readResource(resource: any): { amount: any; reference: string; captureId: string } {
  const res = resource ?? {}
  const unit = (Array.isArray(res.purchase_units) ? res.purchase_units[0] : null) ?? {}
  const capture = (Array.isArray(unit.payments?.captures) ? unit.payments.captures[0] : null) ?? {}
  const amount = res.amount ?? unit.amount ?? capture.amount
    ?? res.seller_receivable_breakdown?.gross_amount ?? {}
  const reference = res.custom_id || res.invoice_id
    || unit.custom_id || unit.invoice_id || capture.custom_id
    || res.reference_id || unit.reference_id || ''
  return { amount, reference: String(reference), captureId: String(capture.id || '') }
}

export class PayPalGateway implements RefundableGateway {
  readonly provider: PaymentProvider = 'paypal'
  readonly capabilities: GatewayCapabilities = {
    refund: true,
    void: true,
    paymentLinks: false, // PayPal tiene invoicing, pero no un "payment link" equivalente al de Stripe
    confirmation: 'push', // webhook firmado (RSA sobre el body crudo) — ver paypal-webhook.ts
  }

  private token: { value: string; expiresAtMs: number } | null = null

  constructor(
    private readonly creds: PayPalCredentials,
    readonly mode: GatewayMode,
  ) {
    // El constructor valida el FORMATO (que estén): `testConnection` lo usa como primer chequeo
    // antes de gastar una llamada a PayPal, igual que Azul/CardNet.
    if (!creds.clientId) throw new Error('PayPal: falta clientId (Client ID de la app REST)')
    if (!creds.clientSecret) throw new Error('PayPal: falta clientSecret (Client Secret de la app REST)')
  }

  private get base(): string {
    return PAYPAL_API_BASE[this.mode]
  }

  /**
   * Token OAuth2 de client_credentials, cacheado en la instancia hasta poco antes de vencer.
   * Público a propósito: `testConnection` lo usa para validar credenciales de verdad contra PayPal
   * (que estén guardadas no significa que sirvan: pueden estar revocadas o ser de la otra cuenta).
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.token && now < this.token.expiresAtMs) return this.token.value

    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString('base64')
    const res = await fetch(`${this.base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    const body = await res.json().catch(() => ({})) as any
    if (!res.ok || !body?.access_token) {
      throw new Error(body?.error_description || 'PayPal rechazó las credenciales (OAuth2)')
    }
    const ttl = Math.max(Number(body.expires_in || 0) - TOKEN_EXPIRY_SKEW_SECONDS, 0)
    this.token = { value: String(body.access_token), expiresAtMs: now + ttl * 1000 }
    return this.token.value
  }

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    try {
      const currency = (req.currency || this.creds.currency || 'usd').toUpperCase()
      const token = await this.getAccessToken()
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      }
      // Idempotencia del lado de PayPal: un doble click del huésped con el mismo key devuelve la
      // orden original en vez de abrir una segunda (mismo rol que `Idempotency-Key` en Stripe).
      if (req.idempotencyKey) headers['PayPal-Request-Id'] = req.idempotencyKey

      const res = await fetch(`${this.base}/v2/checkout/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: req.reference,
            // `custom_id` es lo único que vuelve en el webhook de la captura: sin esto no hay cómo
            // reconciliar el pago con la reserva/folio que lo originó.
            custom_id: req.reference,
            invoice_id: req.reference,
            description: req.description,
            amount: { currency_code: currency, value: toPayPalAmount(req.amountMinor, currency) },
          }],
          payment_source: {
            paypal: {
              experience_context: {
                user_action: 'PAY_NOW',
                return_url: req.successUrl,
                cancel_url: req.cancelUrl,
              },
            },
          },
        }),
      })
      const body = await res.json().catch(() => ({})) as any
      if (!res.ok) {
        return { status: 'failed', reason: body?.message || 'PayPal rechazó la creación de la orden' }
      }
      // 'approve' es el link clásico; 'payer-action' es el que devuelve Orders v2 cuando se manda
      // `payment_source.paypal`. Aceptar los dos evita quedar sin redirect por una variante de la API.
      const links: Array<{ rel?: string; href?: string }> = Array.isArray(body?.links) ? body.links : []
      const approve = links.find(l => l?.rel === 'approve' || l?.rel === 'payer-action')
      if (!approve?.href) {
        return { status: 'failed', reason: 'PayPal no devolvió URL de aprobación' }
      }
      return { status: 'redirect', redirectUrl: approve.href, providerRef: String(body.id) }
    } catch (e: any) {
      // Igual que stripe-gateway: el cobro que no se pudo crear es un resultado del dominio, no
      // una excepción que tumbe el request del huésped.
      return { status: 'failed', reason: e?.message || 'PayPal rechazó el cobro' }
    }
  }

  /**
   * Autentica el webhook con la verificación offline (paypal-webhook.ts) y traduce el evento.
   * Devuelve null si no es auténtico: un evento sin firma válida no puede mover dinero.
   *
   * La distinción entre `null` y `throw` es la misma que en Stripe: falta de CONFIGURACIÓN nuestra
   * (webhookId sin cargar, rawBody descartado por el framework) es un error a gritar, porque en
   * silencio rechazaría para siempre todos los pagos reales; un impostor es un `null` prolijo.
   */
  async confirm(ctx: ConfirmContext): Promise<PaymentOutcome | null> {
    const signature = header(ctx.headers, 'paypal-transmission-sig')
    if (!signature) return null
    if (!this.creds.webhookId) {
      throw new Error('PayPal: falta webhookId para verificar la firma del webhook')
    }
    if (!ctx.rawBody) {
      throw new Error(
        'PayPal: no hay rawBody. La firma se calcula sobre los bytes crudos y el framework los ' +
        'descarta al parsear el JSON (ver PG-0). Sin esto la firma NUNCA valida.',
      )
    }

    const valid = await verifyPayPalWebhookSignature({
      headers: ctx.headers || {},
      rawBody: ctx.rawBody,
      webhookId: this.creds.webhookId,
    })
    if (!valid) return null // firma inválida → impostor

    let body: any
    try {
      body = JSON.parse(typeof ctx.rawBody === 'string' ? ctx.rawBody : ctx.rawBody.toString('utf8'))
    } catch {
      return null // firmado pero ilegible: no hay nada que asentar
    }

    const status = this.mapStatus(String(body?.event_type || ''))
    if (!status) return null // evento que no nos interesa

    const { amount, reference, captureId } = readResource(body?.resource)
    const currency = String(amount.currency_code || this.creds.currency || 'usd')

    return {
      // El id del EVENTO, no el de la captura: `payment-events.ts` usa `${provider}:${eventId}`
      // como PK de idempotencia, y un CAPTURE.COMPLETED y un CAPTURE.REFUNDED de la MISMA captura
      // colisionarían — el reembolso se descartaría como duplicado y el folio quedaría cobrado.
      eventId: String(body?.id || ''),
      // La captura manda sobre la orden: es el id que aceptan /payments/captures/{id}/refund y el
      // void. Para los PAYMENT.CAPTURE.* el propio resource ya ES la captura.
      providerRef: String(captureId || body?.resource?.id || ''),
      status,
      amountMinor: fromPayPalAmount(amount.value, currency),
      currency,
      reference,
      raw: body,
    }
  }

  private mapStatus(eventType: string): PaymentOutcome['status'] | null {
    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
      case 'CHECKOUT.ORDER.COMPLETED':
        return 'paid'
      case 'PAYMENT.CAPTURE.DENIED':
      case 'PAYMENT.CAPTURE.DECLINED':
        return 'failed'
      case 'PAYMENT.CAPTURE.PENDING':
      case 'CHECKOUT.ORDER.APPROVED':
        // Aprobada pero sin capturar: hay intención de pago, todavía no hay plata.
        return 'pending'
      case 'PAYMENT.CAPTURE.REFUNDED':
      case 'PAYMENT.CAPTURE.REVERSED':
        return 'refunded'
      // La orden se anuló/venció sin que nadie pagara. Distinto de 'failed': no hubo cobro rechazado.
      case 'CHECKOUT.ORDER.VOIDED':
        return 'expired'
      default:
        return null
    }
  }

  /** Reembolso de una CAPTURA. Sin monto = total; con monto = parcial, en el decimal de PayPal. */
  async refund(providerRef: string, amountMinor?: number): Promise<RefundResult> {
    const token = await this.getAccessToken()
    const currency = (this.creds.currency || 'usd').toUpperCase()
    const res = await fetch(`${this.base}/v2/payments/captures/${encodeURIComponent(providerRef)}/refund`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(
        amountMinor
          ? { amount: { currency_code: currency, value: toPayPalAmount(amountMinor, currency) } }
          : {}, // body vacío = reembolso total, es lo que espera la API
      ),
    })
    const body = await res.json().catch(() => ({})) as any
    if (!res.ok) throw new Error(body?.message || 'PayPal rechazó el reembolso')
    return { refundId: String(body?.id || providerRef), status: String(body?.status || 'unknown') }
  }

  /** Anula una AUTORIZACIÓN todavía no capturada (libera el dinero retenido al huésped). */
  async voidCharge(providerRef: string): Promise<void> {
    const token = await this.getAccessToken()
    const res = await fetch(`${this.base}/v2/payments/authorizations/${encodeURIComponent(providerRef)}/void`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as any
      throw new Error(body?.message || 'PayPal rechazó la anulación')
    }
  }
}
