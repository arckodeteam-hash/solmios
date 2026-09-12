// bookingengine/service.ts — Facade pública del módulo
// Orquestador delgado que delega a usecases/

import type { RepositoryAdapter, Logger, CacheAdapter } from 'arckode-framework'
import { flowOfRawEvent, type WebhookForwarder } from '../../shared/usecases/webhook-routing'
import type {
  BookingConfigDTO, UpdateBookingConfigDTO,
  AvailabilityQuery, AvailabilityResult,
  PublicBookingDTO,
  ConversionEventDTO, CreateConversionEventDTO,
  BookingAnalytics,
  UpsellDTO,
} from './types'
import type { BookingengineSockets } from './sockets'
import { bookingPaidPayload } from './usecases/booking-paid-event'
import { ConfigUseCase } from './usecases/config'
import { AvailabilityUseCase } from './usecases/availability'
import { AnalyticsUseCase } from './usecases/analytics'
import { StripeUseCase, type ExpirePendingFn } from './usecases/stripe'
import {
  syncUpsellFromPackage as syncUpsellFromPackageUsecase,
  removeSyncedUpsell as removeSyncedUpsellUsecase,
} from './usecases/upsells-sync'
import type { PaymentGatewayRegistry } from '../../services/payment-gateway/registry'
import type { PaymentEventStore } from '../../services/payment-gateway/payment-events'
import type { PaymentAttemptStore } from '../../services/payment-gateway/payment-attempts'

export class BookingengineService {
  private sockets: BookingengineSockets = {}
  private paymentRequestWebhook?: WebhookForwarder
  private config: ConfigUseCase
  private availability: AvailabilityUseCase
  private analytics: AnalyticsUseCase
  private stripe: StripeUseCase

  constructor(
    configRepo: RepositoryAdapter<BookingConfigDTO>,
    // La disponibilidad sale de las habitaciones y las reservas reales del
    // hotel, no de la tabla de stock (que nadie llena).
    roomsRepo: RepositoryAdapter<any> | undefined,
    reservationsRepo: RepositoryAdapter<any> | undefined,
    hotelsRepo: RepositoryAdapter<any> | undefined,
    private readonly bookingRepo: RepositoryAdapter<PublicBookingDTO>,
    eventsRepo: RepositoryAdapter<ConversionEventDTO>,
    private readonly logger: Logger,
    cache: CacheAdapter,
    registry?: PaymentGatewayRegistry,
    events?: PaymentEventStore,
    /**
     * F4 4.1 — Repo sobre `TrackingEvent` para el funnel de conversión. Opcional para no
     * romper tests viejos: si no se pasa, el funnel devuelve 0 en todos los steps.
     */
    trackingRepo?: RepositoryAdapter<any>,
    /** Repo de `Upsells` para el connector paquetes-bookingengine — ver usecases/upsells-sync.ts. */
    private readonly upsellRepoForSync?: RepositoryAdapter<UpsellDTO>,
    /**
     * FIX (room_blocks + stop-sell) — Bloqueos de habitación, temporadas y tarifas para que la
     * disponibilidad pública deje de vender lo que el hotel ya cerró. Son los MISMOS tres
     * modelos compartidos que consume `/calendar`; si no se cablean, `AvailabilityUseCase`
     * degrada al comportamiento previo (compat con tests/callers viejos).
     */
    roomBlocksRepo?: RepositoryAdapter<any>,
    seasonAssignmentsRepo?: RepositoryAdapter<any>,
    roomRatesRepo?: RepositoryAdapter<any>,
    /** Req. 2 (2026-09-03) — `Configuration` KV GENERAL para `room_type_capacity` (NO `configRepo`, que es `BookingConfig`). */
    configurationRepo?: RepositoryAdapter<any>,
    /** REQ-RWP-01 (#244) — bitácora `payment_attempts`: todo outcome de la pasarela, rechazos incluidos. */
    attempts?: PaymentAttemptStore,
  ) {
    if (!registry) throw new Error('bookingengine: PaymentGatewayRegistry es requerido (pasarela por hotel)')
    if (!reservationsRepo) throw new Error('bookingengine: reservationsRepo es requerido (F0 0.15 — Stripe opera sobre Reservations)')
    this.config = new ConfigUseCase(configRepo, cache)
    this.availability = new AvailabilityUseCase(
      cache, roomsRepo, reservationsRepo, hotelsRepo,
      roomBlocksRepo, seasonAssignmentsRepo, roomRatesRepo, configurationRepo,
    )
    this.analytics = new AnalyticsUseCase(eventsRepo, trackingRepo)
    // F0 0.15 — Stripe opera sobre Reservations (tabla operacional). Antes usaba `bookingRepo`
    // (tabla huérfana `public_bookings`), que nunca recibía filas del widget — el cobro quedaba
    // colgado de una reserva inexistente. Spec booking-unification D2/D3.
    // Hardening go-live — Pasamos hotelsRepo para que StripeUseCase construya el successUrl
    // real con slug + reservationId + accessToken (antes pasaba placeholders literales a Stripe).
    this.stripe = new StripeUseCase(reservationsRepo, logger, registry, events, hotelsRepo ?? undefined, attempts)
  }
  async notifyBookingCreated(d: PublicBookingDTO) { await this.sockets.onBookingCreated?.(d) } // wrapper público, ver controller.ts
  /** #266 — Post-init (composition-root): `checkout.session.expired` vence la reserva con el mismo usecase del cron. Sin cablear = no-op. */
  setExpirePending(fn: ExpirePendingFn): void { this.stripe.setExpirePending(fn) }
  setSockets(s: Partial<BookingengineSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  /** FIX 2026-07-31 — Ofertas → Upsells (ver usecases/upsells-sync.ts). Llamado por
   *  connectors/paquetes-bookingengine.ts. No-op si upsellRepoForSync no está cableado. */
  async syncUpsellFromPackage(pkg: { id: string; hotelId: string; name: string; description?: string | null; price: number; active?: number | boolean }): Promise<void> {
    if (!this.upsellRepoForSync) return
    await syncUpsellFromPackageUsecase({ upsells: this.upsellRepoForSync }, pkg)
  }

  async removeSyncedUpsell(packageId: string): Promise<void> {
    if (!this.upsellRepoForSync) return
    await removeSyncedUpsellUsecase({ upsells: this.upsellRepoForSync }, packageId)
  }

  // initStripe() eliminado: inicializaba UNA cuenta global (process.env) para todos los hoteles.
  // Ahora la pasarela se resuelve con el hotelId de la propia reserva.

  async getConfig(hotelId: string): Promise<BookingConfigDTO> {
    return this.config.get(hotelId)
  }

  async updateConfig(hotelId: string, dto: UpdateBookingConfigDTO): Promise<BookingConfigDTO> {
    return this.config.update(hotelId, dto)
  }

  async checkAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    return this.availability.check(query)
  }

  /**
   * F0 0.15 — Checkout sobre `Reservations`. Antes este método recibía un `bookingId` y leía
   * de `public_bookings`. Ahora recibe `reservationId`, y el monto lo pasa el caller explícito
   * (evita race condition: el precio del cuarto podría cambiar entre leer y cobrar).
   */
  async createReservationCheckout(
    reservationId: string,
    amount: number,
    successUrl: string,
    cancelUrl: string,
  ) {
    return this.stripe.createCheckoutSession(reservationId, amount, successUrl, cancelUrl)
  }

  /** Puerto a los LINKS DE PAGO. Lo inyecta `payment-requests-bookingengine-webhook`. */
  setPaymentRequestWebhookPort(fn: WebhookForwarder): void { this.paymentRequestWebhook = fn }

  /** Ver `shared/usecases/webhook-routing.ts`. Devuelve no-null sólo si el evento era ajeno. */
  private async dispatchPaymentRequestEvent(
    hotelId: string, payload: Buffer | string, signature: string,
  ): Promise<{ type: string } | null> {
    if (flowOfRawEvent(payload) !== 'payment-request') return null
    if (!this.paymentRequestWebhook) {
      this.logger.warn('Webhook de un link de pago recibido en el endpoint del motor, y sin puerto: el cobro NO se aplica', { hotelId })
      return null
    }
    await this.paymentRequestWebhook(hotelId, payload, signature)
    this.logger.info('Webhook de link de pago reenviado a su dueño', { hotelId })
    return { type: 'forwarded_to_payment_requests' }
  }

  /**
   * El cobro del widget es plata real que entra por Stripe. Sin emitir el evento, quedaba solo en la
   * fila de `bookings`: fuera de `payments`, de la conciliación bancaria y del balance.
   *
   * El hotel viene en la RUTA: su secreto de firma es lo que autentica el webhook.
   */
  async handleStripeWebhook(hotelId: string, payload: Buffer | string, signature: string) {
    // Despacho multi-flujo: el hotel configura UNA URL en Stripe y por ahí entran los eventos de
    // los DOS caminos de cobro. Un evento de un LINK DE PAGO que aterriza acá se reenvía a su
    // dueño (`payment-requests`) en vez de morir como "reserva que no es suya" — devolver 200 sin
    // aplicarlo deja el cobro hecho y el link sin marcar, y Stripe no reintenta.
    const foreign = await this.dispatchPaymentRequestEvent(hotelId, payload, signature)
    if (foreign) return foreign

    const result = await this.stripe.handleWebhook(hotelId, payload, signature)
    if (!result) return null // firma inválida → el controller responde 400
    // El socket del widget espera la reserva pagada para refrescar la UI y asentar el cobro en
    // `payments` (ver usecases/booking-paid-event.ts).
    const paid = bookingPaidPayload(hotelId, result)
    if (paid) await this.sockets.onBookingPaid?.(paid as any)
    return result
  }

  /**
   * #196 (PG-4.3) — Retorno del navegador desde Azul/CardNet. Misma salida que el webhook:
   * si la reserva quedó confirmada, el socket `onBookingPaid` asienta el cobro en `payments`
   * (arqueo de caja y conciliación), igual que con Stripe.
   */
  async handleGatewayReturn(hotelId: string, provider: string, query: Record<string, string>) {
    const result = await this.stripe.handleReturn(hotelId, provider, query)
    const paid = bookingPaidPayload(hotelId, result)
    if (paid) await this.sockets.onBookingPaid?.(paid as any)
    return result
  }

  async trackEvent(dto: CreateConversionEventDTO): Promise<ConversionEventDTO> {
    return this.analytics.track(dto)
  }

  async getAnalytics(hotelId: string, from?: string, to?: string): Promise<BookingAnalytics> {
    return this.analytics.getAnalytics(hotelId, from, to)
  }
}
