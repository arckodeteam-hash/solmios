import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError, ValidationError } from 'arckode-framework'
import type { TicketsDTO, CreateTicketsDTO, UpdateTicketsDTO, TicketsQuery, TicketsPaginated } from './types'
import type { TicketsSockets } from './sockets'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import { enrichTickets } from './usecases/enrich'
import { buildAddMessage } from './usecases/add-message'
import { ticketsListCacheKey, invalidateTicketsCaches } from './usecases/cache'

const CACHE_TTL = 300

type CurrentUser = { id: string; role: string; hotelId?: string; userType?: string }

export class TicketsService {
  private sockets: TicketsSockets = {}
  private auditPort: AuditPort | null = null

  /** Conecta el audit log. Lo inyecta el connector `tickets-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  constructor(
    private readonly repo: RepositoryAdapter<TicketsDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly auth: Auth,
    private readonly hotelRepo: RepositoryAdapter<any>,
  ) {}

  setSockets(s: Partial<TicketsSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  async list(query: TicketsQuery, currentUser: CurrentUser): Promise<TicketsPaginated> {
    const filters: Record<string, unknown> = {}
    if (query.status) filters.status = query.status
    if (query.category) filters.category = query.category
    if (query.priority) filters.priority = query.priority
    if (query.userId) filters.userId = query.userId
    if (query.assignedTo) filters.assignedTo = query.assignedTo

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

    // REQ-SOP-05: clave versionada (filtros + paginación incluidos) — ver usecases/cache.ts.
    const cacheKey = await ticketsListCacheKey(this.cache, hotelId, { filters, page, limit })
    const cached = await this.cache.get(cacheKey)
    if (cached) return cached as TicketsPaginated

    const result = await this.repo.paginate(filters, { offset, limit })
    // REQ-SOP-01/03: solicitante/hotel/agente resueltos acá — el hotel no puede resolver por
    // su cuenta el nombre de un agente que pertenece a otro hotel/a la plataforma.
    const data = await enrichTickets(result.data, { userRepo: this.userRepo, hotelRepo: this.hotelRepo })
    const response = { data, total: result.total, page, limit, pages: Math.ceil(result.total / limit) }
    await this.cache.set(cacheKey, response, CACHE_TTL)
    return response
  }

  async getById(id: string, currentUser: CurrentUser): Promise<TicketsDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Ticket no encontrado')
    if (currentUser.role !== 'super_admin' && item.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const [enriched] = await enrichTickets([item], { userRepo: this.userRepo, hotelRepo: this.hotelRepo })
    return enriched
  }

  async create(dto: CreateTicketsDTO, currentUser: CurrentUser): Promise<TicketsDTO> {
    if (currentUser.role !== 'super_admin' && dto.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado para crear en otro hotel')
    }
    const item = await this.repo.create(dto as any)
    await this.sockets.onTicketsCreated?.(item)
    await invalidateTicketsCaches(this.cache, dto.hotelId)
    return item
  }

  async update(id: string, dto: UpdateTicketsDTO, currentUser: CurrentUser): Promise<TicketsDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Ticket no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    // REQ-SOP-03: asignar/reasignar un ticket (assignedTo) es exclusivo de la plataforma
    // (userType 'admin') — un merchant no puede asignarse tickets a sí mismo ni a otros.
    if (dto.assignedTo !== undefined && currentUser.userType !== 'admin') {
      throw new ValidationError('Solo el equipo de soporte puede asignar tickets')
    }
    const patch: UpdateTicketsDTO = { ...dto }
    // REQ-SOP-04: un admin que pasa el ticket a "en progreso" sin agente asignado se lo
    // auto-asigna. Si ya tiene agente (o el propio request ya trae assignedTo), no se toca.
    if (patch.status === 'in_progress' && currentUser.userType === 'admin' && !existing.assignedTo && !patch.assignedTo) {
      patch.assignedTo = currentUser.id
    }
    const item = await this.repo.update(id, patch as any)
    if (!item) throw new NotFoundError('Ticket no encontrado')
    await this.sockets.onTicketsUpdated?.(item)
    await invalidateTicketsCaches(this.cache, existing.hotelId)
    return item
  }

  /** REQ-SOP-02/03: agrega un mensaje con el autor resuelto por el server (nunca el del body). */
  async addMessage(id: string, rawMessage: string, currentUser: CurrentUser): Promise<TicketsDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Ticket no encontrado')

    // authorName es snapshot: se resuelve el nombre REAL acá, el JWT no lo trae.
    const actorUser = await this.userRepo.findById(currentUser.id)
    const { message, patch } = buildAddMessage(existing, rawMessage, {
      id: currentUser.id,
      name: actorUser?.name ?? '',
      role: currentUser.role,
      hotelId: currentUser.hotelId,
      userType: currentUser.userType,
    })

    const item = await this.repo.update(id, patch as any)
    if (!item) throw new NotFoundError('Ticket no encontrado')
    await this.sockets.onTicketsMessageAdded?.(item, message)
    await invalidateTicketsCaches(this.cache, existing.hotelId)
    const [enriched] = await enrichTickets([item], { userRepo: this.userRepo, hotelRepo: this.hotelRepo })
    return enriched
  }

  async delete(id: string, currentUser: CurrentUser): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Ticket no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Ticket no encontrado')
    await this.sockets.onTicketsDeleted?.(id)
    await invalidateTicketsCaches(this.cache, existing.hotelId)
    await auditSafely(this.auditPort, this.logger, {
      hotelId: existing.hotelId, userId: currentUser.id, action: 'ticket.delete',
      entity: 'ticket', entityId: id, detail: `Ticket "${existing.subject}" eliminado`,
    })
  }
}
