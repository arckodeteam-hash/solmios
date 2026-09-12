// bookingengine/tests/public-booking-addons.test.ts — MR-04 (#269): los extras pagados online
// (upsells, amenidades infantiles, amenidades de habitación) se materializan como filas
// `ReservationAddons` (source booking_engine) en la MISMA tx que crea la reserva.
//
// Cubre:
//  (a) single: 1 upsell (30) + 1 amenidad infantil (10) + habitación 100 × 1 noche, tax 18 % →
//      2 filas, todas `source:'booking_engine'` y `reservationId` de la reserva, Σ(amount×qty)=40,
//      `taxRate` 18; `Reservations.totalAmount` sigue siendo 165.20 (no se cobra dos veces).
//  (b) sin extras → 0 filas.
//  (c) grupo: upsell + amenidad → TODOS los addons cuelgan de la líder (`Reservations[0]`), las
//      hermanas con 0.
//  (d) helper puro: cantidad, unitario y kinds; sin I/O.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'
import { buildBookingEngineAddons, totalTaxRateOf, BOOKING_ENGINE_ADDON_KINDS } from '../../../shared/usecases/booking-engine-addons'

const HOTEL_ID = 'h1'

/** Mismo ORM en memoria que `public-booking-child-amenities.test.ts`. */
function makeDb(seed: { rooms?: any[]; reservations?: any[]; promoCodes?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: seed.reservations ?? [],
    ReservationAddons: [],
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
  checkOut: '2026-09-11', // 1 noche
}

const POLICY = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } }
const TAXES_18 = [{ nombre: 'ITBIS', tasa: 18, activo: true }]

/** Config repo: `child_policy` + `taxes` (18 %). */
function configRepo(opts: { taxes?: any[] } = { taxes: TAXES_18 }) {
  return {
    findOne: async (f: any) => {
      if (f.key === 'child_policy') return POLICY
      if (f.key === 'taxes' && opts.taxes) return { hotelId: HOTEL_ID, key: 'taxes', value: opts.taxes }
      return null
    },
    findMany: async (f: any = {}) => {
      if (f.key === 'taxes' && opts.taxes) return [{ hotelId: HOTEL_ID, key: 'taxes', value: opts.taxes }]
      return []
    },
  } as any
}

function repoOf(rows: any[]) {
  return { findMany: async (f: any = {}) => rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)) } as any
}

const CHILD_CATALOG = [
  { id: 'ca-cuna', hotelId: HOTEL_ID, name: 'Cuna extra', price: 10, active: true, sortOrder: 0 },
]
const UPSELLS = [
  { id: 'u-transfer', hotelId: HOTEL_ID, name: 'Transfer', price: 30, kind: 'per_stay', active: true },
  // MR-10 (#275) — `per_person` para probar cantidad > 1 (per_stay ya no la admite).
  { id: 'u-late', hotelId: HOTEL_ID, name: 'Late checkout', price: 30, kind: 'per_person', active: true },
  { id: 'u-off', hotelId: HOTEL_ID, name: 'Inactivo', price: 99, kind: 'per_stay', active: false },
]

function deps() {
  return { config: configRepo(), childAmenities: repoOf(CHILD_CATALOG), upsells: repoOf(UPSELLS) } as any
}

const lineTotal = (rows: any[]) => rows.reduce((s, r) => s + Number(r.amount) * Number(r.quantity), 0)

describe('createPublicBookingDirect — extras pagados online como ReservationAddons (#269)', () => {
  function singleRoomDb() {
    return makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' }],
    })
  }

  it('(a) 1 upsell (30) + 1 amenidad infantil (10) → 2 filas booking_engine, Σ 40, taxRate 18, totalAmount 165.20', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      {
        ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [5],
        upsells: [{ id: 'u-transfer', quantity: 1 }, { id: 'u-off', quantity: 1 }],
        childAmenities: [{ id: 'ca-cuna' }],
      },
      undefined, undefined, undefined, undefined, undefined, deps(),
    )
    expect(res.status).toBe(201)
    // 100 + 30 + 10 = 140; 18 % = 25.20; total 165.20 — el total NO cambia por materializar extras.
    expect(tables.Reservations).toHaveLength(1)
    const reservation = tables.Reservations[0]
    expect(reservation.totalAmount).toBe(165.2)
    expect(reservation.priceBreakdown.upsellsTotal).toBe(30)
    expect(reservation.priceBreakdown.childAmenitiesTotal).toBe(10)
    expect(reservation.notes).toContain('Upsells: Transfer×1=30.00')

    const addons = tables.ReservationAddons
    expect(addons).toHaveLength(2)
    for (const a of addons) {
      expect(a.source).toBe('booking_engine')
      expect(a.reservationId).toBe(reservation.id)
      expect(a.hotelId).toBe(HOTEL_ID)
      expect(a.taxRate).toBe(18)
      expect(a.status).toBe('pending')
      expect(a.unitPrice).toBe(a.amount)
      expect(typeof a.id).toBe('string')
    }
    expect(lineTotal(addons)).toBe(40)
    const byKind = Object.fromEntries(addons.map((a: any) => [a.kind, a]))
    expect(byKind.upsell).toMatchObject({ description: 'Transfer', quantity: 1, amount: 30, unitPrice: 30 })
    expect(byKind.child_amenity).toMatchObject({ description: 'Cuna extra', quantity: 1, amount: 10, unitPrice: 10 })
  })

  it('(a2) upsell con quantity 2 → una fila con quantity 2 y amount unitario', async () => {
    // MR-10 (#275): `per_stay` admite solo qty 1 (qty 2 → 400 upsell_quantity_out_of_range), así
    // que la cantidad 2 se prueba con un `per_person` (2 adultos → tope 2). Lo que valida este
    // caso no cambia: una fila con quantity 2 y el unitario del catálogo.
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, upsells: [{ id: 'u-late', quantity: 2 }] },
      undefined, undefined, undefined, undefined, undefined, deps(),
    )
    expect(res.status).toBe(201)
    expect(tables.ReservationAddons).toHaveLength(1)
    expect(tables.ReservationAddons[0]).toMatchObject({ kind: 'upsell', quantity: 2, amount: 30, unitPrice: 30 })
    expect(lineTotal(tables.ReservationAddons)).toBe(60)
    // 100 + 60 = 160; 18 % = 28.80 → 188.80
    expect(tables.Reservations[0].totalAmount).toBe(188.8)
  })

  it('(b) sin extras → 0 filas', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2 },
      undefined, undefined, undefined, undefined, undefined, deps(),
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(1)
    expect(tables.ReservationAddons).toHaveLength(0)
    expect(tables.Reservations[0].totalAmount).toBe(118)
  })

  it('sin impuestos configurados ni hotels.taxRate → taxRate 0 en las filas', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2, upsells: [{ id: 'u-transfer', quantity: 1 }] },
      undefined, undefined, undefined, undefined, undefined,
      { ...deps(), config: configRepo({}) },
    )
    expect(res.status).toBe(201)
    expect(tables.ReservationAddons).toHaveLength(1)
    expect(tables.ReservationAddons[0].taxRate).toBe(0)
    expect(tables.Reservations[0].totalAmount).toBe(130)
  })
})

describe('createPublicBookingGroup — addons en la reserva LÍDER (#269)', () => {
  function groupDb() {
    return makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r-b1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
        { id: 'r-b2', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
      ],
    })
  }

  it('(c) upsell del grupo + amenidad de una línea ×2 → todos los addons en Reservations[0], hermanas con 0', async () => {
    const { orm, tables } = groupDb()
    const res = await createPublicBookingGroup(
      orm,
      {
        ...BASE_BODY,
        rooms: [
          { roomType: 'double', adults: 2, quantity: 1 },
          { roomType: 'family', adults: 2, quantity: 2, childrenAges: [5], childAmenities: [{ id: 'ca-cuna' }] },
        ],
        upsells: [{ id: 'u-transfer', quantity: 1 }],
      },
      undefined, undefined, undefined, undefined, undefined, deps(),
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
    const leader = tables.Reservations[0]
    expect(leader.priceBreakdown).toBeDefined()
    // Habitaciones 80 + 100×2 = 280; upsell 30; amenidad 10 × 2 unidades = 20 → 330; 18 % = 59.40.
    expect(leader.priceBreakdown.total).toBe(389.4)
    expect(tables.Groups[0].totalAmount).toBe(389.4)

    const addons = tables.ReservationAddons
    expect(addons).toHaveLength(2)
    for (const a of addons) {
      expect(a.reservationId).toBe(leader.id)
      expect(a.source).toBe('booking_engine')
      expect(a.taxRate).toBe(18)
    }
    // Σ addons = upsellsTotal + childAmenitiesTotal del grupo.
    expect(lineTotal(addons)).toBe(50)
    const byKind = Object.fromEntries(addons.map((a: any) => [a.kind, a]))
    expect(byKind.upsell).toMatchObject({ description: 'Transfer', quantity: 1, amount: 30 })
    // La amenidad de la línea con quantity 2 va como UNA fila × 2 (unitario 10).
    expect(byKind.child_amenity).toMatchObject({ description: 'Cuna extra', quantity: 2, amount: 10, unitPrice: 10 })
    for (const sibling of tables.Reservations.slice(1)) {
      expect(addons.filter((a: any) => a.reservationId === sibling.id)).toHaveLength(0)
    }
  })

  it('grupo sin extras → 0 filas', async () => {
    const { orm, tables } = groupDb()
    const res = await createPublicBookingGroup(
      orm, { ...BASE_BODY, rooms: [{ roomType: 'double', adults: 2, quantity: 1 }] },
      undefined, undefined, undefined, undefined, undefined, deps(),
    )
    expect(res.status).toBe(201)
    expect(tables.ReservationAddons).toHaveLength(0)
  })
})

describe('buildBookingEngineAddons — helper puro (#269)', () => {
  it('(d) una fila por extra, orden upsell → child_amenity → room_amenity, unitario y quantity normalizados', () => {
    const rows = buildBookingEngineAddons({
      reservationId: 'res-1', hotelId: HOTEL_ID, taxRate: 18,
      upsells: [{ name: 'Transfer', quantity: 2, unitPrice: 30 }],
      childAmenities: [{ name: 'Cuna extra', price: 10, quantity: 1 }],
      roomAmenities: [{ name: 'Vista al mar', price: 15.555, quantity: 0 }],
    })
    expect(rows.map((r) => r.kind)).toEqual([
      BOOKING_ENGINE_ADDON_KINDS.upsell, BOOKING_ENGINE_ADDON_KINDS.childAmenity, BOOKING_ENGINE_ADDON_KINDS.roomAmenity,
    ])
    expect(rows[0]).toMatchObject({ reservationId: 'res-1', hotelId: HOTEL_ID, description: 'Transfer', quantity: 2, amount: 30, unitPrice: 30, taxRate: 18, source: 'booking_engine', status: 'pending' })
    expect(rows[1]).toMatchObject({ description: 'Cuna extra', quantity: 1, amount: 10 })
    // quantity < 1 → 1; precio redondeado a 2 decimales.
    expect(rows[2]).toMatchObject({ description: 'Vista al mar', quantity: 1, amount: 15.56, unitPrice: 15.56 })
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
  })

  it('sin extras → []; totalTaxRateOf suma las tasas activas', () => {
    expect(buildBookingEngineAddons({ reservationId: 'r', hotelId: HOTEL_ID, taxRate: 18 })).toEqual([])
    expect(totalTaxRateOf([{ rate: 18 }, { rate: 10 }])).toBe(28)
    expect(totalTaxRateOf([])).toBe(0)
  })
})
