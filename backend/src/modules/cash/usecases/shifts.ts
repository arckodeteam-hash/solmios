// cash/usecases/shifts.ts — Lógica de turnos de caja (abrir/cerrar/arqueo/actual).
// Recibe dependencias (no conoce el service). Best-effort coherente con el resto del módulo.

import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  CashMovementDTO, CashShiftDTO, CashRegister, OpenShiftDTO, CloseShiftDTO,
  ReconcileResult, ShiftHistoryPage, ShiftHistoryQuery, CurrentUser,
} from '../types'
import type { CashSockets } from '../sockets'
import { round2, BALANCE_EPSILON } from '../../../shared/utils/money'
import { reconcileShift, summarizeMovements } from './reconcile'

export interface ShiftDeps {
  shiftRepo: RepositoryAdapter<CashShiftDTO>
  repo: RepositoryAdapter<CashMovementDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  logger: Logger
  sockets: CashSockets
  hotelOfUser: (user: CurrentUser, dtoHotelId?: string) => string
  bumpVersion: () => void
}

const DEFAULT_REGISTER: CashRegister = 'reception'

/** Turno abierto del hotel para ESE punto de venta (o null). Reception y restaurant nunca comparten turno. */
export async function resolveOpenShift(deps: ShiftDeps, hotelId: string, register: CashRegister = DEFAULT_REGISTER): Promise<string | null> {
  if (!hotelId) return null
  const open = await deps.shiftRepo.findMany({ hotelId, status: 'open', register } as any)
  return open[0]?.id ?? null
}

export async function listShifts(deps: ShiftDeps, hotelId: string | undefined, user: CurrentUser, register: CashRegister = DEFAULT_REGISTER): Promise<CashShiftDTO[]> {
  const hid = deps.hotelOfUser(user, hotelId)
  const shifts = await deps.shiftRepo.findMany({ hotelId: hid || '__none__', register } as any)
  return shifts.sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''))
}

export async function getCurrentShift(deps: ShiftDeps, user: CurrentUser, register: CashRegister = DEFAULT_REGISTER): Promise<CashShiftDTO | null> {
  const hotelId = deps.hotelOfUser(user)
  const open = await deps.shiftRepo.findMany({ hotelId: hotelId || '__none__', status: 'open', register } as any)
  return open[0] ?? null
}

// DEUDA CONOCIDA (QA-MEDIO, sin resolver a propósito): el check (getCurrentShift) y la mutación
// (shiftRepo.create) no están en una transacción — no hay unique constraint en DB sobre
// (hotelId, register, status='open'). Dos requests casi simultáneos de "abrir turno" para el
// mismo register/hotel pueden pasar el check antes de que cualquiera cree, dejando 2 turnos
// abiertos del mismo cajón. No se resuelve acá: este módulo depende de RepositoryAdapter (regla
// del proyecto: "service NUNCA importa el orm directo"), y una transacción real (como la de
// reservas/usecases/checkin.ts) exigiría inyectar el orm crudo, rompiendo esa convención — cambio
// de arquitectura que hay que decidir a propósito, no colar en un fix de otra cosa. Consecuencia
// si pasa: dos turnos 'open' del mismo register; se resuelve cerrando ambos a mano (recuperable,
// no hay pérdida de plata — cada turno arquea sus propios movimientos por separado).
export async function openShift(deps: ShiftDeps, dto: OpenShiftDTO, user: CurrentUser, register: CashRegister = DEFAULT_REGISTER): Promise<CashShiftDTO> {
  const hotelId = deps.hotelOfUser(user)
  const current = await getCurrentShift(deps, user, register)
  if (current) throw new ValidationError(`Ya hay un turno de ${register === 'restaurant' ? 'restaurante' : 'recepción'} abierto. Cerralo antes de abrir uno nuevo.`)
  const now = new Date().toISOString()
  const opening = dto.openingAmount || 0
  const shift = await deps.shiftRepo.create({
    hotelId, status: 'open', register, openingAmount: opening, openedBy: user.id, openedAt: now,
    notes: dto.notes, denominations: '{}', difference: 0, expectedAmount: opening,
  } as Omit<CashShiftDTO, 'id'>)
  await deps.sockets.onShiftOpened?.(shift)
  deps.bumpVersion()
  return shift
}

/** Default 'reception': la ruta de recepción no pasa expectedRegister explícito, así que SIN este
 * default cualquiera con permiso `billing` podía cerrar/arquear el turno del restaurante pasando su
 * id a mano (mismo bug de fondo que en list/stats — "sin filtro" quedó leyendo como "todo vale"). */
function assertRegister(shift: CashShiftDTO, expectedRegister: CashRegister = DEFAULT_REGISTER): void {
  const actual = shift.register || DEFAULT_REGISTER
  if (actual !== expectedRegister) {
    throw new ValidationError('Ese turno pertenece a otro punto de venta')
  }
}

export async function closeShift(deps: ShiftDeps, id: string, dto: CloseShiftDTO, user: CurrentUser, expectedRegister?: CashRegister): Promise<CashShiftDTO> {
  const shift = await deps.shiftRepo.findById(id)
  if (!shift) throw new NotFoundError('Turno no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(shift.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  assertRegister(shift, expectedRegister)
  if (shift.status === 'closed') throw new Error('El turno ya está cerrado')
  const movs = shift.id ? await deps.repo.findMany({ shiftId: shift.id } as any) : []
  const rec = reconcileShift(shift, movs)
  // QA-UI caja-2026-08-22 (H2/M6): cerrar con diferencia era un click más — el arqueo venía
  // prellenado con el esperado y cuadraba solo. Una diferencia física contra el cajón es un
  // hecho contable: si no cuadra dentro del centavo de tolerancia, exige motivo (convención del
  // repo: validación de negocio en el usecase, como facturas/usecases/pay-invoice).
  const difference = round2(dto.countedAmount - rec.expected)
  const reason = (dto.notes || '').trim()
  if (Math.abs(difference) > BALANCE_EPSILON && !reason) {
    const sign = difference < 0 ? '-' : '+'
    throw new ValidationError(
      `El arqueo no cuadra: hay una diferencia de $${sign}${round2(Math.abs(difference))} ` +
      `contra el efectivo esperado ($${round2(rec.expected)}). ` +
      'Contá el cajón de nuevo o escribí el motivo de la diferencia para cerrar el turno.',
    )
  }
  const now = new Date().toISOString()
  const updated = await deps.shiftRepo.update(id, {
    status: 'closed', countedAmount: dto.countedAmount, expectedAmount: rec.expected,
    difference, denominations: dto.denominations || '{}',
    closedBy: user.id, closedAt: now, notes: dto.notes,
  } as Partial<Omit<CashShiftDTO, 'id'>>)
  if (!updated) throw new NotFoundError('Turno no encontrado')
  await deps.sockets.onShiftClosed?.(updated)
  deps.bumpVersion()
  return updated
}

/** Histórico de turnos del register para auditoría: quién abrió/cerró, fondo, arqueo
 * (esperado/contado/diferencia) y neto por método de cada turno. Filtra por fecha de apertura
 * (`from`/`to`) y pagina — igual semántica que usecases/list.ts. El desglose sale de UNA pasada
 * sobre los movimientos del register agrupados por shiftId (mismo patrón in-memory que stats()). */
export async function listShiftHistory(
  deps: ShiftDeps, hotelId: string | undefined, query: ShiftHistoryQuery, user: CurrentUser, register: CashRegister = DEFAULT_REGISTER,
): Promise<ShiftHistoryPage> {
  const hid = deps.hotelOfUser(user, hotelId)
  let shifts = await deps.shiftRepo.findMany({ hotelId: hid || '__none__', register } as any)
  shifts = [...shifts].sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''))
  if (query.from) shifts = shifts.filter(s => (s.openedAt || '') >= query.from!)
  if (query.to) shifts = shifts.filter(s => (s.openedAt || '') <= query.to! + 'T23:59:59')
  const total = shifts.length
  const page = Math.max(Number(query.page) || 1, 1)
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const offset = (page - 1) * limit

  // Neto por método por turno (los movimientos sin shiftId son huérfanos de turnos cerrados).
  const movs = await deps.repo.findMany({ hotelId: hid || '__none__', register } as any)
  const movsByShift = new Map<string, CashMovementDTO[]>()
  for (const m of movs) {
    if (!m.shiftId) continue
    const arr = movsByShift.get(m.shiftId) || []
    arr.push(m)
    movsByShift.set(m.shiftId, arr)
  }

  const data = shifts.slice(offset, offset + limit).map(s => ({
    ...s,
    byMethodNet: summarizeMovements(movsByShift.get(s.id || '') || []).byMethodNet,
  }))
  return {
    data, total, page, limit,
    pages: Math.ceil(total / limit) || 1,
    hasNext: offset + limit < total, hasPrev: page > 1,
  }
}

export async function reconcile(deps: ShiftDeps, id: string, user: CurrentUser, expectedRegister?: CashRegister): Promise<ReconcileResult> {
  const shift = await deps.shiftRepo.findById(id)
  if (!shift) throw new NotFoundError('Turno no encontrado')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(shift.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  assertRegister(shift, expectedRegister)
  const movs = shift.id ? await deps.repo.findMany({ shiftId: shift.id } as any) : []
  return reconcileShift(shift, movs)
}
