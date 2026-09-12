// bookingengine/tests/type-availability-oversell.test.ts — REQ-HAC-02 (#257).
//
// Desde HAC-01 una reserva `confirmed` puede vivir SIN `roomId` (sólo `roomType`): la habitación
// se asigna al check-in. El chequeo histórico del motor público miraba solape POR HABITACIÓN, así
// que esas reservas no descontaban inventario: con 2 unidades 'double' y 2 confirmadas sin asignar
// el widget seguía vendiendo una tercera. Ahora la venta se decide por TIPO (`availableOfType`):
// N+1 del mismo tipo → 409, tanto en el widget (1 habitación) como en el grupo (rooms[]).
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'

const HOTEL_ID = 'h1'
const CHECK_IN = '2026-08-10'
const CHECK_OUT = '2026-08-12'

/** ORM en memoria que filtra por igualdad (mismo patrón que public-booking-group.test.ts). */
function makeDb(seed: { rooms?: any[]; reservations?: any[]; blocks?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: seed.reservations ?? [],
    RoomBlocks: seed.blocks ?? [],
    RoomRates: [],
    SeasonAssignments: [],
    RateOverrides: [],
    Seasons: [],
    Guests: [],
    Groups: [],
    Configuration: [],
  }
  const t = (name: string) => (tables[name] ??= [])
  const matches = (row: any, filter: any = {}) => Object.entries(filter).every(([k, v]) => row[k] === v)
  const orm: any = {
    findMany: async (table: string, filter: any = {}) => t(table).filter((r) => matches(r, filter)),
    findOne: async (table: string, filter: any = {}) => t(table).find((r) => matches(r, filter)) ?? null,
    findById: async (table: string, id: string) => t(table).find((r) => r.id === id) ?? null,
    create: async (table: string, data: any) => {
      const row = { id: data.id || crypto.randomUUID(), ...data }
      t(table).push(row)
      return row
    },
    update: async (table: string, id: string, patch: any) => {
      const row = t(table).find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row
    },
    updateMany: async (table: string, filter: any, patch: any) => {
      const rows = t(table).filter((r) => matches(r, filter))
      for (const r of rows) Object.assign(r, patch)
      return rows.length
    },
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
  }
  return { orm, tables }
}

const twoDoubles = () => [
  { id: 'd1', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 100, status: 'available' },
  { id: 'd2', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 120, status: 'available' },
]

/** Reserva del tipo SIN unidad asignada (HAC-01), solapando la estadía pedida. */
const unassigned = (id: string, over: Partial<any> = {}) => ({
  id, hotelId: HOTEL_ID, roomId: null, roomType: 'double', status: 'confirmed',
  checkIn: '2026-08-09', checkOut: '2026-08-11', ...over,
})

const widgetBody = {
  hotelId: HOTEL_ID,
  roomType: 'double',
  guestName: 'Ana',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: CHECK_IN,
  checkOut: CHECK_OUT,
  adults: 2,
  children: 0,
}

const OVERSOLD = 'No hay habitaciones de este tipo disponibles para esas fechas'

describe('REQ-HAC-02 — widget (createPublicBookingDirect): N+1 del mismo tipo rebota con 409', () => {
  it('2 unidades + 2 confirmadas SIN asignar que solapan → 409 (antes: vendía una tercera)', async () => {
    const { orm, tables } = makeDb({ rooms: twoDoubles(), reservations: [unassigned('u1'), unassigned('u2')] })
    const res = await createPublicBookingDirect(orm, widgetBody)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(OVERSOLD)
    expect(tables.Reservations).toHaveLength(2) // no se creó nada
  })

  it('2 unidades + 1 asignada + 1 sin asignar → 409', async () => {
    const { orm, tables } = makeDb({
      rooms: twoDoubles(),
      reservations: [unassigned('a1', { roomId: 'd1' }), unassigned('u1')],
    })
    const res = await createPublicBookingDirect(orm, widgetBody)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(OVERSOLD)
    expect(tables.Reservations).toHaveLength(2)
  })

  it('control: 2 unidades + 1 sin asignar → 201 y se asigna una unidad física del tipo', async () => {
    const { orm, tables } = makeDb({ rooms: twoDoubles(), reservations: [unassigned('u1')] })
    const res = await createPublicBookingDirect(orm, widgetBody)
    expect(res.status).toBe(201)
    expect(['d1', 'd2']).toContain(res.body.reservation.roomId)
    expect(tables.Reservations).toHaveLength(2)
  })

  it('control: 2 sin asignar que NO solapan las fechas pedidas → 201', async () => {
    const { orm } = makeDb({
      rooms: twoDoubles(),
      reservations: [
        unassigned('u1', { checkIn: '2026-08-01', checkOut: '2026-08-10' }), // se va el día que entra el nuevo
        unassigned('u2', { checkIn: '2026-08-12', checkOut: '2026-08-15' }), // entra el día que se va el nuevo
      ],
    })
    const res = await createPublicBookingDirect(orm, widgetBody)
    expect(res.status).toBe(201)
  })

  it('las sin asignar canceladas no consumen inventario → 201', async () => {
    const { orm } = makeDb({
      rooms: twoDoubles(),
      reservations: [unassigned('u1', { status: 'cancelled' }), unassigned('u2', { status: 'no_show' })],
    })
    const res = await createPublicBookingDirect(orm, widgetBody)
    expect(res.status).toBe(201)
  })

  it('roomId explícito con el tipo agotado por reservas sin asignar → 409 (red de seguridad final)', async () => {
    const { orm, tables } = makeDb({ rooms: twoDoubles(), reservations: [unassigned('u1'), unassigned('u2')] })
    const { roomType, ...withoutType } = widgetBody
    void roomType
    const res = await createPublicBookingDirect(orm, { ...withoutType, roomId: 'd1' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('Habitación no disponible en esas fechas')
    expect(tables.Reservations).toHaveLength(2)
  })
})

const groupBody = {
  hotelId: HOTEL_ID,
  guestName: 'Ana Pérez',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: CHECK_IN,
  checkOut: CHECK_OUT,
}

describe('REQ-HAC-02 — grupo (createPublicBookingGroup): N+1 del mismo tipo rebota con 409', () => {
  it('2 unidades + 1 sin asignar, línea quantity 2 → 409 con available: 1 y CERO reservas', async () => {
    const { orm, tables } = makeDb({ rooms: twoDoubles(), reservations: [unassigned('u1')] })
    const res = await createPublicBookingGroup(orm, {
      ...groupBody,
      rooms: [{ roomType: 'double', adults: 2, quantity: 2 }],
    })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(1)
    expect(res.body.roomType).toBe('double')
    expect(res.body.error).toContain('Solo hay 1 habitación(es) de "double"')
    expect(tables.Reservations).toHaveLength(1)
    expect(tables.Groups).toHaveLength(0)
  })

  it('2 unidades + 1 sin asignar, línea quantity 1 → 201', async () => {
    const { orm, tables } = makeDb({ rooms: twoDoubles(), reservations: [unassigned('u1')] })
    const res = await createPublicBookingGroup(orm, {
      ...groupBody,
      rooms: [{ roomType: 'double', adults: 2, quantity: 1 }],
    })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    expect(tables.Groups).toHaveLength(1)
  })

  it('2 líneas del mismo tipo (distinta ocupación) descuentan lo que reclamó la anterior → 409 en la 2da', async () => {
    const { orm, tables } = makeDb({ rooms: twoDoubles(), reservations: [unassigned('u1')] })
    const res = await createPublicBookingGroup(orm, {
      ...groupBody,
      rooms: [
        { roomType: 'double', adults: 2, quantity: 1 },
        { roomType: 'double', adults: 1, quantity: 1 },
      ],
    })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(0)
    expect(tables.Reservations).toHaveLength(1)
  })

  it('control: 1 sin asignar que NO solapa las fechas, quantity 2 → 201', async () => {
    const { orm, tables } = makeDb({
      rooms: twoDoubles(),
      reservations: [unassigned('u1', { checkIn: '2026-08-12', checkOut: '2026-08-14' })],
    })
    const res = await createPublicBookingGroup(orm, {
      ...groupBody,
      rooms: [{ roomType: 'double', adults: 2, quantity: 2 }],
    })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
  })
})
