// restaurant/usecases/tables-crud.ts — CRUD de mesas del salón (RES-2).
// Reglas: ownership (IDOR); status ∈ free|occupied|reserved. La consistencia mesa↔comanda abierta
// (una mesa = una comanda abierta) se aplica al abrir comandas en RES-3, no acá.
// #208: una mesa con comanda viva no se borra (409) — la comanda quedaría apuntando a una mesa que
// no existe y el salón dejaría de mostrarla.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError } from 'arckode-framework'
import type { TableDTO, TableStatus, CurrentUser, OrderDTO } from '../types'
import { isTerminalOrder } from './order-totals'

export interface TablesCrudDeps {
  tables: RepositoryAdapter<TableDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  /** #208: comandas del hotel, para negar el borrado de una mesa con comanda viva. Opcional solo por
   *  retrocompat de tests viejos que no ejercitan el borrado; index.ts SIEMPRE lo pasa. Sin él,
   *  `deleteTable` falla CERRADO (misma decisión que `deleteItem` sin `comboItems`). */
  orders?: RepositoryAdapter<OrderDTO>
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
  return deps.tables.create({
    hotelId,
    name: dto.name.trim(),
    zone: dto.zone,
    capacity: dto.capacity ?? 0,
    status: dto.status ?? 'free',
  } as Omit<TableDTO, 'id'>)
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
  return item
}

export async function deleteTable(deps: TablesCrudDeps, id: string, user: CurrentUser): Promise<void> {
  const existing = await deps.tables.findById(id)
  if (!existing) throw new NotFoundError('Mesa no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  // #208: comanda no terminal sobre la mesa (open/sent/.../billed/processing_payment) → 409. Una
  // `paid`/`charged`/`cancelled`/`refunded` ya no la ocupa y no bloquea. Sin repo de comandas no se
  // puede saber → no se borra (fail-closed), nunca "se salta el chequeo".
  if (!deps.orders) throw new ValidationError('Comandas no configuradas: no se puede comprobar si la mesa tiene una comanda abierta')
  const onTable = (await deps.orders.findMany({ hotelId: existing.hotelId, tableId: id })) as OrderDTO[]
  const live = onTable.find((o) => !isTerminalOrder(o))
  if (live) {
    throw new ConflictError(`La mesa tiene la comanda ${live.number ?? live.id} abierta (${live.status}); cerrala o cancelala antes de borrarla`)
  }
  const deleted = await deps.tables.delete(id)
  if (!deleted) throw new NotFoundError('Mesa no encontrada')
}
