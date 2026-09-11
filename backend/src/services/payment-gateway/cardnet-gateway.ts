// services/payment-gateway/cardnet-gateway.ts — Adapter de CardNet Payment Page (pasarela dominicana).
//
// Fuente de verdad: guía oficial "Botón de pago — Web con pantalla (POST + 3DS)"
//   https://developers.cardnet.com.do/guias/boton-de-pago/web-con-pantalla-post-3ds.html
// Protocolo VERIFICADO el 2026-09-11 contra el sandbox real (labservicios.cardnet.com.do) con el
// comercio de pruebas que publica esa misma guía (MerchantNumber 349011300 / Terminal 00567856):
//   1. POST {host}/sessions (JSON) → 200 { SESSION, "session-key" }.
//   2. El navegador hace POST form-urlencoded a {host}/authorize con SESSION (GET devuelve 405).
//   3. CardNet vuelve por POST form-urlencoded a ReturnUrl con SESSION=...&Description=... — sólo
//      trae la SESSION, NUNCA el monto ni la referencia.
//   4. GET {host}/sessions/{SESSION}?sk={session-key} → { ResponseCode, TransactionId, ... };
//      antes de que el tarjetahabiente termine responde 404 {"message":"rspdata_not_found"}.
// No hay firma ni hash: el único secreto es la session-key, que hay que PERSISTIR entre
// createCharge() y confirm() (puerto CardnetSessionStore). Payment Page no tiene refund ni void.
//
// Lo que NO se verificó (requiere el afiliado real del hotel): que el número de comercio/terminal
// propio sea aceptado —CardNet no lo valida al crear la sesión— y una transacción aprobada con
// ResponseCode '00' de punta a punta (el sandbox devolvió '03' en el retorno probado).
//
// CardNet no tiene webhook (`capabilities.confirmation === 'pull'`): el retorno del navegador NO
// es prueba de pago — hay que consultar activamente la sesión para saber si se aprobó.

import type {
  ChargeRequest, ChargeResult, ConfirmContext, GatewayCapabilities, GatewayMode,
  PaymentGateway, PaymentOutcome, PaymentProvider,
} from './types'

export interface CardnetCredentials {
  /** Número de comercio (MerchantNumber) asignado por CardNet al afiliar. */
  merchantNumber: string
  /** Terminal (MerchantTerminal) asignada dentro del comercio. */
  merchantTerminal: string
  /** Nombre del comercio (40 chars, mayúsculas). Opcional: el sandbox acepta sin él. */
  merchantName?: string
  /** MCC del comercio (MerchantType). Opcional. */
  merchantType?: string
  currency?: string
}

/**
 * Traduce el JSON genérico de `payment_gateways.credentials` (merchantId/terminalId, mismo shape
 * que Azul — ver usecases/build-credentials.ts) al shape propio de CardNet. Centralizado acá para
 * que `registry.ts` y el usecase de `testConnection` no dupliquen el mapeo.
 */
export function toCardnetCredentials(stored: Record<string, unknown>): CardnetCredentials {
  return {
    merchantNumber: String(stored.merchantId || ''),
    merchantTerminal: String(stored.terminalId || ''),
    merchantName: stored.merchantName ? String(stored.merchantName) : undefined,
    merchantType: stored.merchantType ? String(stored.merchantType) : undefined,
    currency: stored.currency ? String(stored.currency) : undefined,
  }
}

/** Hosts de Payment Page (guía oficial, sección "Ambientes"). */
export const CARDNET_HOST: Record<GatewayMode, string> = {
  test: 'https://labservicios.cardnet.com.do',
  live: 'https://ecommerce.cardnet.com.do',
}

/** CardNet sólo procesa pesos dominicanos y dólares; CurrencyCode es el numérico ISO 4217. */
const CARDNET_CURRENCY: Record<string, string> = { DOP: '214', USD: '840' }

export function cardnetCurrencyCode(currency: string): string | null {
  return CARDNET_CURRENCY[String(currency || '').toUpperCase()] || null
}

/** Amount = 12 dígitos con ceros a la izquierda, en unidades menores (000000010000 = RD$100.00). */
export function formatCardnetAmount(amountMinor: number): string {
  return String(amountMinor).padStart(12, '0')
}

/** Fila que hay que persistir entre createCharge() y confirm(): la session-key es el único secreto. */
export interface CardnetSessionRow {
  /** SESSION devuelta por CardNet (`sess-...`). */
  id: string
  hotelId: string
  provider: 'cardnet'
  /** Nuestra referencia (reserva/folio): CardNet no la devuelve en el retorno. */
  reference: string
  /** session-key: sin ella no se puede consultar el estado de la sesión. */
  secret: string
  amountMinor: number
  currency: string
  mode: GatewayMode
}

/** Puerto de persistencia; lo implementa quien construye el adapter (registry sobre payment_gateway_sessions). */
export interface CardnetSessionStore {
  save(row: CardnetSessionRow): Promise<void>
  load(session: string): Promise<CardnetSessionRow | null>
}

interface CardnetSessionResponse { SESSION?: string; 'session-key'?: string; message?: string }

/** GET /sessions/{SESSION}?sk=. '00' = aprobado (guía oficial); cualquier otro código = rechazado. */
export interface CardnetStatusResponse {
  ResponseCode: string
  TransactionId?: string; OrdenID?: string; AuthorizationCode?: string
  RetrivalReferenceNumber?: string; CreditCardNumber?: string; TxToken?: string; SESSION?: string
}

export class CardnetGateway implements PaymentGateway {
  readonly provider: PaymentProvider = 'cardnet'
  readonly capabilities: GatewayCapabilities = {
    refund: false, // Payment Page no expone reembolso ni anulación
    void: false,
    paymentLinks: false,
    confirmation: 'pull', // sin webhook: hay que consultar la sesión
  }

  constructor(
    private readonly creds: CardnetCredentials,
    readonly mode: GatewayMode,
    private readonly sessions: CardnetSessionStore,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    if (!creds.merchantNumber) throw new Error('CardNet: falta comercio (MerchantNumber)')
    if (!creds.merchantTerminal) throw new Error('CardNet: falta terminal (MerchantTerminal)')
  }

  private get host(): string { return CARDNET_HOST[this.mode] }

  /** Cuerpo del POST /sessions con lo que la guía marca como obligatorio + opcionales si existen. */
  private sessionPayload(amount: string, ordenId: string, currencyCode: string, returnUrl: string, cancelUrl: string) {
    return {
      TransactionType: '0200',
      CurrencyCode: currencyCode,
      AcquiringInstitutionCode: '349',
      MerchantNumber: this.creds.merchantNumber,
      MerchantTerminal: this.creds.merchantTerminal,
      ...(this.creds.merchantName ? { MerchantName: this.creds.merchantName } : {}),
      ...(this.creds.merchantType ? { MerchantType: this.creds.merchantType } : {}),
      ReturnUrl: returnUrl,
      CancelUrl: cancelUrl,
      PageLanguaje: 'ESP', // sic: así lo escribe CardNet
      OrdenId: ordenId,
      TransactionId: String(Math.floor(100000 + Math.random() * 900000)), // 6 dígitos
      Tax: '000000000000',
      Amount: amount,
    }
  }

  private async postSession(payload: Record<string, string>): Promise<{ session: string; secret: string }> {
    const r = await this.fetchImpl(`${this.host}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await r.json().catch(() => ({})) as CardnetSessionResponse
    if (!r.ok) throw new Error(body?.message || `HTTP ${r.status}`)
    if (!body.SESSION || !body['session-key']) throw new Error('respuesta sin SESSION/session-key')
    return { session: body.SESSION, secret: body['session-key'] }
  }

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    try {
      const currency = (req.currency || this.creds.currency || 'DOP').toUpperCase()
      const currencyCode = cardnetCurrencyCode(currency)
      if (!currencyCode) return { status: 'failed', reason: 'CardNet sólo cobra en DOP o USD' }
      if (!Number.isInteger(req.amountMinor) || req.amountMinor < 0) {
        return { status: 'failed', reason: 'CardNet: el monto debe ser un entero en unidades menores' }
      }
      const payload = this.sessionPayload(
        formatCardnetAmount(req.amountMinor), req.reference.slice(0, 20), currencyCode, req.successUrl, req.cancelUrl,
      )
      const { session, secret } = await this.postSession(payload)
      await this.sessions.save({
        id: session, hotelId: req.hotelId, provider: 'cardnet', reference: req.reference,
        secret, amountMinor: req.amountMinor, currency: currency.toLowerCase(), mode: this.mode,
      })
      // /authorize exige POST: redirigimos a una página propia que auto-envía el form (bookingengine).
      const origin = new URL(req.successUrl).origin
      const redirectUrl = `${origin}/api/pay/go/cardnet/${encodeURIComponent(req.hotelId)}?session=${encodeURIComponent(session)}`
      return { status: 'redirect', redirectUrl, providerRef: session }
    } catch (e: any) {
      return { status: 'failed', reason: `CardNet no creó la sesión: ${e?.message || 'error desconocido'}` }
    }
  }

  /** Form que el navegador tiene que POSTear para entrar a la página hospedada de CardNet. */
  hostedForm(session: string): { action: string; fields: Record<string, string> } {
    return { action: `${this.host}/authorize`, fields: { SESSION: session } }
  }

  /**
   * Modo 'pull': el POST de retorno sólo trae la SESSION, y una SESSION la puede escribir cualquiera.
   * Sólo confirma si la sesión es NUESTRA (fila guardada, del mismo hotel) y CardNet dice que se aprobó.
   */
  async confirm(ctx: ConfirmContext): Promise<PaymentOutcome | null> {
    const session = ctx.providerRef || ctx.query?.SESSION
    if (!session) return null
    const row = await this.sessions.load(session)
    if (!row || row.hotelId !== ctx.hotelId) return null

    const res = await this.queryStatus(session, row.secret)
    if (!res?.ResponseCode) return null

    return {
      eventId: session,
      providerRef: session,
      status: res.ResponseCode === '00' ? 'paid' : 'failed',
      amountMinor: row.amountMinor,
      currency: row.currency,
      reference: row.reference,
      raw: res,
    }
  }

  /** 404 rspdata_not_found = el tarjetahabiente todavía no terminó: no es fallo, es "sin confirmación". */
  private async queryStatus(session: string, secret: string): Promise<CardnetStatusResponse | null> {
    try {
      const r = await this.fetchImpl(`${this.host}/sessions/${encodeURIComponent(session)}?sk=${encodeURIComponent(secret)}`)
      if (!r.ok) return null
      return await r.json() as CardnetStatusResponse
    } catch {
      return null // red caída / host inalcanzable: sin confirmación, no se asume pagado
    }
  }

  /** "Probar conexión": crea una sesión de 1 unidad sin guardarla. Verifica host y formato, no el afiliado. */
  async probe(): Promise<{ ok: boolean; message: string }> {
    try {
      const payload = this.sessionPayload(
        '000000000001', 'probe', cardnetCurrencyCode(this.creds.currency || 'DOP') || '214',
        'https://localhost/probe', 'https://localhost/probe',
      )
      await this.postSession(payload)
      return {
        ok: true,
        message: `CardNet (${this.mode}) respondió una sesión en ${this.host}: el host y el formato son correctos. ` +
          'OJO: CardNet no valida el afiliado al crear la sesión — el número de comercio/terminal sólo se confirma con un pago de prueba.',
      }
    } catch (e: any) {
      return { ok: false, message: `CardNet no respondió una sesión válida en ${this.host}: ${e?.message || 'error desconocido'}` }
    }
  }
}
