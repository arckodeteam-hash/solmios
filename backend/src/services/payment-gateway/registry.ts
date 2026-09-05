// services/payment-gateway/registry.ts — Resuelve la pasarela de CADA hotel.
//
// Este es el archivo que cierra el agujero de multi-tenancy: antes, `payments` y `bookingengine`
// leían process.env.STRIPE_SECRET_KEY, o sea UNA cuenta global para todos los hoteles. Con dos
// hoteles con llaves cargadas, la plata de uno podía cobrarse en la cuenta del otro.
//
// Orden de resolución:
//   1. fila en `payment_gateways` del hotel (enabled)   ← lo correcto
//   2. fallback a process.env (comportamiento actual)   ← para no romper hoteles sin migrar
//
// El fallback se borra cuando ningún hotel dependa de él. Mientras exista, se avisa por log.

import type { Logger } from 'arckode-framework'
import { IMPLEMENTED_PROVIDERS, type GatewayMode, type PaymentGateway, type PaymentProvider } from './types'
import { StripeGateway, type StripeCredentials } from './stripe-gateway'
import { AzulGateway, toAzulCredentials } from './azul-gateway'
import { CardnetGateway, toCardnetCredentials } from './cardnet-gateway'
import { PayPalGateway, toPayPalCredentials } from './paypal-gateway'
import { decryptCredentials } from './crypto'

export interface GatewayRow {
  id: string
  hotelId: string
  provider: PaymentProvider
  mode: GatewayMode
  credentials: string // cifrado
  enabled: boolean | number
  isDefault: boolean | number
}

type GatewayRepo = {
  findMany(filter: Record<string, unknown>): Promise<GatewayRow[]>
}

export class PaymentGatewayRegistry {
  /** Cachea por hotel+provider+mode. Se invalida al guardar config (ver invalidate()). */
  private readonly cache = new Map<string, PaymentGateway>()

  constructor(
    private readonly repo: GatewayRepo,
    private readonly logger: Logger,
  ) {}

  private key(hotelId: string, provider: PaymentProvider, mode: GatewayMode): string {
    return `${hotelId}:${provider}:${mode}`
  }

  /** Tras guardar/cambiar credenciales hay que tirar el cliente viejo, o sigue cobrando con la llave anterior. */
  invalidate(hotelId: string): void {
    for (const k of [...this.cache.keys()]) {
      if (k.startsWith(`${hotelId}:`)) this.cache.delete(k)
    }
  }

  /**
   * Devuelve la pasarela del hotel, o null si no tiene ninguna utilizable.
   * `provider` opcional: si no se pasa, usa la marcada como default del hotel.
   */
  async resolve(hotelId: string, provider?: PaymentProvider): Promise<PaymentGateway | null> {
    const rows = (await this.repo.findMany({ hotelId })) || []
    const usable = rows.filter(r => Boolean(r.enabled) && IMPLEMENTED_PROVIDERS.includes(r.provider))

    const row = provider
      ? usable.find(r => r.provider === provider)
      : usable.find(r => Boolean(r.isDefault)) ?? usable[0]

    if (row) {
      const cached = this.cache.get(this.key(hotelId, row.provider, row.mode))
      if (cached) return cached
      const gw = this.build(row)
      if (gw) this.cache.set(this.key(hotelId, row.provider, row.mode), gw)
      return gw
    }

    return this.envFallback(hotelId, provider)
  }

  private build(row: GatewayRow): PaymentGateway | null {
    let creds: Record<string, unknown>
    try {
      creds = decryptCredentials(row.credentials)
    } catch (e: any) {
      // Credenciales corruptas o master key rotada: NO caer al env global, sería cobrar en la
      // cuenta equivocada. Mejor no cobrar que cobrar mal.
      this.logger.error(`Pasarela ${row.provider} del hotel ${row.hotelId}: no se pudo descifrar (${e?.message})`)
      return null
    }

    switch (row.provider) {
      case 'stripe':
        return new StripeGateway(creds as unknown as StripeCredentials, row.mode)
      case 'azul':
        return new AzulGateway(toAzulCredentials(creds), row.mode)
      case 'cardnet':
        return new CardnetGateway(toCardnetCredentials(creds), row.mode)
      case 'paypal':
        return new PayPalGateway(toPayPalCredentials(creds), row.mode)
      default:
        this.logger.warn(`Pasarela '${row.provider}' configurada pero sin adapter implementado`)
        return null
    }
  }

  /**
   * Comportamiento anterior: llaves globales del .env. Solo para hoteles que todavía no migraron.
   * Es EXACTAMENTE el agujero que estamos cerrando, así que se avisa cada vez que se usa.
   */
  private envFallback(hotelId: string, provider?: PaymentProvider): PaymentGateway | null {
    if (provider && provider !== 'stripe') return null
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) return null

    this.logger.warn(
      `Hotel ${hotelId} sin pasarela propia: usando las llaves GLOBALES del .env. ` +
      'Los cobros de este hotel van a la cuenta de la plataforma, no a la suya. ' +
      'Configurar su pasarela en payment_gateways.',
    )
    const mode: GatewayMode = secretKey.startsWith('sk_live_') ? 'live' : 'test'
    return new StripeGateway({
      secretKey,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      currency: process.env.STRIPE_CURRENCY || 'usd',
    }, mode)
  }

  /** ¿Este hotel puede cobrar online? */
  async isConfigured(hotelId: string, provider?: PaymentProvider): Promise<boolean> {
    return (await this.resolve(hotelId, provider)) !== null
  }
}
