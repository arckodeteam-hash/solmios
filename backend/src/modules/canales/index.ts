// canales/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.

import { createModule, OrmRepository, validateSchema, NotFoundError } from 'arckode-framework'
import { registerCanalesModels } from './model'
import { CanalesService } from './service'
import { CanalesController } from './controller'
import { CanalesQueries } from './usecases/canales-queries'
import { ConfigUseCase } from './usecases/config'
import { ChannexUseCase } from './usecases/channex'
import { ChannexAdminService } from './service-channex-admin'
import { getOrCreateOpenChannelKey, verifyOpenChannelKey, buildMappingDetails, applyChanges, logOpenChannelCall, buildEndpointUrl } from './usecases/open-channel-api'
import { buildOpenChannelMappings, roomTypesFromRooms } from './usecases/open-channel-connect'
import { CHANNEX_WEBHOOK_PATH, handleChannexWebhook, registerChannexWebhook, buildCallbackUrl, getOrCreateWebhookSecret } from './usecases/channex-webhook'
import { setChannexHttpEventSink } from './usecases/channex-http'
import { createChannexTrail, createPropertyResolver } from './usecases/channex-trail'
import { SYNC_ACTIONS, SYNC_STATUSES, listChannexLog } from './usecases/sync-log'
import {
  requestChannel, updateChannelRequest, scheduleAppointment, addChannelRequestNote, forHotel,
  CHANNEL_REQUEST_TRANSITIONS,
  type ChannelRequestRow, type ChannelRequestActivityRow, type ChannelRequestDeps, type ChannelRequestActor,
} from './usecases/channel-requests'
import { listChannelRequestsForAdmin, getChannelRequestForAdmin, CHANNEL_REQUEST_FILTER_LABELS } from './usecases/channel-requests-admin'
import { makeChannelRequestNotifyDeps } from './usecases/channel-request-notify-deps'
import { notifyAdminOfChannelRequest, notifyHotelOfChannelRequest } from '../../shared/usecases/notify-channel-request'
import {
  CreateChannelRequestSchema, UpdateChannelRequestSchema, ScheduleAppointmentSchema,
  AddChannelRequestNoteSchema, ChannexAccountSchema,
} from './validators/schema'
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
// El techo de peticiones/minuto contra Channex vive en el transporte HTTP de este módulo, pero lo
// configura el Super Admin sobre la cola de `ari-outbox`. Como un módulo no importa de otro, el
// connector canales-ari-outbox toma el valor guardado y lo aplica por acá.
export { setChannexMaxPerMinute } from './usecases/channex-http'

export function CanalesModule() {
  return createModule({
    name: 'canales',
    version: '1.0.0',
    description: 'Channel manager (Channex) — sincroniza disponibilidad, tarifas y reservas con OTAs',

    contract: {
      name: 'canales',
      version: '1.0.0',
      description: 'Channel manager Channex',
      actions: ['list', 'getById', 'create', 'update', 'delete', 'channels', 'feed', 'sync', 'syncHotel', 'autoProvision', 'pushAvailability', 'pushAvailabilityByRoom', 'testConnection', 'mappingDetails', 'groups', 'connectOTA', 'deactivateChannel', 'pushRateOverrides', 'updateChannelMapping', 'checkChannelReadiness', 'activateChannel', 'overrideChannels'],
      events: ['onCanalesCreated', 'onCanalesUpdated', 'onCanalesDeleted', 'onCanalesSynced', 'onOtaBookingIngested'],
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

      // #347 — Todo lo que le pasa al transporte contra Channex (espera por rate limit, 429, 5xx,
      // timeout, reintentos agotados, 4xx) queda en `sync_log` del hotel dueño de la property, o en
      // `platform` si no se puede saber. Es lo que hace visible en /admin/channex-queue › Registro si
      // un push salió, cuándo, y si no salió por qué. Sin esto todo eso vivía solo en journalctl.
      const trail = createChannexTrail({
        syncLogRepo,
        resolveHotel: createPropertyResolver((model, q) => orm.findMany(model, q)),
        logger: log,
      })
      setChannexHttpEventSink(trail.onHttpEvent)
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
      // Los puertos (correo, campanita) los inyectan email-bootstrap y el connector
      // canales-notificaciones sobre el service; el resto de las deps se resuelve por `queries`.
      const notifyDeps = () => makeChannelRequestNotifyDeps(queries, log, service.channelRequestNotifyPorts)
      const requestsRepo = new OrmRepository<ChannelRequestRow>(orm, 'ChannelRequests')
      const activitiesRepo = new OrmRepository<ChannelRequestActivityRow>(orm, 'ChannelRequestActivities')
      const requestDeps: ChannelRequestDeps = {
        findMany: (q: any) => requestsRepo.findMany(q) as Promise<ChannelRequestRow[]>,
        create: (row: ChannelRequestRow) => requestsRepo.create(row as any) as Promise<ChannelRequestRow>,
        update: (id: string, patch: Partial<ChannelRequestRow>) => requestsRepo.update(id, patch as any) as Promise<ChannelRequestRow>,
        createActivity: (row: ChannelRequestActivityRow) => activitiesRepo.create(row as any),
        listActivities: (requestId: string) => activitiesRepo.findMany({ requestId } as any) as Promise<ChannelRequestActivityRow[]>,
        // El aviso al admin dejó de ser una línea de log: correo al soporte + campanita (REQ-CAN-07).
        // Sigue siendo best-effort — `requestChannel` lo envuelve en un catch.
        notify: async (row: ChannelRequestRow) => {
          log.info('Solicitud de conexión de canal', {
            hotelId: row.hotelId, hotel: row.hotelName, canal: row.channelName, pidio: row.requestedByEmail,
          })
          await notifyAdminOfChannelRequest(notifyDeps(), row)
        },
        notifyHotel: (row, event) => notifyHotelOfChannelRequest(notifyDeps(), row, event),
      }

      /**
       * Quién hace el cambio, para el historial. El JWT trae id/role/hotelId pero NO el nombre:
       * sin leer el usuario, el timeline diría "alguien cambió el estado".
       */
      const resolveActor = async (req: any): Promise<ChannelRequestActor> => {
        const id = req?.user?.id
        if (!id) return {}
        const user = (await queries.findMany('Users', { id }))[0] as any
        return { id, name: user?.name ?? req.user?.name ?? '' }
      }

      // ── Config Channex a nivel PLATAFORMA (super_admin) — white-label: una cuenta para todos ──
      const adminConfig = new ConfigUseCase(repo, queries)
      const adminChannex = new ChannexUseCase(log, () => adminConfig.getPlatformChannex())
      const channexAdmin = new ChannexAdminService(adminConfig, adminChannex, queries)
      const adminOnly = [auth.authenticate('super_admin'), requireUserType('admin')]
      router.post('/api/admin/channex-config/test', adminOnly, async () => ({ status: 200, body: await channexAdmin.test() }))

      // ── Webhook de reservas de Channex (#50) ──────────────────────────────────────────────
      // El secreto y el callback son de la CUENTA de plataforma (no de un hotel): viven en la misma
      // fila `configuration(hotelId='platform', key='channex')` que las credenciales.
      const webhookStore = {
        read: () => queries.getPlatformChannex(),
        write: (patch: { webhookSecret?: string; channexUserId?: string }) => queries.setPlatformChannex(patch),
      }
      // Origen público de esta instalación para armar el callback_url. Misma lógica de proto+host
      // que `buildEndpointUrl` (cf-visitor gana sobre x-forwarded-proto: Cloudflare en modo Flexible
      // habla HTTP con el origen y el x-forwarded-proto queda mintiendo). CHANNEX_WEBHOOK_BASE_URL
      // es un override OPCIONAL, para cuando el host del request no es el alcanzable desde afuera.
      const webhookBaseUrl = (req: any): string => {
        const override = String(process.env.CHANNEX_WEBHOOK_BASE_URL || '').trim()
        if (override) return override.replace(/\/+$/, '')
        const cfVisitor = req?.headers?.['cf-visitor']
        let proto: string | undefined
        if (typeof cfVisitor === 'string') {
          try { proto = JSON.parse(cfVisitor)?.scheme } catch { /* header malformado, se ignora */ }
        }
        proto = proto || (req?.headers?.['x-forwarded-proto'] as string) || 'https'
        return `${proto}://${(req?.headers?.host as string) || 'localhost'}`
      }

      // Estado de la CUENTA: credenciales + webhook + properties vs hoteles + vencimiento del plan
      // (REQ-CAN-09). El `callbackUrl` sale del request porque depende del host público de esta
      // instalación, igual que el alta del webhook de acá abajo.
      router.get('/api/admin/channex-config', adminOnly, async (req: any) => {
        const callbackUrl = buildCallbackUrl(webhookBaseUrl(req), await getOrCreateWebhookSecret(webhookStore))
        return { status: 200, body: await channexAdmin.getStatus(callbackUrl) }
      })
      // `planExpiresAt` es el único campo que se puede vaciar (dato manual, se puede haber cargado
      // mal); el resto de las credenciales conservan lo guardado cuando llegan vacías.
      router.put('/api/admin/channex-config', adminOnly, async (req: any) => {
        const body = (req.body || {}) as Record<string, unknown>
        if (body.planExpiresAt !== undefined) validateSchema(ChannexAccountSchema, { planExpiresAt: body.planExpiresAt })
        return { status: 200, body: await channexAdmin.save(body) }
      })

      // GET /api/admin/channex/log — el registro de TODOS los hoteles (#347), paginado y filtrable.
      // Es la fuente de la pestaña "Registro" de /admin/channex-queue: ahí se ve si un push salió
      // (fila con task ids), si esperó (throttled), si Channex lo rechazó (429/5xx/4xx) y qué hizo
      // el webhook con cada reserva. `hotelId=platform` son las filas de cuenta.
      router.get('/api/admin/channex/log', adminOnly, async (req: any) => {
        const q = req.query || {}
        const page = await listChannexLog(syncLogRepo, {
          hotelId: q.hotelId ? String(q.hotelId) : undefined,
          status: q.status ? String(q.status) : undefined,
          action: q.action ? String(q.action) : undefined,
          page: Number(q.page) || 1,
          limit: Number(q.limit) || 50,
        })
        return { status: 200, body: { ...page, filters: { actions: SYNC_ACTIONS, statuses: SYNC_STATUSES } } }
      })

      // Estado del registro: qué callbacks tiene hoy la cuenta y cuál usaríamos nosotros. Si Channex
      // no responde el panel igual tiene que abrir, así que el error viaja en el body, no como 5xx.
      router.get('/api/admin/channex-webhook', adminOnly, async (req: any) => {
        const callbackUrl = buildCallbackUrl(webhookBaseUrl(req), await getOrCreateWebhookSecret(webhookStore))
        try {
          return { status: 200, body: { success: true, callbackUrl, webhooks: await adminChannex.listWebhooks('') } }
        } catch (e: any) {
          log.warn('No se pudieron listar los webhooks de Channex', { error: e?.message || String(e) })
          return { status: 200, body: { success: false, callbackUrl, webhooks: [], error: e?.message || String(e) } }
        }
      })

      // Rescate manual de reservas que el feed ya no puede entregar (ventana de 30 min vencida).
      // Es de la PLATAFORMA, no de un hotel: `/bookings` es de cuenta y la corrida deriva cada
      // booking a su hotel por `propertyId`, igual que el cron. Se dispara a mano después de una
      // caída conocida — como cron periódico re-traería lo mismo para siempre.
      router.post('/api/admin/channex/recover-bookings', adminOnly, async (req: any) => {
        const desde = String(req.body?.since ?? '').trim()
        // Fecha Y HORA: Channex rechaza `2026-09-01` con 422. Se valida acá para devolver un
        // mensaje que se entienda, en vez del error crudo de Channex.
        if (!desde || Number.isNaN(Date.parse(desde))) {
          return { status: 400, body: { error: 'Falta "since" con fecha y hora ISO (ej. 2026-09-09T18:00:00Z)' } }
        }
        const r = await service.recoverBookingsSince(new Date(desde).toISOString())
        const message = r.feedSize === 0
          ? 'No hay reservas en Channex desde esa fecha'
          : `${r.feedSize} encontradas · ${r.ingested} creadas · ${r.skipped} ya existían · ${r.unmapped} sin hotel mapeado`
        return { status: r.success ? 200 : 422, body: { ...r, message } }
      })

      // Alta idempotente del callback: si el endpoint ya está registrado no crea otro (ver usecase).
      router.post('/api/admin/channex-webhook', adminOnly, async (req: any) => {
        try {
          const result = await registerChannexWebhook({ store: webhookStore, channex: adminChannex, logger: log }, webhookBaseUrl(req))
          return { status: 200, body: { success: Boolean(result.id), ...result } }
        } catch (e: any) {
          log.error('No se pudo registrar el webhook de Channex', { error: e?.message || String(e) })
          return { status: 200, body: { success: false, created: false, id: null, error: e?.message || String(e) } }
        }
      })

      // ── Bandeja del admin (REQ-CAN-08) ────────────────────────────────────────────────────
      // Enriquecida en el usecase (`channel-requests-admin`), no acá: la fila trae el teléfono del
      // hotel, su property de Channex y si la cita está vencida, que es lo que el admin necesita
      // para hacer el alta manual sin abrir cuatro pantallas.
      const adminRequestDeps = async () => ({
        findMany: (model: string, q: Record<string, unknown>) => queries.findMany(model, q),
        environment: (await adminConfig.getPlatformChannex())?.environment,
      })

      router.get('/api/admin/channel-requests', adminOnly, async (req: any) => {
        const result = await listChannelRequestsForAdmin(await adminRequestDeps(), { filter: String(req.query?.filter || 'all') })
        return { status: 200, body: { ...result, filters: CHANNEL_REQUEST_FILTER_LABELS, transitions: CHANNEL_REQUEST_TRANSITIONS } }
      })

      router.get('/api/admin/channel-requests/:id', adminOnly, async (req: any) => {
        const row = await getChannelRequestForAdmin({
          ...(await adminRequestDeps()),
          listActivities: (requestId: string) => activitiesRepo.findMany({ requestId } as any) as Promise<ChannelRequestActivityRow[]>,
        }, req.params.id)
        if (!row) throw new NotFoundError('La solicitud no existe')
        return { status: 200, body: row }
      })

      // Cambio de estado. La máquina de estados vive en el usecase: acá solo se valida la FORMA
      // del body (antes no se validaba nada y `{status:'lo-que-sea'}` llegaba hasta el repo).
      router.put('/api/admin/channel-requests/:id', adminOnly, async (req: any) => {
        const body = validateSchema(UpdateChannelRequestSchema, req.body || {}) as Record<string, string>
        const updated = await updateChannelRequest(requestDeps, req.params.id, body, await resolveActor(req))
        return { status: 200, body: updated }
      })

      // Agendar o reprogramar la cita. Es el ÚNICO camino a `scheduled` (REQ-CAN-03).
      router.post('/api/admin/channel-requests/:id/appointment', adminOnly, async (req: any) => {
        const body = validateSchema(ScheduleAppointmentSchema, req.body || {}) as any
        const updated = await scheduleAppointment(requestDeps, req.params.id, body, await resolveActor(req))
        return { status: 200, body: updated }
      })

      // Nota interna. Se valida por schema (tipo y largo) pero se PERSISTE el texto crudo: el
      // sanitizador de strings del framework colapsa los espacios y le comería los saltos de línea.
      router.post('/api/admin/channel-requests/:id/notes', adminOnly, async (req: any) => {
        validateSchema(AddChannelRequestNoteSchema, req.body || {})
        const note = String(req.body?.note ?? '').slice(0, 2000)
        const updated = await addChannelRequestNote(requestDeps, req.params.id, note, await resolveActor(req))
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
      // Conectar un canal es SIEMPRE del admin de la plataforma, nunca del hotel: hace falta el
      // contrato con la OTA, sus credenciales, y cada canal abierto cuesta plata en la cuenta de
      // Channex. El hotel lo PIDE (`POST /api/channels/requests`) y acá se lo conectan, apuntando
      // a su hotel con `?hotelId=` (resolveTenant deja targetear otro hotel solo a super_admin).
      router.post('/api/channels/connect', adminOnly, (req) => controller.connectOTA(req))
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

      // POST /api/channels/channex/webhook (CHANNEX_WEBHOOK_PATH, compartido con el callback_url
      // que registramos). La llama CHANNEX cuando entra o cambia una reserva. Igual que las 3 de
      // arriba va SIN auth.authenticate(): no hay usuario logueado del otro lado. Se verifica
      // adentro del handler contra el secreto de plataforma (header `api-key` o el `api_key` que
      // el callback_url registrado lleva en el query string). La ingesta es el MISMO camino del
      // cron (`runOne`), así la reserva del webhook es idéntica a la del cron.
      const webhookDeps = {
        store: webhookStore,
        ingestRevision: (revisionId: string) => service.syncOneBookingRevision(revisionId),
        // Sin `payload` (webhook viejo con send_data:false, #342) se barre el feed entero: mismo `run` del cron.
        syncFeed: () => service.syncAllBookingRevisions(),
        trail,   // #347: cada callback deja fila en sync_log (ingestada / plan B / rechazada)
        logger: log,
      }
      router.post(CHANNEX_WEBHOOK_PATH, async (req: any) => handleChannexWebhook(webhookDeps, req))

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
        const body = validateSchema(CreateChannelRequestSchema, req.body || {}) as Record<string, string>
        const channel = body.channel!
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
          channelName: body.channelName || channel,
          requestedByName: user?.name ?? req.user?.name,
          requestedByEmail: user?.email ?? req.user?.email ?? hotel?.email,
          // El mensaje se toma CRUDO del body (validado arriba por forma y largo): el sanitizador
          // del framework colapsa los saltos de línea y el hotel escribe en párrafos.
          message: String(req.body?.message ?? '').slice(0, 500),
          // Teléfono al que quiere que lo llamen; si no puso nada, el del hotel.
          contactPhone: (body.contactPhone || hotel?.phone || '').slice(0, 40),
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

      // El canal propio no es una OTA, pero sigue siendo un canal en la cuenta de Channex: misma
      // regla que el resto. El hotel lo pide como cualquier otro y lo conecta el admin.
      router.post('/api/channels/open-channel/connect', adminOnly, async (req: any) => {
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
