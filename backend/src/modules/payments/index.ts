// payments/index.ts — PUERTA PÚBLICA del módulo Payments
// Cobros, pagos, enlaces de pago, depósitos, conciliación

import { createModule, OrmRepository } from 'arckode-framework'
import { registerPaymentsModels } from './model'
import { PaymentsService } from './service'
import { PaymentsController } from './controller'
import type { PaymentDTO, PaymentLinkDTO, DepositDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { PaymentGatewayRegistry } from '../../services/payment-gateway/registry'
import { PaymentEventStore } from '../../services/payment-gateway/payment-events'

export { PaymentsService }
export type { PaymentDTO, CreatePaymentDTO, ChargeCardDTO, PaymentLinkDTO, CreatePaymentLinkDTO, DepositDTO, CreateDepositDTO, RefundDepositDTO, PaymentsQuery, PaymentsPaginated, ReconciliationEntry, ReconciliationResult } from './types'
export type { PaymentsSockets } from './sockets'
export { PaymentsValidator, CreatePaymentSchema, ChargeCardSchema, CreatePaymentLinkSchema, CreateDepositSchema, RefundDepositSchema, ReconcileSchema } from './validators/schema'

export function PaymentsModule() {
  return createModule({
    name: 'payments',
    // 1.1.0 — STR-D: `paymentsLinkedTo` entra al contract (lo consume connectors/reservas-money
    // y connectors/payment-requests-money para el camino reserva→dinero, GH-0.2).
    version: '1.1.0',
    description: 'Payments: card charging, payment links, deposits, reconciliation',

    contract: {
      name: 'payments',
      version: '1.1.0',
      description: 'Payments: card charging, payment links, deposits, reconciliation',
      actions: ['createPayment', 'chargeCard', 'refund', 'listPayments', 'createLink', 'createDeposit', 'refundDeposit', 'releaseDeposit', 'reconcile', 'paymentsLinkedTo'],
      events: ['onPaymentCreated', 'onPaymentCompleted', 'onPaymentExpired', 'onPaymentFailed', 'onRefundProcessed', 'onDepositCreated', 'onDepositReleased'],
      tables: ['payments', 'payment_links', 'deposits'],
      dependencies: ['folios', 'facturas'],
      rules: ['No importar de otros módulos directamente'],
    },

    create({ logger, orm, cache, router, auth }: { logger: any; orm: any; cache: any; router: any; auth?: any }) {
      registerPaymentsModels(orm)

      const paymentRepo = new OrmRepository<PaymentDTO>(orm, 'Payment')
      const linkRepo = new OrmRepository<PaymentLinkDTO>(orm, 'PaymentLink')
      const depositRepo = new OrmRepository<DepositDTO>(orm, 'Deposit')

      const log = logger.child('payments')
      const userRepo = new OrmRepository<any>(orm, 'Users')

      // La pasarela se resuelve POR HOTEL (tabla payment_gateways), ya no desde process.env.
      // El registry vive en services/ (compartido), no en otro módulo: no rompe el aislamiento.
      const gatewayRepo = new OrmRepository<any>(orm, 'PaymentGateways')
      const registry = new PaymentGatewayRegistry(gatewayRepo as any, log)

      // Barrera anti-doble-cobro: los webhooks se procesan una sola vez aunque lleguen repetidos.
      const eventRepo = new OrmRepository<any>(orm, 'PaymentEvents')
      const events = new PaymentEventStore(eventRepo as any, log)

      // Repos de solo lectura para verificar que folioId/invoiceId/guestId del body sean del
      // mismo hotel que el pago (IDOR de campos de relación — ver payment-crud.ts).
      const folioRefRepo = new OrmRepository<any>(orm, 'Folios')
      const invoiceRefRepo = new OrmRepository<any>(orm, 'Invoices')
      const guestRefRepo = new OrmRepository<any>(orm, 'Guests')
      // SEC3-5: la reserva referenciada por `payments.reservationId` se verifica igual que folio/factura/huésped.
      const reservationRefRepo = new OrmRepository<any>(orm, 'Reservations')
      const service = new PaymentsService(paymentRepo, linkRepo, depositRepo, log, cache, auth, userRepo, registry, events, folioRefRepo, invoiceRefRepo, guestRefRepo, reservationRefRepo)
      const controller = new PaymentsController(service, log)

      // Admin routes (protegidas con auth)
      if (auth) {
        const roleRepo = new OrmRepository<any>(orm, 'Roles')
        const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('finance.payments')]

        // Payments
        router.get('/api/payments', guard('billing', 'view'), (req: any) => controller.listPayments(req))
        router.get('/api/payments/:id', guard('billing', 'view'), (req: any) => controller.getPayment(req))
        router.post('/api/payments', guard('billing', 'create'), (req: any) => controller.createPayment(req))
        router.post('/api/payments/charge', guard('billing', 'create'), (req: any) => controller.chargeCard(req))
        router.post('/api/payments/:id/refund', guard('billing', 'create'), (req: any) => controller.refund(req))

        // Payment Links
        router.get('/api/payment-links', guard('billing', 'view'), (req: any) => controller.listLinks(req))
        router.post('/api/payment-links', guard('billing', 'create'), (req: any) => controller.createLink(req))
        router.delete('/api/payment-links/:id', guard('billing', 'create'), (req: any) => controller.cancelLink(req))

        // Deposits
        router.get('/api/deposits', guard('billing', 'view'), (req: any) => controller.listDeposits(req))
        router.get('/api/deposits/:id', guard('billing', 'view'), (req: any) => controller.getDeposit(req))
        router.post('/api/deposits', guard('billing', 'create'), (req: any) => controller.createDeposit(req))
        router.post('/api/deposits/:id/refund', guard('billing', 'create'), (req: any) => controller.refundDeposit(req))
        router.post('/api/deposits/:id/release', guard('billing', 'create'), (req: any) => controller.releaseDeposit(req))

        // Reconciliation
        router.post('/api/billing/reconciliation', guard('billing', 'edit'), (req: any) => controller.reconcile(req))
      }

      // Public routes
      router.get('/api/public/payment-links/:token', (req: any) => controller.getLinkByToken(req))
      // El hotel va en la RUTA: su secreto de firma es lo que autentica el webhook, y hay que
      // saber de quién es ANTES de creerle al body. Su auth ES la firma (el proveedor no tiene JWT).
      router.post('/api/webhooks/stripe/:hotelId', (req: any) => controller.handleWebhook(req))

      // Ya no se inicializa Stripe con process.env: cada hotel tiene su pasarela en
      // payment_gateways. Un hotel sin configurar cae al ENV global desde el registry, que lo
      // avisa por warning — ese fallback se borra cuando ningún hotel dependa de él.

      log.info('Payments module ready')
      return service
    },
  })
}
