// payment-gateways/types.ts — DTOs de la API (≠ model.ts, que es el schema de BD)

import type { GatewayMode, PaymentProvider, ConfirmationMode } from '../../services/payment-gateway/types'

export type { GatewayMode, PaymentProvider }

/** Fila tal cual vive en la BD (credentials CIFRADO). Uso interno: nunca sale por la API. */
export interface PaymentGatewayRow {
  id: string
  hotelId: string
  provider: PaymentProvider
  mode: GatewayMode
  credentials: string
  enabled: boolean
  isDefault: boolean
  createdAt?: string
  updatedAt?: string
}

/**
 * Lo que SÍ sale por la API. Sin credenciales: solo si existen y una máscara.
 * Mismo criterio que TTLock: la UI necesita saber que el secreto está guardado, no cuál es.
 */
export interface PaymentGatewayDTO {
  id: string
  provider: PaymentProvider
  mode: GatewayMode
  enabled: boolean
  isDefault: boolean
  /** Prefijo+sufijo, ej "sk_live…4242". Nunca la llave completa. */
  secretMask: string
  hasSecret: boolean
  hasWebhookSecret: boolean
  currency?: string
  capabilities: {
    refund: boolean
    void: boolean
    paymentLinks: boolean
    confirmation: ConfirmationMode
  }
  /** false = el puerto admite el proveedor pero todavía no hay adapter escrito. Hoy los cuatro lo tienen. */
  implemented: boolean
  /** MerchantId (Azul) / Comercio (CardNet) guardado. Mismo criterio que hasSecret: nunca el valor. */
  hasMerchantId: boolean
  /** Certificado cliente (mTLS) de Azul guardado (cert + key). */
  hasCert: boolean
  updatedAt?: string
}

export interface UpsertPaymentGatewayDTO {
  provider: PaymentProvider
  mode: GatewayMode
  /** Vacío = conservar el guardado (no hay que re-tipear el secreto para cambiar la moneda). */
  secretKey?: string
  publishableKey?: string
  webhookSecret?: string
  currency?: string
  /** Azul: MerchantId · CardNet: Comercio. */
  merchantId?: string
  /** CardNet: Terminal. Azul no lo usa. */
  terminalId?: string
  /** Azul (mTLS): certificado cliente PEM, codificado en base64 por el frontend antes de enviar. */
  certPem?: string
  /** Azul (mTLS): llave privada del certificado, PEM, codificada en base64. */
  certKeyPem?: string
  enabled?: boolean
  isDefault?: boolean
}

export interface TestConnectionResult {
  ok: boolean
  message: string
  accountName?: string
}
