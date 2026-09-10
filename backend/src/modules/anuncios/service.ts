import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError, ForbiddenError } from 'arckode-framework'
import type {
  AnunciosDTO, CreateAnunciosDTO, UpdateAnunciosDTO, AnunciosQuery, AnunciosPaginated,
  AnnouncementReadDTO, AnunciosScope,
} from './types'
import type { AnunciosSockets } from './sockets'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import { isVisibleFor } from '../../shared/usecases/announcement-visibility'
import { listVisibleAnuncios } from './usecases/list-visible'
import { resolveAudience, assertWindow } from './usecases/audience'
import { annotateReads, upsertRead, type ReadField } from './usecases/reads'
import { anunciosListCacheKey, invalidateAnunciosCaches } from './usecases/cache'

const CACHE_TTL = 300

/** Usuario del token, tal como lo deja `auth.authenticate()`. */
interface CurrentUser { id: string; role: string; hotelId?: string }

export class AnunciosService {
  private sockets: AnunciosSockets = {}
  private auditPort: AuditPort | null = null

  /** Conecta el audit log. Lo inyecta el connector `anuncios-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  constructor(
    private readonly repo: RepositoryAdapter<AnunciosDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly auth: Auth,
    /** Lecturas por usuario. Opcional para no romper a quien construya el service sin ella. */
    private readonly readsRepo?: RepositoryAdapter<AnnouncementReadDTO>,
  ) {}

  setSockets(s: Partial<AnunciosSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  /** Hotel del usuario, resolviéndolo contra la base si el token no lo trae. */
  private async resolveHotelId(currentUser: CurrentUser): Promise<string | undefined> {
    if (currentUser.hotelId) return currentUser.hotelId
    if (currentUser.role === 'super_admin') return undefined
    const user = await this.userRepo.findById(currentUser.id)
    return user?.hotelId
  }

  async list(query: AnunciosQuery, currentUser: CurrentUser): Promise<AnunciosPaginated> {
    const isSuper = currentUser.role === 'super_admin'
    const hotelId = await this.resolveHotelId(currentUser)
    if (!isSuper && !hotelId) throw new AuthError('No hotel assigned')

    // Ver lo programado y lo vencido es una vista de administración de la plataforma. Un hotel
    // recibe solo lo vigente: un anuncio con fecha futura no debe viajar a su navegador todavía.
    const scope: AnunciosScope = isSuper && query.scope === 'all' ? 'all' : 'active'

    const base: Record<string, unknown> = {}
    if (query.type) base.type = query.type
    if (query.priority) base.priority = query.priority
    if (query.active !== undefined) base.active = query.active

    const page = Math.max(query.page || 1, 1)
    const limit = Math.min(Math.max(query.limit || 20, 1), 100)

    const cacheKey = await anunciosListCacheKey(this.cache, {
      hotelId: isSuper ? (query.hotelId ?? null) : hotelId,
      role: currentUser.role,
      filters: base,
      scope,
      page,
      limit,
    })

    // También el cache hit pasa por `annotateReads`: la entrada cacheada es la parte COMÚN a
    // todos los usuarios del mismo rol y hotel, y `seen`/`dismissed` se le agregan encima a cada
    // uno. Devolverla tal cual sería servirle a una persona las marcas de otra.
    const cached = await this.cache.get(cacheKey)
    if (cached) return this.annotate(cached as AnunciosPaginated, currentUser)

    const response = await listVisibleAnuncios(this.repo, base, {
      isSuper, hotelId, queryHotelId: query.hotelId, role: currentUser.role, scope, page, limit,
    })
    await this.cache.set(cacheKey, response, CACHE_TTL)
    return this.annotate(response, currentUser)
  }

  private annotate(page: AnunciosPaginated, currentUser: CurrentUser): Promise<AnunciosPaginated> {
    return annotateReads(this.readsRepo, this.logger, page, currentUser.id)
  }

  async getById(id: string, currentUser: CurrentUser): Promise<AnunciosDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin') {
      const hotelId = await this.resolveHotelId(currentUser)
      if (!isVisibleFor(item, { role: currentUser.role, hotelId })) throw new AuthError('No autorizado')
    }
    return item
  }

  async create(dto: CreateAnunciosDTO, currentUser: CurrentUser): Promise<AnunciosDTO> {
    const { audience, hotelId } = resolveAudience(dto, currentUser)
    assertWindow(dto)

    // `active` y `date` se ponen acá y no se dejan al DEFAULT de la columna: el default es del
    // DDL, no del ORM, así que la fila queda bien en la base pero el objeto que se devuelve vuelve
    // sin el campo. (Y `DEFAULT datetime('now')` sería SQLite-only — ver CLAUDE.md.)
    const item = await this.repo.create({
      ...dto,
      audience,
      hotelId,
      active: dto.active ?? 1,
      date: dto.date ?? new Date().toISOString(),
    } as any)
    await this.sockets.onAnunciosCreated?.(item)
    await invalidateAnunciosCaches(this.cache)
    return item
  }

  async update(id: string, dto: UpdateAnunciosDTO, currentUser: CurrentUser): Promise<AnunciosDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    if (dto.audience && dto.audience !== 'hotel' && currentUser.role !== 'super_admin') {
      throw new ForbiddenError('Solo la plataforma puede publicar anuncios para varios hoteles')
    }
    assertWindow({ startsAt: dto.startsAt ?? existing.startsAt, endsAt: dto.endsAt ?? existing.endsAt })

    const item = await this.repo.update(id, dto as any)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    await this.sockets.onAnunciosUpdated?.(item)
    await invalidateAnunciosCaches(this.cache)
    return item
  }

  async delete(id: string, currentUser: CurrentUser): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Anuncio no encontrado')
    await this.sockets.onAnunciosDeleted?.(id)
    await invalidateAnunciosCaches(this.cache)
    await auditSafely(this.auditPort, this.logger, {
      hotelId: existing.hotelId, userId: currentUser.id, action: 'announcement.delete',
      entity: 'announcement', entityId: id, detail: `Anuncio "${existing.title}" eliminado`,
    })
  }

  /** Marca el anuncio como visto por ESTE usuario. */
  markSeen(id: string, currentUser: CurrentUser): Promise<AnnouncementReadDTO | null> {
    return this.mark(id, currentUser, 'seenAt')
  }

  /** Marca el anuncio como cerrado por ESTE usuario. No lo oculta para sus compañeros. */
  markDismissed(id: string, currentUser: CurrentUser): Promise<AnnouncementReadDTO | null> {
    return this.mark(id, currentUser, 'dismissedAt')
  }

  private async mark(id: string, currentUser: CurrentUser, field: ReadField): Promise<AnnouncementReadDTO | null> {
    if (!this.readsRepo) return null
    const hotelId = await this.resolveHotelId(currentUser)
    return upsertRead(
      { readsRepo: this.readsRepo, anunciosRepo: this.repo },
      id,
      { id: currentUser.id, hotelId },
      field,
    )
  }
}
