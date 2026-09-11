import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError } from 'arckode-framework'
import type { NotificacionesDTO, CreateNotificacionesDTO, UpdateNotificacionesDTO, NotificacionesQuery, NotificacionesPaginated } from './types'
import type { NotificacionesSockets } from './sockets'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import type { ReservationEmailSender } from '../../shared/usecases/notify-reservation-received'
import type { PlatformIdentity } from '../../shared/utils/platform-identity'

const CACHE_TTL = 300

/** Correo al buzón del hotel + nombre de la plataforma para el asunto (avisos de reserva, #246). */
export interface HotelEmailDeps {
  emailSender: ReservationEmailSender
  platformIdentity: () => Promise<PlatformIdentity>
}

export class NotificacionesService {
  private sockets: NotificacionesSockets = {}
  private auditPort: AuditPort | null = null
  private hotelEmail: HotelEmailDeps | null = null

  /** Conecta el audit log. Lo inyecta el connector `notificaciones-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  /**
   * Correo al hotel (avisos de reserva). Lo inyecta `email-bootstrap` post-init, porque el
   * EmailService se construye DESPUÉS de `system.start()` y un connector no puede resolverlo al
   * cablear (TDZ). Hasta que llegue, el aviso sale sólo por la campanita (y push si hay).
   */
  setHotelEmailDeps(d: HotelEmailDeps): void { this.hotelEmail = d }
  /** Lo que el connector `bookingengine-notificaciones` lee en cada aviso; `null` = sin correo todavía. */
  hotelEmailDeps(): HotelEmailDeps | null { return this.hotelEmail }

  constructor(
    private readonly repo: RepositoryAdapter<NotificacionesDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
  ) {}

  setSockets(s: Partial<NotificacionesSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  async list(query: NotificacionesQuery, currentUser: { id: string; role: string; hotelId?: string }): Promise<NotificacionesPaginated> {
    const filters: Record<string, unknown> = {}
    if (query.type) filters.type = query.type
    if (query.channel) filters.channel = query.channel
    if (query.read !== undefined) filters.read = query.read

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

    // Cada usuario ve los avisos del hotel (broadcast, sin `userId`) MÁS los suyos
    // personales — nunca los de otro. El filtro del ORM es por igualdad exacta y
    // no puede expresar el OR (`userId` nulo O `userId` = target); un
    // `filters.userId` en el ORM excluiría los broadcast (NULL nunca matchea `=`).
    // Por eso el scoping se resuelve siempre en memoria — el volumen de
    // notificaciones por hotel es acotado. Un `?userId=` explícito (un manager
    // mirando a alguien) respeta ese pedido usándolo como target del OR.
    const targetUserId = query.userId ?? currentUser.id
    const scoped = (n: NotificacionesDTO) => !n.userId || n.userId === targetUserId

    // Sin cache: la key vieja era solo el hotel, así que la primera consulta se
    // cacheaba y todas las demás —de cualquier usuario— recibían ESA, y el aviso
    // personal no llegaba a su dueño. Con keys por usuario el `cache.delete` del
    // create no las alcanza (no hay glob). Es bajo volumen; se computa fresco.
    const all = (await this.repo.findMany(filters)).filter(scoped)
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const data = all.slice(offset, offset + limit)
    return { data, total: all.length, page, limit, pages: Math.ceil(all.length / limit) }
  }

  async getById(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<NotificacionesDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Notificación no encontrada')
    if (currentUser.role !== 'super_admin' && item.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    return item
  }

  async create(dto: CreateNotificacionesDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<NotificacionesDTO> {
    if (currentUser.role !== 'super_admin' && dto.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado para crear en otro hotel')
    }
    const item = await this.repo.create(dto as any)
    await this.sockets.onNotificacionesCreated?.(item)
    await this.cache.delete(`notificaciones:list:${dto.hotelId}`)
    return item
  }

  async update(id: string, dto: UpdateNotificacionesDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<NotificacionesDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Notificación no encontrada')
    if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    const item = await this.repo.update(id, dto as any)
    if (!item) throw new NotFoundError('Notificación no encontrada')
    await this.sockets.onNotificacionesUpdated?.(item)
    await this.cache.delete(`notificaciones:list:${existing.hotelId}`)
    return item
  }

  async delete(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Notificación no encontrada')
    const isSuper = currentUser.role === 'super_admin'
    if (!isSuper && existing.hotelId !== currentUser.hotelId) {
      throw new AuthError('No autorizado')
    }
    // Cualquiera puede borrar SU propia notificación o una del hotel (sin
    // dueño). Lo que NO puede es borrar la notificación personal de otra
    // persona; solo el super_admin puede borrar cualquiera.
    const ownerId = (existing as any).userId as string | undefined
    if (!isSuper && ownerId && ownerId !== currentUser.id) {
      throw new AuthError('No autorizado')
    }
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Notificación no encontrada')
    await this.sockets.onNotificacionesDeleted?.(id)
    await this.cache.delete(`notificaciones:list:${existing.hotelId}`)
    await auditSafely(this.auditPort, this.logger, {
      hotelId: existing.hotelId, userId: currentUser.id, action: 'notification.delete',
      entity: 'notification', entityId: id, detail: `Notificación "${existing.title}" eliminada`,
    })
  }
}
