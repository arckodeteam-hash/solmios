// services/payment-gateway/payment-attempts.ts — Bitácora de TODO outcome de la pasarela.
//
// `payment_events` es la barrera de idempotencia: un evento del proveedor se asienta una vez.
// Esta tabla es otra cosa: historial. Cada checkout creado, cada pago, cada rechazo y cada
// expiración deja una fila, para que el hotel vea por qué una reserva web quedó sin cobrar
// (REQ-RWP-01). Se escribe best-effort: nunca lanza, porque un fallo al anotar el historial no
// puede tumbar el cobro ni el webhook que lo trae.
//
// NUNCA guarda el payload crudo del proveedor (`outcome.raw`) ni datos del tarjetahabiente más
// allá de la marca y los últimos 4 dígitos.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { PaymentOutcome, GatewayMode } from './types'

export type PaymentAttemptSource = 'booking_engine' | 'payment_request' | 'pos'
export type PaymentAttemptKind = 'checkout_created' | 'paid' | 'failed' | 'expired' | 'refunded' | 'pending'

export interface PaymentAttemptRow {
  id: string
  hotelId: string
  reservationId?: string
  source: PaymentAttemptSource
  provider: string
  mode?: GatewayMode
  providerRef?: string
  eventId?: string
  kind: PaymentAttemptKind
  amountMinor?: number
  currency?: string
  failureCode?: string
  failureMessage?: string
  cardBrand?: string
  cardLast4?: string
  receiptUrl?: string
  occurredAt?: string
}

/**
 * Detalle enriquecido del outcome. Los campos opcionales los llenan los adapters cuando el
 * proveedor los da (Stripe: charge.failure_code, payment_method_details.card, receipt_url).
 * Cuando `PaymentOutcome` los incorpore, esta intersección queda idéntica al tipo base.
 */
export type OutcomeDetails = PaymentOutcome & {
  failureCode?: string
  failureMessage?: string
  card?: { brand?: string; last4?: string }
  receiptUrl?: string
  occurredAt?: string
}

export interface CheckoutInput {
  hotelId: string
  reservationId: string | null
  source: PaymentAttemptSource
  provider: string
  mode: GatewayMode
  providerRef: string
  amountMinor: number
  currency: string
}

/** Detecta la violación de PK/unique en SQLite y Postgres (el mensaje difiere por motor). */
function isDuplicateError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e).toLowerCase()
  return (
    msg.includes('unique constraint') ||   // SQLite: "UNIQUE constraint failed"
    msg.includes('duplicate key') ||        // Postgres: "duplicate key value violates unique constraint"
    msg.includes('constraint failed')
  )
}

export class PaymentAttemptStore {
  constructor(
    private readonly repo: RepositoryAdapter<PaymentAttemptRow>,
    private readonly logger: Logger,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  /** Checkout creado en el proveedor (sesión/redirect). Sin eventId: el id es aleatorio. */
  async recordCheckout(input: CheckoutInput): Promise<void> {
    await this.insert({
      id: crypto.randomUUID(),
      hotelId: input.hotelId,
      reservationId: input.reservationId ?? undefined,
      source: input.source,
      provider: input.provider,
      mode: input.mode,
      providerRef: input.providerRef,
      kind: 'checkout_created',
      amountMinor: input.amountMinor,
      currency: input.currency,
      occurredAt: this.nowIso(),
    })
  }

  /**
   * Outcome del proveedor (paid/failed/expired/refunded/pending). Con eventId el id es
   * `${provider}:${eventId}`: el reintento del webhook cae en duplicado y no duplica la fila.
   */
  async recordOutcome(
    hotelId: string,
    source: PaymentAttemptSource,
    provider: string,
    mode: GatewayMode,
    reservationId: string | null,
    outcome: OutcomeDetails,
  ): Promise<void> {
    await this.insert({
      id: outcome.eventId ? `${provider}:${outcome.eventId}` : crypto.randomUUID(),
      hotelId,
      reservationId: reservationId ?? undefined,
      source,
      provider,
      mode,
      providerRef: outcome.providerRef,
      eventId: outcome.eventId || undefined,
      kind: outcome.status,
      amountMinor: outcome.amountMinor,
      currency: outcome.currency,
      failureCode: outcome.failureCode,
      failureMessage: outcome.failureMessage,
      cardBrand: outcome.card?.brand,
      cardLast4: outcome.card?.last4,
      receiptUrl: outcome.receiptUrl,
      occurredAt: outcome.occurredAt ?? this.nowIso(),
    })
  }

  /** Historial de una reserva. Ante error devuelve [] (es lectura de bitácora, no de dinero). */
  async listByReservation(hotelId: string, reservationId: string): Promise<PaymentAttemptRow[]> {
    try {
      return await this.repo.findMany({ hotelId, reservationId })
    } catch (e) {
      this.logger.warn(`No se pudo leer payment_attempts de ${hotelId}/${reservationId}: ${(e as any)?.message}`)
      return []
    }
  }

  private async insert(row: PaymentAttemptRow): Promise<void> {
    try {
      await this.repo.create(row as Omit<PaymentAttemptRow, 'id'> & { id: string })
    } catch (e) {
      if (isDuplicateError(e)) {
        this.logger.debug(`payment_attempts ${row.id} ya registrado: se ignora`)
        return
      }
      this.logger.warn(`No se pudo registrar payment_attempt ${row.kind} ${row.id}: ${(e as any)?.message}`)
    }
  }
}
