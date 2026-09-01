// canales/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository } from 'arckode-framework'
import { registerCanalesModels } from './model'
import { CanalesService } from './service'
import { CanalesController } from './controller'
import { CanalesQueries } from './usecases/canales-queries'
import { ConfigUseCase } from './usecases/config'
import { ChannexUseCase } from './usecases/channex'
import { ChannexAdminService } from './service-channex-admin'
import { getOrCreateOpenChannelKey, verifyOpenChannelKey, buildMappingDetails, applyChanges, logOpenChannelCall, buildEndpointUrl } from './usecases/open-channel-api'
import type { RoomTypeSummary, CanalesDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard, createModuleChecker } from '../../infrastructure/auth/require-module'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { resolveTenant } from '../../shared/utils/resolve-tenant'

export { CanalesService }
export type { CanalesDTO, CreateCanalesDTO, UpdateCanalesDTO, CanalesQuery, CanalesPaginated, ChannelsResultDTO, ChannelDTO, SyncResultDTO, RoomTypeSummary, TestConnectionDTO, TestConnectionResultDTO, MappingDetailDTO, MappingRateDTO, OTAChannelCreateDTO, OTAChannelMappingDTO, OTAChannelResultDTO, GroupDTO } from './types'
export type { CanalesSockets } from './sockets'
export { CanalesValidator, CreateCanalesSchema, UpdateCanalesSchema } from './validators/schema'

export function CanalesModule() {
  return createModule({
    name: 'canales',
    version: '1.0.0',
    description: 'Channel manager (Channex) — sincroniza disponibilidad, tarifas y reservas con OTAs',

    contract: {
      name: 'canales',
      version: '1.0.0',
      description: 'Channel manager Channex',
      actions: ['list', 'getById', 'create', 'update', 'delete', 'channels', 'feed', 'sync', 'syncHotel', 'autoProvision', 'pushAvailability', 'pushAvailabilityByRoom', 'testConnection', 'mappingDetails', 'groups', 'connectOTA', 'deactivateChannel', 'pushRateOverrides'],
      events: ['onCanalesCreated', 'onCanalesUpdated', 'onCanalesDeleted', 'onCanalesSynced'],
      tables: ['canales_config'],
      dependencies: [],
      rules: ['No importar de otros módulos'],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('canales: auth dependency required')
      // Registrar modelo(s) — delegado a model.ts
      registerCanalesModels(orm)

      const repo = new OrmRepository<CanalesDTO>(orm, 'Canales')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const log = logger.child('canales')
      const syncLogRepo = new OrmRepository<any>(orm, 'SyncLog')
      const queries = new CanalesQueries(orm)
      const service = new CanalesService(repo, userRepo, log, cache, auth, queries, syncLogRepo)
      const controller = new CanalesController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      // Todas las rutas de hotel de canales son del módulo 'channel': el entitlement se agrega una vez
      // envolviendo el permission guard, sin tocar cada ruta. Las rutas /api/admin/* usan adminOnly aparte.
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      // El alta automática corre fuera de un request: necesita preguntar el entitlement a mano.
      service.setModuleCheck(createModuleChecker(orm))
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('channel')]

      // ── Config Channex a nivel PLATAFORMA (super_admin) — white-label: una cuenta para todos ──
      const adminConfig = new ConfigUseCase(repo, queries)
      const adminChannex = new ChannexUseCase(log, () => adminConfig.getPlatformChannex())
      const channexAdmin = new ChannexAdminService(adminConfig, adminChannex)
      const adminOnly = [auth.authenticate('super_admin'), requireUserType('admin')]
      router.get('/api/admin/channex-config', adminOnly, async () => ({ status: 200, body: await channexAdmin.getStatus() }))
      router.put('/api/admin/channex-config', adminOnly, async (req: any) => ({ status: 200, body: await channexAdmin.save(req.body || {}) }))
      router.post('/api/admin/channex-config/test', adminOnly, async () => ({ status: 200, body: await channexAdmin.test() }))

      router.get('/api/channels', guard('channel-manager', 'view'), async (req) => {
        // resolveTenant (no resolveHotelId del cliente): el merchant queda forzado a su hotel; solo
        // super_admin puede targetear otro. Antes filtraba el channexPropertyId de cualquier hotel.
        const hotelId = resolveTenant(req)
        if (!hotelId) return { status: 404, body: { error: 'Hotel no encontrado' } }
        return { status: 200, body: await service.listChannels(hotelId) }
      })
      router.get('/api/channels/feed', guard('channel-manager', 'view'), (req) => controller.feed())

      router.post('/api/channels/test-connection', guard('channel-manager', 'edit'), (req) => controller.testConnection(req))
      router.get('/api/channels/mapping-details', guard('channel-manager', 'view'), (req) => controller.mappingDetails(req))
      router.get('/api/channels/groups', guard('channel-manager', 'view'), (req) => controller.groups(req))
      router.post('/api/channels/connect', guard('channel-manager', 'edit'), (req) => controller.connectOTA(req))
      router.post('/api/channels/:id/deactivate', guard('channel-manager', 'edit'), (req) => controller.deactivate(req))
      router.get('/api/channels/:id/detail', guard('channel-manager', 'view'), (req) => controller.channelDetail(req))

      router.get('/api/channels/bookings', guard('channel-manager', 'view'), (req) => controller.bookings(req))
      router.post('/api/channels/bookings/ingest', guard('channel-manager', 'edit'), (req) => controller.ingestBookings(req))

      router.get('/api/channels/iframe-token', guard('channel-manager', 'view'), (req) => controller.iframeToken(req))

      router.post('/api/channels/sync', guard('channel-manager', 'edit'), async (req) => {
        // resolveTenant, NO el hotelId del cliente: syncProperty es DESTRUCTIVO (borra rate_plans y
        // room_types en Channex antes de recrear). Con el hotelId del body, un merchant de A lo
        // disparaba sobre la cuenta Channex de B con las credenciales de B → oversell / caída de OTAs.
        const hotelId = resolveTenant(req)
        if (!hotelId) return { status: 404, body: { error: 'Hotel no encontrado' } }
        // Mismo camino que el alta automática del connector habitaciones-canales: si divergieran,
        // un hotel terminaría con un catálogo distinto según por dónde se sincronizó.
        return { status: 200, body: await service.syncHotel(hotelId) }
      })

      router.get('/api/canales', guard('channel-manager', 'view'), (req) => controller.index(req))
      router.get('/api/canales/:id', guard('channel-manager', 'view'), (req) => controller.show(req))
      router.post('/api/canales', guard('channel-manager', 'edit'), (req) => controller.store(req))
      router.put('/api/canales/:id', guard('channel-manager', 'edit'), (req) => controller.update(req))
      router.delete('/api/canales/:id', guard('channel-manager', 'edit'), (req) => controller.destroy(req))

      router.get('/api/channels/sync-log', guard('channel-manager', 'view'), (req) => controller.syncLog(req))

      // Etapa 2 — empujar las tarifas por temporada del hotel a Channex (rate/stop-sell/min-max stay).
      router.post('/api/channels/push-rates', guard('channel-manager', 'edit'), async (req) => {
        const hotelId = resolveTenant(req)
        if (!hotelId) return { status: 404, body: { error: 'Hotel no encontrado' } }
        const channel = (req.body as any)?.channel
        return { status: 200, body: await service.pushSeasonalRates(hotelId, channel) }
      })

      // ── Open Channel API (https://docs.channex.io/for-ota/open-channel-api) ──────────────
      // SolmiOS actúa de "canal" propio para Channex: sirve para conectar el channel manager sin
      // depender de credenciales de ninguna OTA real. `open-channel-api.ts` tiene el detalle de
      // cada pieza; acá solo el wiring HTTP.
      const ocDeps = { canalesRepo: repo, syncLogRepo, findMany: (model: string, q: any) => queries.findMany(model, q) }

      // El hotel logueado pide sus credenciales para pegar en el asistente de Channex
      // ("Endpoint", "API Key", "Hotel Code"). Genera la clave la primera vez que se pide.
      router.get('/api/channels/open-channel-key', guard('channel-manager', 'view'), async (req) => {
        const hotelId = resolveTenant(req)
        if (!hotelId) return { status: 404, body: { error: 'Hotel no encontrado' } }
        const apiKey = await getOrCreateOpenChannelKey(ocDeps, hotelId)
        return { status: 200, body: { apiKey, hotelCode: hotelId, endpoint: buildEndpointUrl(req) } }
      })

      // Las 3 rutas de abajo las llama CHANNEX, no un usuario logueado: sin JWT, autenticación por
      // header `api-key` contra la clave guardada del hotel que indica `hotel_code`. Público a
      // propósito (mismo patrón que el webhook de WhatsApp: verificación explícita adentro, no
      // auth.authenticate()).
      router.get('/api/channels/open-ari/test_connection', async (req: any) => {
        const hotelId = String(req.query?.hotel_code || '')
        const apiKey = req.headers?.['api-key']
        if (!(await verifyOpenChannelKey(ocDeps, hotelId, apiKey))) {
          return { status: 401, body: { success: false } }
        }
        await logOpenChannelCall(ocDeps, hotelId, 'open_channel_test')
        return { status: 200, body: { success: true } }
      })

      router.get('/api/channels/open-ari/mapping_details', async (req: any) => {
        const hotelId = String(req.query?.hotel_code || '')
        const apiKey = req.headers?.['api-key']
        if (!(await verifyOpenChannelKey(ocDeps, hotelId, apiKey))) {
          return { status: 401, body: { success: false } }
        }
        const body = await buildMappingDetails(ocDeps, hotelId)
        await logOpenChannelCall(ocDeps, hotelId, 'open_channel_mapping')
        return { status: 200, body }
      })

      router.post('/api/channels/open-ari/changes', async (req: any) => {
        // Forma exacta del payload: doc oficial, sección "changes" — { data: [{ attributes: { hotel_code, changes: [...] } }] }.
        const entry = (req.body as any)?.data?.[0]?.attributes
        const hotelId = String(entry?.hotel_code || '')
        const apiKey = req.headers?.['api-key']
        if (!(await verifyOpenChannelKey(ocDeps, hotelId, apiKey))) {
          return { status: 401, body: { success: false } }
        }
        if (!Array.isArray(entry?.changes)) {
          return { status: 400, body: { success: false, error: 'changes debe ser un array' } }
        }
        const { recorded } = await applyChanges(ocDeps, hotelId, entry.changes)
        return { status: 200, body: { success: true, unique_id: crypto.randomUUID(), recorded } }
      })

      log.info('Módulo canales (Channex) listo')
      return service
    },
  })
}
