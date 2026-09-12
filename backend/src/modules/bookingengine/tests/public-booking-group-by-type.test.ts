// bookingengine/tests/public-booking-group-by-type.test.ts — REQ-HAC-05 (#260): el grupo del
// widget nace POR TIPO, sin unidad. Cada línea `{roomType, quantity}` produce `quantity` filas de
// `Reservations` con `roomType` y `roomId: null`; la habitación la asigna recepción al check-in
// (`reservas/usecases/assign-room.ts`). Espejo de `public-booking-room-resolution.test.ts` para
// `createPublicBookingGroup`.
//
// Cubre:
//  (a) tipo con 3 unidades, grupo de 3 del mismo tipo → 201, 3 filas `roomId === null` + `roomType`,
//      `Groups.totalRooms` 3 y la respuesta con `roomId: null, roomType` por habitación.
//  (b) 4 del mismo tipo con 3 unidades → 409 con `available: 3`, nada creado (todo o nada).
//  (c) 2 líneas del MISMO tipo (2 + 2) con 3 unidades → 409: la segunda línea descuenta lo que
//      reclamó la primera (`available: 1`), nada creado.
//  (d) una reserva `confirmed` SIN unidad del tipo consume inventario (HAC-02): 3 unidades + 1 sin
//      asignar → grupo de 3 → 409 `available: 2`.
//  (e) carrera: el tipo se agota entre el chequeo de afuera y la tx → el re-chequeo con el lock
//      aborta con 409 y no se crea ni el `Groups`; el lock es un UPDATE sobre `Rooms {hotelId, type}`
//      por tipo distinto (no por unidad).
//  (f) push a las OTAs POR TIPO, una vez por tipo distinto; el callback legado por unidad no se invoca.
//  (g) precio por unidad: sin tarifas cae al MÍNIMO `basePrice` entre las vendibles del tipo (lo
//      que `/rates` publica como "desde"), no al de una unidad elegida.
//  (h) capacidad sin unidad: la línea entra si entra en alguna unidad vendible del tipo; pedir más
//      unidades "grandes" que las que existen para esa composición → 409.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingGroup } from '../usecases/public-booking-group'

const HOTEL_ID = 'h1'

/** ORM en memoria real (mismo patrón que public-booking-group.test.ts). `onTransaction` permite
 *  meter una escritura "concurrente" entre el chequeo de afuera y el lock/re-chequeo de la tx. */
function makeDb(seed: { rooms?: any[]; reservations?: any[] } = {}, opts: { onTransaction?: (tables: Record<string, any[]>) => void } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    RoomAmenities: [],
    Reservations: seed.reservations ?? [],
    RoomBlocks: [],
    RoomRates: [],
    SeasonAssignments: [],
    RateOverrides: [],
    Seasons: [],
    PromoCodes: [],
    Guests: [],
    Groups: [],
    ReservationAddons: [],
    Configuration: [],
  }
  const t = (name: string) => (tables[name] ??= [])
  const matches = (row: any, filter: any = {}) => Object.entries(filter).every(([k, v]) => row[k] === v)
  const updateManyCalls: Array<{ table: string; filter: any }> = []
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
      updateManyCalls.push({ table, filter })
      const rows = t(table).filter((r) => matches(r, filter))
      for (const r of rows) Object.assign(r, patch)
      return rows.length
    },
    transaction: async (cb: (tx: any) => Promise<any>) => {
      opts.onTransaction?.(tables)
      return cb(orm)
    },
  }
  return { orm, tables, updateManyCalls }
}

const room = (id: string, type: string, basePrice = 100, extra: any = {}) =>
  ({ id, hotelId: HOTEL_ID, type, capacity: 2, basePrice, status: 'available', ...extra })

const threeDeluxe = () => [room('d1', 'deluxe'), room('d2', 'deluxe'), room('d3', 'deluxe')]

const BASE_BODY = {
  hotelId: HOTEL_ID,
  guestName: 'Ana Pérez',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: '2026-09-10',
  checkOut: '2026-09-12', // 2 noches
}

/** Reserva `confirmed` del tipo SIN unidad (HAC-01): también consume inventario del tipo. */
const unassigned = (id: string, roomType: string) => ({
  id, hotelId: HOTEL_ID, roomId: null, roomType, status: 'confirmed', checkIn: '2026-09-10', checkOut: '2026-09-12',
})

describe('REQ-HAC-05 — createPublicBookingGroup crea N filas del TIPO sin unidad', () => {
  it('(a) 3 unidades, grupo de 3 del mismo tipo → 201, 3 filas roomId null + roomType, Groups.totalRooms 3', async () => {
    const { orm, tables } = makeDb({ rooms: threeDeluxe() })
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'deluxe', adults: 2, quantity: 3 }] })

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
    for (const r of tables.Reservations) {
      expect(r.roomId).toBeNull()
      expect(r.roomType).toBe('deluxe')
      expect(r.groupId).toBe(tables.Groups[0].id)
      expect(r.status).toBe('pending')
    }
    expect(tables.Groups).toHaveLength(1)
    expect(tables.Groups[0].totalRooms).toBe(3)
    // 3 × 100 × 2 noches, sin impuestos (config vacío).
    expect(tables.Groups[0].totalAmount).toBe(600)
    // La respuesta pública también sale por tipo, sin unidad.
    expect(res.body.reservations).toHaveLength(3)
    for (const r of res.body.reservations) {
      expect(r.roomId).toBeNull()
      expect(r.roomType).toBe('deluxe')
    }
    expect(tables.Reservations[0].notes).toContain('Habitaciones: deluxe×3 (para 2)')
  })

  it('(b) 4 del mismo tipo con 3 unidades → 409 con available 3, nada creado', async () => {
    const { orm, tables } = makeDb({ rooms: threeDeluxe() })
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'deluxe', adults: 2, quantity: 4 }] })

    expect(res.status).toBe(409)
    expect(res.body.available).toBe(3)
    expect(res.body.roomType).toBe('deluxe')
    expect(res.body.error).toContain('Solo hay 3 habitación(es) de "deluxe"')
    expect(tables.Reservations).toHaveLength(0)
    expect(tables.Groups).toHaveLength(0)
  })

  it('(c) 2 líneas del MISMO tipo (2 + 2) con 3 unidades → 409: la segunda descuenta lo reclamado por la primera', async () => {
    const { orm, tables } = makeDb({ rooms: threeDeluxe() })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 2 },
        { roomType: 'deluxe', adults: 1, quantity: 2 },
      ],
    })

    expect(res.status).toBe(409)
    expect(res.body.available).toBe(1) // 3 − 2 de la primera línea
    expect(res.body.roomType).toBe('deluxe')
    expect(tables.Reservations).toHaveLength(0)
    expect(tables.Groups).toHaveLength(0)
  })

  it('(c2) control: 2 líneas del mismo tipo (2 + 1) con 3 unidades → 201, 3 filas del tipo sin unidad', async () => {
    const { orm, tables } = makeDb({ rooms: threeDeluxe() })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 2 },
        { roomType: 'deluxe', adults: 1, quantity: 1 },
      ],
    })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
    expect(tables.Reservations.every((r: any) => r.roomId === null && r.roomType === 'deluxe')).toBe(true)
    // Filas en el orden de las líneas: 2 "para 2" y 1 "para 1".
    expect(tables.Reservations.map((r: any) => r.adults)).toEqual([2, 2, 1])
  })

  it('(d) una confirmed SIN unidad del tipo consume inventario (HAC-02): 3 unidades + 1 sin asignar → grupo de 3 → 409 available 2', async () => {
    const { orm, tables } = makeDb({ rooms: threeDeluxe(), reservations: [unassigned('u1', 'deluxe')] })
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'deluxe', adults: 2, quantity: 3 }] })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(2)
    expect(tables.Reservations).toHaveLength(1) // sólo la sembrada
    expect(tables.Groups).toHaveLength(0)
  })

  it('(e) carrera: el tipo se agota entre el chequeo de afuera y la tx → el re-chequeo con el lock por tipo aborta con 409', async () => {
    const warns: string[] = []
    const logger = { warn: (m: string) => { warns.push(m) }, error: () => {} }
    const { orm, tables, updateManyCalls } = makeDb(
      { rooms: [room('d1', 'deluxe'), room('d2', 'deluxe'), room('s1', 'standard', 80)] },
      // Otro comprador commitea 1 deluxe justo antes de que tomemos el lock: quedan 1 y pedimos 2.
      { onTransaction: (tables) => { tables.Reservations.push(unassigned('other', 'deluxe')) } },
    )
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 2 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, undefined, undefined, undefined, logger)

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('"deluxe" ya no está disponible para esas fechas')
    // Todo o nada: ni Groups ni filas nuestras (sólo la del otro comprador).
    expect(tables.Groups).toHaveLength(0)
    expect(tables.Reservations.map((r: any) => r.id)).toEqual(['other'])
    // El lock es por TIPO (`Rooms {hotelId, type}`), uno por tipo distinto — nunca por unidad.
    const roomLocks = updateManyCalls.filter((c) => c.table === 'Rooms').map((c) => c.filter)
    expect(roomLocks).toEqual([{ hotelId: HOTEL_ID, type: 'deluxe' }])
    expect(warns.some((w) => w.includes('se agotó concurrentemente'))).toBe(true)
  })

  it('(e2) sin carrera: un lock por tipo distinto (deluxe, standard), en el orden de las líneas', async () => {
    const { orm, updateManyCalls } = makeDb({ rooms: [room('d1', 'deluxe'), room('d2', 'deluxe'), room('s1', 'standard', 80)] })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'standard', adults: 2, quantity: 1 },
        { roomType: 'deluxe', adults: 1, quantity: 1 },
      ],
    })
    expect(res.status).toBe(201)
    const roomLocks = updateManyCalls.filter((c) => c.table === 'Rooms').map((c) => c.filter)
    expect(roomLocks).toEqual([{ hotelId: HOTEL_ID, type: 'deluxe' }, { hotelId: HOTEL_ID, type: 'standard' }])
  })

  it('(f) push a las OTAs POR TIPO, una vez por tipo distinto; el callback legado por unidad no se invoca', async () => {
    const { orm } = makeDb({ rooms: [room('d1', 'deluxe'), room('d2', 'deluxe'), room('s1', 'standard', 80)] })
    const unitPushes: any[] = []
    const typePushes: Array<{ hotelId: string; roomType: string }> = []
    const res = await createPublicBookingGroup(
      orm,
      { ...BASE_BODY, rooms: [{ roomType: 'deluxe', adults: 2, quantity: 2 }, { roomType: 'standard', adults: 2, quantity: 1 }] },
      (hotelId: string, roomId: string) => { unitPushes.push({ hotelId, roomId }) },
      undefined, undefined, undefined, undefined, undefined,
      (hotelId: string, roomType: string) => { typePushes.push({ hotelId, roomType }) },
    )
    expect(res.status).toBe(201)
    expect(typePushes).toEqual([{ hotelId: HOTEL_ID, roomType: 'deluxe' }, { hotelId: HOTEL_ID, roomType: 'standard' }])
    expect(unitPushes).toHaveLength(0)
  })

  it('(g) precio por unidad sin tarifas: MÍNIMO basePrice entre las vendibles del tipo (lo que /rates publica), no el de una unidad elegida', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        room('d1', 'deluxe', 150),
        room('d2', 'deluxe', 100),
        room('d3', 'deluxe', 120),
        // En mantenimiento: ni cuenta como inventario ni fija el precio.
        room('d4', 'deluxe', 10, { status: 'maintenance' }),
      ],
    })
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'deluxe', adults: 2, quantity: 3 }] })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
    // 100 × 2 noches por fila; grupo 600.
    for (const r of tables.Reservations) expect(r.totalAmount).toBe(200)
    expect(res.body.totalBreakdown.subtotal).toBe(600)
  })

  it('(g2) 4 unidades con una en mantenimiento → sólo 3 vendibles: grupo de 4 → 409 available 3', async () => {
    const { orm } = makeDb({ rooms: [...threeDeluxe(), room('d4', 'deluxe', 100, { status: 'maintenance' })] })
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'deluxe', adults: 2, quantity: 4 }] })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(3)
  })

  it('(h) capacidad sin unidad: entra si entra en alguna unidad del tipo → 201 sin elegir cuál', async () => {
    const { orm, tables } = makeDb({
      rooms: [room('f-chica', 'familiar', 80, { capacity: 2 }), room('f-grande', 'familiar', 150, { capacity: 4 })],
    })
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'familiar', adults: 4, quantity: 1 }] })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].roomId).toBeNull()
    expect(tables.Reservations[0].roomType).toBe('familiar')
  })

  it('(h2) más unidades "grandes" que las que existen para esa composición → 409 (ninguna asignación lo cumple)', async () => {
    const { orm, tables } = makeDb({
      rooms: [room('f-chica', 'familiar', 80, { capacity: 2 }), room('f-grande', 'familiar', 150, { capacity: 4 })],
    })
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'familiar', adults: 4, quantity: 2 }] })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(1)
    expect(res.body.error).toContain('con capacidad para 4 huésped(es)')
    expect(tables.Reservations).toHaveLength(0)
  })

  it('(h3) ninguna unidad del tipo admite la composición → 409 available 0, nada creado', async () => {
    const { orm, tables } = makeDb({ rooms: threeDeluxe() }) // capacity 2
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'deluxe', adults: 3, quantity: 1 }] })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(0)
    expect(tables.Reservations).toHaveLength(0)
    expect(tables.Groups).toHaveLength(0)
  })

  it('tipo inexistente en el hotel → 404, nada creado', async () => {
    const { orm, tables } = makeDb({ rooms: threeDeluxe() })
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'suite', adults: 2, quantity: 1 }] })
    expect(res.status).toBe(404)
    expect(tables.Reservations).toHaveLength(0)
  })
})
