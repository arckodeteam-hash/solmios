import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError } from 'arckode-framework'
import type { AnunciosDTO, CreateAnunciosDTO, UpdateAnunciosDTO, AnunciosQuery, AnunciosPaginated } from './types'
import type { AnunciosSockets } from './sockets'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'

const CACHE_TTL = 300

/**
 * Lectura de UN aviso por UN usuario — fila de `announcement_reads`. El par
 * (announcementId, userId) es único (índice de migrate-db.ts): un aviso se lee y se
 * cierra por persona, no por hotel. Ver `AnnouncementReadsModel`.
 */
export interface AnnouncementReadDTO {
  id: string
  hotelId?: string
  userId: string
  announcementId: string
  /** ISO del PRIMER visto del usuario; null hasta que el banner lo marca. */
  seenAt?: string | null
  /** ISO del ✕ del usuario; null hasta que lo cierra. */
  dismissedAt?: string | null
}

/** Un anuncio del listado con su conteo de lecturas reales (sólo el panel de plataforma lo pide). */
export type AnnouncementWithReads = AnunciosDTO & { reads?: number }

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
    private readonly readsRepo: RepositoryAdapter<AnnouncementReadDTO>,
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

    const hotelId = await this.resolveHotelId(currentUser)

    if (currentUser.role !== 'super_admin') {
      if (!hotelId) throw new AuthError('No hotel assigned')
      filters.hotelId = hotelId
    } else if (query.hotelId) {
      filters.hotelId = query.hotelId
    }

    const page = Math.max(query.page || 1, 1)
    const limit = Math.min(Math.max(query.limit || 20, 1), 100)
    const offset = (page - 1) * limit

    // BUG FIX: la key omitía page/limit/filtros → la primera query puebla la clave y todas las demás
    // combinaciones recibían esa misma respuesta por CACHE_TTL (mismo bug que opiniones).
    const filterKey = JSON.stringify(filters)
    const cacheKey = `anuncios:list:${hotelId || 'all'}:p${page}:l${limit}:${filterKey}`
    const cached = await this.cache.get(cacheKey)
    let response: AnunciosPaginated
    if (cached) {
      response = cached as AnunciosPaginated
    } else {
      const result = await this.repo.paginate(filters, { offset, limit })
      response = { data: result.data, total: result.total, page, limit, pages: Math.ceil(result.total / limit) }
      await this.cache.set(cacheKey, response, CACHE_TTL)
    }
    // La vista por usuario va SIEMPRE después del cache: la página cacheada es la del hotel
    // (compartida), lo que cada usuario deja de ver es sólo suyo y no se cachea.
    return this.applyUserView(response, currentUser, hotelId)
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

  // ==================== lecturas por usuario (ANN-4) ====================

  /**
   * Marca el aviso como VISTO por ESTE usuario. Idempotente: el banner la llama en cada
   * render, pero el par (announcementId, userId) tiene UNA fila y `seenAt` conserva el
   * momento de la PRIMERA llamada — repetir no lo pisa ni duplica.
   */
  async markSeen(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<void> {
    const hotelId = await this.resolveHotelId(currentUser)
    const ann = await this.visibleAnnouncementOrThrow(id, currentUser, hotelId)
    await this.upsertRead(ann, currentUser, hotelId, { seenAt: new Date().toISOString() })
  }

  /**
   * El ✕ del banner: ESTE usuario deja de ver el aviso, el resto del hotel lo sigue viendo.
   * Setea `dismissedAt` del par (announcementId, userId) SIN tocar `seenAt`. Idempotente.
   */
  async dismiss(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<void> {
    const hotelId = await this.resolveHotelId(currentUser)
    const ann = await this.visibleAnnouncementOrThrow(id, currentUser, hotelId)
    await this.upsertRead(ann, currentUser, hotelId, { dismissedAt: new Date().toISOString() })
  }

  /** hotelId del usuario: del token y, si no está, de la base (mismo criterio en todo el módulo). */
  private async resolveHotelId(currentUser: { id: string; role: string; hotelId?: string }): Promise<string | undefined> {
    if (currentUser.hotelId) return currentUser.hotelId
    if (currentUser.role === 'super_admin') return undefined
    const user = await this.userRepo.findById(currentUser.id)
    return user?.hotelId
  }

  /**
   * Un seen/dismiss sólo se registra sobre un aviso que existe y es visible para el hotel
   * del usuario (mismo criterio que `getById`): si no, NotFoundError/AuthError y ninguna
   * fila huérfana en announcement_reads.
   */
  private async visibleAnnouncementOrThrow(
    id: string,
    currentUser: { id: string; role: string; hotelId?: string },
    hotelId?: string,
  ): Promise<AnunciosDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Anuncio no encontrado')
    if (currentUser.role !== 'super_admin' && item.hotelId !== hotelId) {
      throw new AuthError('No autorizado')
    }
    return item
  }

  /**
   * Upsert de la fila de lectura por (announcementId, userId), select-then-create como
   * `markTeamRead`. Sólo escribe la marca que falta: la que ya está no se pisa (`seenAt`
   * conserva el primer visto) y ninguna borra a la otra (dismiss no toca `seenAt`).
   */
  private async upsertRead(
    announcement: AnunciosDTO,
    currentUser: { id: string; role: string; hotelId?: string },
    hotelId: string | undefined,
    mark: { seenAt?: string; dismissedAt?: string },
  ): Promise<void> {
    const announcementId = announcement.id
    const [existing] = await this.readsRepo.findMany({ announcementId, userId: currentUser.id })
    if (existing) {
      const patch: Partial<AnnouncementReadDTO> = {}
      if (mark.seenAt && !existing.seenAt) patch.seenAt = mark.seenAt
      if (mark.dismissedAt && !existing.dismissedAt) patch.dismissedAt = mark.dismissedAt
      if (Object.keys(patch).length === 0) return
      await this.readsRepo.update(existing.id, patch as any)
      return
    }
    try {
      await this.readsRepo.create({
        // Contexto de hotel de la lectura: el del usuario y, si no tiene (super_admin),
        // el del propio aviso.
        hotelId: hotelId ?? announcement.hotelId ?? '',
        userId: currentUser.id,
        announcementId,
        ...mark,
      } as any)
    } catch (e) {
      // Carrera perdida: otro request del mismo par insertó primero y el UNIQUE
      // (announcementId, userId) nos rechazó. La lectura ya está registrada —
      // idempotente, no error. Si la fila no está, el fallo era real: propagar.
      const [raced] = await this.readsRepo.findMany({ announcementId, userId: currentUser.id })
      if (!raced) throw e
    }
  }

  /**
   * Vista por usuario de la página del listado (ANN-4), aplicada DESPUÉS del cache:
   *
   * - Usuario del hotel (el banner): sin los avisos que ÉL descartó — el resto del hotel
   *   los sigue viendo igual, por eso el filtro no va en la key del cache compartido.
   * - super_admin (panel de plataforma): ve TODOS, incluso los que él mismo cerró, y cada
   *   aviso con `reads` = lecturas reales (COUNT de announcement_reads por anuncio).
   */
  private async applyUserView(
    page: AnunciosPaginated,
    currentUser: { id: string; role: string; hotelId?: string },
    hotelId?: string,
  ): Promise<AnunciosPaginated> {
    if (currentUser.role === 'super_admin') {
      const data: AnnouncementWithReads[] = await Promise.all(page.data.map(async (a) => ({
        ...a,
        reads: await this.readsRepo.count({ announcementId: a.id }),
      })))
      return { ...page, data }
    }
    const mine = await this.readsRepo.findMany({ userId: currentUser.id, hotelId })
    const dismissed = new Set(mine.filter((r) => r.dismissedAt).map((r) => r.announcementId))
    if (dismissed.size === 0) return page
    const data = page.data.filter((a) => !dismissed.has(a.id))
    // El total es el de la página compartida menos lo que ESTA página le ocultó a este usuario.
    return { ...page, data, total: Math.max(page.total - (page.data.length - data.length), 0) }
  }
}
