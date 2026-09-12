// bookingengine/tests/public-booking-room-amenities.test.ts — REQ-01 (#290): amenidades
// PERSONALIZADAS de la habitación (RoomAmenities `custom:*`) en la reserva pública (single y grupo).
//
// REQ-HAC-05 (#260): la reserva individual nace por TIPO sin unidad (`roomId` null). El catálogo
// contra el que se resuelven las keys es la UNIÓN de `RoomAmenities` de las unidades vendibles del
// tipo (misma key en dos unidades → la más barata), y la habitación cotiza al MÍNIMO `basePrice`
// del tipo. Ya no se "elige la unidad que la ofrece": eso lo decide recepción al asignar.
//
// Cubre:
//  (a) single por roomType con `roomAmenities:[{key:'custom:jacuzzi'}]` donde solo la room más cara la
//      ofrece → igual se cobra (unión del tipo), breakdown.roomAmenitiesTotal = su precio,
//      subtotal/total lo incluyen, la reserva persiste el snapshot con precio y `roomAmenitiesTotal`,
//      y nace sin unidad.
//  (b) key no ofrecida por ninguna room del tipo → se ignora con warn, total sin cambios.
//  (c) el precio mandado en el body se IGNORA: manda el de `RoomAmenities`.
//  (c2) `roomId` explícito → sólo deriva el tipo: resuelve contra la unión del tipo, sin unidad.
//  (d) grupo de 2 líneas, solo una con roomAmenities → solo esas filas llevan snapshot; cada
//      unidad cobra el precio de SUS filas.
//  (e) sin roomAmenities → breakdown.roomAmenitiesTotal 0, snapshot [] y nada más cambia.
//  (f) total = subtotal - promo + taxes sigue cuadrando con las amenidades dentro del subtotal.
//
// #292 — la amenidad de ejemplo es `custom:jacuzzi`: `custom:cuna` es la CUNA, la gobierna
// `needsCrib` (bebé + el tipo la ofrece) y no una key suelta en `roomAmenities` — ver
// `public-booking-crib.test.ts`.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'

const HOTEL_ID = 'h1'

/** ORM en memoria (mismo patrón que `public-booking-group.test.ts`), con `RoomAmenities`. */
function makeDb(seed: { rooms?: any[]; roomAmenities?: any[]; promoCodes?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    RoomAmenities: seed.roomAmenities ?? [],
    Reservations: [],
    RoomBlocks: [],
    RoomRates: [],
    SeasonAssignments: [],
    RateOverrides: [],
    Seasons: [],
    PromoCodes: seed.promoCodes ?? [],
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

const BASE_BODY = {
  hotelId: HOTEL_ID,
  guestName: 'Ana Pérez',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: '2026-09-10',
  checkOut: '2026-09-12', // 2 noches
}

const am = (roomId: string, amenityKey: string, extra: any = {}) => ({ id: `${roomId}-${amenityKey}`, roomId, amenityKey, isActive: true, name: '', price: 0, ...extra })

function makeLogger() {
  const warns: string[] = []
  return { logger: { warn: (m: string) => { warns.push(m) }, error: () => {} }, warns }
}

/** 2 rooms 'double': r-cheap (80, sin jacuzzi) y r-jac (100, con jacuzzi a 15 y cama extra a 30). */
function twoRoomsDb() {
  return makeDb({
    rooms: [
      { id: 'r-cheap', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 80, status: 'available' },
      { id: 'r-jac', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 100, status: 'available' },
    ],
    roomAmenities: [
      am('r-cheap', 'wifi'),
      am('r-cheap', 'custom:cama_extra', { name: 'Cama extra', price: 25 }),
      am('r-jac', 'wifi'),
      am('r-jac', 'custom:jacuzzi', { name: 'Jacuzzi', price: 15 }),
      am('r-jac', 'custom:cama_extra', { name: 'Cama extra', price: 30 }),
    ],
  })
}

describe('createPublicBookingDirect — amenidades de habitación (REQ-01 #290)', () => {
  it('(a) solo la room más cara ofrece el jacuzzi → se cobra igual (unión del tipo), roomAmenitiesTotal=15, subtotal/total la incluyen, snapshot persistido, sin unidad', async () => {
    const { orm, tables } = twoRoomsDb()
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, roomAmenities: [{ key: 'custom:jacuzzi' }] })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('double')
    const tb = res.body.totalBreakdown
    expect(tb.roomAmenitiesTotal).toBe(15)
    expect(tb.childAmenitiesTotal).toBe(0)
    // 2 noches × 80 (mínimo basePrice del tipo, lo que publica /rates) + 15 de jacuzzi.
    expect(tb.subtotal).toBe(175)
    expect(tb.total).toBe(175)
    expect(res.body.reservation.totalAmount).toBe(175)

    const saved = tables.Reservations[0]
    expect(saved.roomId).toBeNull()
    expect(saved.roomType).toBe('double')
    expect(saved.roomAmenitiesTotal).toBe(15)
    expect(saved.roomAmenities).toEqual([{ key: 'custom:jacuzzi', name: 'Jacuzzi', price: 15, quantity: 1, total: 15 }])
    expect(saved.priceBreakdown.roomAmenitiesTotal).toBe(15)
    expect(saved.priceBreakdown.subtotal).toBe(175)
    expect(saved.notes).toContain('Amenidades habitación: Jacuzzi=15.00')
  })

  it('(a2) las dos la ofrecen → se cobra el precio MÁS BARATO entre las unidades del tipo', async () => {
    const { orm, tables } = twoRoomsDb()
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, roomAmenities: [{ key: 'custom:cama_extra' }] })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(25)
    expect(res.body.totalBreakdown.subtotal).toBe(185)
    expect(tables.Reservations[0].roomAmenities).toEqual([{ key: 'custom:cama_extra', name: 'Cama extra', price: 25, quantity: 1, total: 25 }])
  })

  it('(b) key no ofrecida por ninguna room → se ignora con warn, total sin cambios', async () => {
    const { orm, tables } = twoRoomsDb()
    const { logger, warns } = makeLogger()
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, roomAmenities: [{ key: 'custom:sauna' }] }, undefined, undefined, undefined, logger)
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(160)
    expect(tables.Reservations[0].roomAmenities).toEqual([])
    expect(tables.Reservations[0].roomAmenitiesTotal).toBe(0)
    expect(tables.Reservations[0].notes).not.toContain('Amenidades habitación')
    expect(warns.some((w) => w.includes('Amenidad de habitación ignorada'))).toBe(true)
  })

  it('(b2) una key fija (wifi) o inactiva no se cobra ni entra al snapshot', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 80, status: 'available' }],
      roomAmenities: [am('r1', 'wifi', { price: 99 }), am('r1', 'custom:jacuzzi', { name: 'Jacuzzi', price: 15, isActive: false })],
    })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, roomAmenities: [{ key: 'wifi' }, { key: 'custom:jacuzzi' }] })
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(160)
    expect(tables.Reservations[0].roomAmenities).toEqual([])
  })

  it('(c) el precio mandado en el body se IGNORA: manda el de RoomAmenities', async () => {
    const { orm, tables } = twoRoomsDb()
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, roomAmenities: [{ key: 'custom:jacuzzi', price: 0.01, name: 'Gratis' }] })
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(15)
    expect(tables.Reservations[0].roomAmenities[0]).toEqual({ key: 'custom:jacuzzi', name: 'Jacuzzi', price: 15, quantity: 1, total: 15 })
  })

  it('(c2) roomId explícito → sólo deriva el tipo (HAC-05): resuelve contra la UNIÓN del tipo y nace sin unidad', async () => {
    const { orm, tables } = twoRoomsDb()
    // r-cheap no ofrece el jacuzzi pero r-jac (mismo tipo) sí → se cobra a 15; la cama extra al
    // precio más barato del tipo (25). La fila no queda atada a r-cheap.
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomId: 'r-cheap', adults: 2, roomAmenities: [{ key: 'custom:jacuzzi' }, { key: 'custom:cama_extra' }] })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('double')
    expect(tables.Reservations[0].roomId).toBeNull()
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(40)
    expect(tables.Reservations[0].roomAmenities).toEqual([
      { key: 'custom:jacuzzi', name: 'Jacuzzi', price: 15, quantity: 1, total: 15 },
      { key: 'custom:cama_extra', name: 'Cama extra', price: 25, quantity: 1, total: 25 },
    ])
  })

  it('(e) sin roomAmenities → roomAmenitiesTotal 0, snapshot [] y nada más cambia', async () => {
    const { orm, tables } = twoRoomsDb()
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2 })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(160)
    expect(res.body.totalBreakdown.total).toBe(160)
    expect(tables.Reservations[0].roomAmenities).toEqual([])
    expect(tables.Reservations[0].roomAmenitiesTotal).toBe(0)
  })

  it('(f) total = subtotal - promo + taxes sigue cuadrando con las amenidades dentro del subtotal', async () => {
    const promo = { id: 'p1', hotelId: HOTEL_ID, code: 'DESC10', kind: 'percent', value: 10, active: true, uses: 0, maxUses: null }
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 100, status: 'available' }],
      roomAmenities: [am('r1', 'custom:jacuzzi', { name: 'Jacuzzi', price: 10 })],
      promoCodes: [promo],
    })
    const promoCodes = {
      findOne: async (f: any) => tables.PromoCodes.find((p) => Object.entries(f).every(([k, v]) => p[k] === v)) ?? null,
      findMany: async (f: any = {}) => tables.PromoCodes.filter((p) => Object.entries(f).every(([k, v]) => p[k] === v)),
    } as any
    const config = {
      findOne: async (f: any) => (f.key === 'taxes' ? { hotelId: HOTEL_ID, key: 'taxes', value: [{ name: 'ITBIS', rate: 18, active: true }] } : null),
    } as any
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'double', adults: 2, promoCode: 'DESC10', roomAmenities: [{ key: 'custom:jacuzzi' }] },
      undefined, undefined, undefined, undefined, undefined,
      { config, promoCodes },
    )
    expect(res.status).toBe(201)
    const tb = res.body.totalBreakdown
    expect(tb.subtotal).toBe(210)
    expect(tb.roomAmenitiesTotal).toBe(10)
    // El promo se calcula sobre el subtotal QUE INCLUYE las amenidades: 10% de 210.
    expect(tb.promoDiscount).toBe(21)
    expect(tb.taxes).toBe(Math.round((210 - 21) * 0.18 * 100) / 100)
    expect(tb.total).toBe(Math.round((tb.subtotal - tb.promoDiscount + tb.taxes) * 100) / 100)
    expect(tables.Reservations[0].totalAmount).toBe(tb.total)
  })
})

describe('createPublicBookingGroup — amenidades de habitación por línea (REQ-01 #290)', () => {
  function groupDb() {
    return makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r-f1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
        { id: 'r-f2', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
        { id: 'r-f3', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
      ],
      roomAmenities: [
        am('r-a', 'custom:jacuzzi', { name: 'Jacuzzi', price: 15 }), // la línea double NO la pide
        am('r-f2', 'custom:jacuzzi', { name: 'Jacuzzi', price: 15 }),
        am('r-f3', 'custom:jacuzzi', { name: 'Jacuzzi', price: 20 }),
        // r-f1 no ofrece el jacuzzi → con quantity 2 se eligen f2 y f3 (las que la ofrecen).
      ],
    })
  }

  it('(d) 2 líneas, solo la segunda con roomAmenities y quantity 2 → se prefieren las que la ofrecen; snapshot por unidad a SU precio', async () => {
    const { orm, tables } = groupDb()
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'double', adults: 2, quantity: 1 },
        { roomType: 'family', adults: 2, quantity: 2, roomAmenities: [{ key: 'custom:jacuzzi' }] },
      ],
    })
    expect(res.status).toBe(201)
    const tb = res.body.totalBreakdown
    // Habitaciones: 80×2 + 100×2×2 = 560; jacuzzis: 15 (f2) + 20 (f3) = 35.
    expect(tb.roomAmenitiesTotal).toBe(35)
    expect(tb.subtotal).toBe(595)
    expect(tb.total).toBe(595)
    expect(tables.Groups[0].totalAmount).toBe(595)

    expect(tables.Reservations).toHaveLength(3)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    expect(Object.keys(byRoom).sort()).toEqual(['r-a', 'r-f2', 'r-f3'])
    // Línea 1 (no pidió nada): sin snapshot aunque r-a ofrezca el jacuzzi.
    expect(byRoom['r-a'].roomAmenities).toEqual([])
    expect(byRoom['r-a'].roomAmenitiesTotal).toBe(0)
    // Línea 2: cada unidad con SU snapshot (quantity 1) y SU precio.
    expect(byRoom['r-f2'].roomAmenities).toEqual([{ key: 'custom:jacuzzi', name: 'Jacuzzi', price: 15, quantity: 1, total: 15 }])
    expect(byRoom['r-f2'].roomAmenitiesTotal).toBe(15)
    expect(byRoom['r-f3'].roomAmenities).toEqual([{ key: 'custom:jacuzzi', name: 'Jacuzzi', price: 20, quantity: 1, total: 20 }])
    expect(byRoom['r-f3'].roomAmenitiesTotal).toBe(20)
    // El desglose guardado en la líder es el del grupo, con las amenidades adentro.
    expect(tables.Reservations[0].priceBreakdown.roomAmenitiesTotal).toBe(35)
    expect(tables.Reservations[0].priceBreakdown.subtotal).toBe(595)
    expect(tables.Reservations[0].notes).toContain('Amenidades habitación: family: Jacuzzi=35.00')
  })

  it('línea que pide más unidades que rooms con la amenidad → la que no la ofrece la ignora con warn', async () => {
    const { orm, tables } = groupDb()
    const { logger, warns } = makeLogger()
    const res = await createPublicBookingGroup(
      orm,
      { ...BASE_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 3, roomAmenities: [{ key: 'custom:jacuzzi' }] }] },
      undefined, undefined, undefined, logger,
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(35)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    expect(byRoom['r-f1'].roomAmenities).toEqual([])
    expect(byRoom['r-f1'].roomAmenitiesTotal).toBe(0)
    expect(warns.some((w) => w.includes('Amenidad de habitación ignorada'))).toBe(true)
  })

  it('sin roomAmenities en ninguna línea → roomAmenitiesTotal 0 y nada más cambia', async () => {
    const { orm, tables } = groupDb()
    const res = await createPublicBookingGroup(orm, { ...BASE_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 1 }] })
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(tables.Reservations[0].roomId).toBe('r-f1')
    expect(tables.Reservations[0].roomAmenities).toEqual([])
    expect(tables.Reservations[0].roomAmenitiesTotal).toBe(0)
  })

  it('el cobro (Stripe) del grupo usa el total CON amenidades de habitación', async () => {
    const { orm } = groupDb()
    const calls: any[] = []
    const stripe = {
      createReservationCheckout: async (reservationId: string, amount: number) => {
        calls.push({ reservationId, amount })
        return { id: 'cs_1', url: 'https://checkout.example/cs_1', payment_status: 'unpaid' }
      },
    }
    const res = await createPublicBookingGroup(
      orm,
      { ...BASE_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 1, roomAmenities: [{ key: 'custom:jacuzzi' }] }] },
      undefined, undefined, stripe, undefined, { successUrl: 'https://x/ok', cancelUrl: 'https://x/ko' },
    )
    expect(res.status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0].amount).toBe(215)
  })
})
