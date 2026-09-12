// reservas/usecases/assign-room.ts — Asignar / soltar / listar habitaciones para una reserva (REQ-HAC-03, #258).
//
// Con HAC-01 la reserva nace con `roomId = null` y vende un TIPO (`roomType`); la unidad concreta
// se asigna en recepción, normalmente al check-in. Este usecase es el ÚNICO camino que escribe
// `roomId` sobre una reserva existente: `updateReservation` (crud.ts) delega acá cuando el PUT
// trae un `roomId` distinto, para que el solape, el bloqueo, el tipo y la auditoría se validen
// una sola vez y de la misma manera.
//
// Reglas:
//   · La habitación tiene que ser del MISMO hotel (400) y vendible (`isRoomSellable`, 409).
//   · No puede solapar con otra reserva activa ni con un `RoomBlock` (409 `room_overlap`).
//   · Cambiar de tipo exige `allowTypeChange` explícito (409 `type_mismatch`) — un upgrade es una
//     decisión de negocio, no un efecto colateral de elegir mal en un selector.
//   · Reasignar una reserva `checked_in` mueve también el folio abierto y los estados de las
//     habitaciones (anterior → `cleaning`, nueva → `occupied`), en transacción si el ORM la tiene.
//   · Todo cambio de habitación emite `onRoomAssigned` (TTLock genera/reemplaza el código ahí) y
//     deja auditoría `reservation.room_assigned` / `room_unassigned` / `room_type_changed`.

import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { Auth, CacheAdapter, Logger, RepositoryAdapter } from 'arckode-framework'
import { overlapsRange } from '../../../shared/usecases/room-overlap'
import { isCleaning, isRoomSellable } from '../../../shared/usecases/room-status'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import type { AssignRoomDTO, ReservasDTO } from '../types'
import type { ReservasSockets } from '../sockets'
import type { FolioRoomWriter, ReservasQueries } from './reservas-queries'
import { safeEmit } from './safe-emit'
import { invalidateReservasCaches } from './cache'

export interface RoomAssignmentDeps {
  repo: RepositoryAdapter<ReservasDTO>
  roomRepo: RepositoryAdapter<any>
  /** RoomBlocks. Opcional como en crud.ts: sin repo no hay bloqueos que chequear. */
  blockRepo?: RepositoryAdapter<any>
  /** Folio abierto + habitaciones + transacción (reasignación en estadía). */
  queries: Pick<ReservasQueries, 'transaction'>
  sockets: ReservasSockets
  auditPort: AuditPort | null
  logger: Logger
  cache: CacheAdapter
  auth: Auth
}

export type CurrentUser = { id: string; role: string; hotelId?: string }

export interface AssignableRoom {
  id: string
  number: string
  floor?: number | string | null
  status: string
  cleaningStatus: 'clean' | 'dirty'
  typeMismatch: boolean
  suggested: boolean
}

/** Estados en los que la habitación ya no se puede tocar: la estadía terminó o nunca ocurrió. */
const CLOSED_STATUSES = new Set(['cancelled', 'no_show', 'checked_out'])

const day = (v: unknown): string => String(v ?? '').slice(0, 10)

function loadReservation(repo: RepositoryAdapter<ReservasDTO>, id: string, currentUser: CurrentUser, auth: Auth) {
  return repo.findById(id).then((item: any) => {
    if (!item) throw new NotFoundError('Reserva no encontrada')
    // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings. Post-findById.
    auth.assertOwnership(item.hotelId, currentUser.hotelId ?? '', currentUser.role, 'super_admin')
    return item
  })
}

/** Tipo vendido de la reserva; si la fila es anterior al backfill, el de la habitación que tiene. */
async function effectiveRoomType(roomRepo: RepositoryAdapter<any>, existing: any): Promise<string | null> {
  if (existing.roomType) return String(existing.roomType)
  if (!existing.roomId) return null
  const current = await roomRepo.findOne({ id: existing.roomId } as any)
  return current?.type ? String(current.type) : null
}

/**
 * 409 `room_overlap` si otra reserva activa (no cancelled/no_show, no la propia) o un RoomBlock
 * ocupa la habitación en [checkIn, checkOut). Mismo criterio que `availability.ts` + crud.ts.
 */
export async function assertNoRoomConflict(
  deps: { repo: RepositoryAdapter<ReservasDTO>; blockRepo?: RepositoryAdapter<any> },
  hotelId: string,
  roomId: string,
  checkIn: string,
  checkOut: string,
  excludeReservationId?: string,
): Promise<void> {
  const others = await deps.repo.findMany({ roomId } as any)
  const other = (others as any[]).find((r) => r.id !== excludeReservationId && overlapsRange(r, checkIn, checkOut))
  if (other) {
    throw new ConflictError('La habitación ya está ocupada esas noches', {
      reason: 'room_overlap',
      conflictReservationId: other.id,
      locator: other.externalLocator || other.id,
      from: day(other.checkIn),
      to: day(other.checkOut),
    })
  }
  if (!deps.blockRepo) return
  const blocks = await deps.blockRepo.findMany({ roomId, hotelId } as any)
  const block = (blocks as any[]).find((b) => checkIn <= b.endDate && checkOut >= b.startDate)
  if (block) {
    throw new ConflictError(`Habitación bloqueada del ${block.startDate} al ${block.endDate}: ${block.reason || 'Sin motivo'}`, {
      reason: 'room_overlap',
      blockId: block.id,
      from: block.startDate,
      to: block.endDate,
    })
  }
}

/**
 * Valida que `roomId` pueda asignarse a `existing` y arma el patch. NO escribe: lo usan
 * `assignRoom` y el PUT de crud.ts, cada uno persiste a su manera.
 */
export async function validateRoomAssignment(
  deps: Pick<RoomAssignmentDeps, 'repo' | 'roomRepo' | 'blockRepo'>,
  existing: any,
  roomId: string,
  opts: { allowTypeChange?: boolean; checkIn?: string; checkOut?: string; userId?: string } = {},
): Promise<{ room: any; patch: Partial<ReservasDTO>; typeChanged: boolean }> {
  const room = await deps.roomRepo.findOne({ id: roomId } as any)
  if (!room || room.hotelId !== existing.hotelId) throw new ValidationError('La habitación no pertenece a este hotel')
  if (!isRoomSellable(room.status)) {
    throw new ConflictError(`La habitación ${room.number ?? roomId} está fuera de servicio (${room.status})`, { reason: 'room_not_sellable', status: room.status })
  }
  const checkIn = opts.checkIn ?? existing.checkIn
  const checkOut = opts.checkOut ?? existing.checkOut
  await assertNoRoomConflict(deps, existing.hotelId, roomId, checkIn, checkOut, existing.id)

  const soldType = await effectiveRoomType(deps.roomRepo, existing)
  const typeChanged = Boolean(soldType && room.type !== soldType)
  if (typeChanged && !opts.allowTypeChange) {
    throw new ConflictError(`La habitación es de tipo "${room.type}" y la reserva vendió "${soldType}"`, { reason: 'type_mismatch', expected: soldType, actual: room.type })
  }
  const patch: Partial<ReservasDTO> = {
    roomId,
    roomAssignedAt: new Date().toISOString(),
    roomAssignedBy: opts.userId ?? null,
    // Fila sin `roomType` (anterior al backfill) o upgrade explícito: queda el tipo de la unidad.
    ...(!existing.roomType || typeChanged ? { roomType: room.type } : {}),
  }
  return { room, patch, typeChanged }
}

/** Reasignación en estadía: el folio abierto y los estados de ambas habitaciones siguen a la reserva. */
async function moveStay(deps: RoomAssignmentDeps, reservationId: string, previousRoomId: string | null, roomId: string): Promise<void> {
  // `queries.transaction` corre en una transacción real si el ORM la ofrece; si no, secuencial.
  await deps.queries.transaction(async (q: FolioRoomWriter) => {
    const folio = await q.findOpenFolioByReservation(reservationId)
    if (folio) await q.updateFolio(folio.id, { roomId })
    if (previousRoomId && previousRoomId !== roomId) await q.updateRoom(previousRoomId, { status: 'cleaning' })
    await q.updateRoom(roomId, { status: 'occupied' })
  })
}

async function emitAssigned(deps: RoomAssignmentDeps, item: any, roomId: string | null, previousRoomId: string | null): Promise<void> {
  await safeEmit(deps.logger, 'onRoomAssigned', deps.sockets.onRoomAssigned, { reservationId: item.id, hotelId: item.hotelId, roomId, previousRoomId })
  await invalidateReservasCaches(deps.cache, item.hotelId)
}

/** POST /reservas/:id/assign-room. Idempotente si ya tiene esa habitación. */
export async function assignRoom(deps: RoomAssignmentDeps, id: string, dto: AssignRoomDTO, currentUser: CurrentUser): Promise<ReservasDTO> {
  const existing = await loadReservation(deps.repo, id, currentUser, deps.auth)
  if (CLOSED_STATUSES.has(existing.status)) {
    throw new ConflictError(`No se puede asignar habitación a una reserva ${existing.status}`, { reason: 'invalid_status', status: existing.status })
  }
  const previousRoomId: string | null = existing.roomId ?? null
  if (dto.roomId === previousRoomId) return existing

  const { patch, typeChanged } = await validateRoomAssignment(deps, existing, dto.roomId, { allowTypeChange: dto.allowTypeChange, userId: currentUser.id })
  const updated = (await deps.repo.update(id, patch as any)) as ReservasDTO
  if (existing.status === 'checked_in') await moveStay(deps, id, previousRoomId, dto.roomId)

  const base = { hotelId: existing.hotelId, userId: currentUser.id, entity: 'reservation', entityId: id }
  await auditSafely(deps.auditPort, deps.logger, { ...base, action: 'reservation.room_assigned', detail: JSON.stringify({ from: previousRoomId, to: dto.roomId }) })
  if (typeChanged) {
    await auditSafely(deps.auditPort, deps.logger, { ...base, action: 'reservation.room_type_changed', detail: JSON.stringify({ from: existing.roomType ?? null, to: patch.roomType }) })
  }
  await emitAssigned(deps, existing, dto.roomId, previousRoomId)
  return updated
}

/** DELETE /reservas/:id/assign-room. Sólo antes del check-in: en estadía la unidad no se suelta. */
export async function unassignRoom(deps: RoomAssignmentDeps, id: string, currentUser: CurrentUser): Promise<ReservasDTO> {
  const existing = await loadReservation(deps.repo, id, currentUser, deps.auth)
  if (existing.status !== 'pending' && existing.status !== 'confirmed') {
    throw new ConflictError(`No se puede soltar la habitación de una reserva ${existing.status}`, { reason: 'invalid_status', status: existing.status })
  }
  const previousRoomId: string | null = existing.roomId ?? null
  if (!previousRoomId) return existing

  // El tipo vendido se conserva: si la fila venía sin `roomType`, se fija al de la unidad que tenía
  // para que la próxima asignación siga validando contra ese tipo.
  const roomType = existing.roomType || (await effectiveRoomType(deps.roomRepo, existing))
  const updated = (await deps.repo.update(id, { roomId: null, roomAssignedAt: null, roomAssignedBy: null, ...(roomType && !existing.roomType ? { roomType } : {}) } as any)) as ReservasDTO
  await auditSafely(deps.auditPort, deps.logger, { hotelId: existing.hotelId, userId: currentUser.id, action: 'reservation.room_unassigned', entity: 'reservation', entityId: id, detail: JSON.stringify({ from: previousRoomId }) })
  await emitAssigned(deps, existing, null, previousRoomId)
  return updated
}

/** Orden: limpias y `available` primero, después libres con otro status, después el resto; typeMismatch al final. */
function rankAssignable(r: AssignableRoom): number {
  let rank = r.cleaningStatus === 'clean' && r.status === 'available' ? 0 : r.cleaningStatus === 'clean' ? 1 : 2
  if (r.typeMismatch) rank += 10
  return rank
}

/**
 * GET /reservas/:id/assignable-rooms. Habitaciones del hotel vendibles y libres esas noches.
 * La que ya tiene la reserva se incluye (no choca consigo misma). Sin `allTypes` sólo las del tipo
 * vendido; sin tipo vendido, todas.
 */
export async function listAssignableRooms(
  deps: Pick<RoomAssignmentDeps, 'repo' | 'roomRepo' | 'blockRepo' | 'auth'>,
  id: string,
  opts: { allTypes?: boolean },
  currentUser: CurrentUser,
): Promise<AssignableRoom[]> {
  const existing = await loadReservation(deps.repo, id, currentUser, deps.auth)
  const soldType = await effectiveRoomType(deps.roomRepo, existing)
  const rooms = (await deps.roomRepo.findMany({ hotelId: existing.hotelId } as any)) as any[]

  const reservations = (await deps.repo.findMany({ hotelId: existing.hotelId } as any)) as any[]
  const busy = new Set<string>()
  for (const r of reservations) {
    if (r.id === existing.id || !r.roomId) continue
    if (overlapsRange(r, existing.checkIn, existing.checkOut)) busy.add(String(r.roomId))
  }
  if (deps.blockRepo) {
    const blocks = (await deps.blockRepo.findMany({ hotelId: existing.hotelId } as any)) as any[]
    for (const b of blocks) {
      if (b.roomId && existing.checkIn <= b.endDate && existing.checkOut >= b.startDate) busy.add(String(b.roomId))
    }
  }

  const out: AssignableRoom[] = rooms
    .filter((room) => isRoomSellable(room.status) && !busy.has(String(room.id)))
    .filter((room) => opts.allTypes || !soldType || room.type === soldType)
    .map((room): AssignableRoom => ({
      id: String(room.id),
      number: String(room.number ?? ''),
      floor: room.floor ?? null,
      status: String(room.status ?? ''),
      cleaningStatus: isCleaning(room.status) ? 'dirty' as const : 'clean' as const,
      typeMismatch: Boolean(soldType && room.type !== soldType),
      suggested: false,
    }))
    .sort((a, b) => rankAssignable(a) - rankAssignable(b) || a.number.localeCompare(b.number, undefined, { numeric: true }))
  if (out.length && rankAssignable(out[0]) === 0) out[0].suggested = true
  return out
}
