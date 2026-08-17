// providers.ts — Catálogo de SERVICIOS EXTERNOS (proveedores/contratistas).
//
// El hotel carga acá a quién llama cuando algo no se arregla adentro: plomero,
// electricista, técnico de A/C. Después, al crear o editar un ticket, se le puede
// asignar un proveedor externo EN VEZ de un técnico interno.
//
// Vive dentro del módulo `mantenimiento` (no es un módulo aparte) justamente para
// que el ticket pueda referenciarlo sin necesitar un connector: el módulo es dueño
// de las dos tablas.
import type { RepositoryAdapter } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { MaintenanceProviderDTO } from '../types'
import { assertOwnership } from '../helpers'

type User = { id: string; role: string; hotelId?: string }

/** Campos del perfil que la edición puede tocar (nunca id/hotelId). */
const PROVIDER_EDITABLE_FIELDS = [
  'name', 'specialty', 'phone', 'email', 'notes',
  'address', 'rate', 'workDays', 'workStart', 'workEnd',
] as const satisfies readonly (keyof MaintenanceProviderDTO)[]

export class ProvidersUseCase {
  constructor(private readonly repo: RepositoryAdapter<MaintenanceProviderDTO>) {}

  /**
   * Los proveedores del hotel de quien pregunta. Los de baja no se listan, SALVO que se
   * pida `includeInactive` (la vista de administración los gestiona: reactivar, ver el
   * catálogo completo). Los consumers normales —el selector de tickets, la app— no lo
   * pasan y siguen viendo solo activos.
   */
  async list(user: User, opts: { includeInactive?: boolean } = {}): Promise<MaintenanceProviderDTO[]> {
    const hotelId = user.hotelId
    if (!hotelId && user.role !== 'super_admin') return []
    const rows = await this.repo.findMany(hotelId ? { hotelId } : {})
    return opts.includeInactive ? rows : rows.filter((p) => p.active !== false)
  }

  async create(dto: Partial<MaintenanceProviderDTO>, user: User): Promise<MaintenanceProviderDTO> {
    const hotelId = dto.hotelId ?? user.hotelId
    if (!hotelId) throw new ValidationError('Falta el hotel del proveedor')
    assertOwnership(hotelId, user)
    const name = (dto.name ?? '').trim()
    if (name.length === 0) throw new ValidationError('El proveedor necesita un nombre')
    return this.repo.create({
      hotelId,
      name,
      specialty: dto.specialty ?? '',
      phone: dto.phone ?? '',
      email: dto.email ?? '',
      notes: dto.notes ?? '',
      address: dto.address ?? '',
      rate: dto.rate ?? '',
      workDays: dto.workDays ?? '',
      workStart: dto.workStart ?? '',
      workEnd: dto.workEnd ?? '',
      active: dto.active ?? true,
    } as any)
  }

  async update(id: string, dto: Partial<MaintenanceProviderDTO>, user: User): Promise<MaintenanceProviderDTO> {
    const existing = await this.owned(id, user)
    const patch: Record<string, unknown> = {}
    for (const key of PROVIDER_EDITABLE_FIELDS) {
      if (dto[key] !== undefined) patch[key] = dto[key]
    }
    if (typeof dto.active === 'boolean') patch.active = dto.active
    const item = await this.repo.update(existing.id, patch as any)
    if (!item) throw new NotFoundError('Proveedor no encontrado')
    return item
  }

  /**
   * Baja LÓGICA, no borrado físico: un ticket viejo puede seguir apuntando a este
   * proveedor, y borrarlo de verdad dejaría el historial señalando a la nada.
   */
  async remove(id: string, user: User): Promise<void> {
    const existing = await this.owned(id, user)
    await this.repo.update(existing.id, { active: false } as any)
  }

  private async owned(id: string, user: User): Promise<MaintenanceProviderDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Proveedor no encontrado')
    assertOwnership(item.hotelId, user)
    return item
  }
}
