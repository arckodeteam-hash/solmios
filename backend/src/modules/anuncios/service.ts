import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError } from 'arckode-framework'
import type { AnunciosDTO, CreateAnunciosDTO, UpdateAnunciosDTO, AnunciosQuery, AnunciosPaginated } from './types'
import type { AnunciosSockets } from './sockets'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import * as reads from './usecases/announcement-reads'
import { anunciosListCacheKey, invalidateAnunciosCaches } from './usecases/cache'
import { normalizeWindow, applyWindow, resolveScope, paginateInMemory } from './usecases/visibility-window'

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
    // 'all' (sin ventana de vigencia) es sólo para super_admin: AuthError si lo pide otro.
    const scope = resolveScope(query.scope, currentUser.role)
    const filters: Record<string, unknown> = {}
    if (query.type) filters.type = query.type
    if (query.priority) filters.priority = query.priority
    if (query.active !== undefined) filters.active = query.active

    const hotelId = await reads.resolveHotelId(this.readsDeps, currentUser)

    if (currentUser.role !== 'super_admin') {
      if (!hotelId) throw new AuthError('No hotel assigned')
      filters.hotelId = hotelId
    } else if (query.hotelId) {
      filters.hotelId = query.hotelId
    }

    const page = Math.max(query.page || 1, 1)
    const limit = Math.min(Math.max(query.limit || 20, 1), 100)

    // La clave lleva filtros, alcance, paginación y el token de VERSIÓN del caché (#160): sin la
    // versión no había forma de invalidar (CacheAdapter sólo borra claves exactas) y el listado
    // seguía viejo hasta 5 minutos después de publicar o borrar un aviso. Ver `usecases/cache.ts`.
    const cacheKey = await anunciosListCacheKey(this.cache, hotelId, { filters, page, limit, scope })
    let response: AnunciosPaginated
    if (scope === 'all') {
      // La página tal cual sale de la base: programados y vencidos incluidos (panel del super_admin).
      response = await this.cachedOr(cacheKey, async () => {
        const r = await this.repo.paginate(filters, { offset: (page - 1) * limit, limit })
        return { data: r.data, total: r.total, page, limit, pages: Math.ceil(r.total / limit) }
      })
    } else {
      // Vigencia (ANN-3): se cachea la lista CRUDA de la consulta y la ventana se aplica DESPUÉS
      // del cache, con el reloj de este request — si se cacheara ya filtrada, un aviso se
      // publicaría o vencería hasta 5 minutos tarde (el TTL). Y ANTES de paginar, porque total
      // y pages tienen que salir de las filas vigentes, no del COUNT de la tabla.
      const rows = await this.cachedOr(cacheKey, () => this.repo.findMany(filters))
      response = paginateInMemory(applyWindow(rows, new Date()), page, limit)
    }
    // La vista por usuario va SIEMPRE después del cache: la página cacheada es la del hotel
    // (compartida), lo que cada usuario deja de ver es sólo suyo y no se cachea.
    return reads.applyUserView(this.readsDeps, response, currentUser, hotelId)
  }

  /** Lo cacheado bajo `key`, o lo que devuelve `load` (guardado con el TTL del listado). */
  private async cachedOr<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.cache.get<T>(key)
    if (hit) return hit
    const value = await load()
    await this.cache.set(key, value, CACHE_TTL)
    return value
  }

  async getById(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<AnunciosDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && item.hotelId !== currentUser.hotelId) {
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
    // Vigencia (ANN-3): startsAt/endsAt normalizados a ISO (null si no vienen); endsAt <= startsAt → 400.
    const item = await this.repo.create({
      ...dto,
      ...normalizeWindow(dto),
      date: dto.date ?? new Date().toISOString(),
    } as any)
    await this.sockets.onAnunciosCreated?.(item)
    await invalidateAnunciosCaches(this.cache, item.hotelId ?? dto.hotelId)
    return item
  }

  async update(id: string, dto: UpdateAnunciosDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<AnunciosDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    // El hotel ANTERIOR se guarda antes de escribir: después del update, `existing` puede ser la
    // misma instancia que acaba de mutar y el hotel viejo ya no estaría por ningún lado — su
    // listado quedaría cacheado con un aviso que se mudó.
    const previousHotelId = existing.hotelId
    // La ventana se valida contra la fila actual: un body sin fechas conserva las que ya están.
    const item = await this.repo.update(id, { ...dto, ...normalizeWindow(dto, existing) } as any)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    await this.sockets.onAnunciosUpdated?.(item)
    await invalidateAnunciosCaches(this.cache, previousHotelId)
    // Si el aviso cambió de hotel, la lista del destino también dejó de ser cierta.
    if (item.hotelId && item.hotelId !== previousHotelId) await invalidateAnunciosCaches(this.cache, item.hotelId)
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
