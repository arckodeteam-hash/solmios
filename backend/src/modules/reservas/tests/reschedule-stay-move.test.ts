// reservas/tests/reschedule-stay-move.test.ts — REQ-HAC-03 (#258): reagendar una estadía en curso
// a OTRA habitación pasa por el mismo camino que POST /assign-room.
//
// Con la reserva `checked_in`, `updateReservation` rechaza el `roomId` (409 `use_assign_endpoint`):
// mover una estadía también mueve el folio abierto y los estados de las habitaciones. El commit
// del reagendado delega en `assignRoom` ANTES del update, y el update lleva sólo fechas/total.
// Repos in-memory: molde de `assign-room.test.ts` (folios/rooms/transaction) y de
// `reschedule-pricing.test.ts` (deps de reschedule). Auth REAL, como en assign-room.test.ts.
import { describe, it, expect } from 'bun:test'
import { Auth, ConflictError } from 'arckode-framework'
import { commitReschedule, type RescheduleDeps } from '../usecases/reschedule'
import type { RoomAssignmentDeps } from '../usecases/assign-room'
import type { FolioRoomWriter } from '../usecases/reservas-queries'
import type { AuditEntry } from '../../../shared/usecases/audit'
import { paidSourceFrom } from '../../../shared/usecases/reservation-paid'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child: () => noopLogger } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const noMoneyRows = { findMany: async () => [] as any[] }
const paidOf = paidSourceFrom({ folioRepo: noMoneyRows, invoiceRepo: noMoneyRows, paymentRepo: noMoneyRows })

const HOTEL = 'hotel-a'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const matches = (row: any, q: any) => Object.keys(q || {}).every((k) => row[k] === q[k])

/** Repo in-memory con estado (mismo molde que assign-room.test.ts). */
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

/** Folios/Rooms en memoria + `transaction` secuencial. Cuenta las transacciones para probar que el PUT NO mueve estadía. */
function fakeQueries(folios: any[], rooms: any[]) {
  const writer: FolioRoomWriter = {
    findOpenFolioByReservation: async (reservationId) => folios.find((f) => f.reservationId === reservationId && f.status === 'open') ?? null,
    updateFolio: async (id, patch) => { Object.assign(folios.find((f) => f.id === id), patch) },
    updateRoom: async (roomId, patch) => { Object.assign(rooms.find((r) => r.id === roomId), patch) },
  }
  const q = { txCalls: 0, transaction: async (fn: (w: FolioRoomWriter) => Promise<any>) => { q.txCalls++; return fn(writer) } }
  return q as any
}

// room-1 (standard, 100/noche) es donde está alojado; room-2 (suite, 200/noche) es el destino.
const ROOMS = () => [
  { id: 'room-1', hotelId: HOTEL, number: '101', type: 'standard', basePrice: 100, status: 'occupied' },
  { id: 'room-2', hotelId: HOTEL, number: '201', type: 'suite', basePrice: 200, status: 'available' },
]

const reserva = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', roomType: 'standard', status: 'checked_in',
  checkIn: '2030-01-10', checkOut: '2030-01-12', totalAmount: 200, currency: 'USD', adults: 2, children: 0, ...over,
})

type Harness = {
  deps: RescheduleDeps; rooms: any[]; folios: any[]; updates: any[]; audits: AuditEntry[]; emitted: any[]
  queries: { txCalls: number }
}

function harness(res: any, opts: { withAssignment?: boolean; otherReservations?: any[] } = {}): Harness {
  const updates: any[] = []
  const audits: AuditEntry[] = []
  const emitted: any[] = []
  const rooms = ROOMS()
  const folios = [{ id: 'f1', reservationId: 'r1', hotelId: HOTEL, roomId: 'room-1', status: 'open' }]
  const repo = memRepo([res, ...(opts.otherReservations ?? [])], updates)
  const roomRepo = memRepo(rooms)
  const sockets = { onRoomAssigned: async (d: any) => { emitted.push(d) } }
  const queries = fakeQueries(folios, rooms)
  const roomAssignment: RoomAssignmentDeps = {
    repo, roomRepo, blockRepo: memRepo([]), queries, sockets,
    auditPort: { record: async (e) => { audits.push(e) } }, logger: noopLogger, cache: noopCache, auth: realAuth,
  }
  const deps: RescheduleDeps = {
    repo, roomRepo, logger: noopLogger, cache: noopCache, sockets, paidOf, addonsOf: async () => [],
    ...(opts.withAssignment === false ? {} : { roomAssignment }),
  }
  return { deps, rooms, folios, updates, audits, emitted, queries }
}

describe('commitReschedule — estadía en curso a otra habitación (REQ-HAC-03)', () => {
  it('mismo checkIn, otra habitación: mueve el folio y los estados, emite onRoomAssigned y persiste la reserva reagendada', async () => {
    const h = harness(reserva())
    const result = await commitReschedule(h.deps, 'r1', { roomId: 'room-2', checkOut: '2030-01-13' }, user)

    // Folio abierto y estados de habitación siguen a la reserva (en transacción).
    expect(h.folios[0].roomId).toBe('room-2')
    expect(h.rooms.find((r) => r.id === 'room-1').status).toBe('cleaning')
    expect(h.rooms.find((r) => r.id === 'room-2').status).toBe('occupied')
    expect(h.queries.txCalls).toBe(1)

    // Evento + auditoría, los mismos que POST /assign-room (TTLock reemplaza el código ahí).
    expect(h.emitted).toEqual([{ reservationId: 'r1', hotelId: HOTEL, roomId: 'room-2', previousRoomId: 'room-1' }])
    expect(h.audits.map((a) => a.action)).toEqual(['reservation.room_assigned', 'reservation.room_type_changed'])

    // La reserva queda con la habitación nueva, las fechas y el total del reagendado
    // (modo keep: 200 pactado + 1 noche agregada × 200 de la suite).
    const persisted = h.deps.repo.rows[0]
    expect(persisted.roomId).toBe('room-2')
    expect(persisted.roomType).toBe('suite')
    expect(persisted.roomAssignedBy).toBe('u1')
    expect(persisted.checkIn).toBe('2030-01-10')
    expect(persisted.checkOut).toBe('2030-01-13')
    expect(persisted.totalAmount).toBe(400)
    expect(result.reservation.roomId).toBe('room-2')
    expect(result.reservation.totalAmount).toBe(400)
    expect(result.quote.roomChanged).toBe(true)

    // Orden: assignRoom persiste el roomId ANTES del update de fechas/total, y ese update ya NO
    // lleva `roomId` (crud.ts lo rechazaría en estadía con 409 use_assign_endpoint).
    const iRoom = h.updates.findIndex((u) => u.roomId === 'room-2')
    const iDates = h.updates.findIndex((u) => u.checkOut === '2030-01-13')
    expect(iRoom).toBeGreaterThanOrEqual(0)
    expect(iDates).toBeGreaterThan(iRoom)
    expect(h.updates[iDates].roomId).toBeUndefined()
  })

  it('el rango NUEVO se valida antes de mover nada: si la extensión choca en el destino, ni folio ni estados cambian', async () => {
    const ocupada = { id: 'r2', hotelId: HOTEL, roomId: 'room-2', status: 'confirmed', checkIn: '2030-01-12', checkOut: '2030-01-14', totalAmount: 400 }
    const h = harness(reserva(), { otherReservations: [ocupada] })
    const call = commitReschedule(h.deps, 'r1', { roomId: 'room-2', checkOut: '2030-01-13' }, user)
    await expect(call).rejects.toBeInstanceOf(ConflictError)
    expect(h.folios[0].roomId).toBe('room-1')
    expect(h.rooms.find((r) => r.id === 'room-1').status).toBe('occupied')
    expect(h.rooms.find((r) => r.id === 'room-2').status).toBe('available')
    expect(h.queries.txCalls).toBe(0)
    expect(h.updates).toEqual([])
  })

  it('sin deps de asignación cableadas, mover una estadía es 409 (fail-closed, nunca a medio mover)', async () => {
    const h = harness(reserva(), { withAssignment: false })
    const call = commitReschedule(h.deps, 'r1', { roomId: 'room-2' }, user)
    await expect(call).rejects.toBeInstanceOf(ConflictError)
    expect(h.folios[0].roomId).toBe('room-1')
    expect(h.updates).toEqual([])
  })

  it('en estadía sin cambiar de habitación (extender la salida) NO pasa por assignRoom', async () => {
    const h = harness(reserva())
    const result = await commitReschedule(h.deps, 'r1', { checkOut: '2030-01-13' }, user)
    expect(result.reservation.checkOut).toBe('2030-01-13')
    expect(result.reservation.totalAmount).toBe(300) // + 1 noche × 100 de la standard
    expect(h.queries.txCalls).toBe(0)
    expect(h.emitted).toEqual([])
  })

  it('antes del check-in (confirmed) el cambio va por el PUT: sello roomAssignedAt/By, tipo explícito, sin tocar folio ni estados', async () => {
    const h = harness(reserva({ status: 'confirmed' }))
    const result = await commitReschedule(h.deps, 'r1', { roomId: 'room-2' }, user)
    expect(result.reservation.roomId).toBe('room-2')
    expect(result.reservation.roomType).toBe('suite') // standard→suite: el quote ya es la decisión explícita
    expect(result.reservation.roomAssignedBy).toBe('u1')
    expect(result.reservation.roomAssignedAt).toBeTruthy()
    expect(h.queries.txCalls).toBe(0)
    expect(h.folios[0].roomId).toBe('room-1')
    expect(h.emitted).toEqual([{ reservationId: 'r1', hotelId: HOTEL, roomId: 'room-2', previousRoomId: 'room-1' }])
    expect(h.audits.map((a) => a.action)).toEqual(['reservation.room_assigned', 'reservation.room_type_changed'])
  })
})
