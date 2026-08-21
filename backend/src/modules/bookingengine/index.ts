// bookingengine/index.ts — PUERTA PÚBLICA
// Módulo BookingEngine: config admin + endpoints públicos (sin auth)
// Endpoints: admin /booking-engine/* + público /api/public/*, /api/widgets/*

import { createModule, OrmRepository } from 'arckode-framework'
import { registerBookingengineModels } from './model'
import { BookingengineService } from './service'
import { BookingengineController } from './controller'
import type { BookingConfigDTO, PublicBookingDTO, ConversionEventDTO, UpsellDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { PaymentGatewayRegistry } from '../../services/payment-gateway/registry'
import { PaymentEventStore } from '../../services/payment-gateway/payment-events'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'

export { registerBookingengineModels, UpsellModel, BookingConfigModel, ConversionEventsModel, PublicBookingModel } from './model'
export { BookingengineService } from './service'
export type { BookingConfigDTO, UpdateBookingConfigDTO, AvailabilityQuery, AvailabilityResult, PublicBookingDTO, CreatePublicBookingDTO, ConversionEventDTO, CreateConversionEventDTO, BookingAnalytics, UpsellDTO, CreateUpsellDTO, UpdateUpsellDTO, UpsellKind } from './types'
export type { BookingengineSockets } from './sockets'
export { BookingengineValidator, UpdateBookingConfigSchema, CheckAvailabilitySchema, CreatePublicBookingSchema, TrackEventSchema, CreateUpsellSchema, UpdateUpsellSchema } from './validators/schema'
// Calendario público de tarifas (`GET /api/public/hotels/:slug/calendar`).
export { validatePublicCalendarQuery, MAX_CALENDAR_DAYS } from './validators/schema'
export type { CalendarDay, PublicCalendarBody, PublicCalendarQuery } from './usecases/public-calendar'
// Catálogo de tipos de habitación (`GET /api/public/hotels/:slug/room-types`).
export type { PublicRoomTypeCatalogEntry } from './usecases/public-room-types'

export function BookingengineModule(opts?: { pushAvailability?: (hotelId: string, roomId: string) => void }) {
  return createModule({
    name: 'bookingengine',
    version: '1.0.0',
    description: 'Booking engine: widget config, public availability, reservations, analytics',

    contract: {
      name: 'bookingengine',
      version: '1.0.0',
      description: 'Booking engine: widget config, public availability, reservations, analytics',
      actions: ['getConfig', 'updateConfig', 'checkAvailability', 'trackEvent', 'getAnalytics', 'getPublicBookingBySlug', 'createPublicBookingDirect'],
      events: ['onBookingCreated', 'onBookingCancelled', 'onConversionEvent'],
      tables: ['booking_config', 'conversion_events'],
      dependencies: ['canales', 'hoteles', 'habitaciones'],
      rules: ['No importar de otros módulos directamente'],
    },

    create({ logger, orm, cache, router, auth }: { logger: any; orm: any; cache: any; router: any; auth?: any }) {
      registerBookingengineModels(orm)

      const configRepo = new OrmRepository<BookingConfigDTO>(orm, 'BookingConfig')
      const roomsRepo = new OrmRepository<any>(orm, 'Rooms')
      const reservationsRepo = new OrmRepository<any>(orm, 'Reservations')
      const hotelsRepo = new OrmRepository<any>(orm, 'Hotels')
      const bookingRepo = new OrmRepository<PublicBookingDTO>(orm, 'BookingEngine')
      const eventsRepo = new OrmRepository<ConversionEventDTO>(orm, 'ConversionEvents')
      // F4 4.1 (D13) — Repo sobre `TrackingEvent` (modelo definido por el módulo server-tracking
      // en composition-root). Se usa SOLO para leer el funnel de conversión. Sin cross-module
      // import: accedemos al modelo global registrado en el ORM, mismo patrón que Rooms/Hotels.
      const trackingRepo = new OrmRepository<any>(orm, 'TrackingEvent')

      const log = logger.child('bookingengine')
      // La pasarela se resuelve POR HOTEL: el huésped que reserva en el widget del Hotel A le
      // paga a la cuenta del Hotel A, no a la del .env del servidor.
      const gatewayRepo = new OrmRepository<any>(orm, 'PaymentGateways')
      const registry = new PaymentGatewayRegistry(gatewayRepo as any, log)
      // Barrera anti-doble-cobro para el webhook público.
      const eventStore = new PaymentEventStore(new OrmRepository<any>(orm, 'PaymentEvents') as any, log)

      // F2 2.3 — Upsells: deps para el controller (no el service, que se mantiene < 200 líneas).
      // El controller invoca los usecases directo; userRepo + auth se necesitan para ownership
      // (admin no puede tocar upsells de hotel ajeno).
      const upsellRepo = new OrmRepository<UpsellDTO>(orm, 'Upsells')
      const userRepoForUpsells = new OrmRepository<any>(orm, 'Users')
      // F2 2.4 / 2.5 — Deps nuevos: configuration (taxes + currency_rates) y promo_codes
      // (valida + incrementa uses en el flujo unificado). Sin estos, los endpoints públicos
      // /rates y /booking procesan todo vacío (degradación graceful, no rompe el flujo).
      const configurationRepo = new OrmRepository<any>(orm, 'Configuration')
      const promoCodesRepo = new OrmRepository<any>(orm, 'PromoCodes')
      // FIX (foto real por tipo de habitación en /rates) — `roomsRepo` ya existe arriba (lo usa
      // el service para disponibilidad); `hotelMediaRepo` nuevo, mismo criterio: acceso directo
      // por nombre de modelo ORM, no import cross-module.
      const hotelMediaRepo = new OrmRepository<any>(orm, 'HotelMedia')
      // F4 #627 — Repo de políticas de cancelación para la auto-cancelación pública.
      // El modelo 'CancellationPolicies' lo registra el módulo `cancellation` (F1) en
      // composition-root. Mismo patrón que trackingRepo: acceso por nombre global, sin import.
      const cancellationPolicyRepo = new OrmRepository<any>(orm, 'CancellationPolicies')
      // Calendario público (`GET /api/public/hotels/:slug/calendar`): bloqueos de habitación +
      // temporada por fecha + tarifas por temporada. Los tres modelos son COMPARTIDOS
      // (`shared/models.ts`), no de otro módulo: mismo patrón que Rooms/Hotels/Configuration
      // acá arriba — repo por nombre de modelo ORM, sin import cross-module.
      const roomBlocksRepo = new OrmRepository<any>(orm, 'RoomBlocks')
      const seasonAssignmentsRepo = new OrmRepository<any>(orm, 'SeasonAssignments')
      const roomRatesRepo = new OrmRepository<any>(orm, 'RoomRates')

      const service = new BookingengineService(
        configRepo, roomsRepo, reservationsRepo, hotelsRepo,
        bookingRepo, eventsRepo, log, cache, registry, eventStore, trackingRepo,
        // FIX 2026-07-31 — habilita syncUpsellFromPackage/removeSyncedUpsell para el
        // connector paquetes-bookingengine (Ofertas → Upsells).
        upsellRepo,
        // FIX (room_blocks + stop-sell) — mismos tres repos que ya consume `/calendar` más
        // abajo. Sin esto, `AvailabilityUseCase` seguía vendiendo habitaciones bloqueadas por
        // mantenimiento y noches con `room_rates.closed` (cerradas en las OTAs, abiertas acá).
        roomBlocksRepo, seasonAssignmentsRepo, roomRatesRepo,
      )
      const controller = new BookingengineController(
        service, log, orm, auth, opts?.pushAvailability, hotelsRepo,
        upsellRepo, userRepoForUpsells, auth,
        configurationRepo, promoCodesRepo,
        // FIX 2026-07-31 — `configRepo` (arriba, tabla real `booking_config`) para que
        // enabled/minNights/maxNights/showComparison/cancellationPolicy dejen de ser
        // decorativos en /rates, /ota-prices y /booking.
        configRepo,
        roomsRepo, hotelMediaRepo,
        // F4 #627 — reservationsRepo (ya existe arriba) + cancellationPolicyRepo para
        // la auto-cancelación pública del huésped (POST /api/public/reservations/:id/cancel).
        reservationsRepo, cancellationPolicyRepo,
        // Calendario público — deps nuevas al final (no corren las posiciones existentes).
        roomBlocksRepo, seasonAssignmentsRepo, roomRatesRepo, cache,
      )

      // Admin routes (protegidas con auth)
      if (auth) {
        const roleRepo = new OrmRepository<any>(orm, 'Roles')
        const guard = createPermissionGuard(auth, roleRepo)

        // FIX 2026-07-31 (QA solmi-direct-booking) — faltaba el prefijo /api: el resto del
        // proyecto registra rutas admin como '/api/...' (ver /api/upsells abajo) y el router del
        // framework NO agrega prefijo automático. Con '/booking-engine/config' a secas, el
        // frontend (que siempre pega a '/api/booking-engine/config') recibía 404 NOT_FOUND desde
        // que el módulo existe — la pantalla /panel/booking-engine nunca pudo cargar ni guardar
        // config (Promise.all en loadAll() rechazaba entero, form nunca se hidrataba).
        router.get('/api/booking-engine/config', guard('settings', 'view'), (req: any) => controller.getConfig(req))
        router.put('/api/booking-engine/config', guard('settings', 'edit'), (req: any) => controller.updateConfig(req))
        router.get('/api/booking-engine/analytics', guard('reports', 'view'), (req: any) => controller.getAnalytics(req))

        // F2 2.3 — Upsells admin. Permiso propio `upsells:*` (decisión: no reusar settings:* ni
        // booking-engine:edit porque no existe; cada recurso con su permiso, mismo criterio que
        // landing/media/promo). userType merchant asegura que no accede un staff userType=admin.
        const upsellGuard = (action: 'view' | 'create' | 'edit' | 'delete') => [
          ...guard('upsells', action),
          requireUserType('merchant'),
        ]
        router.get('/api/upsells', upsellGuard('view'), (req: any) => controller.listUpsells(req))
        router.post('/api/upsells', upsellGuard('create'), (req: any) => controller.createUpsell(req))
        router.put('/api/upsells/:id', upsellGuard('edit'), (req: any) => controller.updateUpsell(req))
        router.delete('/api/upsells/:id', upsellGuard('delete'), (req: any) => controller.destroyUpsell(req))
        // GET /api/booking-engine lo sirve el módulo `reservas`, que se registra antes y gana por orden de ruta.
      }

      // Público (sin auth) — TODOS con rate-limit por IP (F0 0.5). Límites y claves por
      // especificación (openspec/changes/solmi-direct-booking/specs/public-hotel-info/spec.md):
      // queries read-only 60/60s, escritura de bookings/checkout 20/60s, eventos 120/60s.
      // El webhook de Stripe NO se rate-limite acá: la firma criptográfica es validación
      // suficiente, y un límite por IP podría bloquear a Stripe mismo tras un replay storm.
      router.post('/api/public/availability', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-availability:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.checkAvailability(req)
      })
      router.get('/api/public/hotel/:slug', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-hotel-info:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getHotelPublicInfo(req)
      })
      // F2 2.4 — Tarifas públicas del hotel por slug: room types disponibles + fromPrice +
      // availableCount (D11 urgencia) + taxBreakdown. Rate-limit 60/60s (read-only, mismo
      // techo que /public/hotel/:slug). Sin auth.
      router.get('/api/public/hotels/:slug/rates', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-rates:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getPublicRates(req)
      })
      // Catálogo de tipos de habitación (sin disponibilidad): la vitrina "Habitaciones" de la
      // landing lo usa para decidir QUÉ tarjetas mostrar, sin que un tipo ocupado en la ventana
      // indicativa de /rates desaparezca de la web pública (ver usecase). Rate-limit 60/60s,
      // mismo techo que /rates y /hotel/:slug (read-only). Sin auth.
      router.get('/api/public/hotels/:slug/room-types', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-room-types:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getPublicRoomTypes(req)
      })
      // Calendario público de tarifas: por día, `fromPrice` de esa noche + disponibilidad real
      // (considera `room_blocks`) + stop-sell + minStay. Rate-limit 60/60s, mismo techo que
      // /rates y /hotel/:slug (read-only). Sin auth.
      router.get('/api/public/hotels/:slug/calendar', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-calendar:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getPublicCalendar(req)
      })
      // F2 2.6 — Lista upsells activos del hotel para el step de extras del widget. Rate-limit
      // 60/60s (read-only). Sin auth. Filtro opcional ?kind=per_room|per_person|per_stay.
      router.get('/api/public/hotels/:slug/upsells', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-upsells:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getPublicUpsells(req)
      })
      // F3 3.15 — Comparativo de tarifas directo vs OTA (StayAPI). Devuelve el badge "ahorrás
      // $X reservando directo" SOLO si directo es más barato. Si no, `{showComparison:false}`
      // (no promociona OTAs más baratas). Rate-limit 30/60s (read-only pero llama API externa
      // paga — más estricto que /rates para no quemar quota de StayAPI). Sin auth.
      router.get('/api/public/hotels/:slug/ota-prices', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-ota-prices:${getClientIp(req)}`, { maxAttempts: 30, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getPublicOtaPrices(req)
      })
      // F1 1.11 — Sitemap dinámico. Público (sin auth), cache-control 1h. Rate-limit suave:
      // bots buenos respetan crawl-delay, pero un bot malicioso podría meter ruido. 60/min sobra.
      router.get('/sitemap.xml', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`sitemap:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getSitemap(req)
      })
      router.get('/api/public/booking/:slug', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-booking-info:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getPublicBookingBySlug(req)
      })
      router.post('/api/public/booking', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-booking-create:${getClientIp(req)}`, { maxAttempts: 20, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.createPublicBookingDirect(req)
      })
      // Tarea 10 (QA 2026-08-20/21) — varias habitaciones (mismo tipo ×N y/o tipos distintos) en
      // 1 sola reserva. Mismo rate-limit que el endpoint de 1 habitación (misma escritura pública).
      router.post('/api/public/booking/group', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-booking-group-create:${getClientIp(req)}`, { maxAttempts: 20, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.createPublicBookingGroup(req)
      })
      router.post('/api/public/bookings', async () => {
        // DT-13 — flujo plural viejo borrado (F0 0.12 rollback path, ya no tiene sentido: el
        // flag BOOKING_USE_UNIFIED_FLOW nunca vuelve a false en la práctica). 410 permanente
        // para no romper clients stale, mismo criterio que GET /api/public/bookings/:id de abajo.
        log.warn('POST /api/public/bookings removed — use POST /api/public/booking')
        return { status: 410, body: { error: 'Deprecated. Use POST /api/public/booking' } }
      })
      router.get('/api/public/bookings/:id', async (req: any) => {
        // Hardening go-live (solmi-direct-booking) — IDOR eliminado. Este endpoint exponía
        // cualquier reserva por UUID sin token. El endpoint seguro
        // `GET /api/public/reservations/:id?token=X` (HMAC + timingSafeEqual) lo reemplaza.
        // Devolvemos 410 SIEMPRE (sin importar el flag) para no romper clients stale que
        // todavía lo piden, pero sin filtrar datos. El branch IDOR se borró.
        log.warn('GET /api/public/bookings/:id removed (IDOR) — use GET /api/public/reservations/:id?token=X')
        return { status: 410, body: { error: 'Deprecated. Use GET /api/public/reservations/:id?token=X' } }
      })
      // F0 0.14 — Endpoint público SEGURO. Token HMAC en ?token=X (anti-IDOR).
      router.get('/api/public/reservations/:id', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-reservation-get:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.getPublicReservation(req)
      })
      // F4 #627 — Auto-cancelación pública del huésped. Misma seguridad que GET (token HMAC
      // + timingSafeEqual + anti-enumeración). Rate-limit 20/60s (escritura, mismo techo que
      // POST /api/public/booking — un huésped no cancela más de unas pocas reservas).
      router.post('/api/public/reservations/:id/cancel', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-reservation-cancel:${getClientIp(req)}`, { maxAttempts: 20, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.cancelPublicReservation(req)
      })
      router.post('/api/public/bookings/:id/checkout', async () => {
        // DT-13 — mismo criterio que el POST de arriba: flujo plural viejo borrado.
        log.warn('POST /api/public/bookings/:id/checkout removed — use POST /api/public/reservations/:id/checkout')
        return { status: 410, body: { error: 'Deprecated. Use POST /api/public/reservations/:id/checkout' } }
      })
      router.post('/api/public/webhook/stripe/:hotelId', (req: any) => controller.handleStripeWebhook(req))
      router.post('/api/public/events', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-events:${getClientIp(req)}`, { maxAttempts: 120, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.trackEvent(req)
      })

      // Widget endpoints — mismo rate-limit que la ruta pública equivalente (es un alias).
      router.get('/api/widgets/availability/:hotelId', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-widget-availability:${getClientIp(req)}`, { maxAttempts: 60, windowMs: 60_000 })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.checkAvailability(req)
      })

      // Ya no se inicializa Stripe con process.env: la pasarela sale de payment_gateways del hotel.

      log.info('BookingEngine module ready')
      return service
    },
  })
}
