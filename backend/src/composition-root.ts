// src/composition-root.ts — SolmiOS
// Entry point. SOLO: config, infra, módulos, conectores, start/stop.

import {
  System, ConfigStore, Logger, Router, MemoryCache, ORM, Container, NodeServer, OrmRepository,
} from 'arckode-framework'
import { cors, requestLogger, bodyLimit, timeout, compression } from 'arckode-framework/middlewares'
import { securityHeaders } from './shared/middlewares/security-headers'
import { corsWithErrorHeaders } from './shared/middlewares/cors-error-headers'
import { getClientIp } from './shared/middlewares/rate-limit'
import { scopedRateLimit } from './shared/middlewares/scoped-rate-limit'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { PostgresAdapter } from 'arckode-framework/adapters/postgres'
import { jwtTokenAdapter } from 'arckode-framework/adapters/jwt'
import { HotelAuth } from './infrastructure/auth/hotel-auth'
import { registerSharedModels } from './shared/models'
import { configureStripe } from './infrastructure/stripe-config'
import { bootstrapEmail } from './infrastructure/email-bootstrap'
import { createPushAvailability } from './shared/utils/push-availability'
import { createNoShowCron } from './modules/reports/usecases/no-show-cron'
import { createAutoMessagesCron } from './modules/marketing/usecases/auto-messages-cron'
import { createNightAuditCron } from './shared/usecases/night-audit-cron'
import { createEvidenceRetentionCron } from './shared/usecases/evidence-retention-cron'
import { createTrialReminderCron } from './shared/usecases/trial-reminder-cron'
import { createPrearrivalPassCron } from './shared/usecases/prearrival-pass-cron'
import { createSubscriptionSuspensionCron } from './shared/usecases/subscription-suspension-cron'
import { createReferralCreditsCron } from './shared/usecases/referral-credits-cron'
import { createCurrencyRatesCron, CURRENCY_RATES_TICK_MS } from './shared/usecases/currency-rates-cron'
import { createBookingSyncCron, DEFAULT_BOOKING_SYNC_TICK_MS } from './shared/usecases/booking-sync-cron'
import { HousekeepingSettingsUseCase } from './modules/housekeeping/usecases/settings'
import { reservasPaymentRequestsConnector } from './connectors/reservas-payment-requests'
import { RedisCache } from './infrastructure/cache/redis-cache'

// ─── Config ────────────────────────────────────────────────────────────────
const config = new ConfigStore()
config.define({
  PORT: { type: 'number', default: '3000' },
  JWT_SECRET: { type: 'string', required: true },
  JWT_EXPIRES: { type: 'string', default: '24h' },
  JWT_REFRESH_EXPIRES: { type: 'string', default: '7d' },
  FRONTEND_PORT: { type: 'number', default: 5173 },
})
config.load(process.env)
const PORT = config.get<number>('PORT')

// ─── Infraestructura ───────────────────────────────────────────────────────
// Logger(source, level): el 1er arg es el NOMBRE del componente, no el nivel. Antes decía
// `new Logger('info')` → todos los logs salían con source="info" en vez de identificar el origen.
const logger = new Logger('solmios', 'info')
// Multi-motor: DATABASE_URL -> Postgres, sino SQLite (DB_PATH). Migración SQLite→Postgres.
const DATABASE_URL = process.env.DATABASE_URL
const db = DATABASE_URL
  ? new PostgresAdapter({ connectionString: DATABASE_URL })
  : new SqliteAdapter({ path: process.env.DB_PATH || './data/managerhotel.db', wal: true, foreignKeys: true })
await db.connect()
const orm = new ORM(db)
registerSharedModels(orm)

// PF-03 (#279): con REDIS_URL seteada el cache sobrevive a un restart y se comparte entre
// procesos (prod hoy corre 1 solo proceso systemd, así que el beneficio inmediato es la
// persistencia tras restart/deploy). Sin la var, MemoryCache de siempre — cero config nueva en dev.
const cache = process.env.REDIS_URL ? new RedisCache(process.env.REDIS_URL, logger) : new MemoryCache()
const container = new Container()
const auth = new HotelAuth(jwtTokenAdapter, config.get<string>('JWT_SECRET'), logger, config.get('JWT_EXPIRES'), config.get('JWT_REFRESH_EXPIRES'))
const router = new Router()
const FRONTEND_PORT = config.get<number>('FRONTEND_PORT')
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',') || [`http://localhost:${PORT}`, 'http://localhost:3000', `http://localhost:${FRONTEND_PORT}`]

// CORS con headers también en respuestas de error: un 401/403/409 lanzado como ErrorContract
// escapaba sin Access-Control-Allow-Origin (el catch del Router arma la respuesta sin headers)
// y el browser lo reportaba como error de CORS en vez del status real.
router.use(corsWithErrorHeaders({ origins: CORS_ORIGINS }))
router.use(securityHeaders())
router.use(bodyLimit(5 * 1024 * 1024))
router.use(requestLogger(logger))
// SEC-4.2: keyBy getClientIp (CF-Connecting-IP / última-XFF). Sin esto el limiter keyeaba por
// remoteAddress = 127.0.0.1 detrás de nginx → un solo bucket para TODOS (inútil o bloquea a todos).
// #658: separado en dos — /api/auth/* (fuerza bruta) queda agresivo; el resto del panel (lectura
// normal, N+1 de RRHH/Config incluido) queda holgado. Antes compartían el mismo cupo de 200/min
// y una sola pasada de navegación normal ya disparaba ~100 respuestas 429.
//
// DEV (NODE_ENV !== 'production'): límites holgados para que la suite E2E de Playwright (que ahora
// cubre auth multitenant + staff + nómina + edición, ~25 tests haciendo setup por API) no toque el
// techo. En prod se mantienen los límites originales (30/600). Sin este ajuste, correr la suite
// completa en dev satura el bucket de /api/* en ~35s y produce cascadas de 429.
const isDev = process.env.NODE_ENV !== 'production'
const authMax = isDev ? 200 : 30
const apiMax = isDev ? 3000 : 600
router.use(scopedRateLimit((path) => path.startsWith('/api/auth'), { windowMs: 60_000, max: authMax, keyBy: getClientIp }))
router.use(scopedRateLimit((path) => !path.startsWith('/api/auth'), { windowMs: 60_000, max: apiMax, keyBy: getClientIp }))
router.use(timeout(30000))
router.use(compression({ threshold: 1024 }))

const http = new NodeServer(PORT, logger)
const system = new System({ config, container, logger, orm, router, http, cache, auth })

// ─── Storage ───────────────────────────────────────────────────────────────
// Con credenciales de Backblaze B2 en el entorno se sube a B2 (S3-compatible);
// si no, al disco local. Mismo patrón que DATABASE_URL para Postgres vs SQLite.
import { StorageService } from 'arckode-framework/modules/storage'
import { LocalStorageAdapter } from 'arckode-framework/modules/storage/local-adapter'
import { serveStatic } from 'arckode-framework/static'
import { S3StorageAdapter, s3ConfigFromEnv } from './infrastructure/storage/s3-adapter'
const s3Config = s3ConfigFromEnv()
// Se guarda la referencia al adapter S3: housekeeping la necesita para FIRMAR la
// subida del video directo al bucket (un video no entra en el body del backend).
const s3Adapter = s3Config ? new S3StorageAdapter(s3Config) : undefined
const storage = new StorageService(
  s3Adapter ?? new LocalStorageAdapter('./uploads', '/uploads'),
)
// El estático local sigue sirviendo lo ya subido a disco aunque se active B2.
serveStatic(router, './uploads', { prefix: '/uploads' })

// DEP-05: endpoint público de salud (/api/health) para monitoreo externo.
import { registerHealthRoute } from './infrastructure/health'
registerHealthRoute(router, orm)

// ─── Módulos ───────────────────────────────────────────────────────────────
import { HabitacionesModule } from './modules/habitaciones'
import { ReservasModule } from './modules/reservas'
import { HuespedesModule } from './modules/huespedes'
import { FacturasModule } from './modules/facturas'
import { HousekeepingModule } from './modules/housekeeping'
import { MantenimientoModule } from './modules/mantenimiento'
import { PaquetesModule } from './modules/paquetes'
import { GruposModule } from './modules/grupos'
import { HotelesModule } from './modules/hoteles'
import { UsuariosModule } from './modules/usuarios'
import { RolesModule } from './modules/roles'
import { DispositivosModule } from './modules/dispositivos'
import { AnunciosModule } from './modules/anuncios'
import { ApikeysModule } from './modules/apikeys'
import { AuditlogModule } from './modules/auditlog'
import { TicketsModule } from './modules/tickets'
import { NotificacionesModule } from './modules/notificaciones'
import { CanalesModule } from './modules/canales'
import { OpinionesModule } from './modules/opiniones'
import { GastosModule } from './modules/gastos'
import { FoliosModule } from './modules/folios'
import { PaymentsModule } from './modules/payments'
import { AccountingModule } from './modules/accounting'
import { TreasuryModule } from './modules/treasury'
import { CajaChicaModule } from './modules/caja-chica'
import { RestaurantModule } from './modules/restaurant'
import { InventarioModule } from './modules/inventario'
import { ComprasModule } from './modules/compras'
import { EmpleadosModule } from './modules/empleados'
import { ReclutamientoModule } from './modules/reclutamiento'
import { ReembolsosModule } from './modules/reembolsos'
import { PayrollModule } from './modules/payroll'
import { AttendanceModule } from './modules/attendance'
import { ActivosModule } from './modules/activos'
import { CapacitacionModule } from './modules/capacitacion'
import { CrmModule } from './modules/crm'
import { MarketingModule } from './modules/marketing'
import { AiRecepcionistaModule } from './modules/ai-recepcionista'
import { AiGerenteModule } from './modules/ai-gerente'
import { BookingengineModule } from './modules/bookingengine'
import { CashModule } from './modules/cash'
import { PaymentRequestsModule } from './modules/payment-requests'
import { PaymentGatewaysModule } from './modules/payment-gateways'
import { AdminModule } from './modules/admin'
import { ReportsModule } from './modules/reports'
import { PricingModule } from './modules/pricing'
import { AmenitiesModule } from './modules/amenities'
import { TtlockModule } from './modules/ttlock'
import { SubscriptionsModule } from './modules/subscriptions'
import { ReferralsModule } from './modules/referrals'
import { AliadosModule } from './modules/aliados'
import { DashboardModule } from './modules/dashboard'
import { FeedbackModule } from './modules/feedback'
import { StaffAuthModule } from './modules/staff-auth'
import { MessagesModule } from './modules/messages'
import { PushTokensModule } from './modules/pushtokens'
import { EmailQueueModule } from './modules/email-queue'
import { PublicapiModule } from './modules/publicapi'
import { WebhooksModule } from './modules/webhooks'
import { PlatformEmailsModule } from './modules/platform-emails'
// F0 (solmi-direct-booking): media del hotel (hero/gallery/room) para la landing pública.
// Modelo + service + usecases (tasks 0.6 + 0.7). Rutas (0.8) se agregan en pieza paralela.
import { HotelMediaModule } from './modules/hotel-media'
// F1 (solmi-direct-booking): landing pública por bloques. Tasks 1.1–1.4 (modelo +
// seeder + service + rutas admin/pública). El admin la edita desde /settings/landing.
import { LandingModule } from './modules/landing'
import { SitePagesModule } from './modules/site-pages'
import { DeletionRequestsModule } from './modules/deletion-requests'
// Leads del formulario de ventas de la landing pública ("Hablar con Ventas"/"Contactar
// ventas"). Mismo patrón que deletion-requests: formulario público + gestión super_admin.
import { SalesLeadsModule } from './modules/sales-leads'
// Digitalización: expediente de los hoteles SIN presencia digital. El sistema detecta los que no
// tienen web y el super_admin los acompaña por los cinco pasos (página por plantilla,
// configuración completa —que se cobra—, Google Maps, Google Hotel y motor de reservas).
import { DigitalizacionModule } from './modules/digitalizacion'
// F2 2.1–2.3 (solmi-direct-booking): códigos promocionales del widget de reservas.
// Modelo promo_codes (con UNIQUE index creado en migrate-db.ts) + CRUD admin + validación
// pública (sin auth, rate-limited). Upsells NO va acá: es sub-dominio de bookingengine.
import { PromoCodesModule } from './modules/promo-codes'
// F3 3.1–3.3 (solmi-direct-booking): agregador de reseñas externas (GBP + TripAdvisor + StayAPI).
// Modelo external_reviews (con UNIQUE index creado en migrate-db.ts) + service.upsertBatch
// (dedup por source+sourceExternalId) + cron nightly. Connectors en src/connectors/ +
// OAuth helper en services/gbp-oauth-client.ts. Rutas admin (reviews/*) + cron wiring abajo.
import { ExternalReviewsModule } from './modules/external-reviews'
// F3 3.6 (solmi-direct-booking): wallet pass al confirmar la reserva. Modelo wallet_passes
// (UNIQUE (reservationId) creado en migrate-db.ts) + service.generatePass que orquesta
// TTLock + Apple .pkpass + Google save URL + email "Tu pase + código de acceso".
// Rutas admin (`/api/wallet-pass` GET + `/api/wallet-pass/reservation/:id` GET, permiso
// `settings:view`). El trigger de generación NO va por HTTP: el connector `reservas-wallet`
// subscribe a `bookingengine.onBookingPaid` y dispara generatePass (F3 3.8). El email se
// inyecta desde `email-bootstrap` (F3 3.9) igual que reservas/payroll/opiniones.
import { WalletPassModule } from './modules/wallet-pass'
// F3 3.10–3.13 (solmi-direct-booking): server-side tracking. Modelo tracking_events +
// service.fireAll (Meta CAPI + GA4 MP v2 + Enhanced Conversions con SHA256 de PII).
// Trigger: connector `bookingengine-tracking` subscribe a `bookingengine.onBookingPaid`
// (mismo socket que `reservas-wallet`) y dispara fireAll(reservationId). Skip silencioso si
// faltan creds (status=skipped en tracking_events). Rutas admin (`POST /api/server-tracking/test`
// y `GET /api/server-tracking/events`, permiso settings:edit). Las CREDS viajan como keys
// libres en configuration (meta_pixel_id, meta_capi_token, ga4_measurement_id, ga4_api_secret,
// meta_test_event_code) — el frontend las persiste con ConfigService.set.
import { ServerTrackingModule } from './modules/server-tracking'
// F3 3.14 (solmi-direct-booking) — Cron de recuperación de reservas abandonadas. Módulo
// cron-only (sin rutas HTTP ni tabla propia): registra el service.runSweep que el cron
// factory invoca cada 30 min. El email se pasa post-init desde email-bootstrap.
import { AbandonRecoveryModule } from './modules/abandon-recovery'
// F1 plan #627 (políticas de cancelación) — Tabla cancellation_policies + cálculo de
// penalidad. F1 = fundación: solo modelo + funciones puras (shared/usecases/cancellation-math).
// Las rutas CRUD y la integración con reservas/bookingengine llegan en F2-F5.
import { CancellationModule } from './modules/cancellation'
// F3 3.5 (solmi-direct-booking): los fetchers se declaran acá (antes de modules[]) para que
// tanto el módulo (ruta admin /api/external-reviews/sync-now) como el cron nightly compartan
// la MISMA configuración de clients HTTP externos. Los connectors viven en src/connectors/.
import { fetchGbpReviews, defaultGbpFetcher } from './connectors/gbp-reviews'
import { fetchTripadvisorReviews, defaultTripadvisorFetcher } from './connectors/tripadvisor-reviews'
import { fetchStayApiReviews, defaultStayApiFetcher } from './connectors/stayapi-reviews'
// F3 3.15 (solmi-direct-booking): fetcher StayAPI de precios OTA (comparativo directo vs OTA).
// Es un adaptador HTTP externo (no conector inter-módulo — mismo caso que stayapi-reviews.ts).
// El import acá es para que el analyzer lo registre como "no dead code"; el consumo real lo
// hace bookingengine/usecases/public-ota-prices.ts.
import { defaultStayApiPricesFetcher } from './connectors/stayapi-ota-prices'
import type { ExternalReviewsFetchers } from './shared/usecases/external-reviews-cron'
// F3 3.14 (solmi-direct-booking) — Cron de recuperación de reservas abandonadas.
import { createAbandonRecoveryCron, ABANDON_RECOVERY_TICK_MS } from './shared/usecases/abandon-recovery-cron'
import { FcmClient } from './services/fcm-client'

// F3 3.5 — Fetchers de las 3 APIs externas. Compartido por módulo (sync endpoint) + cron.
// Declarado antes de modules[] para que el closure del módulo capture la referencia estable.
const externalReviewsFetchers: ExternalReviewsFetchers = {
  gbp: (c, _f, log) => fetchGbpReviews(c, defaultGbpFetcher, log as any),
  tripadvisor: (c, _f, log) => fetchTripadvisorReviews(c, defaultTripadvisorFetcher, log as any),
  stayapi: (c, _f, log) => fetchStayApiReviews(c, defaultStayApiFetcher, log as any),
}

const pushAvailability = createPushAvailability((name) => system.resolveModule(name), logger)

const mods = [
  PaymentGatewaysModule(),
  UsuariosModule({ storage }), HabitacionesModule(), ReservasModule({ storage }), HuespedesModule(),
  FacturasModule(), HousekeepingModule({ storage, videoStorage: s3Adapter }), MantenimientoModule({ storage }), PaquetesModule(),
  GruposModule(), HotelesModule({ storage }), RolesModule(), DispositivosModule(),
  AnunciosModule(), ApikeysModule(), AuditlogModule(), TicketsModule(), NotificacionesModule(),
  CanalesModule(), OpinionesModule(), GastosModule(), FoliosModule(), PaymentsModule(),
  EmpleadosModule({ storage }), PayrollModule(), AttendanceModule(), ActivosModule(), CapacitacionModule(), CrmModule(), MarketingModule(),
  ReclutamientoModule(), ReembolsosModule(),
  AiRecepcionistaModule(), AiGerenteModule(), BookingengineModule({ pushAvailability }),
  CashModule(),
  // Contabilidad de doble entrada (CTB-0). Módulo aislado; los asientos automáticos se
  // enganchan por conectores en tareas posteriores (CTB-4). Ver openspec contabilidad-tesoreria.
  AccountingModule(),
  // Tesorería (TES-0): bancos, flujo de caja, AR/AP, presupuesto. Reportes leen payments/expenses/invoices.
  TreasuryModule(),
  // Caja chica (PETTY-0): fondos fijos con custodio para gastos menores + reposición. Reusa permiso
  // de treasury. El conector caja-chica-gastos descuenta el saldo al crear un gasto vinculado.
  CajaChicaModule(),
  // POS de restaurante (RES-0): estaciones/KDS configurables, carta, mesas, comandas, cuenta. Los conectores
  // a folios/payments/accounting se enganchan en RES-5/RES-6. Ver openspec restaurante-pos.
  RestaurantModule(),
  // Inventario de insumos (INV-0): comida/bebida/bar/suministro, stock, costo promedio, ledger de
  // movimientos. Los conectores (recepción de compra suma stock, venta del POS resta) se enganchan luego.
  InventarioModule(),
  // Compras (COM-0): requisición → orden de compra → recepción → gasto. Conectores a inventario (suma
  // stock), treasury (valida proveedor) y gastos (genera el gasto que pega en caja/contabilidad).
  ComprasModule(),
  // ANTES que PaymentRequestsModule: ambos registran una ruta bajo /api/stripe/webhook/.
  // payment-requests usa el comodín /api/stripe/webhook/:hotelId (cobro a huéspedes);
  // subscriptions usa el literal /api/stripe/webhook/platform (el hotel pagándole a la
  // plataforma). El Router prueba las rutas en orden de registro y :hotelId matchea
  // CUALQUIER segmento — incluida la palabra "platform" — así que subscriptions tiene
  // que registrarse primero o su webhook nunca se alcanza.
  SubscriptionsModule(),
  // Programa de referidos B2B (PLAN-REFERIDOS.md). Crea referrals/referral_codes/referral_credits/
  // referral_tiers y los endpoints admin/* + /api/referrals/me + público /resolve. El connector
  // subscriptions-referrals vincula el alta cuando viene con referralCode; el cron
  // referral-credits-cron valida/libera los créditos Y aplica el descuento de bienvenida al
  // referido (1er mes gratis, referredRewardValue % off) persistido en Referrals.welcomeRewardStatus.
  ReferralsModule(),
  // Programa "Aliados" (GitLab #549, cluster #552-559): evolución de Referidos para hoteles
  // con >5 referidos validados — comisión en dinero (%) en vez de meses gratis. Ver
  // modules/aliados/model.ts. El paso 2 del cron de referidos (referral-credits-cron.ts)
  // chequea la tabla Partners antes de crear ReferralCredits.
  AliadosModule(),
  PaymentRequestsModule(), AdminModule(), ReportsModule(), PricingModule(),
  AmenitiesModule(), TtlockModule(), DashboardModule(), FeedbackModule(),
  StaffAuthModule(),
  MessagesModule({ storage }),
  PushTokensModule(),
  EmailQueueModule(),
  PublicapiModule(),
  WebhooksModule(),
  // Plantillas editables de los correos de PLATAFORMA (ciclo de vida SaaS: welcome, trial_*,
  // payment_*, subscription_canceled). Solo super_admin. Lo consumen subscriptions (webhook/signup)
  // y el cron de trial vía resolveModule('platform-emails').sendEvent().
  PlatformEmailsModule(),
  // F0 (solmi-direct-booking) — Media del hotel (hero/gallery/room) para landing pública.
  // Tasks 0.6 + 0.7: solo modelo + service + usecases. Rutas admin + pública van en task 0.8.
  // Reusa el StorageService global (mismo adapter S3/local que hotel-logos, dir 'hotel-media').
  HotelMediaModule({ storage }),
  // F1 (solmi-direct-booking) — Landing pública del hotel por bloques (hero/gallery/amenities/...).
  // Tasks 1.1–1.4: modelo + seeder lazy (9 defaults) + blocks-crud (upsert atómico + toggle) +
  // rutas admin (`/api/landing` GET/PUT + `/api/landing/:id/toggle` PATCH) + ruta pública
  // (`/api/public/hotels/:slug/landing` rate-limited). Permisos: `landing:view|edit`.
  LandingModule(),
  // CMS del sitio público del SaaS (solmios.com): páginas del footer editables desde /admin/sitio.
  // Scope plataforma (hotelId='platform'), CRUD solo super_admin, lectura pública rate-limited
  // de las published (`/api/public/site-pages[/:slug]`) — la consume el landing para renderizar.
  SitePagesModule(),
  // Solicitudes de eliminación de datos personales (Ley 172-13): formulario público al
  // final de /p/eliminacion-datos (sin auth, rate-limited) + gestión del flujo
  // received→verifying→completed/rejected desde /admin/eliminacion-datos (solo super_admin).
  DeletionRequestsModule(),
  // Leads del formulario de ventas: formulario público al final de la landing (sin auth,
  // rate-limited) + gestión del flujo new→contacted→won/lost desde /admin/leads-ventas
  // (solo super_admin).
  SalesLeadsModule(),
  // Digitalización de hoteles sin web (herramienta interna de ventas, solo super_admin):
  // detección de candidatos + expediente con los cinco pasos en `/api/digitalizacion`.
  DigitalizacionModule(),
  // F2 2.1–2.3 (solmi-direct-booking) — Códigos promocionales del widget de reservas.
  // Modelo promo_codes (UNIQUE (hotelId, code) creado en migrate-db.ts) + CRUD admin
  // (`/api/promo-codes` auth + permiso `promo:*`) + ruta pública de validación
  // (`POST /api/public/hotels/:slug/promo/validate` rate-limited 30/min/IP). Permisos `promo:*`
  // agregados a hotel_admin en shared/permissions.ts.
  PromoCodesModule(),
  // F3 3.1 (solmi-direct-booking) — Reseñas externas (Google/TripAdvisor/StayAPI). Modelo
  // external_reviews (UNIQUE (source, sourceExternalId) en migrate-db.ts) + CRUD admin
  // (`/api/external-reviews` auth + permiso `reports:*` + module guard `sales.reviews`).
  // F3 3.5 — recibe los fetchers para cablear el endpoint "Sync now" (POST /sync-now).
  ExternalReviewsModule({ fetchers: externalReviewsFetchers }),
  // F3 3.6 (solmi-direct-booking) — Wallet pass (Apple .pkpass + Google save URL). Reusa el
  // StorageService global (mismo adapter S3/local que hotel-media, dir 'wallet-passes').
  // TTLock + EmailService se inyectan post-init (setTtlockPort + setEmailDeps abajo) para
  // evitar orden-de-carga entre módulos. Permisos: settings:view + module guard settings.locks.
  WalletPassModule({ storage }),
  // F3 3.10–3.13 (solmi-direct-booking): server-side tracking (Meta CAPI + GA4 MP v2).
  // Modelo tracking_events + service.fireAll. Sin deps de construction: el connector
  // `bookingengine-tracking` (registrado abajo) subscribe al socket onBookingPaid.
  ServerTrackingModule(),
  // F3 3.14 (solmi-direct-booking): cron de recuperación de reservas abandonadas. Módulo
  // cron-only (sin tabla propia ni rutas HTTP). El cron factory abajo usa el service que
  // acá se construye. Se le inyecta el EmailService en el mismo factory (resuelto post-init).
  AbandonRecoveryModule(),
  // F1 plan #627 (políticas de cancelación) — Modelo cancellation_policies + funciones
  // puras de cálculo (shared/usecases/cancellation-math). Sin rutas HTTP en F1 (F3 las agrega).
  CancellationModule(),
]
for (const m of mods) system.addModule(m as any)

// ─── Conectores ────────────────────────────────────────────────────────────
import { reservasHousekeepingConnector } from './connectors/reservas-housekeeping'
import { reservasTtlockConnector } from './connectors/reservas-ttlock'
import { reportsTtlockConnector } from './connectors/reports-ttlock'
import { habitacionesCanalesConnector } from './connectors/habitaciones-canales'
import { habitacionesReservasConnector } from './connectors/habitaciones-reservas'
import { reservasCanalesConnector } from './connectors/reservas-canales'
import { mantenimientoNotificacionesConnector } from './connectors/mantenimiento-notificaciones'
import { mantenimientoHabitacionesConnector } from './connectors/mantenimiento-habitaciones'
import { bookingChannexConnector } from './connectors/booking-channex'
import { reservasHuespedesConnector } from './connectors/reservas-huespedes'
import { reservasOpinionesConnector } from './connectors/reservas-opiniones'
import { reservasMarketingConnector } from './connectors/reservas-marketing'
import { reservasDepositsConnector } from './connectors/reservas-deposits'
// F3 3.8 (solmi-direct-booking) — Wallet pass al confirmar: bookingengine emite onBookingPaid
// (mismo socket que ya cablea `bookingengine-payments`) → wallet-pass.generatePass orquesta
// TTLock + Apple/Google + email. Best-effort: si el pass falla, el webhook igual queda OK.
import { reservasWalletConnector } from './connectors/reservas-wallet'
// F3 3.12 (solmi-direct-booking) — Server-tracking fire al confirmar: bookingengine emite
// onBookingPaid → bookingengine-tracking.fireAll(reservationId) → Meta CAPI + GA4 MP.
// Best-effort + fire-and-forget: no bloquea el webhook. Skip silencioso si faltan creds.
import { bookingengineTrackingConnector } from './connectors/bookingengine-tracking'
import { pricingCanalesConnector } from './connectors/pricing-canales'
import { reclutamientoEmpleadosConnector } from './connectors/reclutamiento-empleados'
import { capacitacionEmpleadosConnector } from './connectors/capacitacion-empleados'
import { amenitiesHabitacionesConnector } from './connectors/amenities-habitaciones'
import { paymentsCajaConnector } from './connectors/payments-caja'
import { paymentsAccountingConnector } from './connectors/payments-accounting'
// COR-1 — todo movimiento de `payments` resincroniza `reservations.pendingAmount`: el listado y el
// detalle tienen que devolver el MISMO saldo. Ver connectors/payments-reservas.ts.
import { paymentsReservasConnector } from './connectors/payments-reservas'
import { foliosAccountingConnector } from './connectors/folios-accounting'
import { facturasAccountingConnector } from './connectors/facturas-accounting'
import { gastosAccountingConnector } from './connectors/gastos-accounting'
import { cashAccountingConnector } from './connectors/cash-accounting'
import { restauranteFoliosConnector } from './connectors/restaurante-folios'
import { restaurantePaymentsConnector } from './connectors/restaurante-payments'
import { restauranteAccountingConnector } from './connectors/restaurante-accounting'
import { restauranteInventarioConnector } from './connectors/restaurante-inventario'
import { comprasInventarioConnector } from './connectors/compras-inventario'
import { comprasTreasuryConnector } from './connectors/compras-treasury'
import { comprasGastosConnector } from './connectors/compras-gastos'
import { paymentRequestsPaymentsConnector } from './connectors/payment-requests-payments'
import { paymentRequestsTtlockConnector } from './connectors/payment-requests-ttlock'
import { facturasReservasConnector } from './connectors/facturas-reservas'
import { facturasAuditlogConnector } from './connectors/facturas-auditlog'
import { rolesAuditlogConnector } from './connectors/roles-auditlog'
import { paymentsAuditlogConnector } from './connectors/payments-auditlog'
import { usuariosAuditlogConnector } from './connectors/usuarios-auditlog'
import { adminAuditlogConnector } from './connectors/admin-auditlog'
import { apikeysAuditlogConnector } from './connectors/apikeys-auditlog'
import { hotelesAuditlogConnector } from './connectors/hoteles-auditlog'
import { dispositivosAuditlogConnector } from './connectors/dispositivos-auditlog'
import { empleadosAuditlogConnector } from './connectors/empleados-auditlog'
import { reembolsosAuditlogConnector } from './connectors/reembolsos-auditlog'
import { habitacionesAuditlogConnector } from './connectors/habitaciones-auditlog'
import { huespedesAuditlogConnector } from './connectors/huespedes-auditlog'
import { reservasAuditlogConnector } from './connectors/reservas-auditlog'
import { gastosAuditlogConnector } from './connectors/gastos-auditlog'
import { paquetesAuditlogConnector } from './connectors/paquetes-auditlog'
import { paquetesBookingengineConnector } from './connectors/paquetes-bookingengine'
import { canalesAuditlogConnector } from './connectors/canales-auditlog'
import { gruposAuditlogConnector } from './connectors/grupos-auditlog'
import { housekeepingAuditlogConnector } from './connectors/housekeeping-auditlog'
import { mantenimientoAuditlogConnector } from './connectors/mantenimiento-auditlog'
import { attendanceAuditlogConnector } from './connectors/attendance-auditlog'
import { activosAuditlogConnector } from './connectors/activos-auditlog'
import { anunciosAuditlogConnector } from './connectors/anuncios-auditlog'
import { capacitacionAuditlogConnector } from './connectors/capacitacion-auditlog'
import { crmAuditlogConnector } from './connectors/crm-auditlog'
import { crmPromocodesConnector } from './connectors/crm-promocodes'
import { feedbackAuditlogConnector } from './connectors/feedback-auditlog'
import { marketingAuditlogConnector } from './connectors/marketing-auditlog'
import { notificacionesAuditlogConnector } from './connectors/notificaciones-auditlog'
import { opinionesAuditlogConnector } from './connectors/opiniones-auditlog'
import { reclutamientoAuditlogConnector } from './connectors/reclutamiento-auditlog'
import { ticketsAuditlogConnector } from './connectors/tickets-auditlog'
import { aiRecepcionistaAuditlogConnector } from './connectors/ai-recepcionista-auditlog'
import { cashAuditlogConnector } from './connectors/cash-auditlog'
import { paymentRequestsAuditlogConnector } from './connectors/payment-requests-auditlog'
import { pricingAuditlogConnector } from './connectors/pricing-auditlog'
import { payrollAuditlogConnector } from './connectors/payroll-auditlog'
import { facturasPaymentsConnector } from './connectors/facturas-payments'
import { foliosFacturasConnector } from './connectors/folios-facturas'
import { foliosPaymentsConnector } from './connectors/folios-payments'
import { reservasFoliosSettlementConnector } from './connectors/reservas-folios-settlement'
// `reservas` leía `Folios`/`Invoices`/`Payment` con el ORM crudo para calcular "lo cobrado".
// Ahora la lectura la hacen los módulos dueños y llega por puerto. Ver connectors/reservas-money.ts.
import { reservasMoneyConnector } from './connectors/reservas-money'
// STR-A: `payment-requests` (techo del cobro + bridge del webhook) lee el MISMO camino
// reserva→dinero por los módulos dueños, no con repos crudos de `invoices`/`payments`.
import { paymentRequestsMoneyConnector } from './connectors/payment-requests-money'
import { paymentsCeilingConnector } from './connectors/payments-ceiling'
import { gastosCajaConnector } from './connectors/gastos-caja'
import { cajaChicaGastosConnector } from './connectors/caja-chica-gastos'
import { payrollGastosConnector } from './connectors/payroll-gastos'
import { reembolsosGastosConnector } from './connectors/reembolsos-gastos'
import { reservasRescheduleChargeConnector } from './connectors/reservas-reschedule-charge'
import { reservasPromocodesConnector } from './connectors/reservas-promocodes'
import { attendanceDashboardConnector } from './connectors/attendance-dashboard'
import { attendancePayrollConnector } from './connectors/attendance-payroll'
import { bookingenginePaymentsConnector } from './connectors/bookingengine-payments'
import { bookingengineDepositsConnector } from './connectors/bookingengine-deposits'
import { bookingenginePromocodesConnector } from './connectors/bookingengine-promocodes'
import { bookingengineTtlockConnector } from './connectors/bookingengine-ttlock'
import { messagesUsuariosConnector } from './connectors/messages-usuarios'
import { messagesPushtokensConnector } from './connectors/messages-pushtokens'
import { pushtokensUsuariosConnector } from './connectors/pushtokens-usuarios'
import { housekeepingMantenimientoConnector } from './connectors/housekeeping-mantenimiento'
import { housekeepingNotificacionesConnector } from './connectors/housekeeping-notificaciones'
import { housekeepingHabitacionesConnector } from './connectors/housekeeping-habitaciones'
import { empleadosHousekeepingConnector } from './connectors/empleados-housekeeping'
import { empleadosAttendanceConnector } from './connectors/empleados-attendance'
import { empleadosMantenimientoConnector } from './connectors/empleados-mantenimiento'
import { empleadosCapacitacionConnector } from './connectors/empleados-capacitacion'
import { usuariosSubscriptionsConnector } from './connectors/usuarios-subscriptions'
import { canalesSubscriptionsConnector } from './connectors/canales-subscriptions'
import { canalesReservasConnector } from './connectors/canales-reservas'
import { aiRecepcionistaReservasConnector } from './connectors/ai-recepcionista-reservas'
import { aiGerenteReservasConnector } from './connectors/ai-gerente-reservas'
import { aliadosFeedbackConnector } from './connectors/aliados-feedback'
import { publicapiReservasConnector } from './connectors/publicapi-reservas'
import { reservasWebhooksConnector } from './connectors/reservas-webhooks'
import { paymentsWebhooksConnector } from './connectors/payments-webhooks'
import { subscriptionsReferralsConnector } from './connectors/subscriptions-referrals'
import { subscriptionsAdminPolicyConnector } from './connectors/subscriptions-admin-policy'
import { subscriptionsUsuariosOwnerConnector } from './connectors/subscriptions-usuarios-owner'
import { paymentRequestsBookingengineWebhookConnector } from './connectors/payment-requests-bookingengine-webhook'
// F3 3.2 (solmi-direct-booking) — Adaptadores HTTP externos de reviews. NO son conectores
// inter-módulo (los que wirean sockets): son clientes de APIs externas. Imports y factory
// `externalReviewsFetchers` viven arriba (cerca de ExternalReviewsModule) para que el módulo
// (ruta admin /sync-now) y el cron compartan la misma config de clients HTTP. La regla
// UNREGISTERED_CONNECTOR del analyzer los ve igual (están importados en composition-root).
import { createExternalReviewsCron } from './shared/usecases/external-reviews-cron'

system.addConnector('reservas-housekeeping', reservasHousekeepingConnector)
system.addConnector('reservas-ttlock', reservasTtlockConnector)
// El no-show lo marca `reports` (endpoint + cron), no `reservas`: sin este connector el PIN
// del que no se presentó seguía vivo sobre una habitación ya liberada para revender.
system.addConnector('reports-ttlock', reportsTtlockConnector)
system.addConnector('habitaciones-canales', habitacionesCanalesConnector)
// #648 — disponibilidad por rango de fechas en GET /api/habitaciones?checkIn&checkOut, mismo
// criterio de solapamiento que reservas/usecases/availability.ts (shared/usecases/room-overlap.ts).
system.addConnector('habitaciones-reservas', habitacionesReservasConnector)
system.addConnector('reservas-canales', reservasCanalesConnector)
system.addConnector('mantenimiento-notificaciones', mantenimientoNotificacionesConnector)
system.addConnector('mantenimiento-habitaciones', mantenimientoHabitacionesConnector)
system.addConnector('booking-channex', bookingChannexConnector)
system.addConnector('reservas-huespedes', reservasHuespedesConnector(logger))
// Invitación a opinar post-checkout: reservas emite onReservationCheckedOut → opiniones crea
// review 'pending'. Cierra el gap "opiniones sin disparador post-checkout". Seguro: reservas
// compone sockets, no pisa a reservas-huespedes (CRM). Best-effort.
system.addConnector('reservas-opiniones', reservasOpinionesConnector)
// DT-18: on_reservation (reserva confirmada) + post_checkout, en tiempo real — antes de este
// connector NINGÚN código disparaba estos 2 de los 5 triggerEvent del enum de auto-messages.
system.addConnector('reservas-marketing', reservasMarketingConnector)
// Libera el depósito/garantía en el checkout: reservas emite onReservationCheckedOut → payments
// libera los holds 'held' de la reserva. Cierra el bug CONFIRMADO "el hold queda colgando" (el
// checkout no tocaba deposits). Best-effort, no pisa a reservas-opiniones (sockets se componen).
system.addConnector('reservas-deposits', reservasDepositsConnector)
// F3 3.8 (solmi-direct-booking) — Wallet pass al confirmar la reserva. bookingengine emite
// onBookingPaid ({ id: reservationId }) tras webhook Stripe → wallet-pass.generatePass.
// Idempotente por UNIQUE(reservationId) en `wallet_passes`. Best-effort, no bloquea el webhook.
system.addConnector('reservas-wallet', reservasWalletConnector)
// F3 3.12 (solmi-direct-booking) — Server-tracking fire al confirmar. Mismo socket que
// reservas-wallet (onBookingPaid) — setSockets compone, no pisa. Fire-and-forget async.
system.addConnector('bookingengine-tracking', bookingengineTrackingConnector)
// Auto-push de tarifas a OTAs: pricing emite onRatesUpdated al cambiar tarifas → canales las empuja
// a Channex. Cierra el gap "push manual": editar tarifas ya no requiere apretar el botón. Fire-and-forget.
system.addConnector('pricing-canales', pricingCanalesConnector)
// Postulante contratado → expediente de empleado, solo si ya existe la cuenta de usuario (match por
// email en el hotel). No fabrica credenciales. Cierra el ciclo reclutamiento→empleados.
system.addConnector('reclutamiento-empleados', reclutamientoEmpleadosConnector(orm))
// Curso completado → documento en el expediente del empleado (sin scoring). Cierra capacitacion→empleados.
system.addConnector('capacitacion-empleados', capacitacionEmpleadosConnector)
// Elimina la dualidad de amenities: al reasignar RoomAmenities (fuente de verdad) se sincroniza el
// CSV vestigial Rooms.amenities que leen ai-recepcionista y bookingengine/availability. No destructivo.
system.addConnector('amenities-habitaciones', amenitiesHabitacionesConnector(orm))
system.addConnector('payments-caja', paymentsCajaConnector)
system.addConnector('payments-reservas', paymentsReservasConnector)
// Un gasto en efectivo saca plata del cajón: sin esto el arqueo del turno no lo ve.
system.addConnector('gastos-caja', gastosCajaConnector)
// Un gasto con pettyCashFundId descuenta el saldo del fondo fijo (caja chica). Best-effort e
// idempotente (dedup por expenseId). El gasto sigue viviendo en `expenses` (AP + contabilidad).
system.addConnector('caja-chica-gastos', cajaChicaGastosConnector)
// Contabilidad automática (CTB-4): cada cobro/reembolso/depósito, cargo de folio (ingreso) y gasto
// genera su asiento de doble entrada. Self-gating (no-op si el hotel no tiene plan de cuentas seedeado).
system.addConnector('payments-accounting', paymentsAccountingConnector)
system.addConnector('folios-accounting', foliosAccountingConnector)
// Factura standalone (sin folio) devenga su propio ingreso al crearse; se auto-excluye si nace
// de un folio (folioId seteado), ya devengado por folios-accounting (CTB-4.2 / DT-12, #641).
system.addConnector('facturas-accounting', facturasAccountingConnector)
system.addConnector('gastos-accounting', gastosAccountingConnector)
system.addConnector('cash-accounting', cashAccountingConnector)
// POS de restaurante: cargo a habitación (folios) y cobro directo (payments). RES-5.
system.addConnector('restaurante-folios', restauranteFoliosConnector)
system.addConnector('restaurante-payments', restaurantePaymentsConnector)
// Venta directa del POS → asiento "Ventas Restaurante" (RES-6). El cargo a folio lo asienta folios-accounting.
system.addConnector('restaurante-accounting', restauranteAccountingConnector)
// Compras (COM-3/4): recepción suma stock (inventario), la OC valida proveedor (treasury), y al facturar
// genera un gasto (gastos) que ya pega en caja + contabilidad por los conectores existentes.
// Venta del POS → descuenta stock de insumos según la receta de cada ítem (INT-1). Best-effort.
system.addConnector('restaurante-inventario', restauranteInventarioConnector)
system.addConnector('compras-inventario', comprasInventarioConnector)
system.addConnector('compras-treasury', comprasTreasuryConnector)
system.addConnector('compras-gastos', comprasGastosConnector)
// Pagar la nómina es un gasto. Cae en `gastos` y de ahí, si fue en efectivo, en la caja.
// Se registra después de gastos-caja para que el egreso encuentre el socket ya inyectado.
system.addConnector('payroll-gastos', payrollGastosConnector)
// Un reembolso pagado es un gasto del hotel; en efectivo cae en la caja (vía gastos-caja).
system.addConnector('reembolsos-gastos', reembolsosGastosConnector)
// Mover/extender una reserva desde el planning cobra la diferencia: folio, efectivo (→caja) o tarjeta (Stripe).
system.addConnector('reservas-reschedule-charge', reservasRescheduleChargeConnector)
// FIX 2026-07-31 — el código promocional del wizard de reserva manual (staff) se guardaba
// como texto sin validar/aplicar descuento. Ver connectors/reservas-promocodes.ts.
system.addConnector('reservas-promocodes', reservasPromocodesConnector)
// PC-5 (2026-08-19) — cancelar desde el widget público también devuelve el uso del código.
system.addConnector('bookingengine-promocodes', bookingenginePromocodesConnector)
// C-1 (2026-08-19) — cancelar desde el widget público también expira los códigos TTLock.
system.addConnector('bookingengine-ttlock', bookingengineTtlockConnector(logger))
// Cablea el prefill de nómina: payroll lee horas de attendance y salarios de empleados.
system.addConnector('attendance-payroll', attendancePayrollConnector)
// El dashboard de RRHH muestra el fichaje real de hoy (presentes/ausentes/tarde) — #198.
system.addConnector('attendance-dashboard', attendanceDashboardConnector)
system.addConnector('facturas-reservas', facturasReservasConnector)
system.addConnector('facturas-auditlog', facturasAuditlogConnector)
system.addConnector('roles-auditlog', rolesAuditlogConnector)
system.addConnector('payments-auditlog', paymentsAuditlogConnector)
system.addConnector('usuarios-auditlog', usuariosAuditlogConnector)
system.addConnector('admin-auditlog', adminAuditlogConnector)
// SC-05 (plata): efectivo del cajón, solicitudes de pago, tarifario y nómina.
system.addConnector('cash-auditlog', cashAuditlogConnector)
system.addConnector('payment-requests-auditlog', paymentRequestsAuditlogConnector)
system.addConnector('pricing-auditlog', pricingAuditlogConnector)
system.addConnector('payroll-auditlog', payrollAuditlogConnector)
// SC-05: borrados sensibles — credenciales, tenant entero, sesiones, RRHH y plata.
system.addConnector('apikeys-auditlog', apikeysAuditlogConnector)
system.addConnector('hoteles-auditlog', hotelesAuditlogConnector)
system.addConnector('dispositivos-auditlog', dispositivosAuditlogConnector)
system.addConnector('empleados-auditlog', empleadosAuditlogConnector)
system.addConnector('reembolsos-auditlog', reembolsosAuditlogConnector)
// SC-05: borrar una habitación, un huésped, una reserva, un gasto o un paquete deja rastro.
system.addConnector('habitaciones-auditlog', habitacionesAuditlogConnector)
system.addConnector('huespedes-auditlog', huespedesAuditlogConnector)
system.addConnector('reservas-auditlog', reservasAuditlogConnector)
system.addConnector('gastos-auditlog', gastosAuditlogConnector)
system.addConnector('paquetes-auditlog', paquetesAuditlogConnector)
// FIX 2026-07-31 — "Ofertas" (paquetes, type='servicio') no alimentaba el step de Extras
// del widget público (tabla Upsells, catálogo separado). Ver connectors/paquetes-bookingengine.ts.
system.addConnector('paquetes-bookingengine', paquetesBookingengineConnector)
// SC-05: borrados que rompen operación. Un canal borrado corta la distribución a las OTAs (el hotel
// se sigue vendiendo con inventario viejo → overbooking) y un fichaje/turno borrado cambia la nómina.
system.addConnector('canales-auditlog', canalesAuditlogConnector)
system.addConnector('grupos-auditlog', gruposAuditlogConnector)
system.addConnector('housekeeping-auditlog', housekeepingAuditlogConnector)
system.addConnector('mantenimiento-auditlog', mantenimientoAuditlogConnector)
system.addConnector('attendance-auditlog', attendanceAuditlogConnector)
// SC-05: borrados de contenido y RRHH. No mueven plata, pero borran evidencia (opiniones, tickets,
// pins de feedback), cortan comunicación (anuncios, notificaciones, auto-mensajes, intents de la IA)
// o tiran historial de personas (postulantes, cursos, activos asignados) — todo con actor y detalle.
system.addConnector('activos-auditlog', activosAuditlogConnector)
system.addConnector('anuncios-auditlog', anunciosAuditlogConnector)
system.addConnector('capacitacion-auditlog', capacitacionAuditlogConnector)
system.addConnector('crm-auditlog', crmAuditlogConnector)
system.addConnector('crm-promocodes', crmPromocodesConnector)
system.addConnector('feedback-auditlog', feedbackAuditlogConnector)
system.addConnector('marketing-auditlog', marketingAuditlogConnector)
system.addConnector('notificaciones-auditlog', notificacionesAuditlogConnector)
system.addConnector('opiniones-auditlog', opinionesAuditlogConnector)
system.addConnector('reclutamiento-auditlog', reclutamientoAuditlogConnector)
system.addConnector('tickets-auditlog', ticketsAuditlogConnector)
system.addConnector('ai-recepcionista-auditlog', aiRecepcionistaAuditlogConnector)
// El dinero se asienta en `payments` → payments-caja lo lleva al arqueo y a la conciliación.
system.addConnector('facturas-payments', facturasPaymentsConnector)
system.addConnector('folios-payments', foliosPaymentsConnector)
// Un cobro Stripe también es dinero: sin esto queda fuera de `payments` y de la conciliación.
system.addConnector('payment-requests-payments', paymentRequestsPaymentsConnector)
system.addConnector('payment-requests-ttlock', paymentRequestsTtlockConnector(logger))
// El widget público cobra con Stripe: ese dinero vivía solo en la tabla `bookings`.
system.addConnector('bookingengine-payments', bookingenginePaymentsConnector)
// El correo de confirmación de PAGO del motor NO va acá: necesita el EmailService, que se
// construye recién en `bootstrapEmail()` DESPUÉS de `system.start()`. Referenciarlo desde un
// connector daba ReferenceError por TDZ al arrancar. Se suscribe en `email-bootstrap.ts`,
// junto al resto de las inyecciones de correo.
// F5 #627 — Cuando el huésped auto-cancela desde la página pública, marca/libera depósitos held.
system.addConnector('bookingengine-deposits', bookingengineDepositsConnector)
system.addConnector('reservas-payment-requests', reservasPaymentRequestsConnector(orm))
// folios-facturas debe registrarse antes que reservas-folios-settlement:
// el settlement del checkout usa folios.closeAndCreateInvoice(), que necesita el puerto inyectado.
system.addConnector('folios-facturas', foliosFacturasConnector)
system.addConnector('reservas-folios-settlement', reservasFoliosSettlementConnector)
// El camino reserva → dinero (folios + facturas + payments) lo sirven los módulos dueños.
// Va después de que los tres estén registrados; sin este connector `reservas` falla fuerte al
// calcular el saldo en vez de devolver 0 (GH-0.2: un 0 en silencio autoriza recobrar plata).
system.addConnector('reservas-money', reservasMoneyConnector)
// Idem para el techo del cobro: sin este connector, create/update/createCheckout fallan fuerte
// en vez de medir contra `reservations.deposit` (GH-0.2: un 0 en silencio autoriza recobrar).
system.addConnector('payment-requests-money', paymentRequestsMoneyConnector)
// RTC-8.1: la vía charge-card valida contra el techo de `payment-requests` antes de abrir sesión.
system.addConnector('payments-ceiling', paymentsCeilingConnector)
// El chat resuelve nombres de compañeros sin pasar por `users:view`.
system.addConnector('messages-usuarios', messagesUsuariosConnector)
// Un mensaje nuevo le llega al teléfono aunque la app esté cerrada.
system.addConnector('messages-pushtokens', messagesPushtokensConnector)
// El aviso dice el nombre de quien escribió, no su id.
system.addConnector('pushtokens-usuarios', pushtokensUsuariosConnector)
// Lo que la camarera reporta como roto se convierte en un ticket con fotos.
system.addConnector('housekeeping-mantenimiento', housekeepingMantenimientoConnector)
// Asignar una habitación le avisa a la persona asignada.
system.addConnector('housekeeping-notificaciones', housekeepingNotificacionesConnector)
// Aprobar la limpieza devuelve la habitación a 'available' (#392): sin esto quedaba trabada en
// 'cleaning' desde el checkout.
system.addConnector('housekeeping-habitaciones', housekeepingHabitacionesConnector)
// El motor de evaluación de desempeño (#321) lee productividad/calidad de housekeeping y
// puntualidad/asistencia de attendance — datos reales, sin importar esos módulos.
system.addConnector('empleados-housekeeping', empleadosHousekeepingConnector)
system.addConnector('empleados-attendance', empleadosAttendanceConnector)
// Productividad de mantenimiento → motor de evaluación #321: el técnico se puntúa por tickets resueltos
// (criterio maintenance). Cierra el gap "Mantenimiento fuera del scoring".
system.addConnector('empleados-mantenimiento', empleadosMantenimientoConnector)
// DT-19: cursos completados → motor de evaluación #321 (criterio training). Antes un curso
// completado solo dejaba un documento en el expediente (capacitacion-empleados), no pesaba en el score.
system.addConnector('empleados-capacitacion', empleadosCapacitacionConnector)
// El login pregunta si el hotel puede operar (prueba vigente / suscripción al día).
system.addConnector('usuarios-subscriptions', usuariosSubscriptionsConnector)
// El cron de ingesta OTA (booking-sync) no debe crear reservas nuevas para un hotel suspendido (#542).
system.addConnector('canales-subscriptions', canalesSubscriptionsConnector)
// Cancelación REAL para los flujos sin usuario logueado (OTA vía Channex y los dos bots de IA):
// los tres cancelaban con un update directo a `status:'cancelled'`, salteando la política, el
// snapshot financiero y el evento `onReservationCancelled` — único disparador del release del
// depósito retenido (reservas-deposits). Ahora delegan en `reservas.cancelBySystem()`.
system.addConnector('canales-reservas', canalesReservasConnector)
system.addConnector('ai-recepcionista-reservas', aiRecepcionistaReservasConnector)
system.addConnector('ai-gerente-reservas', aiGerenteReservasConnector)
// "Escalar a SOLMI OS" de un Aliado Certificado reusa el pipeline de feedback pins (#559).
system.addConnector('aliados-feedback', aliadosFeedbackConnector)
// La API pública v1 (auth por API key) delega en habitaciones/reservas/huespedes — publicapi no
// tiene tabla propia ni importa esos módulos directo.
system.addConnector('publicapi-reservas', publicapiReservasConnector)
// Webhooks salientes: reservas/payments emiten sus sockets → webhooks.dispatch() los entrega a
// las subscriptions activas del hotel (best-effort, no puede tumbar el flujo que los dispara).
system.addConnector('reservas-webhooks', reservasWebhooksConnector)
system.addConnector('payments-webhooks', paymentsWebhooksConnector)
// Programa de referidos: subscriptions emite onTrialStarted con el referralCode del alta pública →
// referrals.linkSignup() vincula al referido con el referidor. Best-effort (un fallo nunca volta el alta).
system.addConnector('subscriptions-referrals', subscriptionsReferralsConnector)
// #28 — la política de alta (¿tarjeta antes de la prueba?) la fija el super-admin, no el código.
system.addConnector('subscriptions-admin-policy', subscriptionsAdminPolicyConnector)
// #28 — quien abandonó el Checkout del alta no puede loguearse: prueba quién es con su clave.
system.addConnector('subscriptions-usuarios-owner', subscriptionsUsuariosOwnerConnector)
// Una sola URL de webhook para el hotel: cada handler reenvía al otro el evento que no es suyo.
// Sin esto, todo cobro del motor de reservas moría en el handler de los links de pago (200 mudo).
system.addConnector('payment-requests-bookingengine-webhook', paymentRequestsBookingengineWebhookConnector)

// ─── Infraestructura transversal ────────────────────────────────────────────
configureStripe(orm, logger)

// ─── Schema sync (modo migrate-only) ────────────────────────────────────────
// RUN_MIGRATE=1: crea tablas faltantes desde los modelos registrados (para módulos
// sin migración como folios, amenities, companions, locks, plans, rates, etc.).
// Idempotente (CREATE TABLE IF NOT EXISTS). Usa system.init() (que registra modelos
// vía orm.define en cada módulo) en vez de system.start() — init() no bindea el
// puerto HTTP (PORT), así no choca con el servicio que ya corre. start() sí lo bindea.
if (process.env.RUN_MIGRATE === '1') {
  system.init()
  await orm.migrate()
  logger.info('orm.migrate() completado: tablas sincronizadas desde modelos')
  await system.stop()
  process.exit(0)
}

// ─── Start ─────────────────────────────────────────────────────────────────
await system.start()

const { emailService, startWorker } = bootstrapEmail(orm, logger, (name) => system.resolveModule(name))

// Post-init: ai-recepcionista usa pushAvailability (reservas IA bypassan el módulo reservas).
const aiRecepcionista = system.resolveModule<{ channexPusher: ((hotelId: string, roomId: string) => void) | null }>('ai-recepcionista')
if (aiRecepcionista) aiRecepcionista.channexPusher = pushAvailability

// F3 3.6/3.7 post-init — Wallet pass: el módulo necesita el puerto TTLock para generar el
// lockCode de reservas que no tienen uno previo. Se inyecta acá (post system.start) porque
// ttlock se registra en `mods[]` y solo está disponible tras resolver el container.
// Best-effort: si ttlock no está registrado (módulo desactivado), el puerto queda null — el
// usecase solo reusa lockCodes existentes, no genera nuevos.
const ttlockForWallet = system.resolveModule<{ generateCode(hotelId: string, reservationId: string): Promise<{ code?: string | null } | null> }>('ttlock')
const walletPass = system.resolveModule<{ setTtlockPort(t: any): void }>('wallet-pass')
if (walletPass && ttlockForWallet) walletPass.setTtlockPort(ttlockForWallet)

// Campañas del CRM: el envío va por la MISMA cola persistente del resto del sistema
// (patrón wallet-pass/abandon-recovery — EmailService inyectado post-init).
const crmForEmail = system.resolveModule<{ setEmailDeps(es: unknown): void }>('crm')
if (crmForEmail) crmForEmail.setEmailDeps(emailService)

// Post-init: los avisos al teléfono. Sin credenciales de Firebase `fromEnv`
// devuelve null y el módulo se queda solo guardando tokens: la app sigue
// avisando mientras está abierta, que es lo que hacía antes de todo esto.
const fcm = FcmClient.fromEnv(logger)
if (fcm) {
  const pushTokens = system.resolveModule<{ setSender: (s: FcmClient) => void }>('pushtokens')
  pushTokens?.setSender(fcm)
}

startWorker()

// ─── Cron jobs ──────────────────────────────────────────────────────────────
const ONE_DAY_MS = 24 * 60 * 60 * 1000
// El 4º argumento expira el PIN de la puerta al marcar no-show: sin esto, quien no se
// presentó conservaba acceso a una habitación que ya se liberó y se puede revender.
// `reservas-ttlock` cubre checkout y cancelación; el no-show lo marca este cron.
const noShowCron = createNoShowCron(orm, emailService, logger, async (reservationId: string) => {
  const ttlock = system.resolveModule<{ expireCodesByReservation(id: string): Promise<void> }>('ttlock')
  if (ttlock?.expireCodesByReservation) await ttlock.expireCodesByReservation(reservationId)
})
// FIX G1 (fix-noshow-cron-init): corrida inicial a los 10s de arrancar (igual que night-audit). Antes
// solo setInterval(24h): si el backend restarteaba antes de 24h (deploy/crash/OOM) el contador se
// reiniciaba y el cron podía no llegar a ejecutarse nunca → reservas confirmed vencidas quedaban
// colgadas bloqueando disponibilidad (overbooking). El cron es idempotente (solo marca pending/confirmed).
setTimeout(() => { noShowCron().catch((e) => logger.warn('markNoShows initial run failed', { error: (e as Error).message })) }, 10_000)
setInterval(() => { noShowCron().catch((e) => logger.warn('markNoShows failed', { error: (e as Error).message })) }, ONE_DAY_MS)
logger.info('No-show cron listo (con corrida inicial a los 10s)', { tickMs: ONE_DAY_MS })

const AUTO_MESSAGES_TICK_MS = 60_000 * 60
const autoMsgTrigger = system.resolveModule<{ triggerAutoMessages: (params: any) => Promise<void> }>('marketing')
if (autoMsgTrigger) {
  const autoMsgCron = createAutoMessagesCron(orm, autoMsgTrigger)
  setInterval(() => { autoMsgCron().catch((e) => logger.warn('auto-messages cron failed', { error: (e as Error).message })) }, AUTO_MESSAGES_TICK_MS)
  logger.info('Auto-messages cron listo', { tickMs: AUTO_MESSAGES_TICK_MS })
}

// Retención de evidencias multimedia (#326): borra fotos/video de limpieza pasados los N días
// configurados por hotel (default 35), avisando antes al admin. Solo el archivo — la tarea queda.
const evidenceSettings = new HousekeepingSettingsUseCase(new OrmRepository(orm, 'Configuration'))
const evidenceRetentionCron = createEvidenceRetentionCron(
  orm,
  (name) => system.resolveModule(name),
  s3Adapter,
  (hotelId) => evidenceSettings.get(hotelId).then((s) => s.evidenceRetentionDays),
  logger,
)
setInterval(() => {
  evidenceRetentionCron().catch((e) => logger.warn('evidence-retention cron failed', { error: (e as Error).message }))
}, ONE_DAY_MS)

const NIGHT_AUDIT_TICK_MS = 60_000 * 60 * 3 // cada 3h (postea si hay nuevas reservas in-house)
const nightAuditCron = createNightAuditCron(orm, (name) => system.resolveModule(name), logger)
setTimeout(() => {
  nightAuditCron().catch((e) => logger.warn('night-audit initial run failed', { error: (e as Error).message }))
}, 10_000) // primer corrida a los 10s de iniciar
setInterval(() => {
  nightAuditCron().catch((e) => logger.warn('night-audit cron failed', { error: (e as Error).message }))
}, NIGHT_AUDIT_TICK_MS)
logger.info('Night-audit cron listo', { tickMs: NIGHT_AUDIT_TICK_MS })

// Booking-sync cron (issue #564): ingesta el feed GLOBAL de bookings OTA de Channex y deriva
// cada revisión a su hotel por propertyId. Intervalo configurable por BOOKING_SYNC_INTERVAL_MS.
const BOOKING_SYNC_TICK_MS = Number(process.env.BOOKING_SYNC_INTERVAL_MS) || DEFAULT_BOOKING_SYNC_TICK_MS
const bookingSyncCron = createBookingSyncCron(orm, (name) => system.resolveModule(name), logger)
setTimeout(() => {
  bookingSyncCron().catch((e) => logger.warn('booking-sync initial run failed', { error: (e as Error).message }))
}, 10_000)
setInterval(() => {
  bookingSyncCron().catch((e) => logger.warn('booking-sync cron failed', { error: (e as Error).message }))
}, BOOKING_SYNC_TICK_MS)
logger.info('Booking-sync cron listo', { tickMs: BOOKING_SYNC_TICK_MS })

// Pase + código de acceso 24 h antes de la llegada (pedido del cliente 2026-08-29). El pase y
// el PIN se crean al pagar, pero el correo con la HABITACIÓN y el código sale recién ahora: la
// habitación puede reasignarse hasta la víspera. Al pagar va la confirmación de pago
// (`booking-paid-email.ts`), sin habitación ni código. Dedup con `wallet_passes.emailSentAt`.
const PREARRIVAL_TICK_MS = 60_000 * 60 // cada hora: la ventana es de 24 h, no hace falta más fino
const prearrivalPassCron = createPrearrivalPassCron(orm, (name) => system.resolveModule(name), logger)
setTimeout(() => {
  prearrivalPassCron().catch((e) => logger.warn('prearrival-pass initial run failed', { error: (e as Error).message }))
}, 10_000)
setInterval(() => {
  prearrivalPassCron().catch((e) => logger.warn('prearrival-pass cron failed', { error: (e as Error).message }))
}, PREARRIVAL_TICK_MS)
logger.info('Prearrival-pass cron listo', { tickMs: PREARRIVAL_TICK_MS })

// Crones del ciclo SaaS (PLAN-SUSCRIPCIONES.md). Mismo molde que night-audit: factory, corrida
// inicial a los 10s (anti-restart), setInterval con catch que no tira. Los tres son idempotentes
// (dedup por marcas tipo trialReminderSentAt / status en referrals) → re-correrlos no duplica.
const SAAS_TICK_MS = 60_000 * 60 * 6 // cada 6h
// Aviso de trial por vencer/vencido: manda el correo (vía platform-emails) a las suscripciones
// `trialing` a <=2 días del fin o ya vencidas. Dedup con trialReminderSentAt/trialExpiredEmailSentAt.
const trialReminderCron = createTrialReminderCron(orm, (name) => system.resolveModule(name), logger)
setTimeout(() => {
  trialReminderCron().catch((e) => logger.warn('trial-reminder initial run failed', { error: (e as Error).message }))
}, 10_000)
setInterval(() => {
  trialReminderCron().catch((e) => logger.warn('trial-reminder cron failed', { error: (e as Error).message }))
}, SAAS_TICK_MS)
logger.info('Trial-reminder cron listo', { tickMs: SAAS_TICK_MS })

// Recordatorio → gracia → suspensión para suscripciones active/past_due (el hermano post-trial del
// anterior). Reactivación NO vive acá: es efecto del pago real (handle-stripe-event invoice.paid).
const subscriptionSuspensionCron = createSubscriptionSuspensionCron(orm, (name) => system.resolveModule(name), logger)
setTimeout(() => {
  subscriptionSuspensionCron().catch((e) => logger.warn('subscription-suspension initial run failed', { error: (e as Error).message }))
}, 10_000)
setInterval(() => {
  subscriptionSuspensionCron().catch((e) => logger.warn('subscription-suspension cron failed', { error: (e as Error).message }))
}, SAAS_TICK_MS)
logger.info('Subscription-suspension cron listo', { tickMs: SAAS_TICK_MS })

// Créditos del programa de referidos (PLAN-REFERIDOS.md §5): trial→active al empezar a pagar,
// active→validated al cumplir los meses (genera crédito al referidor), clawback si churnea pronto.
const referralCreditsCron = createReferralCreditsCron(orm, (name) => system.resolveModule(name), logger)
setTimeout(() => {
  referralCreditsCron().catch((e) => logger.warn('referral-credits initial run failed', { error: (e as Error).message }))
}, 10_000)
setInterval(() => {
  referralCreditsCron().catch((e) => logger.warn('referral-credits cron failed', { error: (e as Error).message }))
}, SAAS_TICK_MS)
logger.info('Referral-credits cron listo', { tickMs: SAAS_TICK_MS })

// F2 2.7 (D10 multi-moneda) — Cron daily de tasas de cambio: fetcha openexchangerates free tier
// y guarda en configuration('currency_rates', hotelId='platform'). El endpoint público
// /api/public/hotels/:slug/rates las consume para conversión display-only. Si
// OPENEXCHANGERATES_APP_ID no está, skip silencioso (no rompe nada, solo no actualiza).
const currencyRatesCron = createCurrencyRatesCron(orm, logger)
setTimeout(() => {
  currencyRatesCron().catch((e) => logger.warn('currency-rates initial run failed', { error: (e as Error).message }))
}, 10_000)
setInterval(() => {
  currencyRatesCron().catch((e) => logger.warn('currency-rates cron failed', { error: (e as Error).message }))
}, CURRENCY_RATES_TICK_MS)
logger.info('Currency-rates cron listo', { tickMs: CURRENCY_RATES_TICK_MS })

// F3 3.3 (solmi-direct-booking) — Cron nightly del agregador de reseñas externas. Para cada
// hotel con creds configuradas (gbp_place_id / tripadvisor_location_id / stayapi_hotel_ids),
// pull las 3 fuentes en paralelo, dedupea por (source, sourceExternalId), upsert batch en
// external_reviews, e invalida el cache del aggregate de opiniones. Idempotente (correr 2× no
// duplica); si una fuente cae, procesa las demás. Mismo molde que currency-rates (factory +
// corrida inicial 10s + setInterval 24h + skip silencioso si no hay creds).
const EXTERNAL_REVIEWS_TICK_MS = ONE_DAY_MS
// (Fetchers declarados arriba, junto con ExternalReviewsModule — compartidos con /sync-now.)
const externalReviewsCron = createExternalReviewsCron(
  orm, (name) => system.resolveModule(name), logger, externalReviewsFetchers, cache,
)
setTimeout(() => {
  externalReviewsCron().catch((e) => logger.warn('external-reviews initial run failed', { error: (e as Error).message }))
}, 10_000)
setInterval(() => {
  externalReviewsCron().catch((e) => logger.warn('external-reviews cron failed', { error: (e as Error).message }))
}, EXTERNAL_REVIEWS_TICK_MS)
logger.info('External-reviews cron listo', { tickMs: EXTERNAL_REVIEWS_TICK_MS })

// F3 3.14 (solmi-direct-booking) — Cron de recuperación de reservas abandonadas. Cada 30 min
// busca reservas `pending` con createdAt entre 1h y 4h atrás y `abandonEmailSent=false`, les
// manda un email con link al widget que restaura el state (`?reservation=:id&token=:accessToken`),
// y marca el flag. Idempotente por diseño (el flag evita re-envíos); reservas confirmadas o
// sin accessToken (creadas desde panel) se skipan. Mismo molde que currency-rates/external-reviews:
// factory + corrida inicial 10s (anti-restart) + setInterval con catch que no rompe el arranque.
const abandonRecoveryService = system.resolveModule<{ runSweep(): Promise<unknown> }>('abandon-recovery')
if (abandonRecoveryService && typeof abandonRecoveryService.runSweep === 'function') {
  const abandonRecoveryCron = createAbandonRecoveryCron(
    abandonRecoveryService as any, logger,
  )
  setTimeout(() => {
    abandonRecoveryCron().catch((e) => logger.warn('abandon-recovery initial run failed', { error: (e as Error).message }))
  }, 10_000)
  setInterval(() => {
    abandonRecoveryCron().catch((e) => logger.warn('abandon-recovery cron failed', { error: (e as Error).message }))
  }, ABANDON_RECOVERY_TICK_MS)
  logger.info('Abandon-recovery cron listo', { tickMs: ABANDON_RECOVERY_TICK_MS })
} else {
  logger.warn('Abandon-recovery: módulo no disponible — cron desactivado')
}

// ─── Shutdown ──────────────────────────────────────────────────────────────
process.on('SIGINT', async () => { await system.stop(); process.exit(0) })
process.on('SIGTERM', async () => { await system.stop(); process.exit(0) })
