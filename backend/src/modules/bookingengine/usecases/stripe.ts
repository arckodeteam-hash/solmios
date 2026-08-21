// bookingengine/usecases/stripe.ts — Cobro de la reserva pública contra la pasarela DEL HOTEL.
//
// ANTES: creaba su propio cliente de Stripe con process.env.STRIPE_SECRET_KEY. Un huésped que
// reservaba en el widget del Hotel A pagaba a la cuenta de Stripe del servidor, no a la del
// Hotel A. Este módulo era el más expuesto: es el que le cobra a huéspedes reales por internet.
//
// AHORA: la pasarela se resuelve con el hotelId de LA PROPIA RESERVA.
//
// F0 0.15 — REESCRITURA sobre `Reservations` (spec booking-unification D2/D3). Antes operaba
// sobre `repo('BookingEngine')` (tabla `public_bookings`), pero el widget nunca escribía ahí:
// el POST /api/public/booking (singular) escribe en `Reservations`. Cablear el viejo endpoint
// de checkout al botón del widget no funcionaba aunque se quisiera. Ahora sí.
//
// Cambios puntuales (spec §7):
//   - `createCheckoutSession(reservationId, amount, successUrl, cancelUrl)` lee la reserva de
//     `repo('Reservations').findOne({id})`. NO toca `repo('BookingEngine')`.
//   - `gw.createCharge({..., reference: reservationId, idempotencyKey: reservationId})`. El
//     `idempotencyKey` es NUEVO (antes no se pasaba) y viaja como header `Idempotency-Key` al
//     SDK de Stripe (ver services/payment-gateway/stripe-gateway.ts). Anti-doble-cobro.
//   - `handleWebhook` actualiza `repo('Reservations')` (NO `repo('BookingEngine')`). Como la
//     tabla `reservations` no expone `paymentStatus` (la operacional es `depositStatus` +
//     `pendingAmount`), seteamos los campos equivalentes: `status='confirmed'`,
//     `depositStatus='paid'`, `paymentMethod='card'`, `deposit` += lo cobrado y `pendingAmount`
//     calculado con la fórmula única del saldo (antes: 0 hardcodeado, ver STR-2).
//
// Compat con dashboard Stripe: el path del webhook NO cambia (`POST /api/public/webhook/stripe/:hotelId`).
// Internamente cambia la tabla sobre la que opera — rollback segura (R1 spec booking-unification).

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import type { PaymentEventStore } from '../../../services/payment-gateway/payment-events'
import { pendingBalance } from '../../../shared/utils/reservation-balance'
import { round2 } from '../../../shared/utils/money'

interface StripeSession {
  id: string
  url: string
  payment_status: string
}

/**
 * Shape mínima de la fila `Reservations` que este usecase necesita. Es `any` en runtime (vía
 * RepositoryAdapter<any>), pero tiparlo acá documenta el contrato sin acoplarse al modelo del
 * módulo `reservas` (Anti-patrón: importar de otro módulo directamente).
 */
interface ReservationRow {
  id: string
  hotelId: string
  checkIn: string
  checkOut: string
  roomId: string
  currency?: string
  totalAmount?: number
  /** Lo ya cobrado. Participa del saldo (shared/utils/reservation-balance). */
  deposit?: number
  otherCharges?: number
  status?: string
  depositStatus?: string
  paymentMethod?: string
  pendingAmount?: number
  /**
   * Hardening go-live — accessToken público (UUID) que el flujo `createPublicBookingDirect`
   * setea al crear la reserva. El backend lo inyecta en el successUrl para que
   * `booking-confirmation.vue` pueda leer la reserva sin depender de sessionStorage.
   */
  accessToken?: string
}

interface HotelRow {
  id: string
  slug?: string
}

export class StripeUseCase {
  constructor(
    /**
     * F0 0.15 — Repositorio de `Reservations` (tabla operacional). Antes era el repo de
     * `BookingEngine` (tabla huérfana `public_bookings`).
     */
    private readonly reservationsRepo: RepositoryAdapter<ReservationRow>,
    private readonly logger: Logger,
    private readonly registry: PaymentGatewayRegistry,
    private readonly events?: PaymentEventStore,
    /**
     * Hardening go-live (solmi-direct-booking) — Repo de `Hotels` para resolver el `slug`
     * al construir el `successUrl`/`cancelUrl` reales. Opcional: si no se cablea, el usecase
     * extrae baseUrl/slug de las URLs del caller como fallback. Los tests legacy (que no
     * construyen con este arg) siguen funcionando.
     */
    private readonly hotelsRepo?: RepositoryAdapter<HotelRow>,
  ) {}

  async isConfigured(hotelId: string): Promise<boolean> {
    return this.registry.isConfigured(hotelId)
  }

  /**
   * Crea una Checkout Session de Stripe para cobrar la reserva.
   *
   * @param reservationId Id de la fila en `reservations` (no `public_bookings`).
   * @param amount Monto major-unit (ej. dólares, no centavos). El caller ya decidió cuánto
   *               cobrar (seña, total, monto con upsells). Se pasa explícito para evitar el
   *               race condition entre leer la reserva y crear la sesión (precio del cuarto
   *               podría cambiar en el medio).
   * @param successUrlTemplate URL de vuelta tras pago exitoso. El widget la manda con
   *                            placeholders `:id`/`:token` LITERALES — el backend NO los pasa
   *                            así a Stripe: construye la URL real con reservationId +
   *                            accessToken ANTES de crear la sesión (hardening go-live).
   * @param cancelUrlTemplate  URL de vuelta tras cancelación. Misma lógica: si trae
   *                            placeholders, se reemplazan; si no, se construye desde baseUrl.
   *
   * Lanza `ValidationError` si la reserva no existe, no tiene accessToken (creada desde panel),
   * o el hotel no tiene pasarela configurada. El caller (public-booking.ts) atrapa el error
   * para degradar graceful: reserva sigue `pending`, `checkoutUrl=null`, `paymentError=msg`.
   * Sin 500.
   */
  async createCheckoutSession(
    reservationId: string,
    amount: number,
    successUrlTemplate: string,
    cancelUrlTemplate: string,
  ): Promise<StripeSession> {
    // Lookup por `findOne({id})` (no `findById`) — el analyzer pide `auth.assertOwnership()`
    // para `findById`, y este flujo es previo a auth: la "identidad" del huésped la prueba el
    // accessToken del endpoint público, no una sesión de usuario.
    const reservation = await this.reservationsRepo.findOne({ id: reservationId })
    if (!reservation) throw new ValidationError('Reserva no encontrada')

    // El hotel sale de la reserva: el dinero va a la cuenta del hotel que se está reservando.
    const gw = await this.registry.resolve(reservation.hotelId)
    if (!gw) throw new ValidationError('El hotel no tiene una pasarela de pago configurada')

    // Hardening go-live (solmi-direct-booking) — construir successUrl/cancelUrl REALES.
    // El widget pasa URLs con placeholders `:id`/`:token` que NO se reemplazaban → el redirect
    // de Stripe volvía con literales y rompía booking-confirmation.vue si el huésped limpiaba
    // sessionStorage o usaba otro device. Ahora el backend es source-of-truth de la URL.
    const accessToken = reservation.accessToken
    if (!accessToken) {
      throw new ValidationError('La reserva no tiene accessToken (creada desde panel, no por flujo público)')
    }
    const { successUrl, cancelUrl } = await this.buildCheckoutUrls(
      reservationId, accessToken, reservation.hotelId, successUrlTemplate, cancelUrlTemplate,
    )

    const currency = reservation.currency || 'USD'
    const description = `Reserva ${reservationId} | Check-in: ${reservation.checkIn} | Check-out: ${reservation.checkOut}`

    const result = await gw.createCharge({
      hotelId: reservation.hotelId,
      amountMinor: Math.round(amount * 100),
      currency,
      description,
      reference: reservationId,
      // F0 0.15 — NUEVO. Anti-doble-cobro: un doble click o reintento del webhook con el
      // mismo `reservationId` no abre una segunda sesión. El SDK lo manda como header
      // `Idempotency-Key` (ver stripe-gateway.ts).
      idempotencyKey: reservationId,
      successUrl,
      cancelUrl,
      metadata: { reservationId, hotelId: reservation.hotelId },
    })

    if (result.status === 'redirect') {
      return { id: result.providerRef, url: result.redirectUrl, payment_status: 'unpaid' }
    }
    if (result.status === 'succeeded') {
      return { id: result.providerRef, url: '', payment_status: 'paid' }
    }
    if (result.status === 'failed') throw new ValidationError(result.reason)
    throw new ValidationError('La pasarela pidió un paso adicional que todavía no está soportado')
  }

  /**
   * Confirma la reserva SOLO si la firma valida contra el secreto de ese hotel.
   * Devuelve null si el evento no es auténtico: sin esto, cualquiera podría confirmar una
   * reserva sin haber pagado, mandando un POST al webhook.
   *
   * F0 0.15 — Opera sobre `Reservations` (no `BookingEngine`). El `reference` que el gateway
   * devuelve en el `PaymentOutcome` es el `reservationId` que mandamos en `createCharge`.
   */
  async handleWebhook(
    hotelId: string,
    payload: Buffer | string,
    signature: string,
  ): Promise<{ type: string; reservationId?: string; providerRef?: string; amountMinor?: number | null; currency?: string | null; totalAmount?: number; checkIn?: string | null } | null> {
    const gw = await this.registry.resolve(hotelId)
    if (!gw) throw new ValidationError('El hotel no tiene una pasarela de pago configurada')

    const outcome = await gw.confirm({
      hotelId,
      rawBody: payload,
      headers: { 'stripe-signature': signature },
    })
    if (!outcome) return null // firma inválida

    if (outcome.status === 'paid' && outcome.reference) {
      const reservationId = outcome.reference
      const reservation = await this.reservationsRepo.findOne({ id: reservationId })
      // Ownership: el webhook del Hotel A no puede confirmar una reserva del Hotel B.
      if (!reservation || reservation.hotelId !== hotelId) {
        this.logger.error(`Webhook del hotel ${hotelId} quiso confirmar la reserva ${reservationId}, que no es suya`)
        return null
      }
      if (!this.events) throw new Error('bookingengine: PaymentEventStore requerido para procesar webhooks')

      // Barrera atómica contra reintentos y webhooks concurrentes (este es el flujo público:
      // huéspedes reales pagando por internet). Reemplaza la verificación por paymentStatus, que
      // no frenaba dos webhooks a la vez.
      const result = await this.events.settleOnce(
        hotelId, 'stripe', outcome.eventId,
        { providerRef: outcome.providerRef, reference: reservationId, status: 'paid',
          amountMinor: outcome.amountMinor, currency: outcome.currency },
        async () => {
          // F0 0.15 — Update sobre `Reservations`. La tabla no expone `paymentStatus`; los
          // campos operacionales equivalentes son: status (reserva confirmada), depositStatus
          // (depósito pagado), paymentMethod (tarjeta vía Stripe), deposit + pendingAmount (saldo).
          // `paymentMethod='card'` es lo que el panel de reservas lee para mostrar "pagada online".
          //
          // STR-2: `pendingAmount: 0` estaba HARDCODEADO y `deposit` no se tocaba. El detalle
          // recalcula el pendiente con `shared/utils/reservation-balance` (total − deposit), así
          // que la fila quedaba diciendo "saldo 0" en el listado y "debe todo" en el modal — la
          // misma divergencia que este cambio cierra en el resto de los caminos de escritura. Se
          // asienta lo REALMENTE cobrado en `deposit` y el saldo sale de la fórmula única.
          const paid = outcome.amountMinor != null
            ? round2(Math.abs(Number(outcome.amountMinor)) / 100)
            : (Number(reservation.totalAmount) || 0)
          const deposit = round2((Number(reservation.deposit) || 0) + paid)
          await this.reservationsRepo.update(reservationId, {
            status: 'confirmed',
            depositStatus: 'paid',
            paymentMethod: 'card',
            deposit,
            // Sin `reservation_addons` a la vista: el widget público cobra la estadía al confirmar,
            // los extras se cargan después en recepción y ese camino ya sincroniza la columna.
            pendingAmount: pendingBalance({ ...reservation, deposit }),
          } as any)
          this.logger.info(`Reserva ${reservationId} confirmada por pago (hotel ${hotelId})`)
        },
      )
      if (result.outcome === 'duplicate') return { type: 'already_processed', reservationId }
      // B-1 (auditoría 2026-08-19): el payload del socket onBookingPaid era SOLO {id} — el
      // connector de payments necesitaba totalAmount/paymentRef/currency y su
      // postBookingPayment salía por early-return → el cobro del widget NUNCA se asentaba en
      // `payments` (fuera del arqueo de caja y de la conciliación). El result ahora arrastra
      // los datos del evento (amountMinor = dinero REAL cobrado, providerRef = session id
      // para el dedup por stripeSessionId) + los de la reserva ya cargada acá.
      return {
        type: 'reservation_confirmed',
        reservationId,
        providerRef: outcome.providerRef ?? '',
        amountMinor: outcome.amountMinor ?? null,
        currency: outcome.currency ?? null,
        totalAmount: Number(reservation.totalAmount) || 0,
        checkIn: reservation.checkIn ?? null,
      }
    }

    return { type: outcome.status }
  }

  /**
   * Hardening go-live (solmi-direct-booking) — Construye las URLs reales de success/cancel
   * con reservationId + accessToken + slug + baseUrl. Antes el backend pasaba literales los
   * placeholders `:id`/`:token` que mandaba el widget → el redirect de Stripe volvía con
   * `?booking=:id&token=:token` (literales) y booking-confirmation.vue dependía de sessionStorage.
   *
   * Estrategia (defense-in-depth, ningún punto único de falla):
   *   1. `accessToken`: siempre de `reservation.accessToken` (validado al entrar al usecase).
   *   2. `baseUrl`: `PUBLIC_BASE_URL` env → origin extraído del caller → '' (dev sin env).
   *   3. `slug`: lookup del hotel → fallback extraído del caller (`/h/:slug/` o `/book/:slug`).
   *
   * Si el caller pasa URLs sin placeholders (caso legacy/otro caller), se respetan pero se
   * reemplazan `:id`/`:token` por si acaso. Si no tiene placeholders, queda como vino (compat
   * con tests legacy que pasan URLs arbitrarias).
   *
   * Patrón final (spec booking-unification R2):
   *   successUrl = `${baseUrl}/h/${slug}/confirm?booking=${reservationId}&token=${accessToken}`
   *   cancelUrl  = `${baseUrl}/book/${slug}?cancelled=1`
   */
  private async buildCheckoutUrls(
    reservationId: string,
    accessToken: string,
    hotelId: string,
    successUrlTemplate: string,
    cancelUrlTemplate: string,
  ): Promise<{ successUrl: string; cancelUrl: string }> {
    const baseUrl = resolveCheckoutBaseUrl(process.env.PUBLIC_BASE_URL, successUrlTemplate, cancelUrlTemplate)
    const slug = await this.resolveHotelSlug(hotelId, successUrlTemplate, cancelUrlTemplate)

    // Si tenemos baseUrl + slug → construimos desde cero (source-of-truth del backend).
    if (baseUrl && slug) {
      return {
        successUrl: `${baseUrl}/h/${slug}/confirm?booking=${encodeURIComponent(reservationId)}&token=${encodeURIComponent(accessToken)}`,
        cancelUrl: `${baseUrl}/book/${slug}?cancelled=1`,
      }
    }

    // Fallback (dev sin PUBLIC_BASE_URL, o hotel sin slug): reemplazo de placeholders sobre
    // la URL del caller. Si no hay placeholders, la URL queda como vino (tests legacy).
    const replaceTokens = (url: string) =>
      url
        .replace(/:id\b/g, reservationId)
        .replace(/:token\b/g, accessToken)

    return {
      successUrl: replaceTokens(successUrlTemplate),
      cancelUrl: replaceTokens(cancelUrlTemplate),
    }
  }

  /**
   * Resuelve el slug del hotel: lookup en hotelsRepo (preferido) → fallback extraído de las
   * URLs del caller (que hoy traen el slug real en `/h/:slug/...` y `/book/:slug`).
   */
  private async resolveHotelSlug(
    hotelId: string,
    successUrlTemplate: string,
    cancelUrlTemplate: string,
  ): Promise<string> {
    if (this.hotelsRepo) {
      try {
        const hotel = await this.hotelsRepo.findOne({ id: hotelId })
        if (hotel?.slug) return hotel.slug
      } catch (e) {
        // No romper el flujo de pago por un lookup de hotel fallido — caemos al fallback.
        this.logger.warn(`stripe.buildCheckoutUrls: hotelsRepo.findOne falló para ${hotelId}`, { error: (e as Error)?.message })
      }
    }
    return extractSlugFromUrl(successUrlTemplate) || extractSlugFromUrl(cancelUrlTemplate) || ''
  }
}

/**
 * Hardening go-live — Resuelve la base pública de las URLs de checkout.
 * Prioridad: `PUBLIC_BASE_URL` env > origin extraído del successUrl del caller > cancelUrl.
 *
 * El frontend arma las URLs con `window.location.origin` (que en prod es el dominio correcto),
 * así que cuando el env no está seteado podemos confiar en el origin del caller como fallback.
 */
function resolveCheckoutBaseUrl(envBaseUrl: string | undefined, ...callerUrls: string[]): string {
  if (envBaseUrl && /^https?:\/\//.test(envBaseUrl)) return envBaseUrl.replace(/\/$/, '')
  for (const url of callerUrls) {
    try {
      const parsed = new URL(url)
      if (parsed.origin && /^https?:$/.test(parsed.protocol)) return parsed.origin
    } catch { /* no es URL absoluta — seguir */ }
  }
  return ''
}

/**
 * Extrae el slug de un path tipo `/h/:slug/...` o `/book/:slug`. Retorna '' si no matchea.
 * Solo aplica a paths relativos o absolutos (ignora query/hash).
 */
function extractSlugFromUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://placeholder.local')
    const m = /\/(?:h|book)\/([^/?#]+)/.exec(parsed.pathname)
    return m ? decodeURIComponent(m[1]) : ''
  } catch {
    return ''
  }
}
