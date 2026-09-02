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
import { buildOpenChannelMappings, roomTypesFromRooms } from './usecases/open-channel-connect'
import { requestChannel, updateChannelRequest, forHotel, type ChannelRequestRow } from './usecases/channel-requests'
import { readRatePlans } from '../../shared/utils/rate-plans'
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
      actions: ['list', 'getById', 'create', 'update', 'delete', 'channels', 'feed', 'sync', 'syncHotel', 'autoProvision', 'pushAvailability', 'pushAvailabilityByRoom', 'testConnection', 'mappingDetails', 'groups', 'connectOTA', 'deactivateChannel', 'pushRateOverrides', 'updateChannelMapping', 'checkChannelReadiness', 'activateChannel'],
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

      // ── Solicitudes de conexión de una OTA ────────────────────────────────────────────────
      // El hotel las pide desde su panel; las atiende el admin de la plataforma. Ver
      // `usecases/channel-requests.ts` (por qué el botón dejó de abrir el asistente de Channex).
      const requestsRepo = new OrmRepository<ChannelRequestRow>(orm, 'ChannelRequests')
      const requestDeps = {
        findMany: (q: any) => requestsRepo.findMany(q) as Promise<ChannelRequestRow[]>,
        create: (row: ChannelRequestRow) => requestsRepo.create(row as any) as Promise<ChannelRequestRow>,
        update: (id: string, patch: Partial<ChannelRequestRow>) => requestsRepo.update(id, patch as any) as Promise<ChannelRequestRow>,
        notify: async (row: ChannelRequestRow) => {
          log.info('Solicitud de conexión de canal', {
            hotelId: row.hotelId, hotel: row.hotelName, canal: row.channelName, pidio: row.requestedByEmail,
          })
        },
      }

      // ── Config Channex a nivel PLATAFORMA (super_admin) — white-label: una cuenta para todos ──
      const adminConfig = new ConfigUseCase(repo, queries)
      const adminChannex = new ChannexUseCase(log, () => adminConfig.getPlatformChannex())
      const channexAdmin = new ChannexAdminService(adminConfig, adminChannex)
      const adminOnly = [auth.authenticate('super_admin'), requireUserType('admin')]
      router.get('/api/admin/channex-config', adminOnly, async () => ({ status: 200, body: await channexAdmin.getStatus() }))
      router.put('/api/admin/channex-config', adminOnly, async (req: any) => ({ status: 200, body: await channexAdmin.save(req.body || {}) }))
      router.post('/api/admin/channex-config/test', adminOnly, async () => ({ status: 200, body: await channexAdmin.test() }))

      // Bandeja del admin: todas las solicitudes de todos los hoteles, la más nueva primero.
      router.get('/api/admin/channel-requests', adminOnly, async () => {
        const rows = await requestsRepo.findMany({} as any) as ChannelRequestRow[]
        const data = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        return { status: 200, body: { data, total: data.length } }
      })
      router.put('/api/admin/channel-requests/:id', adminOnly, async (req: any) => {
        const updated = await updateChannelRequest(requestDeps, req.params.id, req.body || {})
        if (!updated) return { status: 400, body: { error: 'Estado inválido' } }
        return { status: 200, body: updated }
      })

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
      // Mapeo de rate plans de un canal YA CREADO. Sin esto un canal con "Rate Plans Mapeados (0)"
      // no tenía arreglo desde el panel: solo se podía crear uno nuevo con su mapeo.
      router.put('/api/channels/:id/mapping', guard('channel-manager', 'edit'), (req) => controller.updateMapping(req))
      router.get('/api/channels/:id/readiness', guard('channel-manager', 'view'), (req) => controller.channelReadiness(req))
      router.post('/api/channels/:id/activate', guard('channel-manager', 'edit'), (req) => controller.activate(req))
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

      // Conectar SolmiOS como canal EN UN CLICK. El servidor ya conoce las tres credenciales
      // (endpoint, api key, hotel code) y el mapeo sale del sync: pedirle al hotelero que las
      // transcriba en el asistente de Channex era el paso que dejaba a los hoteles nuevos sin
      // ningún canal conectado. Ver `usecases/open-channel-connect.ts`.
      // Solicitudes del hotel: pedir una OTA y ver en qué anda lo pedido.
      router.get('/api/channels/requests', guard('channel-manager', 'view'), async (req) => {
        const hotelId = resolveTenant(req)
        if (!hotelId) return { status: 404, body: { error: 'Hotel no encontrado' } }
        const rows = await requestsRepo.findMany({ hotelId } as any) as ChannelRequestRow[]
        // Sin `notes`: son internas del admin.
        return { status: 200, body: { data: rows.map(forHotel), total: rows.length } }
      })

      router.post('/api/channels/requests', guard('channel-manager', 'edit'), async (req: any) => {
        const hotelId = resolveTenant(req)
        if (!hotelId) return { status: 404, body: { error: 'Hotel no encontrado' } }
        const channel = String(req.body?.channel || '').trim()
        if (!channel) return { status: 400, body: { error: 'Falta el canal' } }
        // El JWT lleva id/role/hotelId, NO nombre ni correo: sin leer el usuario, el admin recibe
        // la solicitud sin saber a quién contestarle.
        const [hotel, user] = await Promise.all([
          queries.findMany('Hotels', { id: hotelId }).then((r) => r[0] as any),
          req.user?.id ? queries.findMany('Users', { id: req.user.id }).then((r) => r[0] as any) : Promise.resolve(null),
        ])
        const { request, created } = await requestChannel(requestDeps, {
          hotelId,
          hotelName: hotel?.name,
          channel,
          channelName: String(req.body?.channelName || channel),
          requestedByName: user?.name ?? req.user?.name,
          requestedByEmail: user?.email ?? req.user?.email ?? hotel?.email,
          message: String(req.body?.message || '').slice(0, 500),
        })
        return {
          status: 200,
          body: {
            success: true,
            created,
            request: forHotel(request),
            message: created
              ? 'Solicitud enviada. El equipo de SolmiOS te contacta para conectar el canal.'
              : 'Ya tenías una solicitud abierta para este canal: la estamos gestionando.',
          },
        }
      })

      router.post('/api/channels/open-channel/connect', guard('channel-manager', 'edit'), async (req: any) => {
        const hotelId = resolveTenant(req)
        if (!hotelId) return { status: 404, body: { error: 'Hotel no encontrado' } }
        const cfg = (await queries.findMany('Canales', { hotelId }))[0] as CanalesDTO | undefined
        if (!cfg?.channexPropertyId) {
          return { status: 422, body: { success: false, message: 'El hotel todavía no está publicado en el channel manager. Sincronizá primero.' } }
        }
        const [apiKey, mappings, rooms, plans] = await Promise.all([
          getOrCreateOpenChannelKey(ocDeps, hotelId),
          queries.findMany('ChannelMapping', { hotelId }),
          queries.findMany('Rooms', { hotelId }),
          readRatePlans((model: string, q: any) => queries.findMany(model, q), hotelId),
        ])
        const ratePlans = buildOpenChannelMappings(mappings as any, plans, roomTypesFromRooms(rooms as any))
        if (!ratePlans.length) {
          return { status: 422, body: { success: false, message: 'No hay tarifas publicadas para mapear. Sincronizá el hotel y volvé a intentar.' } }
        }
        // El grupo es obligatorio para crear un canal. Los hoteles sincronizados antes de que el
        // sync lo guardara lo tienen vacío: se lee de la property y se persiste, que es lo que
        // además necesita el token del iframe para acotar lo que el hotel ve.
        let groupId = cfg.channexGroupId || ''
        if (!groupId) {
          const hotel = (await queries.findMany('Hotels', { id: hotelId }))[0] as any
          groupId = (await adminChannex.ensureGroupForProperty(cfg, hotel?.name || 'Hotel')) || ''
          if (groupId && cfg.id) await repo.update(cfg.id, { channexGroupId: groupId } as any)
        }
        if (!groupId) {
          return { status: 422, body: { success: false, message: 'No se pudo resolver el grupo del hotel en Channex.' } }
        }
        const result = await service.createOTAChannel(hotelId, {
          channel: 'OpenChannel',
          title: 'SolmiOS Open',
          groupId,
          propertyId: cfg.channexPropertyId,
          ratePlans,
          settings: { endpoint: buildEndpointUrl(req), api_key: apiKey, hotel_code: hotelId },
        })
        if (!result.success) log.warn('No se pudo conectar SolmiOS como canal', { hotelId, message: result.message })
        return { status: result.success ? 200 : 422, body: result }
      })

      log.info('Módulo canales (Channex) listo')
      return service
    },
  })
}
