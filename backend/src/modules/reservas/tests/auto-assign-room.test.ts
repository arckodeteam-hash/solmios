// reservas/tests/auto-assign-room.test.ts — REQ-HAC-07 (#262): auto-asignación de la sugerida por el sistema.
//
// Cubre el usecase (no el cron) con el mismo harness que assign-room.test.ts (repos in-memory,
// Auth REAL): con una libre del tipo vendido → asigna, `roomAssignedBy === 'system'`, auditoría
// `reservation.room_assigned` con userId 'system' y `onRoomAssigned`; otro hotel → 403; sin libres →
// no_rooms sin escribir nada; ya asignada → already_assigned sin update; cancelada → closed; inexistente → not_found.
import { describe, it, expect } from 'bun:test'
import { Auth, ForbiddenError } from 'arckode-framework'
import type { RoomAssignmentDeps } from '../usecases/assign-room'
import { autoAssignSuggestedRoom, SYSTEM_ASSIGNER } from '../usecases/auto-assign-room'
import type { FolioRoomWriter } from '../usecases/reservas-queries'
import type { AuditEntry } from '../../../shared/usecases/audit'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'

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

/** `transaction` secuencial (lo que hace ReservasQueries sin orm.transaction). Acá nadie está checked_in, no se usa. */
function fakeQueries(rooms: any[], repo: any) {
  const writer: FolioRoomWriter = {
    findOpenFolioByReservation: async () => null,
    updateFolio: async () => {},
    updateRoom: async (roomId, patch) => { Object.assign(rooms.find((r) => r.id === roomId), patch) },
    updateReservation: async (id, patch) => { await repo.update(id, patch) },
  }
  return { transaction: async (fn: (q: FolioRoomWriter) => Promise<any>) => fn(writer) } as any
}

const ROOMS = () => [
  { id: 'room-101', hotelId: HOTEL, number: '101', floor: 1, type: 'doble', status: 'available' },
  { id: 'room-102', hotelId: HOTEL, number: '102', floor: 1, type: 'doble', status: 'available' },
  { id: 'room-103', hotelId: HOTEL, number: '103', floor: 1, type: 'doble', status: 'available' },
  { id: 'room-201', hotelId: HOTEL, number: '201', floor: 2, type: 'suite', status: 'available' },
]

const baseRes = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: null, roomType: 'doble', status: 'confirmed',
  checkIn: '2026-10-10', checkOut: '2026-10-13', totalAmount: 300, ...over,
})

/** Otra reserva que ocupa `roomId` esas mismas noches. */
const occupying = (id: string, roomId: string) => ({ id, hotelId: HOTEL, roomId, roomType: 'doble', status: 'confirmed', checkIn: '2026-10-09', checkOut: '2026-10-12' })

type Harness = { deps: RoomAssignmentDeps; updates: any[]; audits: AuditEntry[]; emitted: any[]; repo: any }

function harness(reservas: any[], opts: { rooms?: any[]; blocks?: any[] } = {}): Harness {
  const updates: any[] = []
  const audits: AuditEntry[] = []
  const emitted: any[] = []
  const rooms = opts.rooms ?? ROOMS()
  const repo = memRepo(reservas, updates)
  const deps: RoomAssignmentDeps = {
    repo,
    roomRepo: memRepo(rooms),
    blockRepo: memRepo(opts.blocks ?? []),
    queries: fakeQueries(rooms, repo),
    sockets: { onRoomAssigned: async (d: any) => { emitted.push(d) } },
    auditPort: { record: async (e) => { audits.push(e) } },
    logger: noopLogger,
    cache: noopCache,
    auth: realAuth,
  }
  return { deps, updates, audits, emitted, repo }
}

describe('autoAssignSuggestedRoom — con habitación libre del tipo', () => {
  it('asigna una libre (no la ocupada) con roomAssignedBy system, auditoría y onRoomAssigned', async () => {
    // 101 ocupada por r2 esas noches → quedan 102 y 103 (doble). La suite 201 no cuenta: tipo distinto.
    const h = harness([baseRes(), occupying('r2', 'room-101')])
    const out = await autoAssignSuggestedRoom(h.deps, 'r1', HOTEL)

    expect(out.assigned).toBe(true)
    if (!out.assigned) throw new Error('unreachable')
    expect(['room-102', 'room-103']).toContain(out.roomId)
    expect(out.roomNumber).toBe(out.roomId === 'room-102' ? '102' : '103')

    const row = await h.repo.findById('r1')
    expect(row.roomId).toBe(out.roomId)
    expect(row.roomAssignedBy).toBe('system')
    expect(row.roomAssignedBy).toBe(SYSTEM_ASSIGNER)
    expect(row.roomAssignedAt).toBeTruthy()
    expect(row.roomType).toBe('doble')

    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ action: 'reservation.room_assigned', userId: 'system', entity: 'reservation', entityId: 'r1', hotelId: HOTEL })
    expect(JSON.parse(String(h.audits[0].detail))).toEqual({ from: null, to: out.roomId })

    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0]).toMatchObject({ reservationId: 'r1', hotelId: HOTEL, roomId: out.roomId, previousRoomId: null })
  })

  it('prefiere la sugerida (rank 0: available + limpia, menor número)', async () => {
    const h = harness([baseRes()])
    const out = await autoAssignSuggestedRoom(h.deps, 'r1', HOTEL)
    expect(out).toEqual({ assigned: true, roomId: 'room-101', roomNumber: '101' })
  })

  it('hotelId de otro hotel → 403 (Auth real: el rol system no saltea el scoping) y no escribe nada', async () => {
    const h = harness([baseRes()])
    let err: any = null
    try { await autoAssignSuggestedRoom(h.deps, 'r1', 'hotel-b') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ForbiddenError)
    expect(h.updates).toHaveLength(0)
    expect(h.emitted).toHaveLength(0)
  })
})

describe('autoAssignSuggestedRoom — sin efecto', () => {
  it('sin habitaciones libres del tipo → no_rooms; la reserva sigue sin roomId, sin audit ni socket', async () => {
    const h = harness([baseRes(), occupying('r2', 'room-101'), occupying('r3', 'room-102'), occupying('r4', 'room-103')])
    const out = await autoAssignSuggestedRoom(h.deps, 'r1', HOTEL)
    expect(out).toEqual({ assigned: false, reason: 'no_rooms' })
    expect((await h.repo.findById('r1')).roomId).toBeNull()
    expect(h.updates).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    expect(h.emitted).toHaveLength(0)
  })

  it('reserva ya con roomId → already_assigned y ningún update', async () => {
    const h = harness([baseRes({ roomId: 'room-102', roomAssignedBy: 'u1' })])
    const out = await autoAssignSuggestedRoom(h.deps, 'r1', HOTEL)
    expect(out).toEqual({ assigned: false, reason: 'already_assigned' })
    const row = await h.repo.findById('r1')
    expect(row.roomId).toBe('room-102')
    expect(row.roomAssignedBy).toBe('u1')
    expect(h.updates).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
    expect(h.emitted).toHaveLength(0)
  })

  it('reserva cancelled → closed', async () => {
    const h = harness([baseRes({ status: 'cancelled' })])
    const out = await autoAssignSuggestedRoom(h.deps, 'r1', HOTEL)
    expect(out).toEqual({ assigned: false, reason: 'closed' })
    expect(h.updates).toHaveLength(0)
    expect(h.emitted).toHaveLength(0)
  })

  it('reserva inexistente → not_found', async () => {
    const h = harness([])
    expect(await autoAssignSuggestedRoom(h.deps, 'nope', HOTEL)).toEqual({ assigned: false, reason: 'not_found' })
  })
})
