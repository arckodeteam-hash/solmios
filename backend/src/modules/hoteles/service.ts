// hoteles/service.ts — Facade pública del módulo
// Responsabilidad ÚNICA: casos de uso del módulo.
// NO sabe de HTTP. NO importa de otros módulos.
// Recibe dependencias por constructor (Dependency Inversion).
//
// Si este archivo supera 200 líneas → extraer casos de uso a ./usecases/{caso}.ts
// y dejar acá solo el orquestador que delega.
//
// IMPORTANTE: depende de RepositoryAdapter<HotelesDTO>, no del ORM directamente.
// Esto permite swapear SQL → MongoDB → Prisma en composition-root.ts sin tocar este archivo.

import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError } from 'arckode-framework'
import type { HotelesDTO, CreateHotelesDTO, UpdateHotelesDTO, HotelesQuery, HotelesPaginated } from './types'
import type { HotelesSockets } from './sockets'
import type { SettingsFullUseCase } from './usecases/settings-full'
import type { HotelesQueries } from './usecases/hoteles-queries'
import { assertCancellationCompatible } from './usecases/hoteles-queries'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'

function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

export class HotelesService {
  private sockets: HotelesSockets = {}
  private auditPort: AuditPort | null = null

  /** Conecta el audit log. Lo inyecta el connector `hoteles-auditlog`. */
  setAuditDeps(port: AuditPort): void {
    this.auditPort = port
  }

  constructor(
    private readonly repo: RepositoryAdapter<HotelesDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
    private readonly settingsFull?: SettingsFullUseCase,
    private readonly queries?: HotelesQueries,
  ) {}

  // ACUMULA handlers — nunca pisa el anterior.
  // Si dos conectores registran el mismo evento, ambos corren en cadena (secuencial).
  // Para ejecución paralela independiente → usar EventBus en composition-root.ts.
  setSockets(s: Partial<HotelesSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  async list(query: HotelesQuery, currentUser: { id: string; role: string; hotelId?: string }): Promise<HotelesPaginated> {
    const filters: Record<string, unknown> = {}
    if (query.status) filters.status = query.status

    // Multi-tenancy: non-super_admin only sees their hotel
    if (currentUser.role !== 'super_admin') {
      if (!currentUser.hotelId) throw new AuthError('No hotel assigned')
      filters.id = currentUser.hotelId
    }

    const page = Math.max(query.page || 1, 1)
    const limit = Math.min(Math.max(query.limit || 20, 1), 100)
    const offset = (page - 1) * limit

    // When searching, fetch all matching then paginate in memory
    if (query.search) {
      const all = await this.repo.findMany(filters)
      const q = query.search.toLowerCase()
      const filtered = all.filter((r: any) =>
        r.name?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q)
      )
      const paged = filtered.slice(offset, offset + limit)
      const safe = paged.map(({ wifiPassword, ownerTaxId, ...rest }) => rest as HotelesDTO)
      return { data: safe, total: filtered.length, page, limit, pages: Math.ceil(filtered.length / limit) }
    }

    const result = await this.repo.paginate(filters, { offset, limit })
    const safe = result.data.map(({ wifiPassword, ownerTaxId, ...rest }) => rest as HotelesDTO)

    return { data: safe, total: result.total, page, limit, pages: Math.ceil(result.total / limit) }
  }

  async getById(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<HotelesDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Hotel no encontrado')

    // Ownership check
    if (currentUser.role !== 'super_admin' && item.id !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }

    // Filter sensitive fields
    const { wifiPassword, ownerTaxId, ...safe } = item as any
    return safe
  }

  async create(dto: CreateHotelesDTO): Promise<HotelesDTO> {
    // #34 (COR-6): las dos vías de update ya rechazan el estado contradictorio; sin esto,
    // POST /api/hoteles lo persistía igual. Se evalúa el estado EFECTIVO con los defaults
    // del modelo (freeCancellation=true, cancellationType='flexible'): un create que omita
    // freeCancellation pero mande non_refundable persistiría el conflicto vía el default.
    assertCancellationCompatible(dto.freeCancellation ?? true, dto.cancellationType ?? 'flexible')

    this.logger.info('Creando hotel', { name: dto.name })
    const item = await this.repo.create(dto as any)
    const { wifiPassword, ownerTaxId, ...safe } = item as any
    await this.sockets.onHotelesCreated?.(safe)
    await this.cache.delete('hoteles:list')
    return safe
  }

  async update(id: string, dto: UpdateHotelesDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<HotelesDTO> {
    // Ownership + estado actual: se carga SIEMPRE (antes sólo para no-super_admin) porque
    // la exclusividad #34 necesita el valor ya persistido para evaluar el estado efectivo.
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Hotel no encontrado')
    if (currentUser.role !== 'super_admin' && existing.id !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }

    // #34 (SEC-2): la exclusividad de condiciones no puede vivir sólo en la UI. Se evalúa
    // el estado EFECTIVO (patch mergeado sobre la DB) porque un PUT parcial — sólo
    // cancellationType, por ejemplo — puede crear el conflicto con lo ya persistido.
    assertCancellationCompatible(dto.freeCancellation ?? existing.freeCancellation, dto.cancellationType ?? existing.cancellationType)

    const item = await this.repo.update(id, dto as any)
    if (!item) throw new NotFoundError('Hotel no encontrado')
    const { wifiPassword, ownerTaxId, ...safe } = item as any
    await this.sockets.onHotelesUpdated?.(safe)
    await this.cache.delete('hoteles:list')
    return safe
  }

  async delete(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<void> {
    // Only super_admin can delete hotels
    if (currentUser.role !== 'super_admin') {
      throw new AuthError('Solo super_admin puede eliminar hoteles')
    }

    // Se lee ANTES de borrar: se pierde un tenant entero, el audit log tiene que decir CUÁL.
    const existing = await this.repo.findById(id)

    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Hotel no encontrado')
    await this.sockets.onHotelesDeleted?.(id)
    await this.cache.delete('hoteles:list')
    await auditSafely(this.auditPort, this.logger, {
      hotelId: id, userId: currentUser.id, action: 'hotel.delete',
      entity: 'hotel', entityId: id,
      detail: `Hotel "${existing?.name ?? id}" eliminado`,
    })
  }

  // ── Settings (delegated to queries) ───────────────────────────────────
  async getSettings(hotelId: string, user?: any): Promise<any> {
    if (!this.queries) throw new Error('Queries no disponible para settings')
    return this.queries.getSettings(hotelId, this.auth, user)
  }

  async updateHotel(id: string, body: Record<string, any>, user?: any): Promise<any> {
    if (!this.queries) throw new Error('Queries no disponible para settings')
    return this.queries.updateHotel(id, body, this.auth, user)
  }

  async getSettingsFull(hotelId: string, user?: any): Promise<any> {
    if (!this.settingsFull) throw new Error('SettingsFull no disponible')
    return this.settingsFull.execute(hotelId, this.auth, user)
  }

  async getConfig(hotelId: string, key: string): Promise<any> {
    if (!this.queries) throw new Error('Queries no disponible')
    return this.queries.getConfig(hotelId, key)
  }

  /** Contactos de emergencia (lectura solo-login). Delega en queries. */
  async getEmergencyContacts(hotelId: string): Promise<any> {
    if (!this.queries) throw new Error('Queries no disponible')
    return this.queries.getEmergencyContacts(hotelId)
  }

  async setConfig(body: { clave: string; valor: any; hotelId?: string }, user?: any): Promise<any> {
    if (!this.queries) throw new Error('Queries no disponible')
    return this.queries.setConfig(body, user)
  }
}
