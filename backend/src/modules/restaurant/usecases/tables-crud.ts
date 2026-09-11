// restaurant/usecases/tables-crud.ts — CRUD de mesas del salón (RES-2).
// Reglas: ownership (IDOR); status ∈ free|occupied|reserved. La consistencia mesa↔comanda abierta
// (una mesa = una comanda abierta) se aplica al abrir comandas en RES-3, no acá.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { TableDTO, TableStatus, CurrentUser } from '../types'
import type { RestaurantSockets } from '../sockets'

export interface TablesCrudDeps {
  tables: RepositoryAdapter<TableDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  /** #211 — `onTableChanged` avisa al Salón en vivo. Opcional: sin sockets el CRUD funciona igual. */
  sockets?: RestaurantSockets
}

const TABLE_STATUSES: TableStatus[] = ['free', 'occupied', 'reserved']

export interface CreateTableInput { name: string; zone?: string; capacity?: number; status?: TableStatus }
export interface UpdateTableInput { name?: string; zone?: string; capacity?: number; status?: TableStatus }

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

function assertStatus(status: TableStatus | undefined): void {
  if (status !== undefined && !TABLE_STATUSES.includes(status)) {
    throw new ValidationError(`Estado de mesa inválido: ${status}`)
  }
}

function assertCapacity(capacity: number | undefined): void {
  if (capacity !== undefined && (!Number.isFinite(Number(capacity)) || Number(capacity) < 0)) {
    throw new ValidationError('La capacidad debe ser un número ≥ 0')
  }
}

export async function listTables(deps: TablesCrudDeps, user: CurrentUser): Promise<{ data: TableDTO[]; total: number }> {
  const data = await deps.tables.findMany({ hotelId: hotelFor(user) })
  data.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  return { data, total: data.length }
}

export async function getTable(deps: TablesCrudDeps, id: string, user: CurrentUser): Promise<TableDTO> {
  const item = await deps.tables.findById(id)
  if (!item) throw new NotFoundError('Mesa no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(item.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  return item
}

export async function createTable(deps: TablesCrudDeps, dto: CreateTableInput, user: CurrentUser): Promise<TableDTO> {
  const hotelId = hotelFor(user)
  if (!dto.name?.trim()) throw new ValidationError('El nombre de la mesa es obligatorio')
  assertStatus(dto.status)
  assertCapacity(dto.capacity)
  const created = await deps.tables.create({
    hotelId,
    name: dto.name.trim(),
    zone: dto.zone,
    capacity: dto.capacity ?? 0,
    status: dto.status ?? 'free',
  } as Omit<TableDTO, 'id'>)
  await deps.sockets?.onTableChanged?.(created)
  return created
}

export async function updateTable(deps: TablesCrudDeps, id: string, dto: UpdateTableInput, user: CurrentUser): Promise<TableDTO> {
  const existing = await deps.tables.findById(id)
  if (!existing) throw new NotFoundError('Mesa no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  assertStatus(dto.status)
  assertCapacity(dto.capacity)
  const item = await deps.tables.update(id, dto as Partial<Omit<TableDTO, 'id'>>)
  if (!item) throw new NotFoundError('Mesa no encontrada')
  await deps.sockets?.onTableChanged?.(item)
  return item
}

export async function deleteTable(deps: TablesCrudDeps, id: string, user: CurrentUser): Promise<void> {
  const existing = await deps.tables.findById(id)
  if (!existing) throw new NotFoundError('Mesa no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  const deleted = await deps.tables.delete(id)
  if (!deleted) throw new NotFoundError('Mesa no encontrada')
  await deps.sockets?.onTableChanged?.(existing)
}
