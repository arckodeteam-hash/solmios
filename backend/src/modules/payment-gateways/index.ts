// payment-gateways/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository } from 'arckode-framework'
import { registerPaymentGatewaysModels } from './model'
import { PaymentGatewaysService } from './service'
import { PaymentGatewaysController } from './controller'
import type { PaymentGatewayRow } from './types'
import { PaymentGatewayRegistry } from '../../services/payment-gateway/registry'
import { PaymentAttemptStore } from '../../services/payment-gateway/payment-attempts'
import { isEncryptionConfigured } from '../../services/payment-gateway/crypto'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { PaymentGatewaysService }
export type { PaymentGatewayDTO, UpsertPaymentGatewayDTO, PaymentGatewayRow } from './types'
export type { PaymentGatewaysSockets } from './sockets'
export { PaymentGatewaysValidator, UpsertPaymentGatewaySchema } from './validators/schema'
// REQ-RWP-02 — tipos de la bitácora de intentos, para que el conector los tipe sin importar el service.
export type { PaymentAttemptRow, PaymentAttemptKind } from '../../services/payment-gateway/payment-attempts'

export function PaymentGatewaysModule() {
  return createModule({
    name: 'payment-gateways',
    version: '1.0.0',
    description: 'Pasarelas de pago por hotel (cada dueño cobra a su propia cuenta)',

    contract: {
      name: 'payment-gateways',
      version: '1.0.0',
      description: 'Configuración de pasarelas de pago por hotel',
      actions: ['list', 'upsert', 'setEnabled', 'remove', 'testConnection', 'listAttempts'],
      events: [],
      tables: ['payment_gateways', 'payment_events', 'payment_gateway_sessions', 'payment_attempts'],
      dependencies: [],
      rules: ['Las credenciales se guardan cifradas', 'La API nunca devuelve un secreto'],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('payment-gateways: auth dependency required')
      registerPaymentGatewaysModels(orm)

      const log = logger.child('payment-gateways')

      if (!isEncryptionConfigured()) {
        log.warn(
          'PAYMENTS_ENCRYPTION_KEY no configurada: no se pueden guardar credenciales de pasarela. ' +
          'Generar con: openssl rand -base64 32',
        )
      }

      const repo = new OrmRepository<PaymentGatewayRow>(orm, 'PaymentGateways')
      // Sesiones de los proveedores 'pull' (CardNet): la session-key se guarda cifrada acá.
      const sessionsRepo = new OrmRepository<any>(orm, 'PaymentGatewaySessions')
      const registry = new PaymentGatewayRegistry(repo as any, log, sessionsRepo as any)
      // REQ-RWP-02 — bitácora de intentos (REQ-RWP-01): el detalle de la reserva la lee vía conector.
      const attemptStore = new PaymentAttemptStore(new OrmRepository<any>(orm, 'PaymentAttempts') as any, log)
      const service = new PaymentGatewaysService(repo, log, registry, auth)
      const controller = new PaymentGatewaysController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('settings.gateways')]

      // Configurar cómo cobra el hotel es una decisión de dinero: billing:edit, no billing:view.
      router.get('/api/payment-gateways', guard('billing', 'edit'), (req: any) => controller.list(req))
      router.post('/api/payment-gateways', guard('billing', 'edit'), (req: any) => controller.upsert(req))
      router.put('/api/payment-gateways/:id/enabled', guard('billing', 'edit'), (req: any) => controller.setEnabled(req))
      router.delete('/api/payment-gateways/:id', guard('billing', 'edit'), (req: any) => controller.remove(req))
      router.post('/api/payment-gateways/:id/test', guard('billing', 'edit'), (req: any) => controller.testConnection(req))

      log.info('Módulo payment-gateways listo (5 endpoints)')
      // El registry se expone para que los otros módulos resuelvan la pasarela DEL HOTEL
      // (vía conector), en vez de leer process.env como hacen hoy payments y bookingengine.
      // REQ-RWP-02 — listAttempts: el detalle de la reserva lee los intentos por conector,
      // sin importar el store ni el service de pasarelas.
      return Object.assign(service, {
        registry,
        listAttempts: (hotelId: string, reservationId: string) => attemptStore.listByReservation(hotelId, reservationId),
      })
    },
  })
}
