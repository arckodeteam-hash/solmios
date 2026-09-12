// reservas/tests/create-type-availability.test.ts — REQ-HAC-02 (#257): alta desde el panel.
//
// Desde HAC-01 una reserva `confirmed` puede vivir sin `roomId` (sólo `roomType`). El chequeo viejo
// de `createReservation` miraba únicamente el solape de la UNIDAD elegida, así que con 2 dobles y 2
// reservas de "doble" sin asignar el panel seguía vendiendo una tercera. Ahora la venta se decide
// por TIPO con `availableOfType` (fuente única) y el solape por habitación queda sólo en
// `assertNoRoomConflict` (assign-room.ts), que sigue corriendo porque el alta del panel todavía
// exige `roomId` (crear ES asignar).

import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { createReservation } from '../usecases/crud'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const noopSockets = {} as any
const HOTEL = 'h1'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const SOLD_OUT_MSG = 'No hay habitaciones de este tipo disponibles para esas fechas'

/** Reservas del hotel; `findMany` filtra por `roomId` / `roomType` como lo haría el ORM. */
function resRepo(rows: any[] = []) {
  return {
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    findMany: async (q: any = {}) => rows.filter((r) =>
      (q.roomId == null || r.roomId === q.roomId)
      && (q.roomType == null || r.roomType === q.roomType)
      && (q.hotelId == null || r.hotelId === q.hotelId)),
    create: async (data: any) => ({ id: 'r-new', ...data }),
    update: async (id: string, data: any) => ({ ...rows.find((r) => r.id === id), ...data, id }),
  } as any
}

/** Unidades del hotel; `findMany({hotelId,type})` filtra. */
function roomRepo(rooms: any[]) {
  return {
    findOne: async (f: { id: string }) => rooms.find((r) => r.id === f.id) ?? null,
    findById: async (id: string) => rooms.find((r) => r.id === id) ?? null,
    findMany: async (q: any = {}) => rooms.filter((r) =>
      (q.hotelId == null || r.hotelId === q.hotelId) && (q.type == null || r.type === q.type)),
  } as any
}

/** Mock VIEJO (crud-capacity.test.ts): sólo `findOne` — sin `findMany` no hay conteo por tipo. */
function legacyRoomRepo(rooms: any[]) {
  return { findOne: async (f: { id: string }) => rooms.find((r) => r.id === f.id) ?? null } as any
}

const configRepo = { findOne: async () => null } as any

const twoDoubles = [
  { id: 'd-1', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, number: '101' },
  { id: 'd-2', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, number: '102' },
]

const confirmed = (id: string, over: Record<string, any> = {}) => ({
  id, hotelId: HOTEL, roomId: null, roomType: 'double', status: 'confirmed',
  checkIn: '2026-07-20', checkOut: '2026-07-22', guestName: 'Ana', ...over,
})

const dto = (over: Record<string, any> = {}) => ({
  hotelId: HOTEL, roomId: 'd-1', guestId: 'g1', checkIn: '2026-07-20', checkOut: '2026-07-22',
  status: 'confirmed', totalAmount: 200, adults: 2, children: 0, ...over,
}) as any

function create(repo: any, rooms: any, over: Record<string, any> = {}, blockRepo?: any) {
  return createReservation(repo, blockRepo, noopLogger, noopCache, noopSockets, {}, dto(over), user, rooms, undefined, undefined, undefined, undefined, configRepo)
}

async function rejects409(p: Promise<any>, reason: string, message?: RegExp | string) {
  let err: any = null
  try { await p } catch (e) { err = e }
  expect(err).toBeInstanceOf(ConflictError)
  expect(err.httpStatus).toBe(409)
  if (message) expect(err.message).toMatch(message as any)
  expect(err.details?.reason).toBe(reason)
}

describe('createReservation — N+1 del mismo tipo rebota con 409 en alta desde panel (REQ-HAC-02)', () => {
  it('2 dobles + 2 confirmadas SIN asignar del tipo → 409 aunque la unidad elegida no tenga reservas', async () => {
    const repo = resRepo([confirmed('r-a'), confirmed('r-b')])
    await rejects409(create(repo, roomRepo(twoDoubles)), 'type_sold_out', SOLD_OUT_MSG)
  })

  it('1 asignada a la otra unidad + 1 sin asignar → 409 (la unidad elegida está "libre" pero el tipo no)', async () => {
    const repo = resRepo([confirmed('r-a', { roomId: 'd-2' }), confirmed('r-b')])
    await rejects409(create(repo, roomRepo(twoDoubles)), 'type_sold_out', SOLD_OUT_MSG)
  })

  it('control: 1 sin asignar con 2 unidades → se crea con roomType "double"', async () => {
    const repo = resRepo([confirmed('r-a')])
    const item = await create(repo, roomRepo(twoDoubles))
    expect(item.id).toBe('r-new')
    expect(item.roomType).toBe('double')
    expect(item.roomId).toBe('d-1')
  })

  it('unidad ocupada por una reserva ASIGNADA pero tipo con lugar → 409 room_overlap (solape por habitación sigue en el camino de asignar)', async () => {
    const repo = resRepo([confirmed('r-a', { roomId: 'd-1' })])
    await rejects409(create(repo, roomRepo(twoDoubles)), 'room_overlap', /ocupada/)
  })

  it('reservas que no bloquean (cancelled / no_show / checked_out) no consumen inventario del tipo', async () => {
    const repo = resRepo([
      confirmed('r-a', { status: 'cancelled' }),
      confirmed('r-b', { status: 'no_show', roomId: 'd-2' }),
      confirmed('r-c', { status: 'checked_out' }),
    ])
    const item = await create(repo, roomRepo(twoDoubles))
    expect(item.id).toBe('r-new')
  })

  it('reserva del tipo en OTRAS fechas no cuenta', async () => {
    const repo = resRepo([confirmed('r-a', { checkIn: '2026-07-22', checkOut: '2026-07-24' }), confirmed('r-b', { checkIn: '2026-07-10', checkOut: '2026-07-20' })])
    const item = await create(repo, roomRepo(twoDoubles))
    expect(item.id).toBe('r-new')
  })

  it('un RoomBlock sobre la otra unidad del tipo consume inventario: 1 sin asignar + 1 bloqueada → 409', async () => {
    const repo = resRepo([confirmed('r-a')])
    const blockRepo = { findMany: async (q: any = {}) => [{ id: 'b1', hotelId: HOTEL, roomId: 'd-2', startDate: '2026-07-21', endDate: '2026-07-21', reason: 'pintura' }].filter((b) => q.roomId == null || b.roomId === q.roomId) } as any
    await rejects409(create(repo, roomRepo(twoDoubles), {}, blockRepo), 'type_sold_out', SOLD_OUT_MSG)
  })

  it('mocks viejos sin `findMany` en roomRepo → no explota (se salta el conteo por tipo, queda el solape por unidad)', async () => {
    const repo = resRepo([confirmed('r-a'), confirmed('r-b')])
    const item = await create(repo, legacyRoomRepo(twoDoubles))
    expect(item.id).toBe('r-new')
    await rejects409(create(resRepo([confirmed('r-c', { roomId: 'd-1' })]), legacyRoomRepo(twoDoubles)), 'room_overlap', /ocupada/)
  })
})
