// shared/usecases/tests/type-availability.test.ts — REQ-HAC-02: disponibilidad por TIPO.
//
// Aceptación del issue #257: con reservas SIN `roomId` (HAC-01) el chequeo por habitación no las
// ve y vende de más. Acá se verifica que `countAvailableOfType` cuente asignadas y sin asignar
// por igual, descuente unidades en mantenimiento del inventario, respete `excludeReservationId`
// y que `availableOfType` consulte acotado por hotel y tipo.
import { describe, it, expect } from 'bun:test'
import {
  BLOCKING_RESERVATION_STATUS,
  isBlockingStatus,
  stayOverlaps,
  countAvailableOfType,
  availableOfType,
  typeAvailabilityPortFromOrm,
  type TypeAvailabilityPort,
} from '../type-availability'

const CHECK_IN = '2026-10-10'
const CHECK_OUT = '2026-10-13'

const rooms = (statuses: string[] = ['available', 'available', 'available']) =>
  statuses.map((status, i) => ({ id: `r${i + 1}`, hotelId: 'h1', type: 'Doble', number: `10${i + 1}`, status }))

let seq = 0
const res = (over: Record<string, any> = {}) => ({
  id: `res${++seq}`,
  hotelId: 'h1',
  roomId: null,
  roomType: 'Doble',
  status: 'confirmed',
  checkIn: CHECK_IN,
  checkOut: CHECK_OUT,
  ...over,
})

describe('isBlockingStatus / stayOverlaps', () => {
  it('la whitelist es la del motor público', () => {
    expect([...BLOCKING_RESERVATION_STATUS].sort()).toEqual(['checked_in', 'confirmed', 'guaranteed', 'pending'])
  })

  it('status vacío o null bloquea; cancelled/no_show/checked_out no; compara en minúsculas', () => {
    expect(isBlockingStatus(undefined)).toBe(true)
    expect(isBlockingStatus(null)).toBe(true)
    expect(isBlockingStatus('')).toBe(true)
    expect(isBlockingStatus('CONFIRMED')).toBe(true)
    expect(isBlockingStatus('cancelled')).toBe(false)
    expect(isBlockingStatus('no_show')).toBe(false)
    expect(isBlockingStatus('checked_out')).toBe(false)
  })

  it('stayOverlaps: [checkIn, checkOut) — el día de salida no ocupa; sin fechas no solapa', () => {
    expect(stayOverlaps({ status: 'confirmed', checkIn: '2026-10-08', checkOut: '2026-10-10' }, CHECK_IN, CHECK_OUT)).toBe(false)
    expect(stayOverlaps({ status: 'confirmed', checkIn: '2026-10-12', checkOut: '2026-10-14' }, CHECK_IN, CHECK_OUT)).toBe(true)
    expect(stayOverlaps({ status: 'confirmed', checkIn: '2026-10-12T15:00:00Z', checkOut: '2026-10-14T10:00:00Z' }, CHECK_IN, CHECK_OUT)).toBe(true)
    expect(stayOverlaps({ status: 'cancelled', checkIn: '2026-10-12', checkOut: '2026-10-14' }, CHECK_IN, CHECK_OUT)).toBe(false)
    expect(stayOverlaps({ status: 'confirmed', checkIn: null, checkOut: '2026-10-14' }, CHECK_IN, CHECK_OUT)).toBe(false)
  })
})

describe('countAvailableOfType (REQ-HAC-02)', () => {
  it('1. 3 unidades / 3 confirmadas SIN roomId del mismo tipo → available 0, booked 3, rooms 3', () => {
    const out = countAvailableOfType('Doble', rooms(), [res(), res(), res()], [], CHECK_IN, CHECK_OUT)
    expect(out.rooms).toBe(3)
    expect(out.booked).toBe(3)
    expect(out.available).toBe(0)
    expect(out.busyRoomIds.size).toBe(0)
    expect(out.perNight.map((n) => n.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12'])
  })

  it('2. 2 asignadas + 1 sin asignar → available 0 (busyRoomIds trae las asignadas)', () => {
    const out = countAvailableOfType('Doble', rooms(), [res({ roomId: 'r1' }), res({ roomId: 'r2' }), res()], [], CHECK_IN, CHECK_OUT)
    expect(out.available).toBe(0)
    expect(out.booked).toBe(3)
    expect([...out.busyRoomIds].sort()).toEqual(['r1', 'r2'])
  })

  it('3. una unidad en maintenance → rooms 2; con 2 reservas → available 0', () => {
    const rs = rooms(['available', 'maintenance', 'available'])
    const empty = countAvailableOfType('Doble', rs, [], [], CHECK_IN, CHECK_OUT)
    expect(empty.rooms).toBe(2)
    expect(empty.available).toBe(2)
    expect(empty.sellableRooms.map((r) => r.id)).toEqual(['r1', 'r3'])

    const full = countAvailableOfType('Doble', rs, [res(), res()], [], CHECK_IN, CHECK_OUT)
    expect(full.available).toBe(0)
  })

  it('3b. una reserva asignada a la unidad en mantenimiento igual consume una del tipo', () => {
    const rs = rooms(['available', 'maintenance'])
    const out = countAvailableOfType('Doble', rs, [res({ roomId: 'r2' })], [], CHECK_IN, CHECK_OUT)
    expect(out.rooms).toBe(1)
    expect(out.booked).toBe(1)
    expect(out.available).toBe(0)
  })

  it('4. excludeReservationId: la propia reserva no cuenta', () => {
    const own = res({ id: 'mine' })
    const without = countAvailableOfType('Doble', rooms(['available']), [own], [], CHECK_IN, CHECK_OUT)
    expect(without.available).toBe(0)
    const excluded = countAvailableOfType('Doble', rooms(['available']), [own], [], CHECK_IN, CHECK_OUT, { excludeReservationId: 'mine' })
    expect(excluded.available).toBe(1)
    expect(excluded.booked).toBe(0)
  })

  it('5. grupo de 2 con 1 libre → available 1 < 2 (no entra)', () => {
    const out = countAvailableOfType('Doble', rooms(), [res(), res()], [], CHECK_IN, CHECK_OUT)
    expect(out.available).toBe(1)
    expect(out.available >= 2).toBe(false)
    expect(out.available >= 1).toBe(true)
  })

  it('6a. cancelled / no_show / checked_out no cuentan, ni asignadas ni sin asignar', () => {
    const out = countAvailableOfType('Doble', rooms(), [
      res({ status: 'cancelled' }),
      res({ status: 'no_show', roomId: 'r1' }),
      res({ status: 'checked_out' }),
      res({ status: 'CANCELLED', roomId: 'r2' }),
    ], [], CHECK_IN, CHECK_OUT)
    expect(out.booked).toBe(0)
    expect(out.available).toBe(3)
    expect(out.busyRoomIds.size).toBe(0)
  })

  it('6b. una reserva de OTRO tipo no cuenta (sin asignar por roomType, asignada por la unidad)', () => {
    const all = [...rooms(), { id: 's1', hotelId: 'h1', type: 'Suite', number: '201', status: 'available' }]
    const out = countAvailableOfType('Doble', all, [
      res({ roomType: 'Suite' }),
      res({ roomType: 'Suite', roomId: 's1' }),
    ], [], CHECK_IN, CHECK_OUT)
    expect(out.rooms).toBe(3)
    expect(out.booked).toBe(0)
    expect(out.available).toBe(3)
  })

  it('6b2. la unidad manda: asignada a una Doble con roomType desactualizado igual cuenta como Doble', () => {
    const out = countAvailableOfType('doble', rooms(), [res({ roomType: 'Suite', roomId: 'r1' })], [], CHECK_IN, CHECK_OUT)
    expect(out.booked).toBe(1)
    expect(out.available).toBe(2)
    expect([...out.busyRoomIds]).toEqual(['r1'])
  })

  it('6c. un bloqueo (RoomBlocks) de una unidad del tipo descuenta; de otro tipo no', () => {
    const blocks = [
      { roomId: 'r1', startDate: '2026-10-11', endDate: '2026-10-11' },
      { roomId: 'zzz', startDate: '2026-10-10', endDate: '2026-10-12' },
    ]
    const out = countAvailableOfType('Doble', rooms(), [], blocks, CHECK_IN, CHECK_OUT)
    expect(out.perNight.map((n) => n.available)).toEqual([3, 2, 3])
    expect(out.available).toBe(2)
    expect(out.booked).toBe(1)
  })

  it('6d. noches parciales: perNight refleja la noche ocupada y available = min', () => {
    const out = countAvailableOfType('Doble', rooms(['available']), [
      res({ checkIn: '2026-10-12', checkOut: '2026-10-14' }),
      res({ checkIn: '2026-10-08', checkOut: '2026-10-10' }), // se va el día del check-in: no ocupa
    ], [], CHECK_IN, CHECK_OUT)
    expect(out.perNight).toEqual([
      { date: '2026-10-10', booked: 0, available: 1 },
      { date: '2026-10-11', booked: 0, available: 1 },
      { date: '2026-10-12', booked: 1, available: 0 },
    ])
    expect(out.available).toBe(0)
    expect(out.booked).toBe(1)
  })

  it('sin noches (checkIn = checkOut) → available 0, perNight vacío; overbooking clampea a 0', () => {
    expect(countAvailableOfType('Doble', rooms(), [], [], CHECK_IN, CHECK_IN).available).toBe(0)
    const over = countAvailableOfType('Doble', rooms(['available']), [res(), res()], [], CHECK_IN, CHECK_OUT)
    expect(over.booked).toBe(2)
    expect(over.available).toBe(0)
  })

  it('filtra en memoria: acepta todas las filas del hotel y estados en cualquier caso', () => {
    const all = [...rooms(), { id: 's1', hotelId: 'h1', type: 'Suite', status: 'AVAILABLE' }]
    const out = countAvailableOfType('DOBLE', all, [res({ status: 'Confirmed' }), res({ roomType: 'Suite' })], [], CHECK_IN, CHECK_OUT)
    expect(out.rooms).toBe(3)
    expect(out.booked).toBe(1)
    expect(out.available).toBe(2)
  })
})

describe('availableOfType (port)', () => {
  function fakePort(data: { rooms: any[]; reservations: any[]; blocks?: any[] | null }) {
    const queries: Array<{ repo: string; q: any }> = []
    const port: TypeAvailabilityPort = {
      rooms: { findMany: async (q) => { queries.push({ repo: 'rooms', q }); return data.rooms } },
      reservations: { findMany: async (q) => { queries.push({ repo: 'reservations', q }); return data.reservations } },
      blocks: { findMany: async (q) => { queries.push({ repo: 'blocks', q }); return data.blocks as any } },
    }
    return { port, queries }
  }

  it('7. consulta acotado por { hotelId, type } y { hotelId, roomType } y devuelve lo mismo que el core', async () => {
    const data = { rooms: rooms(), reservations: [res({ roomId: 'r1' }), res()], blocks: [{ roomId: 'r3', startDate: '2026-10-10', endDate: '2026-10-10' }] }
    const { port, queries } = fakePort(data)
    const out = await availableOfType(port, 'h1', 'Doble', CHECK_IN, CHECK_OUT)

    expect(queries.find((x) => x.repo === 'rooms')?.q).toEqual({ hotelId: 'h1', type: 'Doble' })
    expect(queries.find((x) => x.repo === 'reservations')?.q).toEqual({ hotelId: 'h1', roomType: 'Doble' })
    expect(queries.find((x) => x.repo === 'blocks')?.q).toEqual({ hotelId: 'h1' })

    const core = countAvailableOfType('Doble', data.rooms, data.reservations, data.blocks, CHECK_IN, CHECK_OUT)
    expect(out.available).toBe(core.available)
    expect(out.available).toBe(0)
    expect(out.perNight).toEqual(core.perNight)
    expect([...out.busyRoomIds]).toEqual([...core.busyRoomIds])
  })

  it('pasa excludeReservationId al core y tolera repos que devuelven null', async () => {
    const { port } = fakePort({ rooms: rooms(['available']), reservations: [res({ id: 'mine' })], blocks: null })
    const out = await availableOfType(port, 'h1', 'Doble', CHECK_IN, CHECK_OUT, { excludeReservationId: 'mine' })
    expect(out.available).toBe(1)
  })

  it('sin repo de blocks no consulta bloqueos', async () => {
    const port: TypeAvailabilityPort = {
      rooms: { findMany: async () => rooms(['available']) },
      reservations: { findMany: async () => null as any },
    }
    const out = await availableOfType(port, 'h1', 'Doble', CHECK_IN, CHECK_OUT)
    expect(out.available).toBe(1)
  })

  it('typeAvailabilityPortFromOrm mapea a Rooms / Reservations / RoomBlocks', async () => {
    const calls: Array<[string, any]> = []
    const orm = { findMany: async (model: string, q: any) => { calls.push([model, q]); return [] } }
    const out = await availableOfType(typeAvailabilityPortFromOrm(orm), 'h1', 'Doble', CHECK_IN, CHECK_OUT)
    expect(calls.map((c) => c[0]).sort()).toEqual(['Reservations', 'RoomBlocks', 'Rooms'])
    expect(out.rooms).toBe(0)
    expect(out.available).toBe(0)
  })
})
