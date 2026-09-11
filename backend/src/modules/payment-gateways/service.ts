// payment-gateways/service.ts — Casos de uso: configurar las pasarelas DE CADA HOTEL.
//
// Regla no negociable: una credencial que entra, no vuelve a salir. La API devuelve `hasSecret`
// y una máscara, nunca la llave. Si un endpoint devolviera la secretKey de Stripe, cualquiera
// con acceso de lectura al panel podría cobrar y reembolsar contra la cuenta del hotel.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import type { PaymentGatewayRow, PaymentGatewayDTO, UpsertPaymentGatewayDTO, TestConnectionResult } from './types'
import { IMPLEMENTED_PROVIDERS, type PaymentProvider } from '../../services/payment-gateway/types'
import { encryptCredentials, decryptCredentials, maskSecret } from '../../services/payment-gateway/crypto'
import type { PaymentGatewayRegistry } from '../../services/payment-gateway/registry'
import { buildCredentials } from './usecases/build-credentials'
import { testGatewayConnection } from './usecases/test-connection'

/** Capacidades declaradas por proveedor. La UI las lee para no ofrecer botones que van a fallar. */
const CAPABILITIES: Record<PaymentProvider, PaymentGatewayDTO['capabilities']> = {
  stripe: { refund: true, void: true, paymentLinks: true, confirmation: 'push' },
  paypal: { refund: true, void: true, paymentLinks: false, confirmation: 'push' },
  // Azul Payment Page NO soporta reembolsos (requiere afiliación a Webservices) y no tiene
  // webhook: confirma por redirect con hash HMAC-SHA512.
  azul: { refund: false, void: false, paymentLinks: false, confirmation: 'return' },
  // CardNet Payment Page no tiene reembolso ni anulación por API (eso es otra afiliación, la REST 'sin pantalla') y no tiene webhook: confirma consultando la sesión.
  cardnet: { refund: false, void: false, paymentLinks: false, confirmation: 'pull' },
}

export class PaymentGatewaysService {
  constructor(
    private readonly repo: RepositoryAdapter<PaymentGatewayRow>,
    private readonly logger: Logger,
    private readonly registry: PaymentGatewayRegistry,
    private readonly auth?: any,
  ) {}

  /**
   * Carga la pasarela verificando que sea del hotel del usuario. Sin esto, alguien podría
   * borrar o deshabilitar la pasarela de otro hotel enumerando ids — y dejarlo sin poder cobrar.
   */
  private async ownedById(id: string, hotelId: string): Promise<PaymentGatewayRow> {
    const row = await this.repo.findById(id)
    if (!row) throw new NotFoundError('Pasarela no encontrada')
    if (this.auth) this.auth.assertOwnership(row.hotelId, hotelId, undefined, 'super_admin')
    else if (row.hotelId !== hotelId) throw new NotFoundError('Pasarela no encontrada')
    return row
  }

  private toDTO(row: PaymentGatewayRow): PaymentGatewayDTO {
    let creds: Record<string, unknown> = {}
    let readable = true
    try {
      creds = decryptCredentials(row.credentials)
    } catch {
      // Master key rotada o fila corrupta: se reporta, no se rompe el listado.
      readable = false
      this.logger.error(`Pasarela ${row.id} (${row.provider}): credenciales ilegibles`)
    }
    const secret = String(creds.secretKey || '')
    return {
      id: row.id,
      provider: row.provider,
      mode: row.mode,
      enabled: Boolean(row.enabled),
      isDefault: Boolean(row.isDefault),
      secretMask: readable ? maskSecret(secret) : '⚠ ilegible',
      hasSecret: readable && !!secret,
      hasWebhookSecret: readable && !!creds.webhookSecret,
      currency: readable ? (creds.currency as string | undefined) : undefined,
      capabilities: CAPABILITIES[row.provider],
      implemented: IMPLEMENTED_PROVIDERS.includes(row.provider),
      hasMerchantId: readable && !!creds.merchantId,
      hasCert: readable && !!creds.certPem && !!creds.certKeyPem,
      updatedAt: row.updatedAt,
    }
  }

  async list(hotelId: string): Promise<PaymentGatewayDTO[]> {
    const rows = await this.repo.findMany({ hotelId })
    return rows.map(r => this.toDTO(r))
  }

  /**
   * Crea o actualiza la pasarela del hotel. Los secretos vacíos NO pisan los guardados:
   * cambiar la moneda no debería obligar a re-tipear la llave de Stripe.
   */
  async upsert(hotelId: string, body: UpsertPaymentGatewayDTO): Promise<PaymentGatewayDTO> {
    const existing = (await this.repo.findMany({ hotelId, provider: body.provider, mode: body.mode }))[0]
    const prev = existing ? this.safeDecrypt(existing.credentials) : {}

    // Arma y valida las credenciales según el proveedor (usecases/build-credentials.ts): un
    // sk_live_ guardado en modo 'test' cobraría plata real, y Azul/CardNet necesitan sus propios
    // identificadores además de la llave.
    const creds = buildCredentials(body, prev)

    const credentials = encryptCredentials(creds as unknown as Record<string, unknown>)
    const enabled = body.enabled ?? Boolean(existing?.enabled)
    const isDefault = body.isDefault ?? Boolean(existing?.isDefault)

    let row: PaymentGatewayRow
    if (existing) {
      await this.repo.update(existing.id, { credentials, enabled, isDefault } as Partial<PaymentGatewayRow>)
      row = { ...existing, credentials, enabled, isDefault }
    } else {
      row = await this.repo.create({
        hotelId, provider: body.provider, mode: body.mode,
        credentials, enabled, isDefault,
      } as Omit<PaymentGatewayRow, 'id'>) as PaymentGatewayRow
    }

    if (isDefault) await this.clearOtherDefaults(hotelId, row.id)

    // Sin esto el registry sigue cobrando con la llave anterior (cliente cacheado).
    this.registry.invalidate(hotelId)
    this.logger.info(`Pasarela ${body.provider} (${body.mode}) guardada para el hotel ${hotelId}`)
    return this.toDTO(row)
  }

  private safeDecrypt(payload: string): Record<string, unknown> {
    try { return decryptCredentials(payload) } catch { return {} }
  }

  private async clearOtherDefaults(hotelId: string, keepId: string): Promise<void> {
    const rows = await this.repo.findMany({ hotelId })
    for (const r of rows) {
      if (r.id !== keepId && r.isDefault) {
        await this.repo.update(r.id, { isDefault: false } as Partial<PaymentGatewayRow>)
      }
    }
  }

  async setEnabled(hotelId: string, id: string, enabled: boolean): Promise<PaymentGatewayDTO> {
    const row = await this.ownedById(id, hotelId)
    await this.repo.update(id, { enabled } as Partial<PaymentGatewayRow>)
    this.registry.invalidate(hotelId)
    return this.toDTO({ ...row, enabled })
  }

  async remove(hotelId: string, id: string): Promise<void> {
    await this.ownedById(id, hotelId)
    await this.repo.delete(id)
    this.registry.invalidate(hotelId)
  }

  /** Golpea de verdad al proveedor: una llave que "se guardó" no significa que sirva. Ver usecases/test-connection.ts. */
  async testConnection(hotelId: string, id: string): Promise<TestConnectionResult> {
    const row = await this.ownedById(id, hotelId)
    return testGatewayConnection(row)
  }
}
