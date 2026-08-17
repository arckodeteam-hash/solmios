// mantenimiento/service.ts — Facade del módulo. CRUD + delegación a usecases.
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  MantenimientoDTO, CreateMantenimientoDTO, UpdateMantenimientoDTO,
  MantenimientoQuery, MantenimientoPaginated,
  MaintenanceAuditDTO, MaintenanceProviderDTO,
} from './types'
import type { MantenimientoSockets } from './sockets'
import type { StorageService, FileUpload } from 'arckode-framework/modules/storage'
import { TimingsUseCase } from './usecases/timings'
import { AuditUseCase } from './usecases/audit'
import { PhotosUseCase } from './usecases/photos'
import { StatsUseCase } from './usecases/stats'
import { ListUseCase } from './usecases/list'
import { CrudUseCase } from './usecases/crud'
import { ProvidersUseCase } from './usecases/providers'
import { findOwnedTicket } from './helpers'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'

type User = { id: string; role: string; hotelId?: string }

export class MantenimientoService {
  private sockets: MantenimientoSockets = {}
  // Audit log GLOBAL del sistema. NO confundir con `audit` (AuditUseCase): ese es el historial
  // interno del ticket (tabla maintenance_audit) y muere junto con el ticket al borrarlo.
  private auditPort: AuditPort | null = null
  private readonly timings: TimingsUseCase
  private readonly audit: AuditUseCase
  private readonly photos: PhotosUseCase
  private readonly statsUc: StatsUseCase
  private readonly listUc: ListUseCase
  private readonly crud: CrudUseCase
  private readonly providers: ProvidersUseCase

  constructor(
    private readonly repo: RepositoryAdapter<MantenimientoDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly auth: Auth,
    private readonly auditRepo: RepositoryAdapter<MaintenanceAuditDTO>,
    storage?: StorageService,
    /** Catálogo de servicios externos (plomero, electricista…). */
    providerRepo?: RepositoryAdapter<MaintenanceProviderDTO>,
  ) {
    this.timings = new TimingsUseCase(
      repo,
      (item) => this.sockets.onMantenimientoUpdated?.(item) ?? Promise.resolve(),
      (hotelId) => this.listUc.invalidate(hotelId),
    )
    this.audit = new AuditUseCase(auditRepo, repo, logger)
    this.photos = new PhotosUseCase(
      repo, logger,
      (hotelId) => this.listUc.invalidate(hotelId),
      storage,
    )
    this.statsUc = new StatsUseCase(repo)
    this.listUc = new ListUseCase(repo, cache, userRepo)
    this.crud = new CrudUseCase(repo, this.audit, {
      onCreated: (i) => this.sockets.onMantenimientoCreated?.(i) ?? Promise.resolve(),
      onUpdated: (i) => this.sockets.onMantenimientoUpdated?.(i) ?? Promise.resolve(),
      onDeleted: (id) => this.sockets.onMantenimientoDeleted?.(id) ?? Promise.resolve(),
      onAssigned: (i) => this.sockets.onMantenimientoAssigned?.(i) ?? Promise.resolve(),
      invalidate: (h) => this.listUc.invalidate(h),
      // Un ticket no se asigna a un técnico/proveedor que no exista o sea de otro hotel (#392).
      // Solo se valida el que viene con valor: '' (desasignar) no dispara chequeo.
      validateAssignee: async (a, hotelId) => {
        if (a.assignedTo) {
          const u = await userRepo.findOne({ id: a.assignedTo, hotelId })
          if (!u) throw new ValidationError('El técnico asignado no pertenece a este hotel')
        }
        if (a.providerId && providerRepo) {
          const p = await providerRepo.findOne({ id: a.providerId, hotelId })
          if (!p) throw new ValidationError('El proveedor asignado no pertenece a este hotel')
        }
      },
      auditDelete: (existing, user, id) =>
        auditSafely(this.auditPort, this.logger, {
          hotelId: existing.hotelId, userId: user.id, action: 'maintenance.delete',
          entity: 'maintenance_order', entityId: id,
          detail: `Ticket "${existing.title}" (${existing.status ?? 'sin estado'}) eliminado · Hab. ${existing.roomNumber ?? '—'}`,
        }),
    })
    this.providers = new ProvidersUseCase(providerRepo as RepositoryAdapter<MaintenanceProviderDTO>)
  }

  /** Conecta el audit log. Lo inyecta el connector `mantenimiento-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  setSockets(s: Partial<MantenimientoSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  private assertOrderAccess(id: string, user: User): Promise<MantenimientoDTO> {
    return findOwnedTicket(this.repo, id, user)
  }

  // ─── CRUD (delegado: el gate rechaza un service > 200 líneas) ──────────
  async list(query: MantenimientoQuery, u: User): Promise<MantenimientoPaginated> { return this.listUc.list(query, u) }
  async getById(id: string, u: User): Promise<MantenimientoDTO> { return this.assertOrderAccess(id, u) }
  async create(dto: CreateMantenimientoDTO, u: User): Promise<MantenimientoDTO> { return this.crud.create(dto, u) }
  async update(id: string, dto: UpdateMantenimientoDTO, u: User): Promise<MantenimientoDTO> { return this.crud.update(id, dto, u) }
  async delete(id: string, u: User): Promise<void> { return this.crud.delete(id, u) }

  /**
   * Tickets abiertos desde una tarea de limpieza. Lo usa el conector
   * `housekeeping-mantenimiento` para no abrir dos veces el mismo reporte.
   */
  async findBySourceTask(hotelId: string, sourceTaskId: string): Promise<MantenimientoDTO[]> {
    if (!hotelId || !sourceTaskId) return []
    return this.repo.findMany({ hotelId, sourceTaskId })
  }

  // ─── Servicios externos (proveedores) ─────────────────
  async listProviders(u: User, includeInactive = false) { return this.providers.list(u, { includeInactive }) }
  async createProvider(dto: Partial<MaintenanceProviderDTO>, u: User) { return this.providers.create(dto, u) }
  async updateProvider(id: string, dto: Partial<MaintenanceProviderDTO>, u: User) { return this.providers.update(id, dto, u) }
  async removeProvider(id: string, u: User) { return this.providers.remove(id, u) }

  // ─── Timer ────────────────────────────────────────────
  async start(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<MantenimientoDTO> {
    const item = await this.timings.start(id, currentUser)
    await this.audit.log(id, item.hotelId, currentUser.id, 'status_change', 'open', 'in_progress')
    return item
  }

  async complete(id: string, currentUser: { id: string; role: string; hotelId?: string }, notes?: string): Promise<MantenimientoDTO> {
    const existing = await this.assertOrderAccess(id, currentUser)
    const item = await this.timings.complete(id, currentUser, notes)
    await this.audit.log(id, item.hotelId, currentUser.id, 'status_change', existing.status, 'closed')
    if (notes) await this.audit.log(id, item.hotelId, currentUser.id, 'notes_added', null, notes)
    return item
  }

  // ─── Notes ────────────────────────────────────────────
  async addNotes(id: string, notes: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<MantenimientoDTO> {
    const existing = await this.assertOrderAccess(id, currentUser)
    const item = await this.repo.update(id, { notes } as any)
    if (!item) throw new NotFoundError('Ticket de mantenimiento no encontrado')
    await this.audit.log(id, existing.hotelId, currentUser.id, 'notes_added', existing.notes ?? null, notes)
    await this.sockets.onMantenimientoUpdated?.(item)
    await this.listUc.invalidate(existing.hotelId)
    return item
  }

  // ─── Photos ───────────────────────────────────────────
  async addPhoto(id: string, file: FileUpload, type: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<MantenimientoDTO> {
    const item = await this.photos.add(id, file, type, currentUser)
    await this.audit.log(id, item.hotelId, currentUser.id, 'photo_added', null, type)
    return item
  }

  async removePhoto(id: string, photoUrl: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<MantenimientoDTO> {
    const item = await this.photos.remove(id, photoUrl, currentUser)
    await this.audit.log(id, item.hotelId, currentUser.id, 'photo_removed', photoUrl, null)
    return item
  }

  // ─── Audit ────────────────────────────────────────────
  async getAuditHistory(orderId: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<MaintenanceAuditDTO[]> {
    return this.audit.getHistory(orderId, currentUser)
  }

  // ─── Stats ────────────────────────────────────────────
  async getStats(hotelId: string) {
    return this.statsUc.getStats(hotelId)
  }

  /** Productividad por técnico para el motor de evaluación #321 (connector empleados-mantenimiento). */
  async getStaffStats(hotelId: string, from: string, to: string) {
    return this.statsUc.getStaffStats(hotelId, from, to)
  }
}
