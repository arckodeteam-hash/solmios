import { http } from './http'

export type PaymentProvider = 'stripe' | 'paypal' | 'azul' | 'cardnet'
export type GatewayMode = 'test' | 'live'
export type ConfirmationMode = 'push' | 'return' | 'pull'

export interface GatewayCapabilities {
  refund: boolean
  void: boolean
  paymentLinks: boolean
  confirmation: ConfirmationMode
}

export interface PaymentGateway {
  id: string
  provider: PaymentProvider
  mode: GatewayMode
  enabled: boolean
  isDefault: boolean
  /** Máscara tipo "sk_live…4242". El backend NUNCA devuelve la llave completa. */
  secretMask: string
  hasSecret: boolean
  hasWebhookSecret: boolean
  currency?: string
  capabilities: GatewayCapabilities
  /** false = el sistema admite el proveedor pero todavía no hay adapter escrito. Hoy los cuatro lo tienen. */
  implemented: boolean
  /** MerchantId (Azul) / Comercio (CardNet) guardado. Nunca el valor, solo el flag. */
  hasMerchantId: boolean
  /** Certificado cliente (mTLS) de Azul guardado. */
  hasCert: boolean
  updatedAt?: string
}

export interface UpsertGatewayPayload {
  provider: PaymentProvider
  mode: GatewayMode
  /** Vacío = conservar el guardado (no hay que re-tipear el secreto para cambiar la moneda). */
  secretKey?: string
  publishableKey?: string
  webhookSecret?: string
  currency?: string
  /** Azul: MerchantId · CardNet: Comercio. */
  merchantId?: string
  /** CardNet: Terminal. */
  terminalId?: string
  /** Azul (mTLS): certificado cliente, codificado en base64 antes de mandarlo (ver save() en pagos/index.vue). */
  certPem?: string
  /** Azul (mTLS): llave privada del certificado, codificada en base64. */
  certKeyPem?: string
  enabled?: boolean
  isDefault?: boolean
}

export interface TestConnectionResult {
  ok: boolean
  message: string
  accountName?: string
}

export const PaymentGatewayService = {
  list: () => http.get<{ data: PaymentGateway[] }>('/payment-gateways'),
  upsert: (payload: UpsertGatewayPayload) => http.post<PaymentGateway>('/payment-gateways', payload),
  setEnabled: (id: string, enabled: boolean) =>
    http.put<PaymentGateway>(`/payment-gateways/${id}/enabled`, { enabled }),
  remove: (id: string) => http.delete<{ success: boolean }>(`/payment-gateways/${id}`),
  /** Golpea de verdad al proveedor: que la llave se haya guardado no significa que sirva. */
  test: (id: string) => http.post<TestConnectionResult>(`/payment-gateways/${id}/test`, {}),
}
