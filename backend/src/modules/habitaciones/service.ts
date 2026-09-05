import type { RepositoryAdapter, Logger, CacheAdapter, Auth, ORM } from 'arckode-framework'
import { NotFoundError, AuthError, ConflictError } from 'arckode-framework'
import type { HabitacionesDTO, CreateHabitacionesDTO, UpdateHabitacionesDTO, HabitacionesQuery, HabitacionesPaginated } from './types'
import type { HabitacionesSockets } from './sockets'
import { batchCreateRooms, type BatchCreateInput } from './usecases/batch-create'
import { listCacheKey, bumpListVersion } from './usecases/cache'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import { annotateRoomsAvailability, type ReservationsListPort } from '../../shared/usecases/habitaciones-availability'

export type { BatchCreateInput }

export class HabitacionesService {
  private sockets: HabitacionesSockets = {}
  private auditPort: AuditPort | null = null
  private availabilityPort: ReservationsListPort | null = null

  /** Conecta el audit log. Lo inyecta el connector `habitaciones-auditlog`. */
  setAuditDeps(port: AuditPort): void {
    this.auditPort = port
  }

  /**
   * Conecta el módulo `reservas` para poder anotar disponibilidad por fecha en `list()` (#648).
   * Lo inyecta el connector `habitaciones-reservas`. Sin este puerto wireado, `checkIn`/`checkOut`
   * en la query se ignoran silenciosamente (mismo comportamiento que hoy) — no rompe nada, solo
   * no anota disponibilidad (p.ej. en tests que instancian el service sin connectors).
   */
  setAvailabilityDeps(port: ReservationsListPort): void {
    this.availabilityPort = port
  }

  constructor(
    private readonly repo: RepositoryAdapter<HabitacionesDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly auth: Auth,
    private readonly orm?: ORM,
  ) {}

  setSockets(s: Partial<HabitacionesSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  async list(query: HabitacionesQuery, currentUser: { id: string; role: string; hotelId?: string }): Promise<HabitacionesPaginated> {
    const filters: Record<string, unknown> = {}
    if (query.status) filters.status = query.status
    if (query.type) filters.type = query.type

    // Multi-tenancy
    // Resolve hotelId from DB if not provided in token
    let hotelId = currentUser.hotelId
    if (!hotelId && currentUser.role !== 'super_admin') {
      const user = await this.userRepo.findById(currentUser.id)
      hotelId = user?.hotelId
    }

    if (currentUser.role !== 'super_admin') {
      if (!hotelId) throw new AuthError('No hotel assigned')
      filters.hotelId = hotelId
    } else if (query.hotelId) {
      filters.hotelId = query.hotelId
    }

    const page = Math.max(query.page || 1, 1)
    const limit = Math.min(Math.max(query.limit || 20, 1), 100)
    const offset = (page - 1) * limit

    // #648 — disponibilidad por rango de fechas. Rama SEPARADA y SIN CACHE a propósito: la
    // disponibilidad depende de las reservas de cada cuarto, y el cache de este listado solo se
    // invalida al crear/editar/borrar HABITACIONES (`bumpListVersion`), nunca al crear una
    // reserva — cachearla reintroduciría el bug (mostrar como libre un cuarto recién reservado).
    // Cuando `checkIn`/`checkOut` NO vienen, el comportamiento es IDÉNTICO al de antes (no rompe
    // housekeeping/mantenimiento/otros consumidores que llaman a este mismo endpoint sin fechas).
    if (query.checkIn && query.checkOut) {
      const result = query.search
        ? await this.repo.paginate({ ...filters, number: { $like: `%${query.search}%` } }, { offset, limit })
        : await this.repo.paginate(filters, { offset, limit })
      const data = this.availabilityPort
        ? await annotateRoomsAvailability(this.availabilityPort, { id: currentUser.id, role: currentUser.role, hotelId }, result.data, query.checkIn, query.checkOut)
        : result.data
      return { data, total: result.total, page, limit, pages: Math.ceil(result.total / limit) }
    }

    // Clave VERSIONADA: `cache.delete` solo borra claves exactas, así que la
    // invalidación se hace bumpeando la versión (ver usecases/cache.ts).
    const cacheKey = await listCacheKey(this.cache, hotelId, {
      page, limit, status: query.status, type: query.type, search: query.search,
    })
    const cached = await this.cache.get(cacheKey)
    if (cached) return cached as HabitacionesPaginated

    let result
    if (query.search) {
      // For search, add number filter and use paginate
      filters.number = { $like: `%${query.search}%` }
      result = await this.repo.paginate(filters, { offset, limit })
    } else {
      result = await this.repo.paginate(filters, { offset, limit })
    }

    const response = { data: result.data, total: result.total, page, limit, pages: Math.ceil(result.total / limit) }
    await this.cache.set(cacheKey, response, 300)
    return response
  }

  async getById(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<HabitacionesDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Habitación no encontrada')
    if (currentUser.role !== 'super_admin' && item.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    return item
  }

  async create(dto: CreateHabitacionesDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<HabitacionesDTO> {
    if (currentUser.role !== 'super_admin' && dto.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado para crear en otro hotel')
    }
    const item = await this.repo.create(dto as any)
    await this.sockets.onHabitacionesCreated?.(item)
    await bumpListVersion(this.cache, dto.hotelId)
    return item
  }

  async update(id: string, dto: UpdateHabitacionesDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<HabitacionesDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Habitación no encontrada')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const item = await this.repo.update(id, dto as any)
    if (!item) throw new NotFoundError('Habitación no encontrada')
    await this.sockets.onHabitacionesUpdated?.(item)
    await bumpListVersion(this.cache, existing.hotelId)
    return item
  }

  async batchCreate(input: BatchCreateInput, currentUser: { id: string; role: string; hotelId?: string }): Promise<HabitacionesDTO[]> {
    return batchCreateRooms(
      {
        repo: this.repo,
        logger: this.logger,
        cache: this.cache,
        orm: this.orm,
        onCreated: (item) => this.sockets.onHabitacionesCreated?.(item),
      },
      input,
      currentUser,
    )
  }

  async delete(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Habitación no encontrada')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    // ─── A-1 (auditoría 2026-08-19): integridad referencial del delete ──────────────────
    // El ORM crea las tablas SIN FKs físicos y borra con DELETE FROM crudo: sin este guard,
    // borrar dejaba reservas activas, cerraduras TTLock, blocks y amenities apuntando a una
    // habitación inexistente (planning/detalle/checkout rompían silenciosamente). Acceso por
    // nombre de modelo global (patrón bookingengine — this.orm ya estaba cableado para la
    // transacción de batch). Sin orm (tests mínimos) el delete sigue como antes.
    if (this.orm) {
      const reservas = (await this.orm.findMany('Reservations', { roomId: id })) as any[]
      const activas = reservas.filter((r) => !['cancelled', 'no_show', 'checked_out'].includes(String(r.status)))
      if (activas.length > 0) {
        throw new ConflictError(`No se puede eliminar: la habitación tiene ${activas.length} reserva(s) activa(s). Cancelá o mové las reservas primero (el historial pasado no bloquea).`)
      }
      const locks = (await this.orm.findMany('LockDevices', { roomId: id })) as any[]
      if (locks.length > 0) {
        throw new ConflictError('No se puede eliminar: hay cerraduras TTLock vinculadas a esta habitación. Desvinculalas primero desde la vista de cerraduras.')
      }
      // Referencias muertas sin valor (bloqueos y amenities de un cuarto que ya no existe).
      await this.orm.deleteMany('RoomBlocks', { roomId: id }).catch(() => 0)
      await this.orm.deleteMany('RoomAmenities', { roomId: id }).catch(() => 0)
    }
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Habitación no encontrada')
    await this.sockets.onHabitacionesDeleted?.(id, { hotelId: existing.hotelId, type: existing.type })
    await bumpListVersion(this.cache, existing.hotelId)
    await auditSafely(this.auditPort, this.logger, {
      hotelId: existing.hotelId, userId: currentUser.id, action: 'room.delete',
      entity: 'room', entityId: id,
      detail: `Habitación "${existing.number}"${existing.name ? ` (${existing.name})` : ''} eliminada`,
    })
  }
}
