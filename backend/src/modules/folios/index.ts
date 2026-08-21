// folios/index.ts — PUERTA PÚBLICA del módulo de folios.
import { createModule, OrmRepository } from 'arckode-framework'
import { registerFoliosModels } from './model'
import { FoliosService } from './service'
import { FoliosController } from './controller'
import type { FolioDTO, FolioChargeDTO, OpenFolioDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { FoliosService }
export type { FolioDTO, FolioChargeDTO, OpenFolioDTO, PostChargeDTO, ApplyPaymentDTO, FolioQuery, FolioListResult } from './types'
export type { FoliosSockets } from './sockets'
export { FoliosValidator } from './validators/schema'
export type { FolioInvoicingPort, IssuedInvoice, CloseAndCreateInvoiceResult } from './service'
export type { FolioPaymentPort, RecordFolioPaymentInput } from './usecases/payment-port'
export { normalizeFolioPaymentMethod } from './usecases/payment-port'

export function FoliosModule() {
  return createModule({
    name: 'folios',
    version: '1.1.0', // STR-D: foliosOfReservation/reservationIdOfFolio entran al contract (GH-0.2)
    description: 'Folios acumulativos por reserva (cargos + pagos → factura)',
    contract: {
      name: 'folios', version: '1.1.0',
      description: 'Acumulador de cargos/pagos por reserva; al cerrarse genera factura',
      actions: ['list', 'getById', 'open', 'postCharge', 'applyPayment', 'close', 'summary', 'foliosOfReservation', 'reservationIdOfFolio'],
      events: ['onFolioOpened', 'onFolioCharged', 'onFolioPaid', 'onFolioClosed'],
      tables: ['folios', 'folio_charges'],
      dependencies: [],
      rules: ['No importar de otros módulos', 'Usar RepositoryAdapter<T>'],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('folios: auth dependency required')
      registerFoliosModels(orm)
      const folioRepo = new OrmRepository<FolioDTO>(orm, 'Folios')
      const chargeRepo = new OrmRepository<FolioChargeDTO>(orm, 'FolioCharges')
      const configRepo = new OrmRepository<any>(orm, 'Configuration')
      const guestRepo = new OrmRepository<any>(orm, 'Guests')
      const reservationRepo = new OrmRepository<any>(orm, 'Reservations')
      const roomRepo = new OrmRepository<any>(orm, 'Rooms')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const log = logger.child('folios')
      const service = new FoliosService(
        folioRepo, chargeRepo, configRepo,
        { guest: guestRepo, reservation: reservationRepo, room: roomRepo, user: userRepo },
        log, cache, auth!,
      )
      const controller = new FoliosController(service, log, orm)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('finance.folios')]

      router.get('/api/folios', guard('billing', 'view'), (req) => controller.index(req))
      router.get('/api/folios/:id', guard('billing', 'view'), (req) => controller.show(req))
      router.post('/api/folios', guard('billing', 'create'), (req) => controller.store(req))
      router.post('/api/folios/:id/charges', guard('billing', 'create'), (req) => controller.charge(req))
      router.post('/api/folios/:id/payments', guard('billing', 'create'), (req) => controller.payment(req))
      router.post('/api/folios/:id/close', guard('billing', 'edit'), (req) => controller.close(req))
      router.post('/api/folios/:id/invoice', guard('billing', 'edit'), (req) => controller.closeAndInvoice(req))
      router.post('/api/folios/audit/post-room-charges', guard('billing', 'edit'), (req) => controller.postNightAuditRoomCharges(req))

      log.info('Módulo folios listo')
      return service
    },
  })
}
