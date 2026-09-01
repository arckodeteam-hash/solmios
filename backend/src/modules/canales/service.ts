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
import { pushAvailabilityForRoomType, pushAvailabilityForRoom, pushAllRoomTypesAvailability, type AvailabilityDeps } from './usecases/availability'
import { pushFullSyncAri } from './usecases/full-sync'
import { CanalesCrudUseCase } from './usecases/crud'
import { ChannelApiUseCase } from './usecases/channel-api'
import { BookingsUseCase } from './usecases/bookings'
import { BookingSyncUseCase } from './usecases/booking-sync'
import type { ReservationCancelPort } from './usecases/booking-ingestion'
import type { BookingSyncResult } from './usecases/booking-sync'
import { ConfigUseCase } from './usecases/config'
import type { CanalesQueries } from './usecases/canales-queries'
import { auditSafely, channelDeleteEntry, type AuditPort } from './usecases/audit'
import { getSyncLog as getSyncLogFromTable } from './usecases/sync-log'
import { pushSeasonalRatesToChannex } from './usecases/push-rates'
import { readPricingMode } from './usecases/pricing-mode'
import { readRatePlans } from './usecases/rate-plans'

export class CanalesService {
  private sockets: CanalesSockets = {}
  private auditPort: AuditPort | null = null
  private readonly channex: ChannexUseCase
  private readonly crud: CanalesCrudUseCase
  private readonly channelApi: ChannelApiUseCase
  private readonly bookings: BookingsUseCase
  private readonly bookingSync: BookingSyncUseCase
  private readonly config: ConfigUseCase

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
    this.channelApi = new ChannelApiUseCase(this.channex)
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

  /** Conecta el gate de suscripción (#542). Lo inyecta el connector `canales-subscriptions`. */
  setSubscriptionCheck(fn: (hotelId: string) => Promise<{ allowed: boolean }>): void { this.bookingSync.setSubscriptionCheck(fn) }

  /** Conecta la cancelación real de reservas. Lo inyecta el connector `canales-reservas`. */
  setReservationCancelPort(fn: ReservationCancelPort): void { this.bookingSync.setCancelPort(fn) }

  setSockets(s: Partial<CanalesSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  // ─── Config delegado a usecase ───────────────────────────────────────
  async getConfig(hotelId: string): Promise<CanalesDTO | undefined> { return this.config.getConfig(hotelId) }
  private async upsertConfig(hotelId: string, patch: Partial<CanalesDTO>): Promise<CanalesDTO> { return this.config.upsertConfig(hotelId, patch) }

  // ─── Operaciones Channex (delegan al usecase) ────────────────────────
  async listChannels(hotelId: string): Promise<ChannelsResultDTO> {
    const catalog = await this.config.getOTACatalog()
    return this.channex.listChannels(await this.getConfig(hotelId), catalog)
  }

  async getFeed(): Promise<{ pendingBookings: number }> { return this.channex.getFeed() }

  async syncProperty(hotelId: string, hotel: { name: string; currency?: string; email?: string; address?: string; timezone?: string }, rooms: RoomTypeSummary[]): Promise<SyncResultDTO> {
    const cfg = await this.getConfig(hotelId)
    const pricingMode = await readPricingMode((m, q) => this.queries.findMany(m, q), hotelId)
    // Planes del hotel (BAR + B&B por defecto): un rate plan de Channex por (room type × plan) — P5.
    const ratePlans = await readRatePlans((m, q) => this.queries.findMany(m, q), hotelId)
    const { result, newPropertyId } = await this.channex.syncProperty(hotelId, hotel, rooms, cfg, pricingMode, ratePlans)
    if (newPropertyId) await this.upsertConfig(hotelId, { channexPropertyId: newPropertyId, syncEnabled: 1, lastSync: new Date().toISOString() })
    else await this.upsertConfig(hotelId, { lastSync: new Date().toISOString() })

    // ARI del full sync en exactamente 2 llamadas (test 1 de certificación) — lógica en usecases/full-sync.ts.
    await pushFullSyncAri({
      pushAll: () => pushAllRoomTypesAvailability(this.availDeps(), hotelId),
      pushRates: () => this.pushSeasonalRates(hotelId),
      logger: this.logger,
    }, hotelId)

    if (this.syncLogRepo) try {
      await this.syncLogRepo.create({
        id: crypto.randomUUID(), hotelId, channel: 'channex', action: 'sync_property',
        status: result.success ? 'success' : 'error',
        details: { roomTypes: result.roomTypes, ratePlans: result.ratePlans, newPropertyId },
        createdAt: new Date().toISOString(),
      })
    } catch {}
    return result
  }

  // Push de availability: recálculo + push. Disparado por reservas/checkin/checkout/bloqueos. Lógica en usecases/availability.ts.
  private availDeps(): AvailabilityDeps {
    return {
      findMany: (m, q) => this.queries.findMany(m, q),
      getConfig: h => this.getConfig(h),
      pushToChannex: (c, rt, r) => this.channex.pushAvailability(c, rt, r),
      pushAllToChannex: (c, list) => this.channex.pushAllAvailability(c, list),
    }
  }
  async pushAvailability(hotelId: string, roomType: string): Promise<{ pushed: boolean }> { return pushAvailabilityForRoomType(this.availDeps(), hotelId, roomType) }
  async pushAvailabilityByRoom(hotelId: string, roomId: string): Promise<{ pushed: boolean }> { return pushAvailabilityForRoom(this.availDeps(), hotelId, roomId) }

  // ─── Channel API delegado a usecase ──────────────────────────────────
  async testConnection(hotelId: string, channel: string, otaHotelId: string): Promise<TestConnectionResultDTO> { return this.channelApi.testConnection(await this.getConfig(hotelId), channel, otaHotelId) }
  async getMappingDetails(hotelId: string, channel: string, otaHotelId: string): Promise<{ success: boolean; rooms: MappingDetailDTO[]; error?: string }> { return this.channelApi.getMappingDetails(await this.getConfig(hotelId), channel, otaHotelId) }
  async listGroups(hotelId: string): Promise<GroupDTO[]> { return this.channelApi.listGroups(await this.getConfig(hotelId)) }
  async createOTAChannel(hotelId: string, dto: OTAChannelCreateDTO): Promise<OTAChannelResultDTO> { return this.channelApi.createOTAChannel(await this.getConfig(hotelId), dto) }
  async deactivateChannel(hotelId: string, channelId: string): Promise<{ success: boolean; message: string }> { return this.channelApi.deactivateChannel(await this.getConfig(hotelId), channelId) }

  // ─── Bookings delegado a usecase ─────────────────────────────────────
  async getBookings(hotelId: string): Promise<BookingRevisionDTO[]> {
    return this.bookings.getBookings(await this.getConfig(hotelId))
  }
  /** Ingesta GLOBAL del feed de bookings OTA (deriva por propertyId). Cron #564 + botón manual. */
  async syncAllBookingRevisions(): Promise<BookingSyncResult> {
    return this.bookingSync.run()
  }

  // ─── iFrame ────────────────────────────────────────────────────────
  async getIframeToken(hotelId: string, username: string): Promise<string | null> {
    return this.channex.generateIframeToken(await this.getConfig(hotelId), username)
  }
  /** Devuelve el channexPropertyId configurado para el hotel (null si no sincronizó). */
  async getPropertyId(hotelId: string): Promise<string | null> {
    return (await this.getConfig(hotelId))?.channexPropertyId || null
  }
  async getChannelDetail(hotelId: string, channelId: string): Promise<any | null> {
    return this.channelApi.getChannelDetail(await this.getConfig(hotelId), channelId)
  }

  async getSyncLog(hotelId?: string): Promise<any[]> { return getSyncLogFromTable(this.syncLogRepo, hotelId) }

  /** Etapa 2 — empuja las tarifas por temporada a Channex (todos los planes del hotel). getPricingMode: per_person → OBP (#404). */
  async pushSeasonalRates(hotelId: string, channel?: string): Promise<PushRatesResultDTO> {
    return pushSeasonalRatesToChannex({
      getConfig: (h) => this.getConfig(h), findMany: (m, q) => this.queries.findMany(m, q),
      getPricingMode: (h) => readPricingMode((m, q) => this.queries.findMany(m, q), h),
      pushSeasonalRates: (c, r, s, a, mode, plans, restrictions) => this.channex.pushSeasonalRates(c, r, s, a, mode, plans, restrictions),
    }, hotelId, channel)
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
