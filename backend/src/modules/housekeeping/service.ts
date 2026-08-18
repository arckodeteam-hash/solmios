// service.ts — Facade del módulo housekeeping. CRUD base acá; tiempos/fotos/stats en usecases/ (D2/D5).
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError, ValidationError } from 'arckode-framework'
import type { StorageService, FileUpload } from 'arckode-framework/modules/storage'
import type { HousekeepingDTO, CreateHousekeepingDTO, UpdateHousekeepingDTO, HousekeepingQuery, HousekeepingPaginated, StaffStats, StaffStatsQuery, HousekeepingUser } from './types'
import type { HousekeepingSockets } from './sockets'
import { bumpListVersion } from './usecases/cache'
import { ListUseCase } from './usecases/list'
import { CrudUseCase } from './usecases/crud'
import { withRoomInfo } from './usecases/room-info'
import { TimingsUseCase, assertTransition } from './usecases/timings'
import { PhotosUseCase } from './usecases/photos'
import { StatsUseCase } from './usecases/stats'
import { ApproveUseCase } from './usecases/approve'
import { ConfigListsUseCase } from './usecases/config-lists'
import { PhotoRequirementsUseCase } from './usecases/photo-requirements'
import { HousekeepingSettingsUseCase, type HousekeepingSettings, DEFAULT_MAX_VIDEO_SECONDS, DEFAULT_EVIDENCE_RETENTION_DAYS } from './usecases/settings'
import { getRoomLockCode } from './usecases/lock-code'
import { VideoUseCase, type VideoUploadTicket } from './usecases/video'
import { VideoTranscoder } from './usecases/transcode'
import type { S3StorageAdapter } from '../../infrastructure/storage/s3-adapter'
import { assertStaffExists } from './usecases/staff'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'

const CACHE_TTL = 300

/** Sin `configRepo` no hay settings del hotel: se responde el default de fábrica. */
const FALLBACK_SETTINGS: HousekeepingSettings = {
  requireSupervisorPhoto: false, completionEvidence: 'photos',
  maxVideoSeconds: DEFAULT_MAX_VIDEO_SECONDS, evidenceRetentionDays: DEFAULT_EVIDENCE_RETENTION_DAYS,
}

export class HousekeepingService {
  private sockets: HousekeepingSockets = {}
  private auditPort: AuditPort | null = null
  private readonly timings: TimingsUseCase
  private readonly photos: PhotosUseCase
  private readonly statsUc: StatsUseCase
  private readonly approveUc: ApproveUseCase
  private readonly configLists?: ConfigListsUseCase
  private readonly settingsUc?: HousekeepingSettingsUseCase
  /** Solo existe si hay settings (necesita leer el modo/duración del hotel). */
  private readonly videoUc?: VideoUseCase
  private readonly listUc: ListUseCase
  private readonly crud: CrudUseCase
  private readonly employeeRepo?: RepositoryAdapter<any>

  constructor(
    private readonly repo: RepositoryAdapter<HousekeepingDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly auth: Auth,
    employeeRepo?: RepositoryAdapter<any>,
    storage?: StorageService,
    photoReqRepo?: RepositoryAdapter<any>,
    supplyRepo?: RepositoryAdapter<any>,
    private readonly roomRepo?: RepositoryAdapter<any>,
    checklistRepo?: RepositoryAdapter<any>,
    configRepo?: RepositoryAdapter<any>,
    /** Adapter S3 (Backblaze). Sin él no hay modo video: la app sube directo al bucket con URL prefirmada. */
    videoStorage?: S3StorageAdapter,
    private readonly lockDeviceRepo?: RepositoryAdapter<any>,
    private readonly lockCodeRepo?: RepositoryAdapter<any>,
  ) {
    this.employeeRepo = employeeRepo
    if (configRepo) { // antes que `timings`: el cierre consulta el modo de evidencia
      this.settingsUc = new HousekeepingSettingsUseCase(configRepo)
      this.videoUc = new VideoUseCase(repo, this.settingsUc, videoStorage,
        videoStorage ? new VideoTranscoder(repo, videoStorage, logger) : undefined)
    }
    this.timings = new TimingsUseCase(
      repo,
      (item) => this.sockets.onHousekeepingUpdated?.(item) ?? Promise.resolve(),
      (h) => this.invalidateCache(h),
      this.employeeRepo,
      (item) => this.sockets.onTaskCompleted?.(item) ?? Promise.resolve(),
      this.settingsUc,
      photoReqRepo ? { listByRoomType: (h) => new PhotoRequirementsUseCase(photoReqRepo, logger).list(h) } : undefined, // gate de fotos (ver timings.ts)
      roomRepo,
    )
    this.crud = new CrudUseCase(
      repo,
      userRepo,
      {
        onCreated: (i) => this.sockets.onHousekeepingCreated?.(i) ?? Promise.resolve(),
        onUpdated: (i) => this.sockets.onHousekeepingUpdated?.(i) ?? Promise.resolve(),
        onDeleted: (id) => this.sockets.onHousekeepingDeleted?.(id) ?? Promise.resolve(),
        onAssigned: (i) => this.sockets.onTaskAssigned?.(i) ?? Promise.resolve(),
        invalidate: (h) => this.invalidateCache(h),
        audit: (existing, user, id) =>
          auditSafely(this.auditPort, this.logger, {
            hotelId: existing.hotelId, userId: user.id, action: 'housekeeping.delete',
            entity: 'housekeeping_task', entityId: id,
            detail: `Tarea de limpieza eliminada · habitación ${existing.roomId}` +
              `${existing.status ? ` · estado ${existing.status}` : ''}` +
              `${existing.staffId ? ` · asignada a ${existing.staffId}` : ''}`,
          }),
      },
      roomRepo,
    )
    this.photos = new PhotosUseCase(repo, logger, (h) => this.invalidateCache(h), storage)
    this.statsUc = new StatsUseCase(repo, cache, userRepo)
    this.listUc = new ListUseCase(repo, cache, userRepo, roomRepo)
    this.approveUc = new ApproveUseCase(repo)
    if (photoReqRepo && supplyRepo) {
      this.configLists = new ConfigListsUseCase(photoReqRepo, supplyRepo, logger, checklistRepo)
    }
  }
  /** Conecta el audit log. Lo inyecta el connector `housekeeping-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  setSockets(s: Partial<HousekeepingSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev
        ? async (...a: any[]) => {
            try { await prev(...a) } catch (e) { this.logger.error(`Socket chain error [${key}]`, e as any) }
            await h(...a)
          }
        : h
    }
  }

  async list(query: HousekeepingQuery, currentUser: HousekeepingUser): Promise<HousekeepingPaginated> {
    return this.listUc.list(query, currentUser)
  }

  // ─── Delegaciones a usecases ───────────────────────────────────────────────
  async getById(id: string, u: HousekeepingUser) { return this.crud.getById(id, u) }
  async create(dto: CreateHousekeepingDTO, u: HousekeepingUser) { return this.crud.create(dto, u) }
  async update(id: string, dto: UpdateHousekeepingDTO, u: HousekeepingUser) { return this.crud.update(id, dto, u) }
  async delete(id: string, u: HousekeepingUser) { return this.crud.delete(id, u) }

  async start(id: string, u: HousekeepingUser) { return this.timings.start(id, u) }
  async pause(id: string, u: HousekeepingUser) { return this.timings.pause(id, u) }
  async resume(id: string, u: HousekeepingUser) { return this.timings.resume(id, u) }
  async complete(id: string, u: HousekeepingUser) { return this.timings.complete(id, u) }
  async addPhoto(id: string, file: FileUpload, areaId: string, u: HousekeepingUser) { return this.photos.addPhoto(id, file, areaId, u) }
  async removePhoto(id: string, url: string, u: HousekeepingUser) { return this.photos.removePhoto(id, url, u) }
  async stats(q: StaffStatsQuery, u: HousekeepingUser) { return this.statsUc.stats(q, u) }
  /** Puerto de consulta para el motor de evaluación (#321). Lo lee el connector empleados-housekeeping. */
  async getStaffStats(hotelId: string, from: string, to: string) { return this.statsUc.aggregate(hotelId, from, to) }

  // ─── Aprobación y presencia ───────────────────────────────────────────────
  async approve(id: string, user: { id: string; role?: string; hotelId?: string }, note: string | undefined, rating: number) {
    const result = await this.approveUc.approve(id, user, note, rating)
    await this.sockets.onHousekeepingUpdated?.(result)
    await this.sockets.onTaskInspected?.(result)   // aprobada → el connector libera la habitación (#392)
    await this.invalidateCache(result.hotelId)
    return result
  }
  async reject(id: string, user: { id: string; role?: string; hotelId?: string }, note?: string) {
    const result = await this.approveUc.reject(id, user, note)
    await this.sockets.onHousekeepingUpdated?.(result)
    // La camarera tiene que enterarse de que su limpieza volvió.
    if (result.staffId) await this.sockets.onTaskAssigned?.(result)
    await this.invalidateCache(result.hotelId)
    return result
  }
  async markPresence(id: string, user: { id: string; role?: string; hotelId?: string }) { return this.approveUc.markPresence(id, user) }
  async reportIssue(id: string, desc: string, type: string, reporter: { id: string; hotelId?: string; role: string }) {
    return this.approveUc.reportIssue(id, desc, type, reporter, this.sockets.onIssueReported)
  }

  // ─── Config lists (photo requirements + supply lists) ─────────────────────
  async getPhotoRequirements(h: string, rt?: string) { return this.configLists?.getPhotoRequirements(h, rt) ?? [] }
  async upsertPhotoRequirements(h: string, items: any[]) { return this.configLists?.upsertPhotoRequirements(h, items) ?? [] }
  async getSupplyLists(h: string, rt?: string) { return this.configLists?.getSupplyLists(h, rt) ?? [] }
  async upsertSupplyLists(h: string, rt: string, items: any[]) { return this.configLists?.upsertSupplyLists(h, rt, items) ?? [] }
  async getChecklist(h: string, rt?: string) { return this.configLists?.getChecklist(h, rt) ?? [] }
  async upsertChecklist(h: string, rt: string, items: any[]) { return this.configLists?.upsertChecklist(h, rt, items) ?? [] }
  async getSettings(h: string): Promise<HousekeepingSettings> { return this.settingsUc?.get(h) ?? { ...FALLBACK_SETTINGS } }
  async updateSettings(h: string, patch: Partial<HousekeepingSettings>): Promise<HousekeepingSettings> { return this.settingsUc?.update(h, patch) ?? { ...FALLBACK_SETTINGS } }
  // ─── Evidencia en video ── los bytes NO pasan por acá: se firma un permiso y la app sube al bucket.
  private video(): VideoUseCase {
    if (!this.videoUc) throw new ValidationError('Evidencia en video no disponible en este servidor')
    return this.videoUc
  }
  private async afterVideo(r: HousekeepingDTO) { await this.sockets.onHousekeepingUpdated?.(r); await this.invalidateCache(r.hotelId); return r }
  async requestVideoUploadUrl(id: string, i: { contentType: string; durationSeconds: number }, u: HousekeepingUser): Promise<VideoUploadTicket> { return this.video().requestUploadUrl(id, i, u) }
  async attachVideo(id: string, i: { url: string; path: string; durationSeconds: number; mimeType: string }, u: HousekeepingUser) { return this.afterVideo(await this.video().attachVideo(id, i, u)) }
  async removeVideo(id: string, u: HousekeepingUser) { return this.afterVideo(await this.video().removeVideo(id, u)) }
  async getVideoViewUrl(id: string, u: HousekeepingUser) { return this.video().getViewUrl(id, u) }
  async getRoomLockCode(id: string, u: HousekeepingUser) { return getRoomLockCode(this.repo, this.auth, this.lockDeviceRepo, this.lockCodeRepo, id, u) }

  private async invalidateCache(hotelId?: string) {
    // `delete` de una clave exacta ya no alcanza: la clave del listado incluye
    // filtros y página. Se bumpea la versión y las entradas viejas se huerfanizan.
    await bumpListVersion(this.cache, hotelId)
    await this.statsUc.bumpVersion(hotelId)
  }

  async invalidateListCache(hotelId?: string) { return this.invalidateCache(hotelId) }
}
