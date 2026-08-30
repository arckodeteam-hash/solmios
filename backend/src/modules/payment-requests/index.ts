// payment-requests/index.ts — PUERTA PÚBLICA del módulo.
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// payment-requests = solicitud de pago pre-pago con Stripe Checkout para una reserva (legacy).
// Distinto del módulo `payments` (pagos registrados vinculados a folios). No fusionar.

import { createModule, OrmRepository } from 'arckode-framework'
import { PaymentEventStore } from '../../services/payment-gateway/payment-events'
import { registerPaymentRequestModels } from './model'
import { PaymentRequestsService } from './service'
import { PaymentRequestsController } from './controller'
import type { PaymentRequestDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { PaymentRequestsService }
export type {
  PaymentRequestDTO, CreatePaymentRequestDTO, UpdatePaymentRequestDTO,
  PaymentRequestQuery, PaymentRequestStatus, CurrentUser,
  StripeStatusResult, CheckoutResult, WebhookResult,
} from './types'
export type { PaymentRequestsSockets } from './sockets'
export { CreatePaymentRequestSchema, UpdatePaymentRequestSchema, PaymentRequestsValidator } from './validators/schema'
export type { StripePaymentPort, RecordStripePaymentInput, RecordedPayment } from './usecases/payment-port'
// El mapeo cobro → fila de `payments`, para que el connector y el banco de pruebas asienten igual.
export { stripeChargeDto, type StripeChargeDto } from './usecases/payment-port'

export function PaymentRequestsModule() {
  return createModule({
    name: 'payment-requests',
    // 1.4.1 — BUG-1: el settle del webhook (asiento en `payments` + bridge reserva/folio) corre
    // como UN efecto tras el claim atómico de `PaymentEventStore` (clave `stripe:{sessionId}`).
    // Antes el bridge se gatedaba en `!alreadyRecorded`: un fallo posterior al asiento dejaba el
    // reintento sin bridge y el PR se marcaba `paid` con la reserva sin deposit ni cargo foliar.
    // El bridge además es reentrante: cargo foliar primero (deduplicado por ref), reserva al final.
    // 1.4.0 — SEC3-2/SEC3-3: `clampRequestsToCeiling`/`releaseRequestsOfReservation` recortan los
    // links vivos cuando el total cobrable de la reserva baja (PUT totalAmount/otherCharges, baja
    // de un extra, borrado de la reserva); la lectura reserva→dinero sale por el connector
    // `payment-requests-money` (STR-A: sin repos crudos de `invoices`/`payments` acá); marcar
    // `paid` a mano sobre una sesión ya abonada corta con 409 (COR-C).
    // 1.3.0 — GH-0.3/GH-0.4: `createCheckout` reutiliza la sesión abierta en vez de emitir otra,
    // sacar un cobro de `pending` (PUT/DELETE) expira su Checkout Session y puede responder 409 si
    // ya fue abonada, y la sesión se emite contra la cuenta Stripe DEL COBRO, no la del JWT.
    // 1.2.0 — el techo del monto mide contra lo cobrado en `payments` (no contra
    // `reservations.deposit`) y el webhook resuelve el folio filtrando por hotel.
    version: '1.4.1',
    description: 'Solicitudes de pago (Stripe Checkout) por reserva + webhook',

    contract: {
      name: 'payment-requests',
      version: '1.4.1',
      description: 'Solicitud de pago pre-pago con Stripe Checkout; webhook aplica el pago a reserva+folio',
      actions: ['list', 'getById', 'create', 'update', 'delete', 'stripeStatus', 'createCheckout', 'handleWebhook', 'clampRequestsToCeiling', 'releaseRequestsOfReservation', 'setBookingWebhookPort'],
      events: ['onPaymentRequestCreated', 'onPaymentRequestUpdated', 'onPaymentRequestDeleted', 'onPaymentRequestPaid'],
      // Cross-table del bridge del webhook (deuda F10) + los extras que definen el saldo cobrable.
      tables: ['payment_requests', 'reservations', 'folios', 'folio_charges', 'reservation_addons', 'invoices', 'payments', 'payment_events'],
      dependencies: [],
      rules: [
        'hotelId forzado del JWT en create (P0 IDOR)',
        'assertOwnership en update/delete (P0 IDOR CR-25/26)',
        'handleWebhook asienta el cobro en `payments` vía conector payment-requests-payments',
        'handleWebhook aplica pago a Reservations/FolioCharges (DEUDA F10: mover a conector reactivo)',
        'El monto lo decide el SERVIDOR: create/update/createCheckout lo topan contra el saldo real de la reserva (shared/utils/reservation-balance), no contra lo que llega en el body (SEC-1)',
        'El techo es AGREGADO: descuenta los payment_requests `pending` de la misma reserva, así N links no suman más que el saldo (SEC-2)',
        'Lo ya cobrado sale de `payments` (folios/invoices de la reserva), no de `reservations.deposit`: un cobro en efectivo por folio no puede volver a cobrarse por Stripe (GH-0.2)',
        'Un cobro tiene A LO SUMO UNA Checkout Session viva: sacarlo de `pending` (PUT/DELETE) la expira en Stripe primero, y regenerar el checkout reutiliza la abierta (GH-0.3)',
        'SEC3-2: si el total cobrable de la reserva BAJA (PUT totalAmount/otherCharges, baja de un extra, borrado), `clampRequestsToCeiling`/`releaseRequestsOfReservation` expiran los links que el nuevo saldo ya no respalda — el techo no se libera por el lado de la reserva sin matar la sesión',
        'La sesión se emite contra la cuenta Stripe del hotel DEL COBRO (`pr.hotelId`), nunca la del JWT: si no coinciden, el webhook la rechazaría con 403 (GH-0.4)',
        'BUG-1: el settle del webhook es UN efecto atómico tras el claim de `payment_events` (clave `stripe:{sessionId}`): un reintento tras fallo parcial completa el bridge sin duplicar el asiento, y un webhook concurrente con el mismo sessionId no toca nada',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('payment-requests: auth dependency required')
      registerPaymentRequestModels(orm)

      const repo = new OrmRepository<PaymentRequestDTO>(orm, 'PaymentRequests')
      // Repos cross-table para el webhook bridge (deuda F10: conector reactivo futuro).
      const reservationRepo = new OrmRepository<any>(orm, 'Reservations')
      const folioRepo = new OrmRepository<any>(orm, 'Folios')
      const folioChargeRepo = new OrmRepository<any>(orm, 'FolioCharges')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      // Extras de la reserva: el webhook los necesita para dejar `pendingAmount` con el saldo REAL.
      const addonRepo = new OrmRepository<any>(orm, 'ReservationAddons')
      // Camino reserva → `payments` (GH-0.2): lo sirve el connector `payment-requests-money` con
      // los módulos dueños del dinero (STR-A) — este módulo NO abre repos de `invoices`/`payments`.
      // Sin ese connector el techo falla fuerte en vez de medir contra `reservations.deposit`.
      const log = logger.child('payment-requests')
      const service = new PaymentRequestsService(repo, reservationRepo, folioRepo, folioChargeRepo, userRepo, log, auth!, addonRepo)
      // BUG-1: el settle del webhook corre asiento + bridge como UN efecto tras el claim atómico
      // de `payment_events` (misma tabla/tienda que `payments` y `bookingengine`). El modelo lo
      // registra `PaymentGatewaysModule`, creado ANTES en composition-root — mismo supuesto que
      // hace bookingengine con este repo.
      service.setEventStore(new PaymentEventStore(new OrmRepository<any>(orm, 'PaymentEvents') as any, log))
      const controller = new PaymentRequestsController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('finance.payments')]

      router.get('/api/payment-requests', guard('billing', 'view'), (req) => controller.index(req))
      router.get('/api/payment-requests/:id', guard('billing', 'view'), (req) => controller.show(req))
      router.post('/api/payment-requests', guard('billing', 'create'), (req) => controller.store(req))
      router.put('/api/payment-requests/:id', guard('billing', 'edit'), (req) => controller.update(req))
      router.delete('/api/payment-requests/:id', guard('billing', 'delete'), (req) => controller.destroy(req))
      router.get('/api/stripe/status', guard('billing', 'view'), (req) => controller.stripeStatus(req))
      router.post('/api/payment-requests/:id/create-checkout', guard('billing', 'create'), (req) => controller.createCheckout(req))
      // Webhook público: sin auth, firma Stripe verificada en el service.
      router.post('/api/stripe/webhook/:hotelId', (req) => controller.webhook(req))

      log.info('Módulo payment-requests listo')
      return service
    },
  })
}
