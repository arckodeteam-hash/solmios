// bookingengine/controller.ts — Adaptador HTTP del módulo
// Endpoints protegidos (admin) + endpoints públicos (sin auth) + Stripe webhook

import type { HttpRequest, Logger, RepositoryAdapter, Auth } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
// `validateSchema` del shared (superconjunto del framework): acepta `BodyRule` (incluye
// 'text' multilinea, etc.). Mismo import que landing/restaurant. El del framework se usa
// para los schemas legacy que solo tienen tipos primitivos.
import { validateSchema as validateBodySchema } from '../../shared/validators/validate-body'
import type { BookingengineService } from './service'
import type { AvailabilityQuery, CreateConversionEventDTO, UpdateBookingConfigDTO, UpsellDTO, UpsellCurrentUser, MealPlanDTO } from './types'
import {
  UpdateBookingConfigSchema,
  CheckAvailabilitySchema,
  ExtendedPublicBookingSchema,
  CreatePublicBookingGroupSchema,
  TrackEventSchema,
  CreateUpsellSchema,
  UpdateUpsellSchema,
  UpsertMealPlanSchema,
} from './validators/schema'
// F2 2.3 — Upsells: el controller invoca los usecases directamente (sin pasar por service)
// porque no hay lógica de orquestación entre el HTTP y el usecase. Mantener el service <
// 200 líneas deja fuera los métodos passthrough. Mismo patrón que hotel-media/controller.ts
// cuando un sub-dominio no amerita agrandar el facade principal.
import * as upsellsCrud from './usecases/upsells-crud'
// tasks.md 2.2/2.4 (solmi-direct-booking-qa-fixes) — Regímenes de alimentación, mismo patrón
// que upsells arriba (sub-dominio, sin service, catálogo fijo de 3 códigos).
import * as mealPlansCrud from './usecases/meal-plans-crud'
import { getPublicMealPlans } from './usecases/public-meal-plans'
import { getPublicBookingBySlug, createPublicBookingDirect } from './usecases/public-booking'
// Tarea 10 (QA 2026-08-20/21) — varias habitaciones (mismo tipo ×N y/o tipos distintos) en 1 sola
// reserva. Handler aparte, reusa los mismos deps (auth/service/logger) que el de 1 habitación.
import { createPublicBookingGroup } from './usecases/public-booking-group'
import { getPublicHotelInfo } from './usecases/public-hotel-info'
import { getPublicReservation } from './usecases/public-reservation'
import { cancelPublicBooking } from './usecases/public-cancel'
import { listActiveHotelSlugs, buildSitemapXml, resolveBaseUrl } from './usecases/sitemap'
// F2 2.4 / 2.6 — Handlers públicos para /rates y /upsells (rates usa availability + config +
// conversion; upsells lista los activos del hotel para el step de extras del widget).
import { getPublicRates } from './usecases/public-rates'
import { getPublicUpsells } from './usecases/public-upsells'
// Catálogo de tipos de habitación (sin filtrar por disponibilidad): consumido por la vitrina
// "Habitaciones" de la landing, que necesita mostrar TODOS los tipos que el hotel vende, no solo
// los libres en una ventana de fechas indicativa (ver el header del usecase para el bug real).
import { getPublicRoomTypes } from './usecases/public-room-types'
// Calendario público de tarifas: precio desde + disponibilidad real por día.
import { getPublicCalendar } from './usecases/public-calendar'
// F3 3.15 — Handler público para /ota-prices (comparativo directo vs Booking/Airbnb).
import { getPublicOtaPrices } from './usecases/public-ota-prices'
// FIX 2026-07-31 (QA solmi-direct-booking) — getConfig/updateConfig/getAnalytics leían
// `(req as any).hotelId`, campo que NUNCA existe en el request (auth.authenticate() del
// framework deja el tenant en `req.user.hotelId`, no en la raíz). hotelId llegaba `undefined`
// al usecase → `ConfigUseCase.get()` intentaba crear una fila `booking_config` sin hotelId →
// 500 en cada carga de /panel/booking-engine. Mismo resolver que ya usan reservas/folios/etc.
import { hotelOf } from '../../shared/utils/hotel-of'

export class BookingengineController {
  constructor(
    private readonly service: BookingengineService,
    private readonly logger: Logger,
    private readonly orm?: any,
    private readonly auth?: any,
    private readonly pushAvailability?: (hotelId: string, roomId: string) => void,
    // Repositorio de hoteles para la ruta pública GET /api/public/hotel/:slug (F0 0.4).
    // Se pasa desde index.ts (donde ya existe hotelsRepo) en vez de instanciarlo acá:
    // el controller no debe saber del orm.define ni de nombres de modelo.
    private readonly hotelsRepo?: RepositoryAdapter<any>,
    // F2 2.3 — Upsells deps. Opcionales para no romper tests legacy del controller que
    // no construyen con estos params. Si faltan, los handlers de upsell tiran error 500
    // explícito (defense-in-depth: el módulo debe cablearse completo desde index.ts).
    private readonly upsellRepo?: RepositoryAdapter<UpsellDTO>,
    private readonly userRepoForUpsells?: RepositoryAdapter<any>,
    private readonly authImpl?: Auth,
    // F2 2.4 / 2.5 — Deps para los endpoints públicos de rates/booking. `configRepo` lee
    // configuration('taxes') + configuration('currency_rates'); `promoCodesRepo` valida e
    // incrementa uses de promo codes en el flujo unificado de booking. Opcionales para no
    // romper tests legacy del controller (que instancian con 4 params).
    private readonly configRepo?: RepositoryAdapter<any>,
    private readonly promoCodesRepo?: RepositoryAdapter<any>,
    // FIX 2026-07-31 — Repo REAL de `BookingConfig` (tabla `booking_config`, lo que edita el
    // admin en /panel/booking-engine: enabled/minNights/maxNights/showComparison/
    // cancellationPolicy). Distinto de `configRepo` de arriba (que pese al nombre es la
    // `Configuration` KV de taxes/currency — no tocado para no romper nada existente).
    private readonly bookingConfigRepo?: RepositoryAdapter<any>,
    // FIX (foto real por tipo de habitación en /rates) — `roomsRepo`/`hotelMediaRepo` para
    // resolver `photoUrl` por type. Mismo precedente que `hotelsRepo` de arriba: repo ORM
    // compartido por nombre de modelo, no import cross-module de otro service/controller.
    private readonly roomsRepo?: RepositoryAdapter<any>,
    private readonly hotelMediaRepo?: RepositoryAdapter<any>,
    // F4 #627 — Deps para auto-cancelación pública del huésped. `reservationsRepo` opera
    // sobre la tabla operacional (lookup por token + update status→cancelled);
    // `policyRepo` lee las políticas de cancelación (F1 cancellation-math).
    private readonly reservationsRepo?: RepositoryAdapter<any>,
    private readonly cancellationPolicyRepo?: RepositoryAdapter<any>,
    // Calendario público (`GET /api/public/hotels/:slug/calendar`). Se agregan AL FINAL para no
    // correr las posiciones de los deps existentes (varios tests construyen el controller
    // posicionalmente). `roomsRepo`/`reservationsRepo`/`hotelsRepo`/`configRepo`/
    // `bookingConfigRepo` ya están arriba y se reusan.
    private readonly roomBlocksRepo?: RepositoryAdapter<any>,
    private readonly seasonAssignmentsRepo?: RepositoryAdapter<any>,
    private readonly roomRatesRepo?: RepositoryAdapter<any>,
    /** Cache del framework — TTL corto para el calendario (mismo criterio que availability). */
    private readonly cache?: any,
    // tasks.md 2.2/2.4 (solmi-direct-booking-qa-fixes) — Repo de regímenes de alimentación.
    // Al final, mismo motivo que el resto: no correr las posiciones de deps existentes (varios
    // tests construyen el controller posicionalmente). Opcional — defense-in-depth igual que
    // upsellRepo (los handlers tiran 500 explícito si no está cableado).
    private readonly mealPlanRepo?: RepositoryAdapter<MealPlanDTO>,
    /** `RateOverrides` — tarifa por FECHA. Al final, mismo motivo que el resto de los deps nuevos. */
    private readonly rateOverridesRepo?: RepositoryAdapter<any>,
  ) {}

  /** Deps para los usecases de upsells. Tirar si no están cableadas (claramente un bug de wiring). */
  private assertUpsellsDeps(): upsellsCrud.UpsellsCrudDeps {
    if (!this.upsellRepo || !this.userRepoForUpsells || !this.authImpl) {
      throw new Error('bookingengine: upsells deps no cableadas en el controller')
    }
    return { upsells: this.upsellRepo, userRepo: this.userRepoForUpsells, auth: this.authImpl }
  }

  /** Deps para los usecases de regímenes de alimentación. Mismo criterio que upsells arriba. */
  private assertMealPlansDeps(): mealPlansCrud.MealPlansCrudDeps {
    if (!this.mealPlanRepo || !this.userRepoForUpsells || !this.authImpl) {
      throw new Error('bookingengine: meal-plans deps no cableadas en el controller')
    }
    return { mealPlans: this.mealPlanRepo, userRepo: this.userRepoForUpsells, auth: this.authImpl }
  }

  // ─── Admin (protegido con auth) ──────────────────────

  async getConfig(req: HttpRequest) {
    this.logger.info('GET /booking-engine/config')
    const hotelId = await hotelOf(req, this.orm)
    const config = await this.service.getConfig(hotelId as string)
    return { status: 200, body: config }
  }

  async updateConfig(req: HttpRequest) {
    this.logger.info('PUT /booking-engine/config')
    const hotelId = await hotelOf(req, this.orm)
    const data = validateSchema(UpdateBookingConfigSchema, req.body) as UpdateBookingConfigDTO
    const config = await this.service.updateConfig(hotelId as string, data)
    return { status: 200, body: config }
  }

  async getAnalytics(req: HttpRequest) {
    this.logger.info('GET /booking-engine/analytics')
    const hotelId = await hotelOf(req, this.orm)
    const { from, to } = req.query as { from?: string; to?: string }
    const analytics = await this.service.getAnalytics(hotelId as string, from, to)
    return { status: 200, body: analytics }
  }

  // ─── Público (sin auth) ──────────────────────────────

  async checkAvailability(req: HttpRequest) {
    this.logger.info('POST /api/public/availability')
    const data = validateSchema(CheckAvailabilitySchema, req.body) as unknown as AvailabilityQuery
    const result = await this.service.checkAvailability(data)
    return { status: 200, body: result }
  }

  async getHotelPublicInfo(req: HttpRequest) {
    this.logger.info('GET /api/public/hotel/:slug', { slug: req.params.slug })
    // lang default 'es' (D7 — fallback final español). Query opcional `?lang=en`.
    const lang = (req.query?.lang as string | undefined) || 'es'
    try {
      // Allow-list estricta en el usecase: el DTO devuelto SOLO contiene campos públicos
      // (ver spec public-hotel-info). Nunca spread del hotel.
      const dto = await getPublicHotelInfo(
        { hotels: this.hotelsRepo!, config: this.configRepo, bookingConfig: this.bookingConfigRepo },
        String(req.params?.slug || ''),
        lang,
      )
      return { status: 200, body: dto }
    } catch (e: any) {
      // NotFoundError → 404 plano. Anti-enumeración: el usecase tira el MISMO mensaje para
      // "no existe" y "no activo" (no filtrar hoteles pausados).
      if (e?.httpStatus === 404) return { status: 404, body: { error: e.message } }
      throw e
    }
  }

  /**
   * Webhook del motor de reservas. El hotel va en la RUTA: hay que saber de quién es el secreto
   * de firma ANTES de creerle al body. Sin verificación, cualquiera podría confirmar una reserva
   * sin pagarla mandando un POST acá.
   *
   * La firma se verifica contra los bytes CRUDOS (`req.rawBody`, framework >= 1.6.3).
   */
  async handleStripeWebhook(req: HttpRequest) {
    const hotelId = String(req.params?.hotelId || '')
    if (!hotelId) return { status: 400, body: { error: 'Falta el hotel en la ruta del webhook' } }

    const signature = (req as any).headers?.['stripe-signature'] || ''
    const rawBody = (req as any).rawBody
    if (!rawBody) return { status: 400, body: { error: 'Webhook sin body' } }

    try {
      const result = await this.service.handleStripeWebhook(hotelId, rawBody, signature)
      if (!result) return { status: 400, body: { error: 'Firma inválida' } }
      return { status: 200, body: result }
    } catch (e: any) {
      this.logger.error(`Webhook de reservas (hotel ${hotelId}): ${e?.message}`)
      return { status: 400, body: { error: e?.message || 'Webhook rechazado' } }
    }
  }

  /**
   * F0 0.14 — Endpoint público SEGURO para consultar reserva por id + token.
   * Reemplaza al IDOR abierto `GET /api/public/bookings/:id`. Anti-enumeración:
   * mismo 404 para "no existe / sin token / token incorrecto / accessToken null".
   * El token se valida con HMAC-SHA256 + timingSafeEqual (anti timing attack).
   */
  async getPublicReservation(req: HttpRequest) {
    this.logger.info('GET /api/public/reservations/:id', { id: req.params.id })
    const token = (req.query?.token as string | undefined) || undefined
    return getPublicReservation(this.orm, String(req.params?.id || ''), token)
  }

  /**
   * F4 #627 — Auto-cancelación PÚBLICA del huésped.
   * POST /api/public/reservations/:id/cancel?token=X con body opcional { reason }.
   * Token = accessToken (HMAC + timingSafeEqual). Anti-enumeración: 404 mismo body para
   * no-existe / sin-token / token-inválido / accessToken-null.
   * checked_in/checked_out → 409 (no se puede auto-cancelar). Ya cancelled → 200 idempotente.
   */
  async cancelPublicReservation(req: HttpRequest) {
    this.logger.info('POST /api/public/reservations/:id/cancel', { id: req.params.id })
    if (!this.reservationsRepo || !this.cancellationPolicyRepo) {
      return { status: 500, body: { error: 'cancel deps no cableados' } }
    }
    // Token puede venir en query (?token=X) o en body (body.token). Reason es opcional.
    // Cast defensivo: req.body es `{}` por defecto en el type del framework.
    const body = (req.body || {}) as { token?: string; reason?: string }
    const token = (req.query?.token as string | undefined) || body.token || undefined
    const reason = typeof body.reason === 'string' ? body.reason : undefined
    return cancelPublicBooking(
      {
        reservationsRepo: this.reservationsRepo,
        policyRepo: this.cancellationPolicyRepo,
        // Preset `hotels.cancellationType` (nivel 3): sin esto un hotel 'strict' sin
        // políticas custom reembolsaba el 100% pese a anunciar 100% de penalidad.
        hotelsRepo: this.hotelsRepo,
        logger: this.logger,
        // El evento onBookingCancelled está declarado en sockets.ts pero el service no lo
        // expone (gate <200 líneas). Accedemos al socket del service en runtime (ya está
        // seteado por composition-root cuando este handler se ejecuta). Resilient: el
        // usecase ya envuelve el callback en try/catch (no bloquea la cancelación).
        onCancelled: (data) => (this.service as any).sockets?.onBookingCancelled?.(data),
      },
      String(req.params?.id || ''),
      token,
      reason,
    )
  }

  async trackEvent(req: HttpRequest) {
    this.logger.info('POST /api/public/events')
    const data = validateSchema(TrackEventSchema, req.body) as unknown as CreateConversionEventDTO
    const event = await this.service.trackEvent(data)
    return { status: 201, body: event }
  }

  async getPublicBookingBySlug(req: HttpRequest) {
    return getPublicBookingBySlug(this.orm, req.params.slug, req.query || {})
  }

  async createPublicBookingDirect(req: HttpRequest) {
    // F0 0.16 — Pasamos el service (con `createReservationCheckout`) y el logger al usecase
    // para que pueda crear la Checkout Session tras crear la reserva pending. Si Stripe falla,
    // el usecase devuelve `checkoutUrl: null` + `paymentError` (reserva NO se pierde).
    //
    // B5 fix (audit solmi-direct-booking) — Validación del body ANTES de pasar al usecase.
    // Antes `req.body` iba crudo al usecase, que validaba a mano solo los required; campos
    // malformados (ej. `adults: "abc"`) llegaban al ORM y generaban 500 o datos corruptos.
    // Ahora `validateSchema(ExtendedPublicBookingSchema, ...)` valida tipos + required (incl.
    // `roomId` nuevo en el schema). `upsells` (array) y `idempotencyKey` se leen crudo del
    // body porque el framework no soporta `type:'json'` en validators (documentado en schema).
    const rawBody = (req.body || {}) as Record<string, unknown>
    const validated = validateSchema(ExtendedPublicBookingSchema, rawBody) as Record<string, unknown>
    // Reincorporar `upsells`/`idempotencyKey` crudos si vienen (no validados por el schema).
    const body = {
      ...validated,
      ...(Array.isArray(rawBody.upsells) ? { upsells: rawBody.upsells } : {}),
      ...(typeof rawBody.idempotencyKey === 'string' ? { idempotencyKey: rawBody.idempotencyKey } : {}),
    } as { successUrl?: string; cancelUrl?: string; [k: string]: unknown }

    // successUrl/cancelUrl: el widget (F2) las va a mandar en el body. Si no llegan, derivamos
    // de `PUBLIC_BASE_URL` (env) para que el flujo no rompa en prod. El pattern de la URL de
    // vuelta es `/h/:slug?booking=:id&token=:token` (spec booking-unification R2) — lo arma el
    // frontend; el backend solo se asegura de tener URLs válidas para mandarle a Stripe.
    const baseUrl = process.env.PUBLIC_BASE_URL || publicBaseFromRequest(req)
    const successUrl = body.successUrl || (baseUrl ? `${baseUrl}/booking/success` : '')
    const cancelUrl = body.cancelUrl || (baseUrl ? `${baseUrl}/booking/cancel` : '')
    const stripeUrls = successUrl && cancelUrl ? { successUrl, cancelUrl } : undefined
    // F2 2.5 — Pasamos los deps de promo/upsells/config si están cableados. Si faltan, el
    // usecase funciona como F0 0.16 (persiste promoCode/upsells sin validarlos). El wiring
    // completo (index.ts) SIEMPRE cablea estos tres repos.
    const extraDeps = (this.configRepo && this.promoCodesRepo && this.upsellRepo)
      ? { config: this.configRepo, promoCodes: this.promoCodesRepo, upsells: this.upsellRepo, bookingConfig: this.bookingConfigRepo }
      : undefined
    return createPublicBookingDirect(
      this.orm, body,
      this.pushAvailability, this.auth,
      this.service, this.logger,
      stripeUrls,
      extraDeps,
    )
  }

  /**
   * POST /api/public/booking/group — Tarea 10 (QA 2026-08-20/21): varias habitaciones (mismo
   * tipo ×N y/o tipos distintos) en una sola reserva. Mismo criterio de wiring que el handler de
   * 1 habitación de arriba; `rooms` (array) se reincorpora crudo, igual que `upsells` ahí — el
   * framework no valida arrays de objetos.
   */
  async createPublicBookingGroup(req: HttpRequest) {
    const rawBody = (req.body || {}) as Record<string, unknown>
    const validated = validateSchema(CreatePublicBookingGroupSchema, rawBody) as Record<string, unknown>
    const body = {
      ...validated,
      ...(Array.isArray(rawBody.rooms) ? { rooms: rawBody.rooms } : {}),
      ...(Array.isArray(rawBody.upsells) ? { upsells: rawBody.upsells } : {}),
      ...(typeof rawBody.idempotencyKey === 'string' ? { idempotencyKey: rawBody.idempotencyKey } : {}),
    } as { successUrl?: string; cancelUrl?: string; [k: string]: unknown }

    const baseUrl = process.env.PUBLIC_BASE_URL || publicBaseFromRequest(req)
    const successUrl = body.successUrl || (baseUrl ? `${baseUrl}/booking/success` : '')
    const cancelUrl = body.cancelUrl || (baseUrl ? `${baseUrl}/booking/cancel` : '')
    const stripeUrls = successUrl && cancelUrl ? { successUrl, cancelUrl } : undefined
    const extraDeps = (this.configRepo && this.promoCodesRepo && this.upsellRepo)
      ? { config: this.configRepo, promoCodes: this.promoCodesRepo, upsells: this.upsellRepo, bookingConfig: this.bookingConfigRepo }
      : undefined
    return createPublicBookingGroup(
      this.orm, body,
      this.pushAvailability, this.auth,
      this.service, this.logger,
      stripeUrls,
      extraDeps,
    )
  }

  // ─── Público rates/upsells (F2 2.4 / 2.6) ──────────────────────────────────
  // Estos handlers son DELGADOS: la lógica (resolve slug, availability, conversion, taxes,
  // upsells activos) vive en los usecases para que los tests sean unitarios y aislados.

  /** GET /api/public/hotels/:slug/rates — rates + taxes + availableCount (D11 urgencia). */
  async getPublicRates(req: HttpRequest) {
    this.logger.info('GET /api/public/hotels/:slug/rates', { slug: req.params.slug })
    if (!this.hotelsRepo || !this.configRepo) {
      return { status: 500, body: { error: 'rates deps no cableados' } }
    }
    const query = (req.query || {}) as { checkIn?: string; checkOut?: string; rooms?: string; guests?: string; currency?: string }
    return getPublicRates(
      {
        hotels: this.hotelsRepo, availability: this.service, config: this.configRepo,
        bookingConfig: this.bookingConfigRepo, rooms: this.roomsRepo, hotelMedia: this.hotelMediaRepo,
        // F5 #627 — Repo de policies para resolver la política estructurada (cancellationSummary).
        policies: this.cancellationPolicyRepo,
        // Precio por fecha: LOS MISMOS repos que recibe `/calendar` abajo. Si `/rates` cotizara
        // sin ellos (min(basePrice) × noches) el calendario anunciaría un precio y el buscador
        // otro para las mismas fechas en cualquier hotel con temporadas cargadas.
        seasonAssignments: this.seasonAssignmentsRepo, roomRates: this.roomRatesRepo,
        rateOverrides: this.rateOverridesRepo,
      },
      String(req.params?.slug || ''),
      {
        checkIn: String(query.checkIn || ''),
        checkOut: String(query.checkOut || ''),
        rooms: query.rooms ? Number(query.rooms) : undefined,
        guests: query.guests ? Number(query.guests) : undefined,
        currency: query.currency,
      },
    )
  }

  /**
   * GET /api/public/hotels/:slug/calendar — precio desde + disponibilidad real por día.
   * Handler delgado: toda la lógica (temporadas → tarifas → fallback, bloqueos, moneda) vive
   * en `usecases/public-calendar.ts` para poder testearla sin HTTP ni ORM.
   */
  async getPublicCalendar(req: HttpRequest) {
    this.logger.info('GET /api/public/hotels/:slug/calendar', { slug: req.params.slug })
    if (!this.hotelsRepo || !this.roomsRepo || !this.reservationsRepo ||
        !this.roomBlocksRepo || !this.seasonAssignmentsRepo || !this.roomRatesRepo) {
      return { status: 500, body: { error: 'calendar deps no cableados' } }
    }
    const query = (req.query || {}) as { from?: string; to?: string; guests?: string; currency?: string }
    return getPublicCalendar(
      {
        hotels: this.hotelsRepo,
        rooms: this.roomsRepo,
        reservations: this.reservationsRepo,
        roomBlocks: this.roomBlocksRepo,
        seasonAssignments: this.seasonAssignmentsRepo,
        roomRates: this.roomRatesRepo,
        rateOverrides: this.rateOverridesRepo,
        config: this.configRepo,
        bookingConfig: this.bookingConfigRepo,
        cache: this.cache,
      },
      String(req.params?.slug || ''),
      {
        from: String(query.from || ''),
        to: String(query.to || ''),
        guests: query.guests !== undefined ? Number(query.guests) : undefined,
        currency: query.currency,
      },
    )
  }

  /**
   * GET /api/public/hotels/:slug/room-types — catálogo de tipos de habitación SIN filtrar por
   * disponibilidad (ver usecase para el bug real que arregla). Consumido por la vitrina
   * "Habitaciones" de la landing; `/rates` sigue siendo la fuente para precio/disponibilidad
   * en vivo de una búsqueda real.
   */
  async getPublicRoomTypes(req: HttpRequest) {
    this.logger.info('GET /api/public/hotels/:slug/room-types', { slug: req.params.slug })
    if (!this.hotelsRepo || !this.roomsRepo) {
      return { status: 500, body: { error: 'room-types deps no cableados' } }
    }
    return getPublicRoomTypes(
      {
        hotels: this.hotelsRepo, rooms: this.roomsRepo,
        hotelMedia: this.hotelMediaRepo, bookingConfig: this.bookingConfigRepo,
      },
      String(req.params?.slug || ''),
    )
  }

  /** GET /api/public/hotels/:slug/upsells — lista upsells activos (step de extras). */
  async getPublicUpsells(req: HttpRequest) {
    this.logger.info('GET /api/public/hotels/:slug/upsells', { slug: req.params.slug })
    if (!this.hotelsRepo || !this.upsellRepo) {
      return { status: 500, body: { error: 'upsells deps no cableados' } }
    }
    const kind = (req.query?.kind as string | undefined) || undefined
    return getPublicUpsells(
      { hotels: this.hotelsRepo, upsells: this.upsellRepo },
      String(req.params?.slug || ''),
      kind,
    )
  }

  /** GET /api/public/hotels/:slug/meal-plans — regímenes activos (tasks.md 2.2/2.4). */
  async getPublicMealPlans(req: HttpRequest) {
    this.logger.info('GET /api/public/hotels/:slug/meal-plans', { slug: req.params.slug })
    if (!this.hotelsRepo || !this.mealPlanRepo) {
      return { status: 500, body: { error: 'meal-plans deps no cableados' } }
    }
    return getPublicMealPlans(
      { hotels: this.hotelsRepo, mealPlans: this.mealPlanRepo },
      String(req.params?.slug || ''),
    )
  }

  /**
   * F3 3.15 — GET /api/public/hotels/:slug/ota-prices
   * Compara tarifa directa vs Booking/Airbnb (StayAPI). Devuelve `{showComparison:true, savings}`
   * SOLO si directo es más barato; si no, `{showComparison:false}` (no promover OTAs).
   * Rate-limited en la ruta (index.ts). Sin auth.
   */
  async getPublicOtaPrices(req: HttpRequest) {
    this.logger.info('GET /api/public/hotels/:slug/ota-prices', { slug: req.params.slug })
    if (!this.hotelsRepo || !this.configRepo) {
      return { status: 500, body: { error: 'ota-prices deps no cableados' } }
    }
    const query = (req.query || {}) as { checkIn?: string; checkOut?: string; guests?: string }
    return getPublicOtaPrices(
      { hotels: this.hotelsRepo, availability: this.service, config: this.configRepo, bookingConfig: this.bookingConfigRepo },
      String(req.params?.slug || ''),
      {
        checkIn: String(query.checkIn || ''),
        checkOut: String(query.checkOut || ''),
        guests: query.guests ? Number(query.guests) : undefined,
      },
    )
  }

  /**
   * F1 1.11 — Sitemap dinámico (`GET /sitemap.xml`). Lista `/h/:slug` por cada hotel con
   * `onlineBookingStatus='active'`. Público (sin auth), cache-friendly. Devuelve XML crudo
   * con su Content-Type (mismo patrón que `facturas/print` y `capacitacion` para HTML/PDF).
   *
   * FIX 2026-08-01 (issue GitLab #563) — `kernel/http/server.ts` solo se salta el envelope
   * JSON (`{success,data,meta,error}`) cuando `res.body` es un `Buffer` (`Buffer.isBuffer`);
   * un string plano SIEMPRE se envuelve, sin importar el `content-type` declarado. Un crawler
   * pidiendo `/sitemap.xml` recibía JSON con el XML escapado adentro de `data`, no XML crudo —
   * un sitemap "válido" que en realidad nunca fue parseable por Google. Mismo bug afecta a
   * `facturas/controller.ts:printInvoice` (retorna `body: html` sin Buffer) — no lo toco acá
   * (fuera del alcance de #563), pero queda documentado para no repetir el error en el próximo
   * endpoint "raw body" que se agregue.
   */
  async getSitemap(req: HttpRequest) {
    this.logger.info('GET /sitemap.xml')
    const urls = await listActiveHotelSlugs({ hotels: this.hotelsRepo! })
    const baseUrl = resolveBaseUrl(req)
    const xml = buildSitemapXml(baseUrl, urls)
    return {
      status: 200,
      headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': SITEMAP_CACHE_CONTROL },
      body: Buffer.from(xml, 'utf-8'),
    }
  }

  // ─── Upsells admin (F2 2.3) ────────────────────────────────────────────────
  // Sub-dominio del booking engine: extras del widget (desayuno, transfer, late checkout).
  // El controller invoca usecases directo (sin pasar por service) — no hay orquestación
  // entre HTTP y usecase, y mantener el service < 200 líneas deja fuera los passthrough.

  /** GET /api/upsells — lista los upsells del hotel del admin (ordenados por sortOrder). */
  async listUpsells(req: HttpRequest) {
    this.logger.info('GET /api/upsells', { hotelId: (req as any).hotelId })
    const result = await upsellsCrud.list(this.assertUpsellsDeps(), req.user as UpsellCurrentUser)
    return { status: 200, body: result }
  }

  /** POST /api/upsells — alta de upsell. */
  async createUpsell(req: HttpRequest) {
    this.logger.info('POST /api/upsells', { hotelId: (req as any).hotelId })
    const data = validateBodySchema(CreateUpsellSchema, req.body)
    const created = await upsellsCrud.create(this.assertUpsellsDeps(), data as any, req.user as UpsellCurrentUser)
    return { status: 201, body: created }
  }

  /** PUT /api/upsells/:id — edición (partial). */
  async updateUpsell(req: HttpRequest) {
    this.logger.info('PUT /api/upsells/:id', { id: req.params.id })
    const data = validateBodySchema(UpdateUpsellSchema, req.body)
    const updated = await upsellsCrud.update(this.assertUpsellsDeps(), req.params.id, data as any, req.user as UpsellCurrentUser)
    return { status: 200, body: updated }
  }

  /** DELETE /api/upsells/:id — borrado físico. */
  async destroyUpsell(req: HttpRequest) {
    this.logger.info('DELETE /api/upsells/:id', { id: req.params.id })
    const result = await upsellsCrud.remove(this.assertUpsellsDeps(), req.params.id, req.user as UpsellCurrentUser)
    return { status: 200, body: result }
  }

  // ─── Regímenes de alimentación admin (tasks.md 2.2/2.4) ─────────────────────
  // Catálogo FIJO de 3 códigos — sin create/delete, solo list + upsert por código.

  /** GET /api/meal-plans — los 3 regímenes del hotel del admin (con defaults). */
  async listMealPlans(req: HttpRequest) {
    this.logger.info('GET /api/meal-plans', { hotelId: (req as any).hotelId })
    const result = await mealPlansCrud.list(this.assertMealPlansDeps(), req.user as UpsellCurrentUser)
    return { status: 200, body: result }
  }

  /** PUT /api/meal-plans/:code — activar/desactivar + precio de un régimen. */
  async upsertMealPlan(req: HttpRequest) {
    this.logger.info('PUT /api/meal-plans/:code', { code: req.params.code })
    const data = validateBodySchema(UpsertMealPlanSchema, req.body)
    const updated = await mealPlansCrud.upsert(this.assertMealPlansDeps(), req.params.code, data as any, req.user as UpsellCurrentUser)
    return { status: 200, body: updated }
  }
}

/**
 * Cache-Control del sitemap: 1h (3600s). Es el TTL que recomendamos para crawlers — el listado
 * de hoteles activos cambia poco (alta/baja de motor público) y un refresco horario alcanza.
 */
const SITEMAP_CACHE_CONTROL = 'public, max-age=3600'

/**
 * F0 0.16 — Deriva la base pública del widget desde el request cuando `PUBLIC_BASE_URL` no
 * está seteada. Lee el `Origin`/`Referer` del request (headers que manda el navegador) y
 * construye `https://host`. Si no puede derivarla, devuelve '' (string vacío) — el usecase
 * omite el cobro y devuelve `checkoutUrl:null`, sin romper la creación de la reserva.
 *
 * El slug del hotel NO se incluye acá: el widget construye la URL final `/h/:slug?booking=...`
 * del lado del frontend (F2/0.20). Acá solo aseguramos una base válida para que Stripe sepa
 * a qué dominio volver.
 */
function publicBaseFromRequest(req: HttpRequest): string {
  const headers = (req as any).headers || {}
  const origin = headers['origin'] || headers['Origin']
  if (origin && typeof origin === 'string') return origin.replace(/\/$/, '')
  const referer = headers['referer'] || headers['Referer']
  if (referer && typeof referer === 'string') {
    try {
      const u = new URL(referer as string)
      return `${u.protocol}//${u.host}`
    } catch { /* referer malformado → caemos al host header */ }
  }
  const host = headers['host'] || headers['Host']
  if (host && typeof host === 'string') {
    // El widget se sirve por HTTPS en prod (siempre). En dev (HTTP localhost) el schema lo
    // infiere `x-forwarded-proto` si está (Cloudflare/nginx), si no asume https.
    const proto = headers['x-forwarded-proto'] || 'https'
    return `${proto}://${host}`
  }
  return ''
}
