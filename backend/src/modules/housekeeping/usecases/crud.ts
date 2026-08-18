// crud.ts — Alta, lectura, edición y borrado de una tarea de limpieza.
//
// Vive fuera del service para que el facade no se convierta en un God Object: el
// service solo delega (mismo patrón que `list`, `timings`, `photos`, `approve`).
// Los efectos (sockets, invalidación de caché, auditoría) entran por callbacks,
// igual que en `TimingsUseCase`: el usecase no conoce el transporte.
import type { RepositoryAdapter } from 'arckode-framework'
import { NotFoundError, AuthError, ValidationError } from 'arckode-framework'
import type {
  HousekeepingDTO,
  CreateHousekeepingDTO,
  UpdateHousekeepingDTO,
  HousekeepingUser,
} from '../types'
import { withRoomInfo } from './room-info'
import { assertTransition } from './timings'
import { assertStaffExists, withStaffInfo } from './staff'

/** Efectos que dispara el CRUD. Los cablea el service. */
export interface CrudEffects {
  onCreated?: (item: HousekeepingDTO) => Promise<void>
  onUpdated?: (item: HousekeepingDTO) => Promise<void>
  onDeleted?: (id: string) => Promise<void>
  onAssigned?: (item: HousekeepingDTO) => Promise<void>
  invalidate: (hotelId?: string) => Promise<void>
  audit: (existing: HousekeepingDTO, user: HousekeepingUser, id: string) => Promise<void>
}

export class CrudUseCase {
  constructor(
    private readonly repo: RepositoryAdapter<HousekeepingDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly effects: CrudEffects,
    private readonly roomRepo?: RepositoryAdapter<any>,
  ) {}

  /** Solo el super_admin ve tareas de otro hotel. */
  private assertSameHotel(hotelId: string | undefined, user: HousekeepingUser): void {
    if (user.role !== 'super_admin' && hotelId !== user.hotelId) {
      throw new AuthError('No autorizado')
    }
  }

  async getById(id: string, user: HousekeepingUser): Promise<HousekeepingDTO> {
    // NO `findById`: en este ORM la lectura de UNA fila devuelve los campos
    // json/text (`cleaningItems`, `notes`, `supervisorNote`, `photos`) en null,
    // mientras que la lectura en lote (`paginate`, que usa el listado) los
    // deserializa bien. El detalle de la app se sirve de acá, así que sin esto la
    // camarera abría una tarea SIN checklist tildado y SIN el motivo de rechazo.
    const result = await this.repo.paginate({ id }, { offset: 0, limit: 1 })
    const item = result.data[0]
    if (!item) throw new NotFoundError('Tarea de housekeeping no encontrada')
    this.assertSameHotel(item.hotelId, user)
    // El detalle también muestra "Hab. X" y el nombre de la camarera: sin esto el
    // título y el encabezado de aprobación quedaban vacíos.
    const [withRoom] = await withRoomInfo(this.roomRepo, [item])
    const [enriched] = await withStaffInfo(this.userRepo, [withRoom])
    return enriched as HousekeepingDTO
  }

  async create(dto: CreateHousekeepingDTO, user: HousekeepingUser): Promise<HousekeepingDTO> {
    if (user.role !== 'super_admin' && dto.hotelId !== user.hotelId) {
      throw new AuthError('No autorizado para crear en otro hotel')
    }
    await assertStaffExists(this.userRepo, dto.staffId, user)
    const item = await this.repo.create(dto as any)
    await this.effects.onCreated?.(item)
    // Nace ya asignada: la camarera tiene que enterarse.
    if (dto.staffId) await this.effects.onAssigned?.(item)
    await this.effects.invalidate(dto.hotelId)
    return item
  }

  async update(id: string, dto: UpdateHousekeepingDTO, user: HousekeepingUser): Promise<HousekeepingDTO> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Tarea de housekeeping no encontrada')
    this.assertSameHotel(existing.hotelId, user)
    // `inspected` NO se setea por acá: es el único estado que requiere el workflow completo
    // (presencia física del supervisor + calificación). Por el PUT genérico cualquiera con
    // `housekeeping:edit` — incluida la camarera asignada — saltaba toda la revisión.
    if (dto.status === 'inspected' && dto.status !== existing.status) {
      throw new ValidationError('La inspección se hace vía POST /api/housekeeping/:id/approve (presencia + calificación)')
    }
    if (dto.status && dto.status !== existing.status) assertTransition(existing.status, dto.status)
    await assertStaffExists(this.userRepo, dto.staffId, user)
    const item = await this.repo.update(id, dto as any)
    if (!item) throw new NotFoundError('Tarea de housekeeping no encontrada')
    await this.effects.onUpdated?.(item)
    // Solo cuando cambia de dueño: un `update` de estado no es una asignación.
    if (dto.staffId && dto.staffId !== existing.staffId) await this.effects.onAssigned?.(item)
    await this.effects.invalidate(existing.hotelId)
    return item
  }

  async delete(id: string, user: HousekeepingUser): Promise<void> {
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Tarea de housekeeping no encontrada')
    this.assertSameHotel(existing.hotelId, user)
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Tarea de housekeeping no encontrada')
    await this.effects.onDeleted?.(id)
    await this.effects.invalidate(existing.hotelId)
    // Con la tarea se van sus tiempos, fotos y checklist: es la evidencia de la limpieza.
    await this.effects.audit(existing, user, id)
  }
}
