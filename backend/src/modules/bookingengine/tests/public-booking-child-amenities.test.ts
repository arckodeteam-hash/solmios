// bookingengine/tests/public-booking-child-amenities.test.ts — REQ-01 (#233): amenidades para
// niños/bebés elegidas POR HABITACIÓN en la reserva pública (1 habitación y grupo).
//
// Cubre:
//  (a) single: 1 niño con plaza + amenidad de 10 → childAmenitiesTotal=10, subtotal la incluye,
//      la reserva persiste el snapshot con precio y `childAmenitiesTotal`.
//  (b) id inactivo / de otro hotel / inexistente → se ignora (0), la reserva se crea igual.
//  (c) sin menores (solo adultos) con ids → se ignoran (gate por composición).
//  (d) precio 0 → se acepta y aparece en el snapshot con total 0.
//  (e) group: 2 líneas, solo la segunda con niño + amenidad, quantity 2 → total = price × 2;
//      cada reserva de esa línea con su snapshot (quantity 1) y la de la primera línea sin nada.
//  (f) total = subtotal - promo + taxes sigue cuadrando con amenidades en el subtotal.
//  (g) sin `extraDeps.childAmenities` cableado → warn y no se suma nada.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'

const HOTEL_ID = 'h1'

/** Mismo ORM en memoria que `public-booking-composition.test.ts` / `public-booking-group.test.ts`. */
function makeDb(seed: { rooms?: any[]; reservations?: any[]; promoCodes?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: seed.reservations ?? [],
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

const POLICY = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } }

/** Config repo como en `public-booking-composition.test.ts`: responde `child_policy` (y
 *  opcionalmente `taxes`) — el resto de claves devuelve null. */
function configRepo(opts: { policy?: any; taxes?: any[] } = {}) {
  const policy = opts.policy === undefined ? POLICY : opts.policy
  return {
    findOne: async (f: any) => {
      if (f.key === 'child_policy') return policy
      if (f.key === 'taxes' && opts.taxes) return { hotelId: HOTEL_ID, key: 'taxes', value: opts.taxes }
      return null
    },
  } as any
}

/** Repo mínimo del catálogo `child_amenities` (solo `findMany({hotelId})`, como en el usecase). */
function childAmenitiesRepo(rows: any[]) {
  return { findMany: async (f: any = {}) => rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)) } as any
}

const CATALOG = [
  { id: 'ca-cuna', hotelId: HOTEL_ID, name: 'Cuna extra', price: 10, active: true, sortOrder: 0 },
  { id: 'ca-silla', hotelId: HOTEL_ID, name: 'Silla de comer', price: 5.5, active: true, sortOrder: 1 },
  { id: 'ca-gratis', hotelId: HOTEL_ID, name: 'Calienta-biberones', price: 0, active: true, sortOrder: 2 },
  { id: 'ca-off', hotelId: HOTEL_ID, name: 'Bañera (inactiva)', price: 20, active: false, sortOrder: 3 },
  { id: 'ca-otro', hotelId: 'h2', name: 'De otro hotel', price: 99, active: true, sortOrder: 0 },
]

function makeLogger() {
  const warns: string[] = []
  return { logger: { warn: (m: string) => { warns.push(m) }, error: () => {} }, warns }
}

function singleRoomDb() {
  return makeDb({
    rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' }],
  })
}

describe('createPublicBookingDirect — amenidades infantiles (REQ-01 #233)', () => {
  it('(a) 1 niño de 5 años + amenidad de 10 → childAmenitiesTotal=10, subtotal la incluye, snapshot persistido', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [5], childAmenities: [{ id: 'ca-cuna' }] },
      undefined, undefined, undefined, undefined, undefined,
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) },
    )
    expect(res.status).toBe(201)
    const tb = res.body.totalBreakdown
    expect(tb.childAmenitiesTotal).toBe(10)
    expect(tb.upsellsTotal).toBe(0)
    // 2 noches × 100 = 200 de habitación + 10 de amenidad.
    expect(tb.subtotal).toBe(210)
    expect(tb.total).toBe(210)
    expect(res.body.reservation.totalAmount).toBe(210)

    const saved = tables.Reservations[0]
    expect(saved.childAmenitiesTotal).toBe(10)
    expect(saved.childAmenities).toEqual([{ id: 'ca-cuna', name: 'Cuna extra', price: 10, quantity: 1, total: 10 }])
    expect(saved.priceBreakdown.childAmenitiesTotal).toBe(10)
    expect(saved.priceBreakdown.subtotal).toBe(210)
    expect(saved.notes).toContain('Amenidades niños: Cuna extra=10.00')
  })

  it('(a2) varias amenidades + ids repetidos → se suman una sola vez cada una', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [5], childAmenities: [{ id: 'ca-cuna' }, { id: 'ca-silla' }, { id: 'ca-cuna' }] },
      undefined, undefined, undefined, undefined, undefined,
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(15.5)
    expect(res.body.totalBreakdown.subtotal).toBe(215.5)
    expect(tables.Reservations[0].childAmenities).toHaveLength(2)
  })

  it('(b) id inactivo, de otro hotel o inexistente → se ignora (0), la reserva se crea igual', async () => {
    const { orm, tables } = singleRoomDb()
    const { logger, warns } = makeLogger()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [5], childAmenities: [{ id: 'ca-off' }, { id: 'ca-otro' }, { id: 'nope' }] },
      undefined, undefined, undefined, logger, undefined,
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(tables.Reservations[0].childAmenities).toEqual([])
    expect(tables.Reservations[0].childAmenitiesTotal).toBe(0)
    expect(tables.Reservations[0].notes).not.toContain('Amenidades niños')
    expect(warns.length).toBe(3)
  })

  it('(c) sin menores (solo adultos) con ids → se ignoran aunque existan en el catálogo', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childAmenities: [{ id: 'ca-cuna' }] },
      undefined, undefined, undefined, undefined, undefined,
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(tables.Reservations[0].childAmenities).toEqual([])
    expect(tables.Reservations[0].childAmenitiesTotal).toBe(0)
  })

  it('(c2) un bebé (edad ≤ maxFreeAge) también habilita las amenidades — es un menor', async () => {
    const { orm } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [1], childAmenities: [{ id: 'ca-cuna' }] },
      undefined, undefined, undefined, undefined, undefined,
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(10)
  })

  it('(d) precio 0 → se acepta y aparece en el snapshot con total 0', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [5], childAmenities: [{ id: 'ca-gratis' }] },
      undefined, undefined, undefined, undefined, undefined,
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
    expect(tables.Reservations[0].childAmenities).toEqual([{ id: 'ca-gratis', name: 'Calienta-biberones', price: 0, quantity: 1, total: 0 }])
    expect(tables.Reservations[0].childAmenitiesTotal).toBe(0)
    expect(tables.Reservations[0].notes).toContain('Amenidades niños: Calienta-biberones=0.00')
  })

  it('(f) total = subtotal - promo + taxes sigue cuadrando con amenidades dentro del subtotal', async () => {
    const promo = { id: 'p1', hotelId: HOTEL_ID, code: 'DESC10', kind: 'percent', value: 10, active: true, uses: 0, maxUses: null }
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' }],
      promoCodes: [promo],
    })
    const promoCodes = {
      findOne: async (f: any) => tables.PromoCodes.find((p) => Object.entries(f).every(([k, v]) => p[k] === v)) ?? null,
      findMany: async (f: any = {}) => tables.PromoCodes.filter((p) => Object.entries(f).every(([k, v]) => p[k] === v)),
    } as any
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [5], promoCode: 'DESC10', childAmenities: [{ id: 'ca-cuna' }] },
      undefined, undefined, undefined, undefined, undefined,
      { config: configRepo({ taxes: [{ name: 'ITBIS', rate: 18, active: true }] }), promoCodes, childAmenities: childAmenitiesRepo(CATALOG) },
    )
    expect(res.status).toBe(201)
    const tb = res.body.totalBreakdown
    expect(tb.subtotal).toBe(210)
    expect(tb.childAmenitiesTotal).toBe(10)
    // El promo se calcula sobre el subtotal QUE INCLUYE las amenidades: 10% de 210.
    expect(tb.promoDiscount).toBe(21)
    const expectedTaxes = Math.round((210 - 21) * 0.18 * 100) / 100
    expect(tb.taxes).toBe(expectedTaxes)
    expect(tb.total).toBe(Math.round((tb.subtotal - tb.promoDiscount + tb.taxes) * 100) / 100)
    expect(tables.Reservations[0].totalAmount).toBe(tb.total)
  })

  it('(g) sin extraDeps.childAmenities cableado → warn y no se suma nada', async () => {
    const { orm, tables } = singleRoomDb()
    const { logger, warns } = makeLogger()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [5], childAmenities: [{ id: 'ca-cuna' }] },
      undefined, undefined, undefined, logger, undefined,
      { config: configRepo() },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(tables.Reservations[0].childAmenities).toEqual([])
    expect(warns.some((w) => w.includes('extraDeps.childAmenities'))).toBe(true)
  })

  it('sin childAmenities en el body (caller legacy) → breakdown con childAmenitiesTotal=0 y snapshot vacío', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'family', adults: 2, children: 0 })
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
    expect(tables.Reservations[0].childAmenities).toEqual([])
    expect(tables.Reservations[0].childAmenitiesTotal).toBe(0)
  })
})

describe('createPublicBookingGroup — amenidades infantiles por línea (REQ-01 #233)', () => {
  function groupDb() {
    return makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r-b1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
        { id: 'r-b2', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
      ],
    })
  }

  it('(e) 2 líneas, solo la segunda con niño + amenidad, quantity 2 → total = price × 2; snapshot por unidad', async () => {
    const { orm, tables } = groupDb()
    const res = await createPublicBookingGroup(
      orm,
      {
        ...BASE_BODY,
        rooms: [
          { roomType: 'double', adults: 2, quantity: 1 },
          { roomType: 'family', adults: 2, quantity: 2, childrenAges: [5], childAmenities: [{ id: 'ca-cuna' }] },
        ],
      },
      undefined, undefined, undefined, undefined, undefined,
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) } as any,
    )
    expect(res.status).toBe(201)
    const tb = res.body.totalBreakdown
    // Habitaciones: 80×2 + 100×2×2 = 560; amenidades: 10 × 2 unidades = 20.
    expect(tb.childAmenitiesTotal).toBe(20)
    expect(tb.subtotal).toBe(580)
    expect(tb.total).toBe(580)
    expect(tables.Groups[0].totalAmount).toBe(580)

    expect(tables.Reservations).toHaveLength(3)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    // Línea 1 (sin menores): nada.
    expect(byRoom['r-a'].childAmenities).toEqual([])
    expect(byRoom['r-a'].childAmenitiesTotal).toBe(0)
    // Línea 2: cada unidad física con SU snapshot (quantity 1) y SU total.
    for (const roomId of ['r-b1', 'r-b2']) {
      expect(byRoom[roomId].childAmenities).toEqual([{ id: 'ca-cuna', name: 'Cuna extra', price: 10, quantity: 1, total: 10 }])
      expect(byRoom[roomId].childAmenitiesTotal).toBe(10)
    }
    // El desglose guardado en la líder es el del grupo, con las amenidades adentro.
    expect(tables.Reservations[0].priceBreakdown.childAmenitiesTotal).toBe(20)
    expect(tables.Reservations[0].priceBreakdown.subtotal).toBe(580)
    expect(tables.Reservations[0].notes).toContain('Amenidades niños: family: Cuna extra=20.00')
  })

  it('línea sin menores con ids → se ignoran; línea inactiva/ajena → 0', async () => {
    const { orm, tables } = groupDb()
    const res = await createPublicBookingGroup(
      orm,
      {
        ...BASE_BODY,
        rooms: [
          { roomType: 'double', adults: 2, quantity: 1, childAmenities: [{ id: 'ca-cuna' }] }, // sin menores
          { roomType: 'family', adults: 2, quantity: 1, childrenAges: [5], childAmenities: [{ id: 'ca-off' }, { id: 'ca-otro' }] },
        ],
      },
      undefined, undefined, undefined, undefined, undefined,
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) } as any,
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.childAmenitiesTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(360)
    for (const r of tables.Reservations) {
      expect(r.childAmenities).toEqual([])
      expect(r.childAmenitiesTotal).toBe(0)
    }
  })

  it('el cobro (Stripe) del grupo usa el total CON amenidades', async () => {
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
      { ...BASE_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 1, childrenAges: [5], childAmenities: [{ id: 'ca-cuna' }, { id: 'ca-silla' }] }] },
      undefined, undefined, stripe, undefined, { successUrl: 'https://x/ok', cancelUrl: 'https://x/ko' },
      { config: configRepo(), childAmenities: childAmenitiesRepo(CATALOG) } as any,
    )
    expect(res.status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0].amount).toBe(215.5)
    expect(res.body.checkoutUrl).toBe('https://checkout.example/cs_1')
  })
})
