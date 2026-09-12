// reservas/tests/assign-room.test.ts — REQ-HAC-03 (#258): asignar / soltar / listar habitaciones.
//
// Cubre el usecase (no el HTTP controller) con repos in-memory (molde cancel-no-charge.test.ts):
// solape con reserva y con RoomBlock → 409 room_overlap; habitación de otro hotel → 400;
// maintenance → 409; tipo distinto sin flag → 409 type_mismatch y con flag cambia roomType +
// audita; reasignación en estadía mueve folio y estados de habitaciones; desasignar checked_in →
// 409; evento onRoomAssigned + auditoría; listAssignableRooms excluye ocupadas y ordena.
// Auth REAL (mismo criterio que mark-paid.test.ts): si assertOwnership se rompe, esto falla.
import { describe, it, expect } from 'bun:test'
import { Auth, ConflictError, ValidationError } from 'arckode-framework'
import { assignRoom, unassignRoom, listAssignableRooms, assertNoRoomConflict, type RoomAssignmentDeps } from '../usecases/assign-room'
import type { FolioRoomWriter } from '../usecases/reservas-queries'
import type { AuditEntry } from '../../../shared/usecases/audit'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const matches = (row: any, q: any) => Object.keys(q || {}).every((k) => row[k] === q[k])

/** Repo in-memory con estado: `update` mergea y `findMany` filtra por igualdad de campos. */
function memRepo(rows: any[], updates: any[] = []) {
  const data = rows.map((r) => ({ ...r }))
  return {
    findMany: async (q: any) => data.filter((r) => matches(r, q)),
    findOne: async (q: any) => data.find((r) => matches(r, q)) ?? null,
    findById: async (id: string) => data.find((r) => r.id === id) ?? null,
    update: async (id: string, patch: any) => {
      const i = data.findIndex((r) => r.id === id)
      if (i < 0) return null
      updates.push({ id, ...patch })
      data[i] = { ...data[i], ...patch }
      return data[i]
    },
    rows: data,
  } as any
}

/** Folios/Rooms en memoria + `transaction` secuencial (lo que hace ReservasQueries sin orm.transaction). */
function fakeQueries(folios: any[], rooms: any[], repo: any) {
  const writer: FolioRoomWriter = {
    findOpenFolioByReservation: async (reservationId) => folios.find((f) => f.reservationId === reservationId && f.status === 'open') ?? null,
    updateFolio: async (id, patch) => { Object.assign(folios.find((f) => f.id === id), patch) },
    updateRoom: async (roomId, patch) => { Object.assign(rooms.find((r) => r.id === roomId), patch) },
    updateReservation: async (id, patch) => { await repo.update(id, patch) },
  }
  // Simula el rollback de una tx real: si `fn` tira, restaura reservas/folios/rooms al snapshot.
  const transaction = async (fn: (q: FolioRoomWriter) => Promise<any>) => {
    const snap = { rows: repo.rows.map((r: any) => ({ ...r })), folios: folios.map((f) => ({ ...f })), rooms: rooms.map((r) => ({ ...r })) }
    try { return await fn(writer) } catch (e) {
      repo.rows.splice(0, repo.rows.length, ...snap.rows); folios.splice(0, folios.length, ...snap.folios); rooms.splice(0, rooms.length, ...snap.rooms)
      throw e
    }
  }
  return { transaction, txCalls: 0 } as any
}

const ROOMS = () => [
  { id: 'room-101', hotelId: HOTEL, number: '101', floor: 1, type: 'double', status: 'available' },
  { id: 'room-102', hotelId: HOTEL, number: '102', floor: 1, type: 'double', status: 'available' },
  { id: 'room-103', hotelId: HOTEL, number: '103', floor: 1, type: 'double', status: 'cleaning' },
  { id: 'room-104', hotelId: HOTEL, number: '104', floor: 1, type: 'double', status: 'maintenance' },
  { id: 'room-105', hotelId: HOTEL, number: '105', floor: 1, type: 'double', status: 'reserved' },
  { id: 'room-201', hotelId: HOTEL, number: '201', floor: 2, type: 'suite', status: 'available' },
  { id: 'room-901', hotelId: OTRO_HOTEL, number: '901', floor: 9, type: 'double', status: 'available' },
]

const baseRes = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: null, roomType: 'double', status: 'confirmed',
  checkIn: '2026-10-10', checkOut: '2026-10-13', totalAmount: 300, ...over,
})

type Harness = { deps: RoomAssignmentDeps; updates: any[]; audits: AuditEntry[]; emitted: any[]; rooms: any[]; folios: any[] }

function harness(reservas: any[], opts: { rooms?: any[]; blocks?: any[]; folios?: any[] } = {}): Harness {
  const updates: any[] = []
  const audits: AuditEntry[] = []
  const emitted: any[] = []
  const rooms = opts.rooms ?? ROOMS()
  const folios = opts.folios ?? []
  const repo = memRepo(reservas, updates)
  const deps: RoomAssignmentDeps = {
    repo,
    roomRepo: memRepo(rooms),
    blockRepo: memRepo(opts.blocks ?? []),
    queries: fakeQueries(folios, rooms, repo),
    sockets: { onRoomAssigned: async (d: any) => { emitted.push(d) } },
    auditPort: { record: async (e) => { audits.push(e) } },
    logger: noopLogger,
    cache: noopCache,
    auth: realAuth,
  }
  return { deps, updates, audits, emitted, rooms, folios }
}

const rejects = async (p: Promise<any>) => { try { await p } catch (e) { return e as any } throw new Error('esperaba rechazo') }

describe('assignRoom — conflictos', () => {
  it('solape con otra reserva asignada → 409 room_overlap con locator', async () => {
    const h = harness([baseRes(), { id: 'r2', hotelId: HOTEL, roomId: 'room-101', status: 'confirmed', checkIn: '2026-10-12', checkOut: '2026-10-15', externalLocator: 'BK-777' }])
    const e = await rejects(assignRoom(h.deps, 'r1', { roomId: 'room-101' }, user))
    expect(e).toBeInstanceOf(ConflictError)
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'room_overlap', conflictReservationId: 'r2', locator: 'BK-777' })
    expect(h.updates).toHaveLength(0)
    expect(h.emitted).toHaveLength(0)
  })

  it('reserva cancelada / no_show / back-to-back no bloquean', async () => {
    const h = harness([
      baseRes(),
      { id: 'r2', hotelId: HOTEL, roomId: 'room-101', status: 'cancelled', checkIn: '2026-10-10', checkOut: '2026-10-13' },
      { id: 'r3', hotelId: HOTEL, roomId: 'room-101', status: 'no_show', checkIn: '2026-10-10', checkOut: '2026-10-13' },
      { id: 'r4', hotelId: HOTEL, roomId: 'room-101', status: 'confirmed', checkIn: '2026-10-13', checkOut: '2026-10-15' },
    ])
    const out = await assignRoom(h.deps, 'r1', { roomId: 'room-101' }, user)
    expect(out.roomId).toBe('room-101')
  })

  it('solape con RoomBlock → 409 room_overlap con blockId', async () => {
    const h = harness([baseRes()], { blocks: [{ id: 'blk-1', hotelId: HOTEL, roomId: 'room-101', startDate: '2026-10-12', endDate: '2026-10-20', reason: 'Pintura' }] })
    const e = await rejects(assignRoom(h.deps, 'r1', { roomId: 'room-101' }, user))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'room_overlap', blockId: 'blk-1' })
  })

  it('habitación de otro hotel o inexistente → 400', async () => {
    const h = harness([baseRes()])
    const e1 = await rejects(assignRoom(h.deps, 'r1', { roomId: 'room-901' }, user))
    expect(e1).toBeInstanceOf(ValidationError)
    expect(e1.httpStatus).toBe(400)
    const e2 = await rejects(assignRoom(h.deps, 'r1', { roomId: 'nope' }, user))
    expect(e2.httpStatus).toBe(400)
  })

  it('maintenance → 409 room_not_sellable', async () => {
    const h = harness([baseRes()])
    const e = await rejects(assignRoom(h.deps, 'r1', { roomId: 'room-104' }, user))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'room_not_sellable' })
  })

  it('reserva de otro hotel → ownership (403) y cancelada/checked_out → 409 invalid_status', async () => {
    const h = harness([baseRes({ hotelId: OTRO_HOTEL })])
    const e = await rejects(assignRoom(h.deps, 'r1', { roomId: 'room-101' }, user))
    expect(e.httpStatus).toBe(403)
    for (const status of ['cancelled', 'no_show', 'checked_out']) {
      const h2 = harness([baseRes({ status })])
      const e2 = await rejects(assignRoom(h2.deps, 'r1', { roomId: 'room-101' }, user))
      expect(e2.httpStatus).toBe(409)
      expect(e2.details).toMatchObject({ reason: 'invalid_status' })
    }
  })

  it('reserva inexistente → 404', async () => {
    const h = harness([])
    const e = await rejects(assignRoom(h.deps, 'zzz', { roomId: 'room-101' }, user))
    expect(e.httpStatus).toBe(404)
  })

  it('assertNoRoomConflict excluye la propia reserva', async () => {
    const h = harness([baseRes({ roomId: 'room-101' })])
    await assertNoRoomConflict(h.deps, HOTEL, 'room-101', '2026-10-10', '2026-10-13', 'r1')
    const e = await rejects(assertNoRoomConflict(h.deps, HOTEL, 'room-101', '2026-10-10', '2026-10-13'))
    expect(e.details.reason).toBe('room_overlap')
  })
})

describe('assignRoom — tipo', () => {
  it('tipo distinto sin allowTypeChange → 409 type_mismatch {expected, actual}', async () => {
    const h = harness([baseRes()])
    const e = await rejects(assignRoom(h.deps, 'r1', { roomId: 'room-201' }, user))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'type_mismatch', expected: 'double', actual: 'suite' })
    expect(h.audits).toHaveLength(0)
  })

  it('con allowTypeChange → roomType nuevo + audit reservation.room_type_changed', async () => {
    const h = harness([baseRes()])
    const out = await assignRoom(h.deps, 'r1', { roomId: 'room-201', allowTypeChange: true }, user)
    expect(out.roomId).toBe('room-201')
    expect(out.roomType).toBe('suite')
    const typeAudit = h.audits.find((a) => a.action === 'reservation.room_type_changed')
    expect(typeAudit).toBeTruthy()
    expect(JSON.parse(typeAudit!.detail!)).toEqual({ from: 'double', to: 'suite' })
  })

  it('sin roomType (fila legacy) usa el tipo de la habitación que tenía; sin ninguno, rellena roomType', async () => {
    // Legacy con habitación: tipo efectivo = rooms.type de la actual → suite choca.
    const h = harness([baseRes({ roomType: undefined, roomId: 'room-101' })])
    const e = await rejects(assignRoom(h.deps, 'r1', { roomId: 'room-201' }, user))
    expect(e.details.reason).toBe('type_mismatch')
    const ok = await assignRoom(h.deps, 'r1', { roomId: 'room-102' }, user)
    expect(ok.roomType).toBe('double')
    // Sin tipo ni habitación: cualquiera vale y roomType queda fijado.
    const h2 = harness([baseRes({ roomType: undefined })])
    const out = await assignRoom(h2.deps, 'r1', { roomId: 'room-201' }, user)
    expect(out.roomType).toBe('suite')
    expect(h2.audits.map((a) => a.action)).toEqual(['reservation.room_assigned'])
  })
})

describe('assignRoom — efectos', () => {
  it('asigna: roomAssignedAt/By, audita room_assigned {from,to} y emite onRoomAssigned', async () => {
    const h = harness([baseRes()])
    const out = await assignRoom(h.deps, 'r1', { roomId: 'room-101' }, user)
    expect(out.roomId).toBe('room-101')
    expect(out.roomAssignedBy).toBe('u1')
    expect(out.roomAssignedAt).toBeTruthy()
    expect(h.updates).toHaveLength(1)
    const audit = h.audits.find((a) => a.action === 'reservation.room_assigned')!
    expect(audit).toMatchObject({ hotelId: HOTEL, userId: 'u1', entity: 'reservation', entityId: 'r1' })
    expect(JSON.parse(audit.detail!)).toEqual({ from: null, to: 'room-101' })
    expect(h.emitted).toEqual([{ reservationId: 'r1', hotelId: HOTEL, roomId: 'room-101', previousRoomId: null }])
    // Antes del check-in no se tocan los estados de las habitaciones.
    expect(h.rooms.find((r) => r.id === 'room-101').status).toBe('available')
  })

  it('misma habitación → idempotente: sin update, audit ni evento', async () => {
    const h = harness([baseRes({ roomId: 'room-101' })])
    const out = await assignRoom(h.deps, 'r1', { roomId: 'room-101' }, user)
    expect(out.roomId).toBe('room-101')
    expect(h.updates).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    expect(h.emitted).toHaveLength(0)
  })

  it('checked_in reasignada → folio.roomId nuevo, anterior cleaning, nueva occupied, evento con previousRoomId', async () => {
    const rooms = ROOMS()
    rooms.find((r) => r.id === 'room-101')!.status = 'occupied'
    const folios = [{ id: 'f1', hotelId: HOTEL, reservationId: 'r1', roomId: 'room-101', status: 'open' }, { id: 'f0', hotelId: HOTEL, reservationId: 'r1', roomId: 'room-101', status: 'closed' }]
    const h = harness([baseRes({ status: 'checked_in', roomId: 'room-101', folioId: 'f1' })], { rooms, folios })
    const out = await assignRoom(h.deps, 'r1', { roomId: 'room-102' }, user)
    expect(out.roomId).toBe('room-102')
    expect(folios[0].roomId).toBe('room-102')
    expect(folios[1].roomId).toBe('room-101')
    expect(rooms.find((r) => r.id === 'room-101')!.status).toBe('cleaning')
    expect(rooms.find((r) => r.id === 'room-102')!.status).toBe('occupied')
    expect(h.emitted).toEqual([{ reservationId: 'r1', hotelId: HOTEL, roomId: 'room-102', previousRoomId: 'room-101' }])
    expect(JSON.parse(h.audits[0].detail!)).toEqual({ from: 'room-101', to: 'room-102' })
  })

  it('checked_in: si mover folio/estados falla, la reserva NO queda con la habitación nueva (misma tx)', async () => {
    const rooms = ROOMS()
    const folios = [{ id: 'f1', hotelId: HOTEL, reservationId: 'r1', roomId: 'room-101', status: 'open' }]
    const h = harness([baseRes({ status: 'checked_in', roomId: 'room-101', folioId: 'f1' })], { rooms, folios })
    const q = h.deps.queries as any
    const inner = q.transaction
    q.transaction = (fn: any) => inner(async (w: FolioRoomWriter) => fn({ ...w, updateRoom: async () => { throw new Error('db caída') } }))
    const e = await rejects(assignRoom(h.deps, 'r1', { roomId: 'room-102' }, user))
    expect(e.message).toBe('db caída')
    expect((await h.deps.repo.findById('r1'))!.roomId).toBe('room-101')
    expect(folios[0].roomId).toBe('room-101')
    expect(h.emitted).toEqual([])
    expect(h.audits).toEqual([])
  })

  it('socket que falla no rompe la asignación', async () => {
    const h = harness([baseRes()])
    h.deps.sockets = { onRoomAssigned: async () => { throw new Error('ttlock caído') } }
    const out = await assignRoom(h.deps, 'r1', { roomId: 'room-101' }, user)
    expect(out.roomId).toBe('room-101')
  })
})

describe('unassignRoom', () => {
  it('suelta la habitación: roomId/roomAssignedAt/By null, roomType se conserva, audit + evento', async () => {
    const h = harness([baseRes({ roomId: 'room-101', roomAssignedAt: '2026-09-01T00:00:00.000Z', roomAssignedBy: 'u0' })])
    const out = await unassignRoom(h.deps, 'r1', user)
    expect(out.roomId).toBeNull()
    expect(out.roomAssignedAt).toBeNull()
    expect(out.roomAssignedBy).toBeNull()
    expect(out.roomType).toBe('double')
    expect(JSON.parse(h.audits[0].detail!)).toEqual({ from: 'room-101' })
    expect(h.audits[0].action).toBe('reservation.room_unassigned')
    expect(h.emitted).toEqual([{ reservationId: 'r1', hotelId: HOTEL, roomId: null, previousRoomId: 'room-101' }])
  })

  it('fila legacy sin roomType: al soltar fija roomType al tipo de la habitación que tenía', async () => {
    const h = harness([baseRes({ roomId: 'room-201', roomType: undefined })])
    const out = await unassignRoom(h.deps, 'r1', user)
    expect(out.roomId).toBeNull()
    expect(out.roomType).toBe('suite')
  })

  it('checked_in → 409 invalid_status; sin habitación → idempotente', async () => {
    const h = harness([baseRes({ status: 'checked_in', roomId: 'room-101' })])
    const e = await rejects(unassignRoom(h.deps, 'r1', user))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'invalid_status' })
    const h2 = harness([baseRes()])
    const out = await unassignRoom(h2.deps, 'r1', user)
    expect(out.roomId).toBeNull()
    expect(h2.updates).toHaveLength(0)
    expect(h2.emitted).toHaveLength(0)
  })

  it('reserva de otro hotel → 403', async () => {
    const h = harness([baseRes({ hotelId: OTRO_HOTEL, roomId: 'room-101' })])
    const e = await rejects(unassignRoom(h.deps, 'r1', user))
    expect(e.httpStatus).toBe(403)
  })
})

describe('listAssignableRooms', () => {
  const others = () => [
    // room-102 ocupada esas noches por otra reserva; room-101 sólo por una cancelada.
    { id: 'r2', hotelId: HOTEL, roomId: 'room-102', status: 'confirmed', checkIn: '2026-10-11', checkOut: '2026-10-12' },
    { id: 'r3', hotelId: HOTEL, roomId: 'room-101', status: 'cancelled', checkIn: '2026-10-10', checkOut: '2026-10-13' },
    // Sin habitación: no ocupa nada.
    { id: 'r4', hotelId: HOTEL, roomId: null, status: 'confirmed', checkIn: '2026-10-10', checkOut: '2026-10-13' },
  ]

  it('excluye ocupadas/bloqueadas/maintenance y ordena limpia→libre→resto con suggested en la primera', async () => {
    const h = harness([baseRes(), ...others()], { blocks: [{ id: 'blk', hotelId: HOTEL, roomId: 'room-105', startDate: '2026-10-01', endDate: '2026-10-31' }] })
    const out = await listAssignableRooms(h.deps, 'r1', {}, user)
    expect(out.map((r) => r.id)).toEqual(['room-101', 'room-103'])
    expect(out[0]).toMatchObject({ id: 'room-101', number: '101', floor: 1, status: 'available', cleaningStatus: 'clean', typeMismatch: false, suggested: true })
    expect(out[1]).toMatchObject({ id: 'room-103', cleaningStatus: 'dirty', suggested: false })
    // Sin bloqueo, `reserved` (libre pero no available) va después de las limpias available.
    const h2 = harness([baseRes(), ...others()])
    const ids = (await listAssignableRooms(h2.deps, 'r1', {}, user)).map((r) => r.id)
    expect(ids).toEqual(['room-101', 'room-105', 'room-103'])
  })

  it('allTypes incluye otros tipos marcados typeMismatch al final; sin tipo efectivo, todas', async () => {
    const h = harness([baseRes(), ...others()])
    const out = await listAssignableRooms(h.deps, 'r1', { allTypes: true }, user)
    expect(out.map((r) => r.id)).toEqual(['room-101', 'room-105', 'room-103', 'room-201'])
    expect(out.find((r) => r.id === 'room-201')).toMatchObject({ typeMismatch: true, suggested: false })
    expect(out[0].suggested).toBe(true)
    const h2 = harness([baseRes({ roomType: undefined }), ...others()])
    const all = await listAssignableRooms(h2.deps, 'r1', {}, user)
    expect(all.map((r) => r.id)).toContain('room-201')
    expect(all.every((r) => !r.typeMismatch)).toBe(true)
  })

  it('la habitación ya asignada a esta reserva se incluye (no choca consigo misma)', async () => {
    const h = harness([baseRes({ roomId: 'room-101' })])
    const out = await listAssignableRooms(h.deps, 'r1', {}, user)
    expect(out.map((r) => r.id)).toContain('room-101')
  })

  it('sin habitación limpia available, nadie queda suggested', async () => {
    const rooms = ROOMS().map((r) => (r.status === 'available' ? { ...r, status: 'cleaning' } : r))
    const h = harness([baseRes()], { rooms })
    const out = await listAssignableRooms(h.deps, 'r1', {}, user)
    expect(out.length).toBeGreaterThan(0)
    expect(out.some((r) => r.suggested)).toBe(false)
  })

  it('reserva de otro hotel → 403', async () => {
    const h = harness([baseRes({ hotelId: OTRO_HOTEL })])
    const e = await rejects(listAssignableRooms(h.deps, 'r1', {}, user))
    expect(e.httpStatus).toBe(403)
  })
})
