// bookingengine/tests/public-booking-crib.test.ts — #292: la CUNA es la amenidad personalizada
// `custom:cuna` (`CRIB_AMENITY_KEY`) de cada habitación, no una config global del hotel ni un
// catálogo `child_amenities`. El backend re-valida `needsCrib` = bebé > 0 ∧ pedida ∧ el tipo
// (alguna unidad libre) ofrece `custom:cuna`; si `needsCrib` fuerza la key en `roomAmenities`
// (precio real de la unidad asignada), si no la quita aunque el body la mande.
//
// Cubre:
//  (a) tipo SIN `custom:cuna`, bebé + needsCrib:true → needsCrib false, cribCount 0, sin línea.
//  (b) tipo CON `custom:cuna` (15), bebé + needsCrib:true → needsCrib true, cribCount 1,
//      `roomAmenities` trae `{key:'custom:cuna', price:15}` y `roomAmenitiesTotal` = 15 aunque el
//      body NO haya mandado la key en `roomAmenities`.
//  (c) tipo CON cuna, needsCrib:false pero body manda `roomAmenities:[{key:'custom:cuna'}]` →
//      sin línea de cuna, needsCrib false.
//  (d) sin bebés + needsCrib:true → false.
//  (e) grupo con dos líneas de tipos distintos (uno con cuna, otro sin), ambas con bebé y
//      needsCrib:true → sólo la línea del tipo con cuna queda con needsCrib true y su precio.
//  (f) body con `childAmenities:[{id:'x'}]` se ignora: `childAmenities` [] y
//      `childAmenitiesTotal` 0.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'
import { CRIB_AMENITY_KEY, roomsOfferCrib } from '../usecases/public-room-amenities'

const HOTEL_ID = 'h1'

/** Mismo ORM en memoria que `public-booking-room-amenities.test.ts`, con `RoomAmenities`. */
function makeDb(seed: { rooms?: any[]; roomAmenities?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    RoomAmenities: seed.roomAmenities ?? [],
    Reservations: [],
    ReservationAddons: [],
    RoomBlocks: [],
    RoomRates: [],
    SeasonAssignments: [],
    RateOverrides: [],
    Seasons: [],
    PromoCodes: [],
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

// maxBabyAge=1: edades 0-1 son bebé, 2-3 libre (no bebé), 4-12 con plaza.
const BABY_POLICY = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1 }
function childPolicyDeps() {
  return { config: { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL_ID, key: 'child_policy', value: BABY_POLICY } : null) } as any }
}

const am = (roomId: string, amenityKey: string, extra: any = {}) => ({ id: `${roomId}-${amenityKey}`, roomId, amenityKey, isActive: true, name: '', price: 0, ...extra })
const CUNA = { key: CRIB_AMENITY_KEY, name: 'Cuna', price: 15, quantity: 1, total: 15 }

function makeLogger() {
  const warns: string[] = []
  return { logger: { warn: (m: string) => { warns.push(m) }, error: () => {} }, warns }
}

/** 1 room 'double' (100) que ofrece cuna a 15, 1 room 'suite' (150) sin cuna (sólo wifi). */
function twoTypesDb() {
  return makeDb({
    rooms: [
      { id: 'r-double', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' },
      { id: 'r-suite', hotelId: HOTEL_ID, type: 'suite', capacity: 4, basePrice: 150, status: 'available' },
    ],
    roomAmenities: [
      am('r-double', 'wifi'),
      am('r-double', CRIB_AMENITY_KEY, { name: 'Cuna', price: 15 }),
      am('r-suite', 'wifi'),
    ],
  })
}

const direct = (orm: any, body: any, logger?: any) =>
  createPublicBookingDirect(orm, { ...BASE_BODY, ...body }, undefined, undefined, undefined, logger, undefined, childPolicyDeps())

describe('createPublicBookingDirect — cuna por habitación (custom:cuna, #292)', () => {
  it('(a) tipo SIN custom:cuna + bebé + needsCrib:true → needsCrib false, cribCount 0, sin línea de cuna (warn)', async () => {
    const { orm, tables } = twoTypesDb()
    const { logger, warns } = makeLogger()
    const res = await direct(orm, { roomType: 'suite', adults: 2, childrenAges: [1], needsCrib: true }, logger)
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.needsCrib).toBe(false)
    expect(saved.cribCount).toBe(0)
    expect(saved.roomAmenities).toEqual([])
    expect(saved.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(300)
    expect(saved.notes).not.toContain('Cuna')
    expect(warns.some((w) => w.includes('cuna pedida'))).toBe(true)
  })

  it('(b) tipo CON custom:cuna (15) + bebé + needsCrib:true → needsCrib true, cribCount 1, línea de cuna a 15 aunque el body NO mande la key', async () => {
    const { orm, tables } = twoTypesDb()
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.roomId).toBe('r-double')
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    expect(saved.roomAmenities).toEqual([CUNA])
    expect(saved.roomAmenitiesTotal).toBe(15)
    expect(saved.priceBreakdown.roomAmenitiesTotal).toBe(15)
    // 2 noches × 100 + 15 de cuna.
    expect(saved.priceBreakdown.subtotal).toBe(215)
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(15)
    expect(res.body.totalBreakdown.total).toBe(215)
    expect(saved.notes).toContain('Amenidades habitación: Cuna=15.00')
    expect(saved.notes).toContain('Cuna: solicitada')
    // #269 — la cuna se materializa como addon de habitación (una sola vez).
    expect(tables.ReservationAddons.filter((a: any) => a.kind === 'room_amenity')).toHaveLength(1)
    expect(tables.ReservationAddons[0]).toMatchObject({ description: 'Cuna', amount: 15, quantity: 1 })
  })

  it('(b2) la key mandada en el body ADEMÁS de needsCrib:true no duplica la línea', async () => {
    const { orm, tables } = twoTypesDb()
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true, roomAmenities: [{ key: CRIB_AMENITY_KEY }] })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].roomAmenities).toEqual([CUNA])
    expect(tables.Reservations[0].roomAmenitiesTotal).toBe(15)
  })

  it('(b3) roomId explícito de una room que ofrece cuna → mismo gate contra ESA room', async () => {
    const { orm, tables } = twoTypesDb()
    const res = await direct(orm, { roomId: 'r-double', adults: 2, childrenAges: [1], needsCrib: true })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(true)
    expect(tables.Reservations[0].roomAmenities).toEqual([CUNA])
    const res2 = await direct(orm, { roomId: 'r-suite', adults: 2, childrenAges: [1], needsCrib: true })
    expect(res2.status).toBe(201)
    expect(tables.Reservations[1].needsCrib).toBe(false)
    expect(tables.Reservations[1].roomAmenities).toEqual([])
  })

  it('(c) tipo CON cuna, needsCrib:false pero el body manda roomAmenities:[custom:cuna] → sin línea de cuna, needsCrib false', async () => {
    const { orm, tables } = twoTypesDb()
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: false, roomAmenities: [{ key: CRIB_AMENITY_KEY }] })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.needsCrib).toBe(false)
    expect(saved.cribCount).toBe(0)
    expect(saved.roomAmenities).toEqual([])
    expect(saved.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(200)
  })

  it('(c2) otras keys custom del body se conservan aunque se quite la cuna', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' }],
      roomAmenities: [am('r1', CRIB_AMENITY_KEY, { name: 'Cuna', price: 15 }), am('r1', 'custom:cama_extra', { name: 'Cama extra', price: 30 })],
    })
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], roomAmenities: [{ key: CRIB_AMENITY_KEY }, { key: 'custom:cama_extra' }] })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(false)
    expect(tables.Reservations[0].roomAmenities).toEqual([{ key: 'custom:cama_extra', name: 'Cama extra', price: 30, quantity: 1, total: 30 }])
    expect(tables.Reservations[0].roomAmenitiesTotal).toBe(30)
  })

  it('(d) sin bebés + needsCrib:true → needsCrib false, sin línea (aunque el tipo ofrezca cuna)', async () => {
    const { orm, tables } = twoTypesDb()
    // Niño de 8: con plaza, no es bebé.
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [8], needsCrib: true })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(false)
    expect(tables.Reservations[0].cribCount).toBe(0)
    expect(tables.Reservations[0].roomAmenities).toEqual([])
    // Sin niños en absoluto: tampoco (db nueva: la única 'double' ya quedó reservada arriba).
    const fresh = twoTypesDb()
    const res2 = await direct(fresh.orm, { roomType: 'double', adults: 2, needsCrib: true, roomAmenities: [{ key: CRIB_AMENITY_KEY }] })
    expect(res2.status).toBe(201)
    expect(fresh.tables.Reservations[0].needsCrib).toBe(false)
    expect(fresh.tables.Reservations[0].roomAmenities).toEqual([])
  })

  it('(d2) con needsCrib se PREFIERE la unidad del tipo que ofrece cuna y se cobra SU precio', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-cheap', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 80, status: 'available' },
        { id: 'r-crib', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' },
      ],
      roomAmenities: [am('r-crib', CRIB_AMENITY_KEY, { name: 'Cuna', price: 20 })],
    })
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [0], needsCrib: true })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].roomId).toBe('r-crib')
    expect(tables.Reservations[0].needsCrib).toBe(true)
    expect(tables.Reservations[0].roomAmenities).toEqual([{ key: CRIB_AMENITY_KEY, name: 'Cuna', price: 20, quantity: 1, total: 20 }])
    // 2 × 100 + 20.
    expect(res.body.totalBreakdown.subtotal).toBe(220)
  })

  it('(f) childAmenities en el body se IGNORA: snapshot [] y childAmenitiesTotal 0 (sin repo, sin cargo)', async () => {
    const { orm, tables } = twoTypesDb()
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], childAmenities: [{ id: 'x' }] })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.childAmenities).toEqual([])
    expect(saved.childAmenitiesTotal).toBe(0)
    expect(saved.priceBreakdown.childAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(saved.notes).not.toContain('Amenidades niños')
    expect(tables.ReservationAddons).toHaveLength(0)
  })
})

describe('createPublicBookingGroup — cuna por línea (custom:cuna, #292)', () => {
  const group = (orm: any, body: any, logger?: any) =>
    createPublicBookingGroup(orm, { ...BASE_BODY, ...body }, undefined, undefined, undefined, logger, undefined, childPolicyDeps())

  it('(e) dos líneas de tipos distintos (uno con cuna, otro sin), ambas con bebé + needsCrib:true → sólo la del tipo con cuna la recibe, con su precio', async () => {
    const { orm, tables } = twoTypesDb()
    const { logger, warns } = makeLogger()
    const res = await group(orm, {
      rooms: [
        { roomType: 'double', adults: 2, quantity: 1, childrenAges: [1], needsCrib: true },
        { roomType: 'suite', adults: 2, quantity: 1, childrenAges: [0], needsCrib: true },
      ],
    }, logger)
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    expect(byRoom['r-double'].needsCrib).toBe(true)
    expect(byRoom['r-double'].cribCount).toBe(1)
    expect(byRoom['r-double'].roomAmenities).toEqual([CUNA])
    expect(byRoom['r-double'].roomAmenitiesTotal).toBe(15)
    expect(byRoom['r-suite'].needsCrib).toBe(false)
    expect(byRoom['r-suite'].cribCount).toBe(0)
    expect(byRoom['r-suite'].roomAmenities).toEqual([])
    expect(byRoom['r-suite'].roomAmenitiesTotal).toBe(0)
    // 100×2 + 150×2 + 15.
    const tb = res.body.totalBreakdown
    expect(tb.roomAmenitiesTotal).toBe(15)
    expect(tb.childAmenitiesTotal).toBe(0)
    expect(tb.subtotal).toBe(515)
    expect(tables.Groups[0].totalAmount).toBe(515)
    expect(tables.Reservations[0].notes).toContain('Cuna: double')
    expect(tables.Reservations[0].notes).toContain('Amenidades habitación: double: Cuna=15.00')
    expect(warns.some((w) => w.includes('cuna pedida'))).toBe(true)
    // Todas las filas nuevas escriben el snapshot infantil vacío.
    for (const r of tables.Reservations) {
      expect(r.childAmenities).toEqual([])
      expect(r.childAmenitiesTotal).toBe(0)
    }
  })

  it('(e2) línea con cuna pero needsCrib:false y la key en roomAmenities → sin cuna; childAmenities por línea se ignora', async () => {
    const { orm, tables } = twoTypesDb()
    const res = await group(orm, {
      rooms: [{ roomType: 'double', adults: 2, quantity: 1, childrenAges: [1], roomAmenities: [{ key: CRIB_AMENITY_KEY }], childAmenities: [{ id: 'x' }] }],
    })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(false)
    expect(tables.Reservations[0].roomAmenities).toEqual([])
    expect(tables.Reservations[0].childAmenities).toEqual([])
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
  })
})

describe('roomsOfferCrib — helper puro', () => {
  it('true sólo si alguna room dada tiene custom:cuna ACTIVA', () => {
    const map = new Map<string, any[]>([
      ['a', [am('a', 'wifi')]],
      ['b', [am('b', CRIB_AMENITY_KEY, { name: 'Cuna', isActive: false })]],
      ['c', [am('c', CRIB_AMENITY_KEY, { name: 'Cuna' })]],
    ])
    expect(roomsOfferCrib(map, ['a'])).toBe(false)
    expect(roomsOfferCrib(map, ['a', 'b'])).toBe(false)
    expect(roomsOfferCrib(map, ['a', 'b', 'c'])).toBe(true)
    expect(roomsOfferCrib(map, ['zzz'])).toBe(false)
    expect(roomsOfferCrib(map, [])).toBe(false)
  })
})
