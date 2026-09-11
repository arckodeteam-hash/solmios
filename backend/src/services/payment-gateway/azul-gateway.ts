// services/payment-gateway/azul-gateway.ts — Adapter de Azul Payment Page (Banco Popular Dominicano).
//
// Fuente de verdad: manual oficial "Documento E-Commerce AZUL Página de Pagos (Español) 2023-08"
//   https://dev.azul.com.do/Pages/developer/documentos/plugins/Documento-E-Commerce-AZUL-Pagina-Pagos-(Espanol)-2023-08.pdf
// De ahí salen el algoritmo del AuthHash (HMAC-SHA512 sobre la cadena en Unicode/UTF-16LE, con la
// AuthKey como clave y además concatenada al final — "Manejo de la Autenticación (AuthHash)",
// pág. 65-66), el orden exacto de concatenación de ida y de vuelta (pág. 65), los nombres de los
// campos del POST y del retorno (pág. 14-17) y las URLs de Payment Page (pág. 13).
//
// Única salvedad: no probado contra el sandbox de Azul — no hay credenciales de comercio todavía;
// vectores de prueba independientes en azul-gateway.test.ts.
//
// Azul distingue dos productos:
//   - Azul Payment Page: redirect hospedado, SIN webhook, confirma leyendo el retorno + hash
//     (esto es lo que implementa este adapter — `capabilities.confirmation === 'return'`).
//   - Azul Webservices: API directa server-to-server autenticada con mTLS (certificado cliente),
//     usada normalmente para cobro/consulta/reverso sin redirigir al huésped.
// El certificado (certPem/certKeyPem) se guarda en las credenciales igual porque algunos comercios
// de Azul lo piden incluso para operaciones de soporte de Payment Page (verificación/consulta) —
// dejar el campo listo, aunque createCharge()/confirm() de Payment Page en sí no lo necesiten.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  ChargeRequest, ChargeResult, ConfirmContext, GatewayCapabilities, GatewayMode,
  PaymentGateway, PaymentOutcome, PaymentProvider,
} from './types'
// Refactor cross-cutting: currency desde el enum global (shared/currency.ts — source of truth).
import { CurrencyCode } from '../../shared/currency'

export interface AzulCredentials {
  /** MerchantId asignado por Azul al afiliar el comercio. */
  merchantId: string
  /** AuthKey secreta: la llave con la que se firma (y verifica) el AuthHash. */
  authKey: string
  /** Certificado cliente (mTLS), PEM. Lo exige Azul Webservices, no Payment Page en sí. */
  certPem?: string
  /** Llave privada del certificado cliente, PEM. */
  certKeyPem?: string
  currency?: string
}

/**
 * Traduce el JSON genérico de `payment_gateways.credentials` (mismo shape que Stripe/CardNet:
 * secretKey/merchantId/terminalId/certPem/certKeyPem — ver usecases/build-credentials.ts) al
 * shape propio de Azul. Centralizado acá para que `registry.ts` y el usecase de `testConnection`
 * no dupliquen el mapeo ni lo hagan divergir.
 */
export function toAzulCredentials(stored: Record<string, unknown>): AzulCredentials {
  return {
    merchantId: String(stored.merchantId || ''),
    authKey: String(stored.secretKey || ''), // "llave secreta" genérica = AuthKey de Azul
    certPem: stored.certPem ? String(stored.certPem) : undefined,
    certKeyPem: stored.certKeyPem ? String(stored.certKeyPem) : undefined,
    currency: stored.currency ? String(stored.currency) : undefined,
  }
}

/**
 * Hosts de Payment Page según el manual (pág. 13). Producción tiene además un site alterno,
 * `https://contpagos.azul.com.do/PaymentPage/Default.aspx`, para cuando el principal no responde
 * — no se usa por ahora (no hay failover en este adapter).
 */
const AZUL_PAYMENT_PAGE_URL: Record<GatewayMode, string> = {
  test: 'https://pruebas.azul.com.do/PaymentPage/',
  live: 'https://pagos.azul.com.do/PaymentPage/Default.aspx',
}

/**
 * HMAC-SHA512 tal como lo define Azul: la AuthKey es la CLAVE del HMAC y, además, va concatenada
 * al final de `concat` (eso lo hace el caller). La cadena se codifica en Unicode (UTF-16LE,
 * `Encoding.Unicode` en el ejemplo C# / `mb_convert_encoding(..., 'UTF-16LE')` en el PHP del
 * manual). Hex en minúscula, como el `{0:x2}` del ejemplo oficial.
 */
function azulHash(concat: string, authKey: string, encoding: 'utf16le' | 'utf8' = 'utf16le'): string {
  return createHmac('sha512', authKey).update(Buffer.from(concat, encoding)).digest('hex')
}

/**
 * Campos que viajan HACIA Azul Payment Page (manual pág. 14-16). Todos son obligatorios en el
 * POST, incluidos los custom fields aunque no se usen.
 */
export interface AzulPaymentPageFields {
  MerchantId: string
  MerchantName: string
  MerchantType: string
  CurrencyCode: string
  OrderNumber: string
  /** Entero en unidades menores (centavos), como string — Azul no usa floats. */
  Amount: string
  /** Impuesto ya incluido en el total facturado aparte por SolmiOS: se manda en 0. */
  ITBIS: string
  ApprovedUrl: string
  DeclinedUrl: string
  CancelUrl: string
  /** '1' | '0'. Sin custom fields se manda '0' con label/value vacíos, pero el campo viaja igual. */
  UseCustomField1: string
  CustomField1Label: string
  CustomField1Value: string
  /** '1' | '0'. */
  UseCustomField2: string
  CustomField2Label: string
  CustomField2Value: string
}

/**
 * Hash de ida (AuthHash): HMAC-SHA512 de la concatenación de los campos + AuthKey, en el orden
 * exacto del manual (pág. 65). Función PURA y testeable a propósito, separada del resto del
 * adapter. Para el requerimiento Azul acepta la cadena en UTF-8 o Unicode indistintamente; se
 * usa Unicode (UTF-16LE), que el manual recomienda como más seguro.
 */
export function buildAuthHash(fields: AzulPaymentPageFields, authKey: string): string {
  const concat = [
    fields.MerchantId, fields.MerchantName, fields.MerchantType, fields.CurrencyCode,
    fields.OrderNumber, fields.Amount, fields.ITBIS,
    fields.ApprovedUrl, fields.DeclinedUrl, fields.CancelUrl,
    fields.UseCustomField1, fields.CustomField1Label, fields.CustomField1Value,
    fields.UseCustomField2, fields.CustomField2Label, fields.CustomField2Value,
    authKey,
  ].join('')
  return azulHash(concat, authKey)
}

/**
 * Campos que Azul manda de VUELTA en el redirect de retorno (query string) — tabla "Valores de
 * Retorno" del manual (pág. 17). Los que entran en el hash son los marcados HASH=Si.
 */
export interface AzulReturnFields {
  OrderNumber: string
  Amount: string
  AuthorizationCode?: string
  /** Fecha/hora de la transacción tal como la manda Azul (p.ej. 'yyyyMMddHHmmss'). */
  DateTime?: string
  /** Texto del procesador (p.ej. 'ISO8583'). NO indica aprobación: para eso está IsoCode. */
  ResponseCode?: string
  /** Código ISO de respuesta: '00' = aprobada; cualquier otro valor = rechazada/error. */
  IsoCode?: string
  /** 'APROBADA' cuando IsoCode es '00'; en otro caso el motivo del rechazo. */
  ResponseMessage?: string
  ErrorDescription?: string
  RRN?: string
  /** Fuera del hash. Identificador interno de Azul para la transacción. */
  AzulOrderId?: string
  /** Hash que Azul calcula sobre el retorno; debemos poder reproducirlo con la misma fórmula. */
  AuthHash: string
}

/**
 * Verifica el hash de retorno recalculándolo con la fórmula oficial (orden pág. 65: OrderNumber +
 * Amount + AuthorizationCode + DateTime + ResponseCode + IsoCode + ResponseMessage +
 * ErrorDescription + RRN + AuthKey) y comparando contra el que mandó Azul. Es la única barrera
 * contra un retorno falsificado: Payment Page no tiene webhook de respaldo, así que si esto no
 * autentica, no hay otra fuente de verdad.
 *
 * El manual dice que el retorno se genera desde una cadena Unicode (UTF-16LE); se acepta también
 * UTF-8 como fallback. Ambas variantes son HMAC con la AuthKey secreta, así que aceptar las dos
 * no debilita la verificación. Comparación en tiempo constante.
 */
export function verifyReturnHash(fields: AzulReturnFields, authKey: string): boolean {
  if (!fields.AuthHash) return false
  const concat = [
    fields.OrderNumber, fields.Amount,
    fields.AuthorizationCode ?? '', fields.DateTime ?? '', fields.ResponseCode ?? '',
    fields.IsoCode ?? '', fields.ResponseMessage ?? '', fields.ErrorDescription ?? '',
    fields.RRN ?? '',
    authKey,
  ].join('')
  const received = Buffer.from(fields.AuthHash.toLowerCase(), 'utf8')
  return (['utf16le', 'utf8'] as const).some(encoding => {
    const expected = Buffer.from(azulHash(concat, authKey, encoding), 'utf8')
    return expected.length === received.length && timingSafeEqual(expected, received)
  })
}

export class AzulGateway implements PaymentGateway {
  readonly provider: PaymentProvider = 'azul'
  readonly capabilities: GatewayCapabilities = {
    // Payment Page NO soporta reembolso/anulación (eso requiere afiliación a Azul Webservices).
    refund: false,
    void: false,
    paymentLinks: false,
    confirmation: 'return', // sin webhook: confirma leyendo el retorno + AuthHash
  }

  constructor(
    private readonly creds: AzulCredentials,
    readonly mode: GatewayMode,
  ) {
    if (!creds.merchantId) throw new Error('Azul: falta merchantId')
    if (!creds.authKey) throw new Error('Azul: falta authKey')
  }

  /**
   * Arma el redirect a Azul Payment Page. En una integración real Azul exige que estos campos
   * viajen por un formulario HTML auto-submit vía POST (no un GET con querystring) — el AuthHash
   * y el resto de campos no deberían ir expuestos en una URL que queda en logs/historial. El
   * contrato `ChargeResult.redirect` de este puerto solo transporta una `redirectUrl: string`, así
   * que acá se codifican como querystring; el caller (usecase de checkout) es responsable de
   * renderizar el POST real si el manual de Azul lo exige. Limitación documentada a propósito,
   * no un olvido.
   */
  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    try {
      const fields: AzulPaymentPageFields = {
        MerchantId: this.creds.merchantId,
        MerchantName: 'SolmiOS',
        MerchantType: 'ECommerce',
        CurrencyCode: (req.currency || this.creds.currency || CurrencyCode.USD).toUpperCase(),
        OrderNumber: req.reference,
        Amount: String(req.amountMinor),
        ITBIS: '0',
        ApprovedUrl: req.successUrl,
        DeclinedUrl: req.cancelUrl,
        CancelUrl: req.cancelUrl,
        UseCustomField1: '0',
        CustomField1Label: '',
        CustomField1Value: '',
        UseCustomField2: '0',
        CustomField2Label: '',
        CustomField2Value: '',
      }
      const authHash = buildAuthHash(fields, this.creds.authKey)
      const params = new URLSearchParams({ ...fields, AuthHash: authHash })
      const redirectUrl = `${AZUL_PAYMENT_PAGE_URL[this.mode]}?${params.toString()}`
      return { status: 'redirect', redirectUrl, providerRef: fields.OrderNumber }
    } catch (e: any) {
      return { status: 'failed', reason: e?.message || 'Azul rechazó el armado del cobro' }
    }
  }

  /**
   * Confirma leyendo los campos que Azul manda al volver (query del redirect). Sin esta
   * verificación, cualquiera podría escribir a mano la URL de retorno y simular un pago aprobado
   * — acá NO hay webhook de respaldo que lo contradiga.
   */
  async confirm(ctx: ConfirmContext): Promise<PaymentOutcome | null> {
    const q = ctx.query || {}
    const fields: AzulReturnFields = {
      OrderNumber: q.OrderNumber || '',
      Amount: q.Amount || '',
      AuthorizationCode: q.AuthorizationCode,
      DateTime: q.DateTime,
      ResponseCode: q.ResponseCode,
      IsoCode: q.IsoCode,
      ResponseMessage: q.ResponseMessage,
      ErrorDescription: q.ErrorDescription,
      RRN: q.RRN,
      AzulOrderId: q.AzulOrderId,
      AuthHash: q.AuthHash || '',
    }
    if (!fields.OrderNumber || !fields.AuthHash) return null
    if (!verifyReturnHash(fields, this.creds.authKey)) return null // hash inválido → impostor

    const status = this.mapStatus(fields.IsoCode)
    if (!status) return null

    return {
      eventId: fields.AzulOrderId || `${fields.OrderNumber}:${fields.RRN || fields.AuthorizationCode || ''}`,
      providerRef: fields.AzulOrderId || fields.OrderNumber,
      status,
      amountMinor: Number(fields.Amount || 0),
      currency: (this.creds.currency || 'usd').toLowerCase(),
      reference: fields.OrderNumber,
      raw: fields,
    }
  }

  /**
   * La aprobación la dice IsoCode (manual pág. 17): '00' = aprobada; cualquier otro código no
   * vacío = rechazada. ResponseCode es texto del procesador ('ISO8583'), no sirve para decidir.
   */
  private mapStatus(isoCode: string | undefined): PaymentOutcome['status'] | null {
    const code = (isoCode || '').trim()
    if (!code) return null
    return code === '00' ? 'paid' : 'failed'
  }
}
