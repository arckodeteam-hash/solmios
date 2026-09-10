import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError, ForbiddenError, ValidationError } from 'arckode-framework'
import type { AnunciosDTO, CreateAnunciosDTO, UpdateAnunciosDTO, AnunciosQuery, AnunciosPaginated, AnunciosScope } from './types'
import type { AnunciosSockets } from './sockets'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import { ADMIN_ROLES, isVisibleFor } from '../../shared/usecases/announcement-visibility'
import { listVisibleAnuncios } from './usecases/list-visible'
import { resolveAudience, assertWindow } from './usecases/audience'
import * as reads from './usecases/announcement-reads'
import { anunciosListCacheKey, invalidateAnunciosCaches } from './usecases/cache'

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

  async list(query: AnunciosQuery, currentUser: reads.CurrentUser): Promise<AnunciosPaginated> {
    const isSuper = currentUser.role === 'super_admin'
    const hotelId = await reads.resolveHotelId(this.readsDeps, currentUser)
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

    // La clave lleva filtros, paginación y el token de VERSIÓN del caché (#160). Además del hotel,
    // el resultado depende de si el rol recibe la audiencia `admins` y del scope: dos usuarios del
    // mismo hotel con distinto rol NO pueden compartir entrada.
    const listHotel = isSuper ? query.hotelId : hotelId
    const cacheKey = await anunciosListCacheKey(this.cache, listHotel, {
      filters: { ...base, scope, tier: ADMIN_ROLES.has(currentUser.role) ? 'admins' : 'all' },
      page,
      limit,
    })
    const cached = await this.cache.get(cacheKey)
    let response: AnunciosPaginated
    if (cached) {
      response = cached as AnunciosPaginated
    } else {
      response = await listVisibleAnuncios(this.repo, base, {
        isSuper, hotelId, queryHotelId: query.hotelId, role: currentUser.role, scope, page, limit,
      })
      await this.cache.set(cacheKey, response, CACHE_TTL)
    }
    // La vista por usuario va SIEMPRE después del cache: la página cacheada es la del hotel
    // (compartida), lo que cada usuario deja de ver es sólo suyo y no se cachea.
    return reads.applyUserView(this.readsDeps, response, currentUser, hotelId)
  }

  async getById(id: string, currentUser: reads.CurrentUser): Promise<AnunciosDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin') {
      const hotelId = await reads.resolveHotelId(this.readsDeps, currentUser)
      if (!isVisibleFor(item, { role: currentUser.role, hotelId })) throw new AuthError('No autorizado')
    }
    return item
  }

  async create(dto: CreateAnunciosDTO, currentUser: reads.CurrentUser): Promise<AnunciosDTO> {
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
    // Sin hotel = anuncio de plataforma: bumpea el token global y caen TODAS las listas.
    await invalidateAnunciosCaches(this.cache, item.hotelId ?? hotelId)
    return item
  }

  async update(id: string, dto: UpdateAnunciosDTO, currentUser: reads.CurrentUser): Promise<AnunciosDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    if (dto.audience && dto.audience !== 'hotel' && currentUser.role !== 'super_admin') {
      throw new ForbiddenError('Solo la plataforma puede publicar anuncios para varios hoteles')
    }
    // update no acepta hotelId, así que un anuncio de plataforma no puede volverse 'hotel' sin destino.
    if (dto.audience === 'hotel' && !existing.hotelId) throw new ValidationError('Un anuncio con audiencia "hotel" necesita hotelId')
    assertWindow({ startsAt: dto.startsAt ?? existing.startsAt, endsAt: dto.endsAt ?? existing.endsAt })

    // El hotel ANTERIOR se guarda antes de escribir: después del update, `existing` puede ser la
    // misma instancia que acaba de mutar y el hotel viejo ya no estaría por ningún lado — su
    // listado quedaría cacheado con un aviso que se mudó.
    const previousHotelId = existing.hotelId
    const item = await this.repo.update(id, dto as any)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    await this.sockets.onAnunciosUpdated?.(item)
    await invalidateAnunciosCaches(this.cache, previousHotelId)
    // Si el aviso cambió de hotel, la lista del destino también dejó de ser cierta.
    if (item.hotelId && item.hotelId !== previousHotelId) await invalidateAnunciosCaches(this.cache, item.hotelId)
    return item
  }

  async delete(id: string, currentUser: reads.CurrentUser): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Anuncio no encontrado')
    await this.sockets.onAnunciosDeleted?.(id)
    await invalidateAnunciosCaches(this.cache, existing.hotelId)
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
