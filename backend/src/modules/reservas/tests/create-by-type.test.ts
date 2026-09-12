// reservas/tests/create-by-type.test.ts — REQ-HAC-05 (#260): alta desde el panel POR TIPO.
//
// Hasta HAC-05 el alta del panel exigía `roomId` (crear ERA asignar). Ahora vende un TIPO: sin
// `roomId` la fila nace con `roomType` y `roomId: null` (la unidad se elige después, assign-room),
// la disponibilidad se decide por tipo (`availableOfType`, fuente única → 409 `type_sold_out`) y
// la capacidad/precio salen del perfil del tipo (máx. capacidad / mín. basePrice entre sus
// unidades vendibles). Con `roomId` todo sigue como antes (regresión).

import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import { createReservation } from '../usecases/crud'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const noopSockets = {} as any
const HOTEL = 'h1'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

/** Reservas del hotel; `findMany` filtra por `roomId` / `roomType` como lo haría el ORM. `create`
 *  persiste la fila TAL CUAL (si `roomId` no viene, no está). */
function resRepo(rows: any[] = []) {
  const created: any[] = []
  return {
    created,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    findMany: async (q: any = {}) => rows.filter((r) =>
      (q.roomId == null || r.roomId === q.roomId)
      && (q.roomType == null || r.roomType === q.roomType)
      && (q.hotelId == null || r.hotelId === q.hotelId)),
    create: async (data: any) => { const row = { id: 'r-new', ...data }; created.push(row); return row },
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

const configRepo = { findOne: async () => null } as any

const twoDoubles = [
  { id: 'd-1', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, basePrice: 120, number: '101' },
  { id: 'd-2', hotelId: HOTEL, type: 'double', status: 'available', capacity: 3, basePrice: 100, number: '102' },
]

const confirmed = (id: string, over: Record<string, any> = {}) => ({
  id, hotelId: HOTEL, roomId: null, roomType: 'double', status: 'confirmed',
  checkIn: '2026-07-20', checkOut: '2026-07-22', guestName: 'Ana', ...over,
})

/** Alta SIN `roomId`: sólo tipo. */
const dtoByType = (over: Record<string, any> = {}) => ({
  hotelId: HOTEL, roomType: 'double', guestId: 'g1', checkIn: '2026-07-20', checkOut: '2026-07-22',
  status: 'confirmed', totalAmount: 200, adults: 2, children: 0, ...over,
}) as any

function create(repo: any, rooms: any, dto: any, extra: { blockRepo?: any; pricing?: any } = {}) {
  return createReservation(repo, extra.blockRepo, noopLogger, noopCache, noopSockets, {}, dto, user, rooms, undefined, undefined, undefined, extra.pricing, configRepo)
}

async function rejects409(p: Promise<any>, reason?: string, message?: RegExp | string) {
  let err: any = null
  try { await p } catch (e) { err = e }
  expect(err).toBeInstanceOf(ConflictError)
  expect(err.httpStatus).toBe(409)
  if (message) expect(err.message).toMatch(message as any)
  if (reason) expect(err.details?.reason).toBe(reason)
  return err
}

describe('createReservation — alta por TIPO sin unidad (REQ-HAC-05)', () => {
  it('(a) sin roomId con roomType → fila con roomType y roomId === null explícito', async () => {
    const repo = resRepo([])
    const item = await create(repo, roomRepo(twoDoubles), dtoByType())
    expect(item.id).toBe('r-new')
    expect(item.roomType).toBe('double')
    expect(item.roomId).toBeNull()
    // Lo que se le pasó al repo lleva la clave `roomId` con null, no ausente.
    expect(Object.prototype.hasOwnProperty.call(repo.created[0], 'roomId')).toBe(true)
    expect(repo.created[0].roomId).toBeNull()
  })

  it('(a-bis) roomId vacío ("" del wizard) cuenta como "sin unidad"', async () => {
    const repo = resRepo([])
    const item = await create(repo, roomRepo(twoDoubles), dtoByType({ roomId: '' }))
    expect(item.roomId).toBeNull()
    expect(item.roomType).toBe('double')
  })

  it('(b) sin roomId ni roomType → ConflictError (room_or_type_required), no se crea nada', async () => {
    const repo = resRepo([])
    await rejects409(create(repo, roomRepo(twoDoubles), dtoByType({ roomType: undefined })), 'room_or_type_required', /roomId o roomType/)
    expect(repo.created).toHaveLength(0)
    // Callers viejos sin roomRepo: la regla aplica igual.
    await rejects409(create(resRepo([]), undefined, dtoByType({ roomType: undefined })), 'room_or_type_required')
  })

  it('(c) tipo agotado: 2 unidades + 2 confirmadas del tipo SIN asignar → 409 type_sold_out', async () => {
    const repo = resRepo([confirmed('r-a'), confirmed('r-b')])
    await rejects409(create(repo, roomRepo(twoDoubles), dtoByType()), 'type_sold_out', /No hay habitaciones de este tipo/)
    expect(repo.created).toHaveLength(0)
  })

  it('(c-bis) 2 unidades + 1 sin asignar → se crea; una asignada + una sin asignar → 409', async () => {
    const item = await create(resRepo([confirmed('r-a')]), roomRepo(twoDoubles), dtoByType())
    expect(item.roomId).toBeNull()
    await rejects409(create(resRepo([confirmed('r-a', { roomId: 'd-1' }), confirmed('r-b')]), roomRepo(twoDoubles), dtoByType()), 'type_sold_out')
  })

  it('(c-ter) un RoomBlock sobre una unidad del tipo consume inventario', async () => {
    const blockRepo = { findMany: async () => [{ id: 'b1', hotelId: HOTEL, roomId: 'd-2', startDate: '2026-07-21', endDate: '2026-07-21' }] } as any
    await rejects409(create(resRepo([confirmed('r-a')]), roomRepo(twoDoubles), dtoByType(), { blockRepo }), 'type_sold_out')
  })

  it('(d) tipo inexistente en el hotel → 409 unknown_room_type', async () => {
    const repo = resRepo([])
    await rejects409(create(repo, roomRepo(twoDoubles), dtoByType({ roomType: 'penthouse' })), 'unknown_room_type', /inexistente/)
    expect(repo.created).toHaveLength(0)
  })

  it('(d-bis) tipo de OTRO hotel no cuenta como existente (scoped por hotelId)', async () => {
    const rooms = roomRepo([{ id: 'x-1', hotelId: 'h2', type: 'suite', status: 'available', capacity: 2 }])
    await rejects409(create(resRepo([]), rooms, dtoByType({ roomType: 'suite' })), 'unknown_room_type')
  })

  it('capacidad por tipo: entra si entra en ALGUNA unidad vendible (máx. capacity), si no 409', async () => {
    // d-2 admite 3: 3 adultos entran aunque d-1 sea de 2.
    const ok = await create(resRepo([]), roomRepo(twoDoubles), dtoByType({ adults: 3 }))
    expect(ok.roomId).toBeNull()
    // 4 no entran en ninguna.
    await rejects409(create(resRepo([]), roomRepo(twoDoubles), dtoByType({ adults: 4 })), undefined, /admite hasta 3/)
    // Una unidad en mantenimiento no aporta capacidad: con d-2 fuera, 3 adultos ya no entran.
    const maint = twoDoubles.map((r) => (r.id === 'd-2' ? { ...r, status: 'maintenance' } : r))
    await rejects409(create(resRepo([]), roomRepo(maint), dtoByType({ adults: 3 })), undefined, /admite hasta 2/)
  })

  it('priceFrom:"rates" sin unidad: cadena por tipo con fallback = MÍNIMO basePrice de las unidades vendibles', async () => {
    const pricing = { seasonAssignmentRepo: { findMany: async () => [] }, roomRateRepo: { findMany: async () => [] } }
    // Sin temporadas: 2 noches × min(120, 100) = 200 (+ taxes 10).
    const item = await create(resRepo([]), roomRepo(twoDoubles), dtoByType({ priceFrom: 'rates', totalAmount: 999, taxesAmount: 10 }), { pricing })
    expect(item.totalAmount).toBe(210)
    // Con grilla por tipo: 2 × 150.
    const priced = {
      seasonAssignmentRepo: { findMany: async () => [{ hotelId: HOTEL, date: '2026-07-20', season: 'alta' }, { hotelId: HOTEL, date: '2026-07-21', season: 'alta' }] },
      roomRateRepo: { findMany: async () => [{ hotelId: HOTEL, roomType: 'double', occupancy: 2, season: 'alta', channel: '', price: 150, basePrice: 150, percentage: 0, closed: 0 }] },
    }
    const byRates = await create(resRepo([]), roomRepo(twoDoubles), dtoByType({ priceFrom: 'rates', totalAmount: 999 }), { pricing: priced })
    expect(byRates.totalAmount).toBe(300)
  })

  it('(e) regresión: con roomId todo sigue igual (unidad del hotel, roomType derivado, solape por unidad)', async () => {
    const item = await create(resRepo([]), roomRepo(twoDoubles), dtoByType({ roomId: 'd-1', roomType: undefined }))
    expect(item.roomId).toBe('d-1')
    expect(item.roomType).toBe('double')
    // Unidad de otro hotel → 409.
    await rejects409(create(resRepo([]), roomRepo([{ id: 'x-1', hotelId: 'h2', type: 'double', status: 'available' }]), dtoByType({ roomId: 'x-1' })), undefined, /no pertenece/)
    // Unidad ocupada por una reserva asignada → room_overlap aunque el tipo tenga lugar.
    await rejects409(create(resRepo([confirmed('r-a', { roomId: 'd-1' })]), roomRepo(twoDoubles), dtoByType({ roomId: 'd-1' })), 'room_overlap')
    // Precio por unidad: fallback = basePrice de ESA unidad (120), no el mínimo del tipo.
    const pricing = { seasonAssignmentRepo: { findMany: async () => [] }, roomRateRepo: { findMany: async () => [] } }
    const priced = await create(resRepo([]), roomRepo(twoDoubles), dtoByType({ roomId: 'd-1', priceFrom: 'rates', totalAmount: 999 }), { pricing })
    expect(priced.totalAmount).toBe(240)
  })

  it('mocks viejos sin findMany en roomRepo + sin roomId → no explota (se salta existencia/capacidad por tipo)', async () => {
    const legacy = { findOne: async (f: { id: string }) => twoDoubles.find((r) => r.id === f.id) ?? null } as any
    const item = await create(resRepo([]), legacy, dtoByType())
    expect(item.roomId).toBeNull()
    expect(item.roomType).toBe('double')
  })
})
