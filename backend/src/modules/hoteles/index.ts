// hoteles/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository } from 'arckode-framework'
import { bodyLimit } from 'arckode-framework/middlewares'
import type { StorageService } from 'arckode-framework/modules/storage'
import { registerHotelesModels } from './model'
import { HotelesService } from './service'
import { HotelesController } from './controller'
import { SettingsFullUseCase } from './usecases/settings-full'
import { HotelesQueries } from './usecases/hoteles-queries'
import type { HotelesDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'

const LOGO_UPLOAD_LIMIT = 5 * 1024 * 1024

export { HotelesService }
export { SettingsFullUseCase }
export type { HotelesDTO, CreateHotelesDTO, UpdateHotelesDTO, HotelesQuery, HotelesPaginated } from './types'
export type { HotelesSockets } from './sockets'
export { HotelesValidator, CreateHotelesSchema, UpdateHotelesSchema } from './validators/schema'

export function HotelesModule(opts: { storage?: StorageService } = {}) {
  return createModule({
    name: 'hoteles',
    version: '2.0.0',
    description: 'Módulo de hoteles — configuración, settings, multi-tenancy',

    contract: {
      name: 'hoteles',
      version: '2.0.0',
      description: 'Hotels settings with ownership and pagination',
      actions: ['list', 'getById', 'create', 'update', 'delete'],
      events: ['onHotelesCreated', 'onHotelesUpdated', 'onHotelesDeleted'],
      tables: ['hotels'],
      dependencies: [],
      rules: ['Ownership check on read/write', 'Super_admin bypass', 'Pagination required'],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('hoteles: auth dependency required')
      registerHotelesModels(orm)

      const repo = new OrmRepository<HotelesDTO>(orm, 'Hotels')
      const log = logger.child('hoteles')
      const settingsFull = new SettingsFullUseCase(orm)
      const queries = new HotelesQueries(orm)
      const service = new HotelesService(repo, log, cache, auth, settingsFull, queries)
      // Repo de Configuration: las tasas del cron (hotelId='platform') y el currency_config del hotel.
      const configRepo = new OrmRepository<any>(orm, 'Configuration')
      const controller = new HotelesController(service, log, queries, opts.storage, { configRepo, hotelRepo: repo })

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const guard = createPermissionGuard(auth, roleRepo)

      router.get('/api/hoteles', guard('settings', 'view'), (req) => controller.index(req))
      router.get('/api/hoteles/:id', guard('settings', 'view'), (req) => controller.show(req))
      // Alta y baja de hoteles son operaciones de PLATAFORMA, no del hotelero. `hotels:*` no lo tiene
      // ningún rol de hotel: solo super_admin, que bypassa el guard. Antes usaban `settings:create` /
      // `settings:delete`, los mismos permisos que necesita un hotel_admin para sus dispositivos.
      router.post('/api/hoteles', guard('hotels', 'create'), (req) => controller.store(req))
      router.put('/api/hoteles/:id', guard('settings', 'edit'), (req) => controller.update(req))
      router.delete('/api/hoteles/:id', guard('hotels', 'delete'), (req) => controller.destroy(req))

      // Settings
      router.get('/api/settings', guard('settings', 'view'), (req) => controller.getSettings(req))
      router.put('/api/settings/hotel', guard('settings', 'edit'), (req) => controller.updateHotel(req))
      router.get('/api/settings/full', guard('settings', 'view'), (req) => controller.getSettingsFull(req))
      // Logo del hotel: mismo patrón que /api/auth/avatar — data URL base64 en JSON (el router no
      // propaga multipart), sube a StorageService y guarda la URL devuelta en hotels.logo.
      router.post('/api/settings/logo', [...guard('settings', 'edit'), bodyLimit(LOGO_UPLOAD_LIMIT)], (req) => controller.uploadLogo(req))
      router.get('/api/configuracion/:key', guard('settings', 'view'), (req) => controller.getConfig(req))
      router.post('/api/configuracion', guard('settings', 'edit'), (req) => controller.setConfig(req))

      // Contactos de emergencia — lectura SOLO-LOGIN (sin `settings:view`).
      // housekeeper/supervisor/maintenance están en el piso ante un incidente y necesitan los
      // números; darles `settings:view` les abriría toda la configuración del hotel. La ESCRITURA
      // sigue en POST /api/configuracion con `settings:edit`.
      router.get('/api/contactos-emergencia', [auth.authenticate()], (req) => controller.getEmergencyContacts(req))

      // Tasa de cambio automática — lectura SOLO-LOGIN, mismo criterio que contactos de emergencia:
      // la conversión se muestra en pantallas de operación (el detalle de reserva la usa) y
      // recepción no tiene `settings:view`. La ESCRITURA de la tasa manual sigue en
      // POST /api/configuracion (key `currency_config`) con `settings:edit`.
      router.get('/api/tasa-cambio', [auth.authenticate()], (req) => controller.getExchangeRate(req))

      log.info('Módulo hoteles v2 listo (5 settings endpoints + contactos de emergencia + tasa de cambio)')
      return service
    },
  })
}
