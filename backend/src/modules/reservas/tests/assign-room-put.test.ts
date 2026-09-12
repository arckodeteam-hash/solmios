// reservas/tests/assign-room-put.test.ts — REQ-HAC-03 (#258): UN solo camino para escribir `roomId`.
//
// `PUT /api/reservas/:id` (updateReservation) con un `roomId` distinto delega en
// `validateRoomAssignment` (assign-room.ts) — mismo solape/tipo/sello que POST /assign-room — y
// emite `onRoomAssigned` (+ auditoría si el caller cableó `hooks.roomAssignment.auditPort`).
// validate-update.ts ya NO valida solape por su cuenta: sólo re-chequea la unidad actual cuando
// cambian las fechas. `createReservation` rellena `roomType` desde `rooms.type` (HAC-01).
// Repos in-memory (molde assign-room.test.ts / crud-capacity.test.ts).
import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { createReservation, updateReservation } from '../usecases/crud'
import type { AuditEntry } from '../../../shared/usecases/audit'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any

const HOTEL = 'hotel-a'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const matches = (row: any, q: any) => Object.keys(q || {}).every((k) => row[k] === q[k])

/** Repo in-memory con estado: `update` mergea, `create` asigna id, `findMany` filtra por igualdad. */
function memRepo(rows: any[], updates: any[] = []) {
  const data = rows.map((r) => ({ ...r }))
  return {
    findMany: async (q: any) => data.filter((r) => matches(r, q)),
    findOne: async (q: any) => data.find((r) => matches(r, q)) ?? null,
    findById: async (id: string) => data.find((r) => r.id === id) ?? null,
    create: async (row: any) => { const item = { id: 'r-new', ...row }; data.push(item); return item },
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

const ROOMS = () => [
  { id: 'room-101', hotelId: HOTEL, number: '101', type: 'double', status: 'available', capacity: 2 },
  { id: 'room-102', hotelId: HOTEL, number: '102', type: 'double', status: 'available', capacity: 2 },
  { id: 'room-201', hotelId: HOTEL, number: '201', type: 'suite', status: 'available', capacity: 4 },
]

const baseRes = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-101', roomType: 'double', status: 'confirmed',
  checkIn: '2026-10-10', checkOut: '2026-10-13', totalAmount: 300, adults: 2, children: 0, ...over,
})

function harness(reservas: any[], opts: { rooms?: any[]; auditPort?: boolean; blocks?: any[] } = {}) {
  const updates: any[] = []
  const audits: AuditEntry[] = []
  const assigned: any[] = []
  const updated: any[] = []
  const repo = memRepo(reservas, updates)
  const roomRepo = memRepo(opts.rooms ?? ROOMS())
  const sockets = {
    onRoomAssigned: async (d: any) => { assigned.push(d) },
    onReservasUpdated: async (d: any) => { updated.push(d) },
    onReservasCreated: async () => {},
  }
  const hooks = opts.auditPort || opts.blocks
    ? { roomAssignment: {
        ...(opts.auditPort ? { auditPort: { record: async (e: AuditEntry) => { audits.push(e) } } } : {}),
        ...(opts.blocks ? { blockRepo: memRepo(opts.blocks) } : {}),
      } }
    : undefined
  const put = (id: string, dto: Record<string, any>) =>
    updateReservation(repo, noopLogger, noopCache, sockets, id, dto as any, user, roomRepo, undefined, undefined, undefined, hooks)
  return { repo, roomRepo, sockets, hooks, put, updates, audits, assigned, updated }
}

const rejects = async (p: Promise<any>) => { try { await p } catch (e) { return e as any } throw new Error('esperaba rechazo') }

describe('PUT /reservas/:id con roomId distinto — delega en validateRoomAssignment', () => {
  it('(a) habitación ocupada esas noches → 409 room_overlap, no persiste ni emite', async () => {
    const h = harness([
      baseRes(),
      { id: 'r2', hotelId: HOTEL, roomId: 'room-102', status: 'confirmed', checkIn: '2026-10-12', checkOut: '2026-10-15', externalLocator: 'BK-2' },
    ])
    const e = await rejects(h.put('r1', { roomId: 'room-102' }))
    expect(e).toBeInstanceOf(ConflictError)
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'room_overlap', conflictReservationId: 'r2', locator: 'BK-2' })
    expect(h.updates).toHaveLength(0)
    expect(h.assigned).toHaveLength(0)
  })

  it('(a bis) con hooks.roomAssignment.blockRepo: RoomBlock en esas noches → 409 room_overlap', async () => {
    const h = harness([baseRes()], { blocks: [{ id: 'blk-1', hotelId: HOTEL, roomId: 'room-102', startDate: '2026-10-11', endDate: '2026-10-20' }] })
    const e = await rejects(h.put('r1', { roomId: 'room-102' }))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'room_overlap', blockId: 'blk-1' })
  })

  it('(b) habitación de otro tipo sin allowTypeChange → 409 type_mismatch', async () => {
    const h = harness([baseRes()])
    const e = await rejects(h.put('r1', { roomId: 'room-201' }))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'type_mismatch', expected: 'double', actual: 'suite' })
    expect(h.updates).toHaveLength(0)
  })

  it('(b bis) con allowTypeChange → roomType nuevo + audit room_type_changed', async () => {
    const h = harness([baseRes()], { auditPort: true })
    const out: any = await h.put('r1', { roomId: 'room-201', allowTypeChange: true })
    expect(out.roomId).toBe('room-201')
    expect(out.roomType).toBe('suite')
    expect(h.audits.map((a) => a.action)).toEqual(['reservation.room_assigned', 'reservation.room_type_changed'])
  })

  it('(c) roomId válido → roomAssignedAt/By persistidos y onRoomAssigned con previousRoomId', async () => {
    const h = harness([baseRes()])
    const out: any = await h.put('r1', { roomId: 'room-102', notes: 'cambio por pedido del huésped' })
    expect(out.roomId).toBe('room-102')
    expect(out.roomAssignedBy).toBe('u1')
    expect(typeof out.roomAssignedAt).toBe('string')
    expect(out.notes).toBe('cambio por pedido del huésped')
    // Lo persistido lleva el sello, no sólo el objeto devuelto.
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]).toMatchObject({ id: 'r1', roomId: 'room-102', roomAssignedBy: 'u1' })
    expect(h.assigned).toEqual([{ reservationId: 'r1', hotelId: HOTEL, roomId: 'room-102', previousRoomId: 'room-101' }])
    // Se emite ANTES del onReservasUpdated (mismo orden: persistir → hooks → sockets).
    expect(h.updated).toHaveLength(1)
  })

  it('(c bis) reserva sin habitación (HAC-01): previousRoomId null; con auditPort audita room_assigned {from,to}', async () => {
    const h = harness([baseRes({ roomId: null })], { auditPort: true })
    const out: any = await h.put('r1', { roomId: 'room-102' })
    expect(out.roomId).toBe('room-102')
    expect(h.assigned).toEqual([{ reservationId: 'r1', hotelId: HOTEL, roomId: 'room-102', previousRoomId: null }])
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ action: 'reservation.room_assigned', entity: 'reservation', entityId: 'r1', hotelId: HOTEL, userId: 'u1' })
    expect(JSON.parse(h.audits[0].detail!)).toEqual({ from: null, to: 'room-102' })
  })

  it('sin auditPort cableado: no audita pero el evento sale igual', async () => {
    const h = harness([baseRes()])
    await h.put('r1', { roomId: 'room-102' })
    expect(h.audits).toHaveLength(0)
    expect(h.assigned).toHaveLength(1)
  })

  it('mismo roomId que ya tiene: no pasa por la asignación (sin sello ni evento)', async () => {
    const h = harness([baseRes()])
    const out: any = await h.put('r1', { roomId: 'room-101', notes: 'x' })
    expect(out.notes).toBe('x')
    expect(out.roomAssignedAt).toBeUndefined()
    expect(h.assigned).toHaveLength(0)
  })

  it('roomId vacío/null → 409 use_unassign_endpoint (soltar es DELETE /assign-room)', async () => {
    const h = harness([baseRes()])
    for (const roomId of [null, '']) {
      const e = await rejects(h.put('r1', { roomId }))
      expect(e.httpStatus).toBe(409)
      expect(e.details).toMatchObject({ reason: 'use_unassign_endpoint' })
    }
    expect(h.updates).toHaveLength(0)
  })

  it('reserva checked_in → 409 use_assign_endpoint (mover una estadía es POST /assign-room)', async () => {
    const h = harness([baseRes({ status: 'checked_in' })])
    const e = await rejects(h.put('r1', { roomId: 'room-102' }))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'use_assign_endpoint' })
    expect(h.updates).toHaveLength(0)
    expect(h.assigned).toHaveLength(0)
  })

  it.each(['cancelled', 'no_show', 'checked_out'])('reserva %s → 409 invalid_status (mismo cierre que POST /assign-room)', async (status) => {
    const h = harness([baseRes({ status })])
    const e = await rejects(h.put('r1', { roomId: 'room-102' }))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'invalid_status', status })
    expect(h.updates).toHaveLength(0)
    expect(h.assigned).toHaveLength(0)
  })

  it('sin roomRepo (caller viejo) → 409 fail-closed, no persiste', async () => {
    const h = harness([baseRes()])
    const e = await rejects(updateReservation(h.repo, noopLogger, noopCache, h.sockets, 'r1', { roomId: 'room-102' } as any, user))
    expect(e).toBeInstanceOf(ConflictError)
    expect(h.updates).toHaveLength(0)
  })
})

describe('PUT sólo fechas — validate-update re-chequea la unidad actual con assertNoRoomConflict', () => {
  it('(d) la habitación actual está ocupada las nuevas noches → 409 room_overlap', async () => {
    const h = harness([
      baseRes(),
      { id: 'r2', hotelId: HOTEL, roomId: 'room-101', status: 'confirmed', checkIn: '2026-10-14', checkOut: '2026-10-16' },
    ])
    const e = await rejects(h.put('r1', { checkIn: '2026-10-10', checkOut: '2026-10-15' }))
    expect(e.httpStatus).toBe(409)
    expect(e.details).toMatchObject({ reason: 'room_overlap', conflictReservationId: 'r2' })
    expect(h.updates).toHaveLength(0)
  })

  it('fechas libres (back-to-back) → acepta sin pasar por la asignación', async () => {
    const h = harness([
      baseRes(),
      { id: 'r2', hotelId: HOTEL, roomId: 'room-101', status: 'confirmed', checkIn: '2026-10-15', checkOut: '2026-10-16' },
    ])
    const out: any = await h.put('r1', { checkIn: '2026-10-10', checkOut: '2026-10-15' })
    expect(out.checkOut).toBe('2026-10-15')
    expect(h.assigned).toHaveLength(0)
  })

  it('reserva sin habitación: cambiar fechas no chequea solape (no hay unidad)', async () => {
    const h = harness([baseRes({ roomId: null })])
    const out: any = await h.put('r1', { checkIn: '2026-10-11', checkOut: '2026-10-14' })
    expect(out.checkIn).toBe('2026-10-11')
  })

  it('cambia habitación Y fechas: el solape se mira contra la habitación NUEVA con las fechas NUEVAS', async () => {
    const h = harness([
      baseRes(),
      { id: 'r2', hotelId: HOTEL, roomId: 'room-102', status: 'confirmed', checkIn: '2026-10-20', checkOut: '2026-10-22' },
    ])
    const e = await rejects(h.put('r1', { roomId: 'room-102', checkIn: '2026-10-19', checkOut: '2026-10-21' }))
    expect(e.details).toMatchObject({ reason: 'room_overlap', conflictReservationId: 'r2' })
    const out: any = await h.put('r1', { roomId: 'room-102', checkIn: '2026-10-16', checkOut: '2026-10-20' })
    expect(out.roomId).toBe('room-102')
    expect(out.checkIn).toBe('2026-10-16')
  })
})

describe('createReservation — roomType (HAC-01)', () => {
  const dto = (over: Record<string, any> = {}) => ({
    hotelId: HOTEL, roomId: 'room-101', checkIn: '2026-11-01', checkOut: '2026-11-03', status: 'confirmed', totalAmount: 200, adults: 2, children: 0, ...over,
  }) as any
  const create = (repo: any, roomRepo: any, d: any) =>
    createReservation(repo, undefined, noopLogger, noopCache, { onReservasCreated: async () => {} }, {}, d, user, roomRepo)

  it('(e) alta con habitación → roomType = room.type', async () => {
    const repo = memRepo([])
    const item: any = await create(repo, memRepo(ROOMS()), dto())
    expect(item.roomType).toBe('double')
    expect(repo.rows[0].roomType).toBe('double')
  })

  it('el dto puede declarar roomType (prevalece) y sin roomRepo se persiste el declarado', async () => {
    // REQ-HAC-02 (#257): el tipo declarado tiene que tener inventario (`availableOfType`); un tipo
    // sin unidades es "agotado", así que se declara uno que existe pero no es el de la unidad.
    const withRoom: any = await create(memRepo([]), memRepo(ROOMS()), dto({ roomId: 'room-201', roomType: 'double' }))
    expect(withRoom.roomType).toBe('double')
    const noRepo: any = await create(memRepo([]), undefined, dto({ roomType: 'double' }))
    expect(noRepo.roomType).toBe('double')
  })
})
