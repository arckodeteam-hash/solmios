// payment-gateways/usecases/build-credentials.ts — arma y valida las credenciales a persistir.
//
// Extraído de service.ts (que superaba las 200 líneas al sumar Azul/CardNet) para no convertirlo
// en un God Object. Función pura: no toca el repo ni el registry, solo decide qué va en el JSON
// cifrado según lo que llegó y lo que ya estaba guardado.

import { ValidationError } from 'arckode-framework'
import type { UpsertPaymentGatewayDTO } from '../types'

export interface GatewayCredentials {
  // Stripe: sk_.../pk_.... Azul: AuthKey. PayPal: client secret. Un mismo campo genérico "llave
  // secreta" les sirve — la UI lo etiqueta distinto por proveedor. CardNet no lo usa: Payment
  // Page no tiene llave ni firma; el afiliado se identifica por MerchantNumber+MerchantTerminal.
  secretKey: string
  publishableKey: string
  webhookSecret: string
  currency: string
  /** Azul: MerchantId · CardNet: Comercio (MerchantNumber). */
  merchantId: string
  /** CardNet: Terminal (MerchantTerminal). Azul no lo usa (queda vacío). */
  terminalId: string
  /** mTLS de Azul, PEM ya decodificado (ver decodeB64). */
  certPem: string
  certKeyPem: string
}

/**
 * Decodifica un PEM (cert/key de Azul) mandado en base64. `undefined`/`''` pasan tal cual: el
 * validador de `type: 'string'` del framework colapsa TODO whitespace —incluidos saltos de
 * línea— a un solo espacio (kernel/validator.ts:45), lo que corrompería un PEM real si viajara
 * crudo. El frontend lo manda en base64 (sin whitespace, no le afecta el colapso) y acá se
 * decodifica una sola vez, antes de cifrar y guardar.
 */
export function decodeB64(value?: string): string | undefined {
  if (!value) return value
  try {
    return Buffer.from(value, 'base64').toString('utf8')
  } catch {
    return value // no era base64 válido: mejor guardarlo tal cual que perderlo en silencio
  }
}

/** Stripe distingue test/live por prefijo. Guardar una llave live en modo test cobra plata real. */
function assertStripeKeyMatchesMode(secretKey: string, mode: string): void {
  const isLiveKey = secretKey.startsWith('sk_live_')
  const isTestKey = secretKey.startsWith('sk_test_')
  if (!isLiveKey && !isTestKey) return // sk_... restringidas u otros formatos: no bloquear
  if (isLiveKey && mode !== 'live') {
    throw new ValidationError('La llave es de PRODUCCIÓN (sk_live_) pero el modo es "test". Cobrarías dinero real.')
  }
  if (isTestKey && mode === 'live') {
    throw new ValidationError('La llave es de PRUEBA (sk_test_) pero el modo es "live". Ningún cobro sería real.')
  }
}

/**
 * Arma las credenciales a cifrar: los campos vacíos/ausentes conservan lo ya guardado (`prev`),
 * y valida lo mínimo que cada proveedor necesita para poder cobrar.
 */
export function buildCredentials(body: UpsertPaymentGatewayDTO, prev: Record<string, unknown>): GatewayCredentials {
  const keep = (k: string, incoming?: string): string =>
    (incoming === undefined || incoming === '') ? String(prev[k] ?? '') : incoming

  const creds: GatewayCredentials = {
    secretKey: keep('secretKey', body.secretKey),
    publishableKey: keep('publishableKey', body.publishableKey),
    webhookSecret: keep('webhookSecret', body.webhookSecret),
    currency: keep('currency', body.currency) || 'usd',
    merchantId: keep('merchantId', body.merchantId),
    terminalId: keep('terminalId', body.terminalId),
    certPem: keep('certPem', decodeB64(body.certPem)),
    certKeyPem: keep('certKeyPem', decodeB64(body.certKeyPem)),
  }

  if (body.provider === 'cardnet') {
    // CardNet Payment Page no tiene llave: el afiliado se identifica por MerchantNumber
    // (Comercio) + MerchantTerminal (Terminal), y el único secreto es la session-key que el
    // propio CardNet devuelve al crear cada sesión (ver services/payment-gateway/cardnet-gateway.ts).
    if (!creds.merchantId || !creds.terminalId) {
      throw new ValidationError('CardNet requiere Comercio y Terminal')
    }
    return creds
  }

  if (!creds.secretKey) {
    throw new ValidationError('Falta la llave secreta de la pasarela')
  }
  if (body.provider === 'stripe') assertStripeKeyMatchesMode(creds.secretKey, body.mode)
  if (body.provider === 'azul' && !creds.merchantId) {
    throw new ValidationError('Azul requiere el Merchant ID')
  }

  return creds
}
