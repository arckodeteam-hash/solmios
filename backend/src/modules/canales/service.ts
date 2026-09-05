import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import type {
  CanalesDTO, CreateCanalesDTO, UpdateCanalesDTO, CanalesQuery, CanalesPaginated,
  ChannelsResultDTO, RoomTypeSummary, SyncResultDTO,
  TestConnectionResultDTO, MappingDetailDTO, GroupDTO, OTAChannelCreateDTO, OTAChannelResultDTO,
  OTAChannelMeta, BookingRevisionDTO, CurrentUser, PushRatesResultDTO,
} from './types'
import type { CanalesSockets } from './sockets'
import { ChannexUseCase } from './usecases/channex'
import { pushAvailabilityForRoomType, pushAvailabilityForRoom, pushAllRoomTypesAvailability, makeAvailabilityDeps, type AvailabilityDeps } from './usecases/availability'
import { syncPropertyToChannex, type SyncPropertyHotel } from './usecases/sync-property'
import { ProvisioningUseCase } from './usecases/provisioning'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import type { AutoProvisionOutcome } from './usecases/auto-provision'
import { CanalesCrudUseCase } from './usecases/crud'
import { ChannelApiUseCase } from './usecases/channel-api'
import { BookingsUseCase } from './usecases/bookings'
import { BookingSyncUseCase, type BookingSyncResult } from './usecases/booking-sync'
import type { ReservationCancelPort } from './usecases/booking-ingestion'
import { ConfigUseCase } from './usecases/config'
import type { CanalesQueries } from './usecases/canales-queries'
import { auditSafely, channelDeleteEntry, type AuditPort } from './usecases/audit'
import { getSyncLog as getSyncLogFromTable } from './usecases/sync-log'
import { withAvailabilityTrail, withRatesTrail } from './usecases/ari-tasks'
import { pushSeasonalRatesToChannex } from './usecases/push-rates'
import { listOverrideChannels } from './usecases/override-channels'
import { readRatePlans } from './usecases/rate-plans'
import { pushRateOverridesFor, type OverridePushItem, type OverridePushResult } from './usecases/push-overrides'

export class CanalesService {
  private sockets: CanalesSockets = {}
  private auditPort: AuditPort | null = null
  private readonly channex: ChannexUseCase
  private readonly crud: CanalesCrudUseCase
  private readonly channelApi: ChannelApiUseCase
  private readonly bookings: BookingsUseCase
  private readonly bookingSync: BookingSyncUseCase
  private readonly config: ConfigUseCase
  private readonly provisioning: ProvisioningUseCase
  /** Entitlement del módulo 'channel'. Lo inyecta el composition-root; sin él se asume habilitado. */
  private moduleCheck?: (hotelId: string, moduleKey: string) => Promise<boolean>

  constructor(
    private readonly repo: RepositoryAdapter<CanalesDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
    private readonly queries: CanalesQueries,
    private readonly syncLogRepo?: RepositoryAdapter<any>,
  ) {
    this.config = new ConfigUseCase(repo, queries)
    // Cuenta white-label de plataforma + mappingStore (P6): pushes resuelven UUIDs sin GETs.
    this.channex = new ChannexUseCase(logger, () => this.config.getPlatformChannex(), {
      read: (h) => this.queries.readChannelMappings(h),
      upsert: async (h, es) => { for (const e of es) await this.queries.upsertChannelMapping(h, e) },
    })
    this.crud = new CanalesCrudUseCase(repo, userRepo, auth)
    this.provisioning = new ProvisioningUseCase({
      getConfig: (h) => this.getConfig(h),
      findMany: (m, q) => this.queries.findMany(m, q),
      readMappings: (h) => this.queries.readChannelMappings(h) as any,
      syncProperty: (h, hotel, rooms) => this.syncProperty(h, hotel, rooms),
      hasPlatformKey: () => this.channex.hasPlatformKey(),
      isModuleEnabled: (h, k) => this.moduleCheck ? this.moduleCheck(h, k) : Promise.resolve(true),
      logger: this.logger,
    })
    this.channelApi = new ChannelApiUseCase(this.channex, { config: this.config, queries: this.queries as any, logger })
    this.bookings = new BookingsUseCase(this.channex)
    // Sync GLOBAL de bookings (cron #564): feed por cuenta de plataforma → deriva por propertyId.
    // El orm se obtiene de queries (escape hatch) para no inyectar ORM directo en el service.
    this.bookingSync = new BookingSyncUseCase({
      channex: this.channex, queries: this.queries, orm: this.queries.getOrm(),
      logger: this.logger, syncLogRepo: this.syncLogRepo,
    })
  }

  /** Conecta el audit log. Lo inyecta el connector `canales-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  /** Checker de entitlement para el alta automática (no hay request HTTP del que sacarlo). */
  setModuleCheck(fn: (hotelId: string, moduleKey: string) => Promise<boolean>): void { this.moduleCheck = fn }

  /** Sync completo del hotel (botón "Sincronizar"). Lee sus habitaciones reales. */
  syncHotel(hotelId: string): Promise<SyncResultDTO> { return this.provisioning.syncHotel(hotelId) }

  /** Alta automática en el channel manager cuando el hotel carga su primera habitación. */
  autoProvision(hotelId: string): Promise<AutoProvisionOutcome> { return this.provisioning.autoProvision(hotelId) }

  /** Conecta el gate de suscripción (#542). Lo inyecta el connector `canales-subscriptions`. */
  setSubscriptionCheck(fn: (hotelId: string) => Promise<{ allowed: boolean }>): void { this.bookingSync.setSubscriptionCheck(fn) }

  /** Conecta la cancelación real de reservas. Lo inyecta el connector `canales-reservas`. */
  setReservationCancelPort(fn: ReservationCancelPort): void { this.bookingSync.setCancelPort(fn) }

  // ACUMULA handlers (implementación única en shared/utils/accumulate-sockets.ts): dos conectores
  // sobre el mismo evento corren en cadena, no se pisan.
  setSockets(s: Partial<CanalesSockets>): void { accumulateSockets(this.sockets as any, s as any) }

  // ─── Config delegado a usecase ───────────────────────────────────────
  async getConfig(hotelId: string): Promise<CanalesDTO | undefined> { return this.config.getConfig(hotelId) }
  private async upsertConfig(hotelId: string, patch: Partial<CanalesDTO>): Promise<CanalesDTO> { return this.config.upsertConfig(hotelId, patch) }

  // ─── Operaciones Channex (delegan al usecase) ────────────────────────
  async listChannels(hotelId: string): Promise<ChannelsResultDTO> {
    const catalog = await this.config.getOTACatalog()
    return this.channex.listChannels(await this.getConfig(hotelId), catalog)
  }

  async getFeed(): Promise<{ pendingBookings: number }> { return this.channex.getFeed() }

  async syncProperty(hotelId: string, hotel: SyncPropertyHotel, rooms: RoomTypeSummary[]): Promise<SyncResultDTO> {
    return syncPropertyToChannex({
      getConfig: (h) => this.getConfig(h),
      getRatePlans: (h) => readRatePlans((m, q) => this.queries.findMany(m, q), h),
      channexSync: (h, ht, r, c, plans) => this.channex.syncProperty(h, ht, r, c, plans),
      upsertConfig: (h, patch) => this.upsertConfig(h, patch),
      pushAllAvailability: (h) => withAvailabilityTrail(this.syncLogRepo, h, () => pushAllRoomTypesAvailability(this.availDeps(), h)),
      pushRates: (h, channel) => this.pushSeasonalRates(h, channel),
      overrideChannels: (h) => listOverrideChannels((m, q) => this.queries.findMany(m, q), h, async () => (await this.listChannels(h)).data),
      syncOpenChannelMapping: (h) => this.channelApi.syncOpenChannelMapping(h),
      logger: this.logger, syncLogRepo: this.syncLogRepo,
    }, hotelId, hotel, rooms)
  }

  // Push de availability: recálculo + push (reservas/checkin/checkout/bloqueos). Todo push ARI
  // deja su fila en sync_log con los task ids de Channex — ver `usecases/ari-tasks.ts`.
  private availDeps(): AvailabilityDeps {
    return makeAvailabilityDeps((m, q) => this.queries.findMany(m, q), (h) => this.getConfig(h), this.channex)
  }
  async pushAvailability(hotelId: string, roomType: string): Promise<{ pushed: boolean }> { return withAvailabilityTrail(this.syncLogRepo, hotelId, () => pushAvailabilityForRoomType(this.availDeps(), hotelId, roomType)) }
  async pushAvailabilityByRoom(hotelId: string, roomId: string): Promise<{ pushed: boolean }> { return withAvailabilityTrail(this.syncLogRepo, hotelId, () => pushAvailabilityForRoom(this.availDeps(), hotelId, roomId)) }

  // ─── Channel API delegado a usecase ──────────────────────────────────
  async testConnection(hotelId: string, channel: string, otaHotelId: string): Promise<TestConnectionResultDTO> { return this.channelApi.testConnection(await this.getConfig(hotelId), channel, otaHotelId) }
  async getMappingDetails(hotelId: string, channel: string, otaHotelId: string): Promise<{ success: boolean; rooms: MappingDetailDTO[]; error?: string }> { return this.channelApi.getMappingDetails(await this.getConfig(hotelId), channel, otaHotelId) }
  async listGroups(hotelId: string): Promise<GroupDTO[]> { return this.channelApi.listGroups(await this.getConfig(hotelId)) }
  async createOTAChannel(hotelId: string, dto: OTAChannelCreateDTO): Promise<OTAChannelResultDTO> { return this.channelApi.createOTAChannel(await this.getConfig(hotelId), dto) }
  async deactivateChannel(hotelId: string, channelId: string): Promise<{ success: boolean; message: string }> { return this.channelApi.deactivateChannel(await this.getConfig(hotelId), channelId) }
  /** Mapeo de rate plans de un canal EXISTENTE (reemplaza el mapeo completo — ver channex.ts). */
  async updateChannelMapping(hotelId: string, channelId: string, ratePlans: any[]): Promise<{ success: boolean; mapped: number; message: string }> { return this.channelApi.updateChannelMapping(await this.getConfig(hotelId), channelId, ratePlans) }
  async checkChannelReadiness(hotelId: string, channelId: string): Promise<{ ready: boolean; issues: string[] }> { return this.channelApi.checkChannelReadiness(await this.getConfig(hotelId), channelId) }
  async activateChannel(hotelId: string, channelId: string): Promise<{ success: boolean; message: string; issues: string[] }> { return this.channelApi.activateChannel(await this.getConfig(hotelId), channelId) }

  // ─── Bookings e iFrame (delegan al usecase, igual que el bloque de arriba) ───────────
  async getBookings(hotelId: string): Promise<BookingRevisionDTO[]> { return this.bookings.getBookings(await this.getConfig(hotelId)) }
  /** Ingesta GLOBAL del feed de bookings OTA (deriva por propertyId). Cron #564 + botón manual. */
  async syncAllBookingRevisions(): Promise<BookingSyncResult> { return this.bookingSync.run() }
  /** Token de un solo uso para el iframe de Channex, acotado a la property Y AL GRUPO del hotel. */
  async getIframeToken(hotelId: string, username: string): Promise<string | null> { return this.channex.generateIframeToken(await this.getConfig(hotelId), username) }
  /** Devuelve el channexPropertyId configurado para el hotel (null si no sincronizó). */
  async getPropertyId(hotelId: string): Promise<string | null> { return (await this.getConfig(hotelId))?.channexPropertyId || null }
  async getChannelDetail(hotelId: string, channelId: string): Promise<any | null> { return this.channelApi.getChannelDetail(await this.getConfig(hotelId), channelId) }

  async getSyncLog(hotelId?: string): Promise<any[]> { return getSyncLogFromTable(this.syncLogRepo, hotelId) }

  /** Etapa 2 — empuja las tarifas por temporada a Channex (todos los planes del hotel). getPricingMode: per_person → OBP (#404). */
  async pushSeasonalRates(hotelId: string, channel?: string): Promise<PushRatesResultDTO> {
    return withRatesTrail(this.syncLogRepo, hotelId, 'push_rates', () => pushSeasonalRatesToChannex({
      getConfig: (h) => this.getConfig(h), findMany: (m, q) => this.queries.findMany(m, q),
      pushSeasonalRates: (c, r, s, a, plans, restrictions, overrides) => this.channex.pushSeasonalRates(c, r, s, a, plans, restrictions, overrides),
    }, hotelId, channel))
  }

  /** Push DELTA de la grilla de tarifas por fecha (una llamada, solo lo tocado). Ver push-overrides.ts. */
  async pushRateOverrides(hotelId: string, items: OverridePushItem[]): Promise<OverridePushResult> {
    return withRatesTrail(this.syncLogRepo, hotelId, 'push_rate_overrides', () => pushRateOverridesFor({
      getConfig: (h) => this.getConfig(h),
      getRatePlans: (h) => readRatePlans((m, q) => this.queries.findMany(m, q), h),
      push: (cfg, i, plans) => this.channex.pushRateOverrides(cfg, i, plans),
    }, hotelId, items))
  }

  // ─── CRUD delegado a usecase ─────────────────────────────────────────
  async list(query?: CanalesQuery, user?: CurrentUser): Promise<CanalesPaginated> {
    return this.crud.list(query, user as any)
  }

  async getById(id: string, user: CurrentUser): Promise<CanalesDTO> { return this.crud.getById(id, user as any) }

  async create(dto: CreateCanalesDTO): Promise<CanalesDTO> {
    const item = await this.crud.create(dto)
    await this.cache.delete('canales:list')
    return item
  }

  async update(id: string, dto: UpdateCanalesDTO, user: CurrentUser): Promise<CanalesDTO> {
    const item = await this.crud.update(id, dto, user as any)
    await this.cache.delete('canales:list')
    return item
  }

  async delete(id: string, user: CurrentUser): Promise<void> {
    const existing = await this.crud.delete(id, user as any)
    await this.cache.delete('canales:list')
    await auditSafely(this.auditPort, this.logger, channelDeleteEntry(existing, user))
  }
}
