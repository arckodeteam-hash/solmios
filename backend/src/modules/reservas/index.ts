import { createModule, OrmRepository } from 'arckode-framework'
import { bodyLimit } from 'arckode-framework/middlewares'
import type { StorageService } from 'arckode-framework/modules/storage'
import { registerReservasModels } from './model'
import { ReservasService } from './service'
import { ReservasController } from './controller'
import { ReservasQueries } from './usecases/reservas-queries'
import { handleQScanProWebhook, type QScanProWebhookBody } from './usecases/qscanpro-webhook'
import type { ReservasDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { ReservasService }
export type { ReservasDTO, CreateReservasDTO, UpdateReservasDTO, ReservasQuery, ReservasPaginated } from './types'
export type { ReservasSockets } from './sockets'
export { ReservasValidator, CreateReservasSchema, UpdateReservasSchema, PreCheckinSchema, PreCheckinPhotoSchema, CancelReservationSchema } from './validators/schema'

// La foto del documento viaja como base64 en el body JSON (mismo motivo que housekeeping: el
// router no propaga req.files). 10 MB cubre fotos reales de celular hasta ~7 MB binarios.
const BYTES_PER_KB = 1024
const BYTES_PER_MB = BYTES_PER_KB * 1024
const PHOTO_UPLOAD_LIMIT = 10 * BYTES_PER_MB

export function ReservasModule(opts: { storage?: StorageService } = {}) {
  return createModule({
    name: 'reservas',
    version: '2.1.0',
    description: 'Módulo de reservas — bookings, checkin/checkout, pre-checkin, guarantee cards, detail, audit',
    contract: {
      name: 'reservas',
      version: '2.1.0',
      description: 'Reservations with ownership, availability, validation, checkin/checkout, pre-checkin, guarantee',
      actions: ['list', 'getById', 'create', 'update', 'delete', 'cancel', 'checkin', 'checkout', 'getExtendedDetail', 'getAuditTrail', 'getPreCheckinData', 'submitPreCheckin', 'uploadPreCheckinPhoto', 'getBookingEngineDashboard', 'sendLockCodeEmail', 'cancelPreview', 'cancelBySystem'],
      events: ['onReservasCreated', 'onReservasUpdated', 'onReservasDeleted', 'onReservationCancelled'],
      tables: ['reservations'],
      dependencies: [],
      rules: ['Ownership check required', 'hotelId not updatable', 'Availability check on create/update'],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('reservas: auth dependency required')
      registerReservasModels(orm)
      const repo = new OrmRepository<ReservasDTO>(orm, 'Reservations')
      const log = logger.child('reservas')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const guestRepo = new OrmRepository<any>(orm, 'Guests')
      const roomRepo = new OrmRepository<any>(orm, 'Rooms')
      const hotelRepo = new OrmRepository<any>(orm, 'Hotels')
      const blockRepo = new OrmRepository<any>(orm, 'RoomBlocks')
      const dateRestrictionRepo = new OrmRepository<any>(orm, 'DateRestrictions')
      const companionsRepo = new OrmRepository<any>(orm, 'Companions')
      const addonsRepo = new OrmRepository<any>(orm, 'ReservationAddons')
      const messageLogRepo = new OrmRepository<any>(orm, 'MessageLogs')
      // F2 plan #627 — repo de políticas de cancelación (módulo cancellation, F1).
      const policyRepo = new OrmRepository<any>(orm, 'CancellationPolicies')
      // IDOR cross-tenant: el update acepta `groupId`, así que hay que poder verificar de qué
      // hotel es ese grupo antes de asignarlo (igual que `roomRepo`/`guestRepo`).
      const groupRepo = new OrmRepository<any>(orm, 'Groups')
      // Reprice del reagendado (`pricingMode: 'reprice'`): MISMOS modelos compartidos que usa el
      // motor público para su precio por fecha. Sin ellos el reprice degrada a `rooms.basePrice`.
      const seasonAssignmentRepo = new OrmRepository<any>(orm, 'SeasonAssignments')
      const roomRateRepo = new OrmRepository<any>(orm, 'RoomRates')
      // Catálogo de temporadas (label/color) para el desglose del quote del wizard. Modelo
      // COMPARTIDO (shared/models.ts) — no es un import del módulo pricing.
      const seasonsRepo = new OrmRepository<any>(orm, 'Seasons')
      const queries = new ReservasQueries(orm)
      const service = new ReservasService(repo, log, cache, userRepo, auth, guestRepo, roomRepo, hotelRepo, queries, blockRepo, dateRestrictionRepo, policyRepo, groupRepo, seasonAssignmentRepo, roomRateRepo, opts.storage, seasonsRepo)
      const controller = new ReservasController(service, log, companionsRepo, addonsRepo, repo, userRepo, auth, orm, null, messageLogRepo, roomRepo, hotelRepo)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const configRepo = new OrmRepository<any>(orm, 'Configuration')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('reservations.list')]

      // ── CRUD ──
      router.get('/api/reservas', guard('reservations', 'view'), (req) => controller.index(req))
      router.get('/api/reservas/:id', guard('reservations', 'view'), (req) => controller.show(req))
      router.post('/api/reservas', guard('reservations', 'create'), (req) => controller.store(req))
      router.put('/api/reservas/:id', guard('reservations', 'edit'), (req) => controller.update(req))
      router.delete('/api/reservas/:id', guard('reservations', 'delete'), (req) => controller.destroy(req))

      // ── Cancel (F2 plan #627): aplica política de cancelación al cancelar ──
      router.post('/api/reservas/:id/cancel', guard('reservations', 'edit'), (req) => controller.cancel(req))

      // ── Companions ──
      router.get('/api/reservations/:id/companions', guard('reservations', 'view'), (req) => controller.listCompanions(req))
      router.post('/api/reservations/:id/companions', guard('reservations', 'edit'), (req) => controller.createCompanion(req))
      router.put('/api/companions/:id', guard('reservations', 'edit'), (req) => controller.updateCompanion(req))
      router.delete('/api/companions/:id', guard('reservations', 'delete'), (req) => controller.deleteCompanion(req))

      // ── Addons ──
      router.get('/api/reservations/:id/addons', guard('reservations', 'view'), (req) => controller.listAddons(req))
      router.post('/api/reservations/:id/addons', guard('reservations', 'edit'), (req) => controller.createAddon(req))
      router.delete('/api/addons/:id', guard('reservations', 'delete'), (req) => controller.deleteAddon(req))

      // ── Reschedule (mover/extender desde planning) ── quote antes que commit (orden de registro) ──
      router.post('/api/reservas/:id/reschedule/quote', guard('reservations', 'edit'), (req) => controller.rescheduleQuote(req))
      router.post('/api/reservas/:id/reschedule', guard('reservations', 'edit'), (req) => controller.reschedule(req))

      // ── Check-in / Check-out ──
      router.post('/api/reservas/:id/checkin', guard('reservations', 'checkin'), (req) => controller.checkin(req))
      router.post('/api/reservas/:id/checkout', guard('reservations', 'checkout'), (req) => controller.checkout(req))

      // ── Enviar código de cerradura por email (botón del planning) ──
      router.post('/api/reservas/:id/send-lock-code-email', guard('reservations', 'edit'), (req) => controller.sendLockCodeEmail(req))

      // ── Pre-checkin (público) ──
      router.get('/api/public/pre-checkin/:hash', (req) => controller.getPreCheckinData(req))
      router.post('/api/public/pre-checkin/:hash', [bodyLimit(PHOTO_UPLOAD_LIMIT)], (req) => controller.submitPreCheckin(req))
      // Foto del documento (escaneo u opcional): mismo límite de body que la firma va embebida en
      // el submit final. Endpoint separado — la foto se sube apenas se toma, no espera al submit.
      router.post('/api/public/pre-checkin/:hash/photo', [bodyLimit(PHOTO_UPLOAD_LIMIT)], (req) => controller.uploadPreCheckinPhoto(req))

      // ── Webhook QScanPro (document scan) — público, autoridad = connection_code ──
      router.post('/api/webhooks/qscanpro', (req) =>
        handleQScanProWebhook((req.body ?? {}) as QScanProWebhookBody, { reservationRepo: repo, guestRepo, configRepo, logger: log })
          .then((data) => ({ status: 200, body: { success: true, data } })),
      )

      // ── Extended detail + Audit ──
      router.get('/api/reservations/:id', guard('reservations', 'view'), (req) => controller.getExtendedDetail(req))
      router.get('/api/reservations/:id/audit', guard('reservations', 'view'), (req) => controller.getAuditTrail(req))

      // ── Guarantee card ──
      router.post('/api/guarantee/pin', guard('reservations', 'edit'), (req) => controller.setGuaranteePin(req))
      router.get('/api/guarantee/has-pin', guard('reservations', 'view'), (req) => controller.getGuaranteeHasPin(req))
      router.post('/api/reservations/:id/guarantee-card/unlock', guard('reservations', 'edit'), (req) => controller.unlockGuaranteeCard(req))

      // ── Booking engine dashboard ──
      router.get('/api/booking-engine', guard('reservations', 'view'), (req) => controller.getBookingEngineDashboard(req))

      // ── Stay quote del wizard (precio por temporada, noche a noche). POST, no GET: la ruta
      // `/api/reservas/:id` está registrada ANTES y capturaría `quote` como :id. Mismo patrón
      // que `/api/reservas/:id/reschedule/quote`. Permiso view: solo cotiza, no persiste.
      router.post('/api/reservas/quote', guard('reservations', 'view'), (req) => controller.quote(req))

      // ── Cancel preview (APPEND-ONLY): montos/penalidad SIN persistir. Mismo permiso que
      // cancel (`reservations:edit`): expone datos financieros de la reserva.
      // El `:id` del router es `([^/]+)` (no cruza `/`), así que `/api/reservas/:id` de
      // arriba NO captura esta ruta pese a estar registrado antes.
      router.get('/api/reservas/:id/cancel-preview', guard('reservations', 'edit'), (req) => controller.cancelPreview(req))

      log.info('Módulo reservas v2.1 listo (26 endpoints)')
      return service
    },
  })
}
