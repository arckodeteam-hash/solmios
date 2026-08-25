// cash/index.ts — PUERTA PÚBLICA del módulo Caja.
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository } from 'arckode-framework'
import { registerCashModels } from './model'
import { CashService } from './service'
import { CashController } from './controller'
import type { CashMovementDTO, CashShiftDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { CashService }
export type {
  CashMovementDTO, CashShiftDTO, CreateMovementDTO, UpdateMovementDTO,
  MovementQuery, CashPaginated, OpenShiftDTO, CloseShiftDTO,
  ReconcileResult, CashStats, MovementType,
  ShiftHistoryRow, ShiftHistoryQuery, ShiftHistoryPage,
} from './types'
export type { CashSockets } from './sockets'
export { CashValidator, CreateMovementSchema, UpdateMovementSchema, OpenShiftSchema, CloseShiftSchema } from './validators/schema'

export function CashModule() {
  return createModule({
    name: 'caja',
    version: '1.0.0',
    description: 'Caja: movimientos y turnos con arqueo',

    contract: {
      name: 'caja',
      version: '1.0.0',
      description: 'Caja: movimientos y turnos con arqueo',
      actions: ['list', 'getById', 'create', 'update', 'delete', 'listShifts', 'getCurrentShift', 'openShift', 'closeShift', 'reconcile', 'stats', 'registerPaymentIncome'],
      events: ['onCashMovementCreated', 'onCashMovementUpdated', 'onCashMovementDeleted', 'onShiftOpened', 'onShiftClosed'],
      tables: ['cash_movements', 'cash_shifts'],
      dependencies: [],
      rules: ['hotelId forzado del JWT en create (P0 IDOR)', 'registerPaymentIncome con dedup por paymentId'],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('caja: auth dependency required')
      registerCashModels(orm)

      const repo = new OrmRepository<CashMovementDTO>(orm, 'CashMovements')
      const shiftRepo = new OrmRepository<CashShiftDTO>(orm, 'CashShifts')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const log = logger.child('caja')
      const service = new CashService(repo, shiftRepo, userRepo, log, cache, auth!)
      const controller = new CashController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('finance.caja')]
      // Caja del restaurante: mismo módulo/usecases, gateado por el permiso `restaurant` (lo tienen
      // hotel_admin/receptionist/waiter) en vez de `billing` — es el cajón del POS, no el de recepción.
      const guardR = (m: string, a: string) => [...permGuard(m, a), moduleGuard('restaurant')]

      // Movimientos — caja de recepción
      router.get('/api/caja/movements', guard('billing', 'view'), (req) => controller.index(req))
      router.get('/api/caja/movements/:id', guard('billing', 'view'), (req) => controller.show(req))
      router.post('/api/caja/movements', guard('billing', 'create'), (req) => controller.store(req))
      // SC-03: PUT y DELETE exigían `billing:create` — receptionist (billing:view+create, SIN
      // edit/delete por diseño, ver permissions.ts) podía editar y BORRAR movimientos de caja.
      router.put('/api/caja/movements/:id', guard('billing', 'edit'), (req) => controller.update(req))
      router.delete('/api/caja/movements/:id', guard('billing', 'delete'), (req) => controller.destroy(req))
      // Turnos — caja de recepción
      router.get('/api/caja/shifts', guard('billing', 'view'), (req) => controller.listShifts(req))
      router.get('/api/caja/shifts/current', guard('billing', 'view'), (req) => controller.currentShift(req))
      router.post('/api/caja/shifts/open', guard('billing', 'create'), (req) => controller.openShift(req))
      router.post('/api/caja/shifts/:id/close', guard('billing', 'create'), (req) => controller.closeShift(req))
      router.get('/api/caja/shifts/:id/reconcile', guard('billing', 'view'), (req) => controller.reconcile(req))
      // Stats — caja de recepción
      router.get('/api/caja/stats', guard('billing', 'view'), (req) => controller.stats(req))

      // ── Caja del restaurante — mismo cajón lógico, punto de venta separado (register='restaurant') ──
      // QA-ALTO: 'restaurant:view'/'restaurant:edit' también los tiene `kitchen` (piensa en KDS,
      // no en el cajón). Se gatea TODO —lectura incluida— con 'restaurant:create', que solo tienen
      // hotel_admin/receptionist/waiter — así cocina queda afuera del cajón por completo.
      router.get('/api/caja/restaurant/movements', guardR('restaurant', 'create'), (req) => controller.index(req, 'restaurant'))
      router.get('/api/caja/restaurant/movements/:id', guardR('restaurant', 'create'), (req) => controller.show(req, 'restaurant'))
      router.post('/api/caja/restaurant/movements', guardR('restaurant', 'create'), (req) => controller.store(req, 'restaurant'))
      router.put('/api/caja/restaurant/movements/:id', guardR('restaurant', 'create'), (req) => controller.update(req, 'restaurant'))
      router.delete('/api/caja/restaurant/movements/:id', guardR('restaurant', 'delete'), (req) => controller.destroy(req, 'restaurant'))
      router.get('/api/caja/restaurant/shifts', guardR('restaurant', 'create'), (req) => controller.listShifts(req, 'restaurant'))
      router.get('/api/caja/restaurant/shifts/current', guardR('restaurant', 'create'), (req) => controller.currentShift(req, 'restaurant'))
      router.post('/api/caja/restaurant/shifts/open', guardR('restaurant', 'create'), (req) => controller.openShift(req, 'restaurant'))
      router.post('/api/caja/restaurant/shifts/:id/close', guardR('restaurant', 'create'), (req) => controller.closeShift(req, 'restaurant'))
      router.get('/api/caja/restaurant/shifts/:id/reconcile', guardR('restaurant', 'create'), (req) => controller.reconcile(req, 'restaurant'))
      router.get('/api/caja/restaurant/stats', guardR('restaurant', 'create'), (req) => controller.stats(req, 'restaurant'))

      log.info('Módulo caja listo')
      return service
    },
  })
}
