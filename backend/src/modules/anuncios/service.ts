import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError } from 'arckode-framework'
import type { AnunciosDTO, CreateAnunciosDTO, UpdateAnunciosDTO, AnunciosQuery, AnunciosPaginated } from './types'
import type { AnunciosSockets } from './sockets'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import * as reads from './usecases/announcement-reads'
import { canSeeAnnouncement, listForHotelAudience } from './usecases/announcement-audience'

// Las lecturas por usuario (ANN-4) viven en `usecases/announcement-reads.ts` desde que el service
// pasó las 200 líneas del gate. Los tipos se re-exportan para no romper a quien los importa de acá.
export type { AnnouncementReadDTO, AnnouncementWithReads } from './usecases/announcement-reads'

const CACHE_TTL = 300

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
    private readonly readsRepo: RepositoryAdapter<reads.AnnouncementReadDTO>,
    private readonly auth: Auth,
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

  async list(query: AnunciosQuery, currentUser: { id: string; role: string; hotelId?: string }): Promise<AnunciosPaginated> {
    const filters: Record<string, unknown> = {}
    if (query.type) filters.type = query.type
    if (query.priority) filters.priority = query.priority
    if (query.active !== undefined) filters.active = query.active

    const hotelId = await reads.resolveHotelId(this.readsDeps, currentUser)
    if (currentUser.role !== 'super_admin' && !hotelId) throw new AuthError('No hotel assigned')

    // Hotel de AUDIENCIA (ANN-1): el del usuario, o el que pide el super_admin por query.
    // NO va en `filters`: el ORM filtra por igualdad y dejaría afuera a los globales; la
    // mezcla hotel+global la hace `listForHotelAudience`. Sin hotel (super_admin) → todo.
    const audienceHotelId = currentUser.role === 'super_admin' ? query.hotelId : hotelId

    const page = Math.max(query.page || 1, 1)
    const limit = Math.min(Math.max(query.limit || 20, 1), 100)
    const offset = (page - 1) * limit

    // BUG FIX: la key omitía page/limit/filtros → la primera query puebla la clave y todas las demás
    // combinaciones recibían esa misma respuesta por CACHE_TTL (mismo bug que opiniones).
    const filterKey = JSON.stringify(filters)
    const cacheKey = `anuncios:list:${audienceHotelId || 'all'}:p${page}:l${limit}:${filterKey}`
    const cached = await this.cache.get(cacheKey)
    let response: AnunciosPaginated
    if (cached) {
      response = cached as AnunciosPaginated
    } else {
      const result = audienceHotelId
        ? await listForHotelAudience(this.repo, filters, audienceHotelId, { offset, limit })
        : await this.repo.paginate(filters, { offset, limit })
      response = { data: result.data, total: result.total, page, limit, pages: Math.ceil(result.total / limit) }
      await this.cache.set(cacheKey, response, CACHE_TTL)
    }
    // La vista por usuario va SIEMPRE después del cache: la página cacheada es la del hotel
    // (compartida), lo que cada usuario deja de ver es sólo suyo y no se cachea.
    return reads.applyUserView(this.readsDeps, response, currentUser, hotelId)
  }

  async getById(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<AnunciosDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    // Un global (sin hotel) se puede LEER desde cualquier hotel; escribirlo (update/delete) no.
    if (currentUser.role !== 'super_admin' && !canSeeAnnouncement(item, currentUser.hotelId)) {
      throw new AuthError('No autorizado')
    }
    return item
  }

  async create(dto: CreateAnunciosDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<AnunciosDTO> {
    if (currentUser.role !== 'super_admin' && dto.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado para crear en otro hotel')
    }
    // La fecha se pone acá, por parámetro, no por default de columna: el default
    // portable de "ahora" es este, no `DEFAULT datetime('now')` (SQLite-only, que
    // en Postgres guardaba el string literal). Ver CLAUDE.md, reglas de migración.
    const item = await this.repo.create({
      ...dto,
      date: dto.date ?? new Date().toISOString(),
    } as any)
    await this.sockets.onAnunciosCreated?.(item)
    await this.cache.delete(`anuncios:list:${dto.hotelId}`)
    return item
  }

  async update(id: string, dto: UpdateAnunciosDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<AnunciosDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const item = await this.repo.update(id, dto as any)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    await this.sockets.onAnunciosUpdated?.(item)
    await this.cache.delete(`anuncios:list:${existing.hotelId}`)
    return item
  }

  async delete(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Anuncio no encontrado')
    await this.sockets.onAnunciosDeleted?.(id)
    await this.cache.delete(`anuncios:list:${existing.hotelId}`)
    await auditSafely(this.auditPort, this.logger, {
      hotelId: existing.hotelId, userId: currentUser.id, action: 'announcement.delete',
      entity: 'announcement', entityId: id, detail: `Anuncio "${existing.title}" eliminado`,
    })
  }

  // ── Lecturas por usuario (ANN-4) — la lógica vive en `usecases/announcement-reads.ts` ──

  /** Deps de las lecturas: el usecase no conoce al service, sólo sus repos. */
  private get readsDeps(): reads.AnnouncementReadsDeps {
    return { repo: this.repo, readsRepo: this.readsRepo, userRepo: this.userRepo }
  }

  /** Marca el aviso como VISTO por ESTE usuario. Idempotente (ver el usecase). */
  markSeen(id: string, currentUser: reads.CurrentUser): Promise<void> { return reads.markSeen(this.readsDeps, id, currentUser) }

  /** El ✕ del banner: ESTE usuario deja de ver el aviso, el resto del hotel lo sigue viendo. */
  dismiss(id: string, currentUser: reads.CurrentUser): Promise<void> { return reads.dismiss(this.readsDeps, id, currentUser) }
}
