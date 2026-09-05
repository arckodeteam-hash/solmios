import { createModule, OrmRepository } from 'arckode-framework'
import type { LockDeviceDTO, LockCodeDTO } from './types'
import { registerTtlockModels } from './model'
import { TtlockService } from './service'
import { TtlockController } from './controller'
import { TtlockQueries } from './usecases/ttlock-queries'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { TtlockService }

export function TtlockModule() {
  return createModule({
    name: 'ttlock',
    version: '1.0.0',
    description: 'TTLock integration: config, sync, codes',
    contract: {
      name: 'ttlock', version: '1.0.0',
      description: 'TTLock smart lock management',
      actions: ['getConfig', 'updateConfig', 'connect', 'listLocks', 'listCodes', 'listGateways', 'listActiveCodes', 'listRecords', 'unlock', 'deletePasscode', 'listLockGateways', 'createPermanentCode', 'syncLocks', 'generateCode', 'revokeCode', 'purgeCodes', 'purgeAllCodes', 'updateLock', 'listMasterKeys', 'createMasterKey', 'revokeMasterKey', 'masterKeyAccessLog', 'masterKeyLocks', 'addMasterKeyLock', 'removeMasterKeyLock', 'lock'],
      events: [],
      tables: ['lock_devices', 'lock_codes'],
      dependencies: [],
      rules: [],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('ttlock: auth dependency required')
      // ttlock es el dueño canónico de LockDevices/LockCodes (ya no viven en shared/models). Sin
      // este registro, `orm.findMany('LockCodes', ...)` — que hace el detalle de una reserva — falla
      // con "Modelo 'LockCodes' no definido" al abrir cualquier reserva desde Planning.
      registerTtlockModels(orm)
      const log = logger.child('ttlock')
      const lockDevicesRepo = new OrmRepository<LockDeviceDTO>(orm, 'LockDevices')
      const lockCodesRepo = new OrmRepository<LockCodeDTO>(orm, 'LockCodes')
      const queries = new TtlockQueries(orm)
      const usersRepo = new OrmRepository<any>(orm, 'Users')
      const service = new TtlockService(lockDevicesRepo, lockCodesRepo, log, queries, auth)
      const controller = new TtlockController(service, log, usersRepo)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('settings.locks')]

      router.get('/api/ttlock/config', guard('ttlock', 'view'), (req: any) => controller.getConfig(req))
      router.put('/api/ttlock/config', guard('ttlock', 'edit'), (req: any) => controller.updateConfig(req))
      router.post('/api/ttlock/connect', guard('ttlock', 'edit'), (req: any) => controller.connect(req))
      router.get('/api/ttlock/locks', guard('ttlock', 'view'), (req: any) => controller.listLocks(req))
      router.get('/api/ttlock/codes', guard('ttlock', 'view'), (req: any) => controller.listCodes(req))
      router.get('/api/ttlock/gateways', guard('ttlock', 'view'), (req: any) => controller.listGateways(req))
      router.get('/api/ttlock/locks/:id/active-codes', guard('ttlock', 'view'), (req: any) => controller.listActiveCodes(req))
      router.get('/api/ttlock/locks/:id/records', guard('ttlock', 'view'), (req: any) => controller.listRecords(req))
      router.post('/api/ttlock/locks/:id/unlock', guard('ttlock', 'edit'), (req: any) => controller.unlock(req))
      // Cerrar en remoto. Mismo permiso que abrir: las dos son operar la puerta.
      router.post('/api/ttlock/locks/:id/lock', guard('ttlock', 'edit'), (req: any) => controller.lock(req))
      router.delete('/api/ttlock/locks/:id/passcodes/:pwdId', guard('ttlock', 'edit'), (req: any) => controller.deletePasscode(req))
      router.get('/api/ttlock/locks/:id/gateways', guard('ttlock', 'view'), (req: any) => controller.listLockGateways(req))
      router.post('/api/ttlock/locks/:id/permanent-codes', guard('ttlock', 'edit'), (req: any) => controller.createPermanentCode(req))
      router.post('/api/ttlock/sync', guard('ttlock', 'edit'), (req: any) => controller.syncLocks(req))
      router.post('/api/ttlock/generate-code/:reservationId', guard('ttlock', 'edit'), (req: any) => controller.generateCode(req))
      router.delete('/api/ttlock/code/:id', guard('ttlock', 'edit'), (req: any) => controller.revokeCode(req))
      router.put('/api/ttlock/lock/:id', guard('ttlock', 'edit'), (req: any) => controller.updateLock(req))
      router.delete('/api/ttlock/lock/:id/codes/revoked', guard('ttlock', 'edit'), (req: any) => controller.purgeCodes(req))
      // Purga GLOBAL: históricos de TODO el hotel (el hotelId sale del token, no de la URL).
      router.delete('/api/ttlock/codes/revoked', guard('ttlock', 'edit'), (req: any) => controller.purgeAllCodes(req))

      // Llaves maestras: un PIN por persona que abre TODAS las puertas. Se suma
      // el rol al permiso — recepción puede administrar cerraduras, pero emitir
      // una llave que abre todo el hotel es del gerente.
      const managerOnly = (a: string) => [auth.authenticate('hotel_admin', 'super_admin'), ...guard('ttlock', a)]
      router.get('/api/ttlock/master-keys', managerOnly('view'), (req: any) => controller.listMasterKeys(req))
      router.post('/api/ttlock/master-keys', managerOnly('edit'), (req: any) => controller.createMasterKey(req))
      router.delete('/api/ttlock/master-keys/:id', managerOnly('edit'), (req: any) => controller.revokeMasterKey(req))
      router.get('/api/ttlock/master-keys/:id/access-log', managerOnly('view'), (req: any) => controller.masterKeyAccessLog(req))
      router.get('/api/ttlock/master-keys/:id/locks', managerOnly('view'), (req: any) => controller.masterKeyLocks(req))
      router.post('/api/ttlock/master-keys/:id/locks/:lockId', managerOnly('edit'), (req: any) => controller.addMasterKeyLock(req))
      router.delete('/api/ttlock/master-keys/:id/locks/:lockId', managerOnly('edit'), (req: any) => controller.removeMasterKeyLock(req))

      log.info('Módulo ttlock listo (25 endpoints)')
      return service
    },
  })
}
