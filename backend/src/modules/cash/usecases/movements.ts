// cash/usecases/movements.ts — CRUD de movimientos manuales (extraído de service.ts, God Object).
// Recibe dependencias (no conoce el service). registerPaymentIncome/registerExpenseOutflow (los
// automáticos de los conectores) siguen en auto-movements.ts — son un flujo distinto.

import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { ConflictError, NotFoundError } from 'arckode-framework'
import type {
  CashMovementDTO, CashRegister, CreateMovementDTO, UpdateMovementDTO,
  MovementQuery, CashPaginated, CurrentUser, MovementType,
} from '../types'
import type { CashSockets } from '../sockets'
import { listMovements } from './list'
import * as shiftsUc from './shifts'
import type { ShiftDeps } from './shifts'

const MOVEMENT_TYPES: MovementType[] = ['income', 'expense', 'opening', 'closing']
const DEFAULT_REGISTER: CashRegister = 'reception'

export interface MovementDeps {
  repo: RepositoryAdapter<CashMovementDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  cache: CacheAdapter
  sockets: CashSockets
  shiftDeps: ShiftDeps
  hotelOfUser: (user: CurrentUser, dtoHotelId?: string) => string
  listVersion(): number
  bumpVersion(): void
}

/** Ownership-style check: una ruta scopeada (ej. /api/caja/restaurant/*) no puede tocar
 * un movimiento del OTRO punto de venta pasando su id a mano. Default 'reception': antes de
 * separar registers esta ruta veía TODO — si acá no filtráramos por default, un movimiento de
 * restaurante volvería a aparecer/editarse mezclado en la caja de recepción (QA-ALTO, encontrado
 * en vivo: el "Hoy" de recepción sumaba plata de una propina cargada desde la caja del restaurante). */
function assertRegister(item: CashMovementDTO, expectedRegister: CashRegister = DEFAULT_REGISTER): void {
  if ((item.register || DEFAULT_REGISTER) !== expectedRegister) {
    throw new NotFoundError('Movimiento no encontrado')
  }
}

export async function list(deps: MovementDeps, query: MovementQuery, user: CurrentUser, register: CashRegister = DEFAULT_REGISTER): Promise<CashPaginated> {
  const hotelId = deps.hotelOfUser(user, query.hotelId)
  return listMovements({ repo: deps.repo, cache: deps.cache, version: deps.listVersion() }, hotelId, { ...query, register })
}

export async function getById(deps: MovementDeps, id: string, user: CurrentUser, expectedRegister: CashRegister = DEFAULT_REGISTER): Promise<CashMovementDTO> {
  const item = await deps.repo.findById(id)
  if (!item) throw new NotFoundError('Movimiento no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(item.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  assertRegister(item, expectedRegister)
  return item
}

export async function create(deps: MovementDeps, dto: CreateMovementDTO, user: CurrentUser, register: CashRegister = 'reception'): Promise<CashMovementDTO> {
  if (!MOVEMENT_TYPES.includes(dto.type)) throw new Error(`Tipo de movimiento inválido: ${dto.type}`)
  const hotelId = deps.hotelOfUser(user)
  const shiftId = await shiftsUc.resolveOpenShift(deps.shiftDeps, hotelId, register)
  const item = await deps.repo.create({
    ...dto, hotelId, shiftId: shiftId || null, register,
    category: dto.category || (dto.type === 'income' ? 'payment' : 'expense'),
    source: 'manual', createdBy: user.id,
  } as Omit<CashMovementDTO, 'id'>)
  await deps.sockets.onCashMovementCreated?.(item)
  deps.bumpVersion()
  return item
}

export async function update(deps: MovementDeps, id: string, dto: UpdateMovementDTO, user: CurrentUser, expectedRegister?: CashRegister): Promise<CashMovementDTO> {
  const existing = await deps.repo.findById(id)
  if (!existing) throw new NotFoundError('Movimiento no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  assertRegister(existing, expectedRegister)
  if (existing.source === 'payment_connector') {
    throw new Error('Los movimientos automáticos (pago) no se pueden editar manualmente')
  }
  if (existing.source === 'expense_connector') {
    throw new Error('Los movimientos automáticos (gasto) no se editan acá: modificá el gasto')
  }
  // #212: un movimiento de un turno ya CERRADO no se edita — el arqueo de ese turno quedó firmado
  // con estos números; cambiarlos después deja el histórico diciendo otra cosa que la caja.
  if (existing.shiftId) {
    const shift = await deps.shiftDeps.shiftRepo.findById(existing.shiftId)
    if (shift && shift.status === 'closed') {
      throw new ConflictError('El turno de este movimiento ya está cerrado: no se puede editar')
    }
  }
  const item = await deps.repo.update(id, dto as Partial<Omit<CashMovementDTO, 'id'>>)
  if (!item) throw new NotFoundError('Movimiento no encontrado')
  await deps.sockets.onCashMovementUpdated?.(item)
  deps.bumpVersion()
  return item
}

export async function destroy(deps: MovementDeps, id: string, user: CurrentUser, expectedRegister?: CashRegister): Promise<CashMovementDTO> {
  const existing = await deps.repo.findById(id)
  if (!existing) throw new NotFoundError('Movimiento no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(existing.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  assertRegister(existing, expectedRegister)
  const deleted = await deps.repo.delete(id)
  if (!deleted) throw new NotFoundError('Movimiento no encontrado')
  await deps.sockets.onCashMovementDeleted?.(id)
  deps.bumpVersion()
  return existing
}
