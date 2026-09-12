// bookingengine/tests/public-booking-crib.test.ts — #292: la CUNA es la amenidad personalizada
// `custom:cuna` (`CRIB_AMENITY_KEY`) de cada habitación, no una config global del hotel ni un
// catálogo `child_amenities`. #341: la cuna es una amenidad de habitación NORMAL — se pide con la
// key cuna en `roomAmenities` (como cualquier `custom:*`) o, por compat, con `needsCrib:true`;
// NO hay gate por bebé ni pregunta aparte. El backend resuelve `needsCrib` = la unidad FINALMENTE
// asignada ofrece una fila cuna (la línea quedó en `roomAmenities`).
// Invariante: `needsCrib === (roomAmenities tiene una línea cuna)` SIEMPRE.
//
// Cubre:
//  (a) tipo SIN `custom:cuna`, bebé + needsCrib:true → needsCrib false, cribCount 0, sin línea.
//  (b) tipo CON `custom:cuna` (15), bebé + needsCrib:true → needsCrib true, cribCount 1,
//      `roomAmenities` trae `{key:'custom:cuna', price:15}` y `roomAmenitiesTotal` = 15 aunque el
//      body NO haya mandado la key en `roomAmenities` (compat con callers viejos).
//  (c) tipo CON cuna, body manda `roomAmenities:[{key:'custom:cuna'}]` SIN needsCrib (o con
//      needsCrib:false, valor muerto) → línea de cuna cobrada, needsCrib true (#341).
//  (c3) #341 — SIN bebé + `roomAmenities:[{key:'custom:cuna'}]` (sin needsCrib) → línea cuna al
//      precio real, needsCrib true, cribCount 1. (c4) cuna con precio 0 → línea con total 0,
//      needsCrib true.
//  (d) sin bebés + needsCrib:true → SÍ cuna si el tipo la ofrece (#341: sin gate por bebé).
//  (e) grupo con dos líneas de tipos distintos (uno con cuna, otro sin), ambas con bebé y
//      needsCrib:true → sólo la línea del tipo con cuna queda con needsCrib true y su precio.
//  (f) body con `childAmenities:[{id:'x'}]` se ignora: `childAmenities` [] y
//      `childAmenitiesTotal` 0.
//  (g) revisión: room A (80) ofrece `custom:jacuzzi`, room B (100) ofrece `custom:cuna`, body
//      pide jacuzzi + cuna con bebé → la cuna tiene PRIORIDAD: se asigna B con cuna cobrada
//      (needsCrib true, jacuzzi ignorada con warn). Con `roomId` explícito A → needsCrib false
//      SIN línea de cuna (antes persistía needsCrib=true + "Cuna: solicitada" sin línea).
//  (h) lo mismo en grupo: quantity 1 → B con cuna; quantity 2 → B needsCrib true, A false, cada
//      fila espejo exacto de su propio snapshot.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'
import { CRIB_AMENITY_KEY, hasCribLine, preferRoomsOffering, roomsOfferCrib } from '../usecases/public-room-amenities'

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

/** Caso del revisor: dos 'double' — A (80) sólo con jacuzzi, B (100) sólo con cuna. Ninguna
 *  ofrece la combinación completa jacuzzi+cuna. */
function jacuzziVsCribDb() {
  return makeDb({
    rooms: [
      { id: 'r-jacuzzi', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 80, status: 'available' },
      { id: 'r-crib', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' },
    ],
    roomAmenities: [
      am('r-jacuzzi', 'custom:jacuzzi', { name: 'Jacuzzi', price: 40 }),
      am('r-crib', CRIB_AMENITY_KEY, { name: 'Cuna', price: 15 }),
    ],
  })
}
const JACUZZI = { key: 'custom:jacuzzi', name: 'Jacuzzi', price: 40, quantity: 1, total: 40 }
/** Invariante #292 sobre una fila persistida: `needsCrib`/`cribCount` son espejo EXACTO del snapshot. */
function expectCribMirrorsSnapshot(saved: any) {
  const hasLine = (saved.roomAmenities as any[]).some((a) => a.key === CRIB_AMENITY_KEY)
  expect(saved.needsCrib).toBe(hasLine)
  expect(saved.cribCount).toBe(hasLine ? 1 : 0)
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

  it('(c) #341: tipo CON cuna, el body manda roomAmenities:[custom:cuna] SIN needsCrib → línea de cuna cobrada, needsCrib true (la key es una amenidad más)', async () => {
    const { orm, tables } = twoTypesDb()
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], roomAmenities: [{ key: CRIB_AMENITY_KEY }] })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    expect(saved.roomAmenities).toEqual([CUNA])
    expect(saved.roomAmenitiesTotal).toBe(15)
    expect(res.body.totalBreakdown.subtotal).toBe(215)
    expect(saved.notes).toContain('Cuna: solicitada')
    expectCribMirrorsSnapshot(saved)
    // Un `needsCrib:false` explícito junto a la key es un valor muerto (la pregunta ya no existe):
    // la key manda igual.
    const fresh = twoTypesDb()
    const res2 = await direct(fresh.orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: false, roomAmenities: [{ key: CRIB_AMENITY_KEY }] })
    expect(res2.status).toBe(201)
    expect(fresh.tables.Reservations[0].needsCrib).toBe(true)
    expect(fresh.tables.Reservations[0].roomAmenities).toEqual([CUNA])
  })

  it('(c2) la cuna convive con otras keys custom del body: ambas se cobran al precio real de la unidad', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' }],
      roomAmenities: [am('r1', CRIB_AMENITY_KEY, { name: 'Cuna', price: 15 }), am('r1', 'custom:cama_extra', { name: 'Cama extra', price: 30 })],
    })
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], roomAmenities: [{ key: CRIB_AMENITY_KEY }, { key: 'custom:cama_extra' }] })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    // La cuna se reinserta como key canónica al final de las keys (una sola vez).
    expect(saved.roomAmenities).toEqual([{ key: 'custom:cama_extra', name: 'Cama extra', price: 30, quantity: 1, total: 30 }, CUNA])
    expect(saved.roomAmenitiesTotal).toBe(45)
    expect(res.body.totalBreakdown.subtotal).toBe(245)
    expectCribMirrorsSnapshot(saved)
  })

  it('(c3) #341: SIN bebé + roomAmenities:[custom:cuna] (sin needsCrib) → línea cuna cobrada al precio real, needsCrib true, cribCount 1', async () => {
    const { orm, tables } = twoTypesDb()
    const { logger, warns } = makeLogger()
    const res = await direct(orm, { roomType: 'double', adults: 2, roomAmenities: [{ key: CRIB_AMENITY_KEY }] }, logger)
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.roomId).toBe('r-double')
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    expect(saved.roomAmenities).toEqual([CUNA])
    expect(saved.roomAmenitiesTotal).toBe(15)
    expect(saved.priceBreakdown.roomAmenitiesTotal).toBe(15)
    // 2 noches × 100 + 15 de cuna, sin ningún niño en la composición.
    expect(saved.priceBreakdown.subtotal).toBe(215)
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(15)
    expect(res.body.totalBreakdown.total).toBe(215)
    expect(saved.notes).toContain('Amenidades habitación: Cuna=15.00')
    expect(saved.notes).toContain('Cuna: solicitada')
    expect(saved.cribUnavailable).toBe(false)
    expect(res.body.cribUnavailable).toBeUndefined()
    expectCribMirrorsSnapshot(saved)
    expect(tables.ReservationAddons.filter((a: any) => a.kind === 'room_amenity')).toHaveLength(1)
    expect(tables.ReservationAddons[0]).toMatchObject({ description: 'Cuna', amount: 15, quantity: 1 })
    expect(warns.some((w) => w.includes('cuna pedida'))).toBe(false)
  })

  it('(c4) cuna con precio 0 → línea con total 0, needsCrib true, cribCount 1 (gratis sigue siendo pedida)', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' }],
      roomAmenities: [am('r1', CRIB_AMENITY_KEY, { name: 'Cuna', price: 0 })],
    })
    const res = await direct(orm, { roomType: 'double', adults: 2, roomAmenities: [{ key: CRIB_AMENITY_KEY }] })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    expect(saved.roomAmenities).toEqual([{ key: CRIB_AMENITY_KEY, name: 'Cuna', price: 0, quantity: 1, total: 0 }])
    expect(saved.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(saved.notes).toContain('Cuna: solicitada')
    expectCribMirrorsSnapshot(saved)
  })

  it('(d) #341: sin bebés + needsCrib:true → SÍ cuna cuando el tipo la ofrece (ya no hay gate por bebé)', async () => {
    const { orm, tables } = twoTypesDb()
    // Niño de 8: con plaza, no es bebé — irrelevante para la cuna.
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [8], needsCrib: true })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(true)
    expect(tables.Reservations[0].cribCount).toBe(1)
    expect(tables.Reservations[0].roomAmenities).toEqual([CUNA])
    expect(res.body.totalBreakdown.subtotal).toBe(215)
    // Sin niños en absoluto, con needsCrib:true + la key (no duplica): también (db nueva: la
    // única 'double' ya quedó reservada arriba).
    const fresh = twoTypesDb()
    const res2 = await direct(fresh.orm, { roomType: 'double', adults: 2, needsCrib: true, roomAmenities: [{ key: CRIB_AMENITY_KEY }] })
    expect(res2.status).toBe(201)
    expect(fresh.tables.Reservations[0].needsCrib).toBe(true)
    expect(fresh.tables.Reservations[0].roomAmenities).toEqual([CUNA])
    expectCribMirrorsSnapshot(fresh.tables.Reservations[0])
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

  it('(g) revisor: A ofrece jacuzzi, B ofrece cuna, body pide ambas con bebé → la CUNA manda: se asigna B con cuna cobrada, jacuzzi ignorada', async () => {
    const { orm, tables } = jacuzziVsCribDb()
    const { logger, warns } = makeLogger()
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true, roomAmenities: [{ key: 'custom:jacuzzi' }] }, logger)
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.roomId).toBe('r-crib')
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    expect(saved.roomAmenities).toEqual([CUNA])
    expect(saved.roomAmenitiesTotal).toBe(15)
    // 2 × 100 + 15 (sin jacuzzi: B no la ofrece).
    expect(res.body.totalBreakdown.subtotal).toBe(215)
    expect(saved.notes).toContain('Cuna: solicitada')
    expectCribMirrorsSnapshot(saved)
    // La jacuzzi se ignoró con el warn genérico; NO hay warn de "cuna pedida" (se dio).
    expect(warns.some((w) => w.includes('Amenidad de habitación ignorada'))).toBe(true)
    expect(warns.some((w) => w.includes('cuna pedida'))).toBe(false)
  })

  it('(g2) revisor: roomId explícito de A (sin cuna) + bebé + needsCrib:true + jacuzzi → needsCrib FALSE, cribCount 0, sin "Cuna: solicitada"; la jacuzzi sí se cobra', async () => {
    const { orm, tables } = jacuzziVsCribDb()
    const { logger, warns } = makeLogger()
    const res = await direct(orm, { roomId: 'r-jacuzzi', adults: 2, childrenAges: [1], needsCrib: true, roomAmenities: [{ key: 'custom:jacuzzi' }] }, logger)
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.roomId).toBe('r-jacuzzi')
    expect(saved.needsCrib).toBe(false)
    expect(saved.cribCount).toBe(0)
    expect(saved.roomAmenities).toEqual([JACUZZI])
    expect(saved.roomAmenitiesTotal).toBe(40)
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(saved.notes).toContain('Amenidades habitación: Jacuzzi=40.00')
    expect(saved.notes).not.toContain('Cuna')
    expectCribMirrorsSnapshot(saved)
    expect(warns.some((w) => w.includes('cuna pedida pero la unidad asignada no la ofrece'))).toBe(true)
  })

  it('(g3) revisor: si NINGUNA unidad libre del tipo tiene cuna, se asigna sin cuna y needsCrib queda false (sin línea, sin nota); el resto de keys se cobra', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-jacuzzi', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 80, status: 'available' }],
      roomAmenities: [am('r-jacuzzi', 'custom:jacuzzi', { name: 'Jacuzzi', price: 40 })],
    })
    const { logger, warns } = makeLogger()
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true, roomAmenities: [{ key: 'custom:jacuzzi' }] }, logger)
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.roomId).toBe('r-jacuzzi')
    expect(saved.needsCrib).toBe(false)
    expect(saved.cribCount).toBe(0)
    expect(saved.roomAmenities).toEqual([JACUZZI])
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(saved.notes).not.toContain('Cuna')
    expectCribMirrorsSnapshot(saved)
    expect(warns.some((w) => w.includes('cuna pedida'))).toBe(true)
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

  it('(h) revisor: A jacuzzi / B cuna, línea con jacuzzi + cuna + bebé (quantity 1) → se asigna B con cuna cobrada', async () => {
    const { orm, tables } = jacuzziVsCribDb()
    const { logger, warns } = makeLogger()
    const res = await group(orm, {
      rooms: [{ roomType: 'double', adults: 2, quantity: 1, childrenAges: [1], needsCrib: true, roomAmenities: [{ key: 'custom:jacuzzi' }] }],
    }, logger)
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(1)
    const saved = tables.Reservations[0]
    expect(saved.roomId).toBe('r-crib')
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    expect(saved.roomAmenities).toEqual([CUNA])
    expect(saved.roomAmenitiesTotal).toBe(15)
    expect(res.body.totalBreakdown.subtotal).toBe(215)
    expect(saved.notes).toContain('Cuna: double')
    expectCribMirrorsSnapshot(saved)
    expect(warns.some((w) => w.includes('cuna pedida'))).toBe(false)
  })

  it('(h2) revisor: misma línea con quantity 2 → B needsCrib true (cuna), A needsCrib false (jacuzzi); cada fila espejo de SU snapshot', async () => {
    const { orm, tables } = jacuzziVsCribDb()
    const { logger, warns } = makeLogger()
    const res = await group(orm, {
      rooms: [{ roomType: 'double', adults: 2, quantity: 2, childrenAges: [1], needsCrib: true, roomAmenities: [{ key: 'custom:jacuzzi' }] }],
    }, logger)
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    expect(byRoom['r-crib'].needsCrib).toBe(true)
    expect(byRoom['r-crib'].cribCount).toBe(1)
    expect(byRoom['r-crib'].roomAmenities).toEqual([CUNA])
    expect(byRoom['r-jacuzzi'].needsCrib).toBe(false)
    expect(byRoom['r-jacuzzi'].cribCount).toBe(0)
    expect(byRoom['r-jacuzzi'].roomAmenities).toEqual([JACUZZI])
    for (const r of tables.Reservations) expectCribMirrorsSnapshot(r)
    // Amenidades: 15 (cuna en B) + 40 (jacuzzi en A). El precio de la línea sale de la primera
    // unidad elegida (B, 100) × 2 unidades × 2 noches = 400 (criterio del flujo de grupo, previo).
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(55)
    expect(res.body.totalBreakdown.subtotal).toBe(455)
    // Las notas son del GRUPO (compartidas por todas las filas): el vistazo dice qué tipo la recibió.
    expect(tables.Reservations[0].notes).toContain('Cuna: double')
    expect(tables.Reservations[0].notes).toContain('Amenidades habitación: double: Cuna=15.00, Jacuzzi=40.00')
    expect(warns.some((w) => w.includes('cuna pedida pero la unidad asignada no la ofrece'))).toBe(true)
  })

  it('(e2) #341: línea SIN bebé con la key cuna en roomAmenities (sin needsCrib) → cuna cobrada, needsCrib true; childAmenities por línea se ignora', async () => {
    const { orm, tables } = twoTypesDb()
    const res = await group(orm, {
      rooms: [{ roomType: 'double', adults: 2, quantity: 1, roomAmenities: [{ key: CRIB_AMENITY_KEY }], childAmenities: [{ id: 'x' }] }],
    })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    expect(saved.roomAmenities).toEqual([CUNA])
    expect(saved.roomAmenitiesTotal).toBe(15)
    expect(saved.childAmenities).toEqual([])
    expect(saved.cribUnavailable).toBe(false)
    expect(saved.notes).toContain('Cuna: double')
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(15)
    expect(res.body.totalBreakdown.subtotal).toBe(215)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
    expectCribMirrorsSnapshot(saved)
  })

  it('(e3) grupo: cuna con precio 0 pedida por key → línea con total 0 y needsCrib true en cada unidad de la línea', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' },
        { id: 'r-b', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' },
      ],
      roomAmenities: [am('r-a', CRIB_AMENITY_KEY, { name: 'Cuna', price: 0 }), am('r-b', CRIB_AMENITY_KEY, { name: 'Cuna', price: 0 })],
    })
    const res = await group(orm, { rooms: [{ roomType: 'double', adults: 2, quantity: 2, roomAmenities: [{ key: CRIB_AMENITY_KEY }] }] })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    for (const r of tables.Reservations) {
      expect(r.needsCrib).toBe(true)
      expect(r.cribCount).toBe(1)
      expect(r.roomAmenities).toEqual([{ key: CRIB_AMENITY_KEY, name: 'Cuna', price: 0, quantity: 1, total: 0 }])
      expect(r.roomAmenitiesTotal).toBe(0)
      expectCribMirrorsSnapshot(r)
    }
    expect(res.body.totalBreakdown.roomAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(400)
  })
})

describe('preferRoomsOffering con prioridad de cuna / hasCribLine — helpers puros', () => {
  it('con priorityKey: (1) ofrecen todo, (2) al menos la cuna, (3) el resto; estable dentro de cada escalón', () => {
    const byRoom = new Map<string, any[]>([
      ['jac', [am('jac', 'custom:jacuzzi', { name: 'Jacuzzi' })]],
      ['crib', [am('crib', CRIB_AMENITY_KEY, { name: 'Cuna' })]],
      ['none', []],
      ['both', [am('both', 'custom:jacuzzi', { name: 'Jacuzzi' }), am('both', CRIB_AMENITY_KEY, { name: 'Cuna' })]],
      ['crib2', [am('crib2', CRIB_AMENITY_KEY, { name: 'Cuna' })]],
    ])
    const candidates = ['jac', 'crib', 'none', 'both', 'crib2'].map((id) => ({ id }))
    const keys = ['custom:jacuzzi', CRIB_AMENITY_KEY]
    expect(preferRoomsOffering(candidates, byRoom, keys, CRIB_AMENITY_KEY).map((r) => r.id)).toEqual(['both', 'crib', 'crib2', 'jac', 'none'])
    // Sin priorityKey: comportamiento de siempre (todo / resto).
    expect(preferRoomsOffering(candidates, byRoom, keys).map((r) => r.id)).toEqual(['both', 'jac', 'crib', 'none', 'crib2'])
    // priorityKey que NO está entre las keys pedidas: se ignora.
    expect(preferRoomsOffering(candidates, byRoom, ['custom:jacuzzi'], CRIB_AMENITY_KEY).map((r) => r.id)).toEqual(['jac', 'both', 'crib', 'none', 'crib2'])
  })

  it('hasCribLine: true sólo si el snapshot trae custom:cuna', () => {
    expect(hasCribLine([])).toBe(false)
    expect(hasCribLine([JACUZZI])).toBe(false)
    expect(hasCribLine([JACUZZI, CUNA])).toBe(true)
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
