// shared/usecases/tests/booking-engine-addons-meal-plan.test.ts — MR-03 (#268) × MR-04 (#269):
// el régimen que la reserva web cobra online se materializa como fila `reservation_addons`
// (`kind:'meal_plan'`, `source:'booking_engine'`) en la MISMA tx que la reserva.
//
// Sin esto el régimen entraba en `totalAmount` (Stripe lo cobraba) pero NO en `reservation_addons`:
// el folio nacía sin el régimen y al checkout aparecía un saldo a favor inexistente — el bug que
// #269 corrigió para upsells/amenidades, reabierto para el régimen.
//
// Cubre:
//  (a) helper puro: `mealPlans` → fila `meal_plan` con quantity = persons × nights × units y
//      unitario del catálogo (amount × quantity = lo cobrado); `included` (unitario 0) también se
//      materializa; sin `mealPlans` → nada.
//  (b) single: breakfast 10 × 3 personas × 3 noches = 90 → una fila cuyo amount × quantity es
//      exactamente `Reservations.mealPlanTotal`; el total de la reserva no cambia.
//  (c) single sin régimen (`room_only` o ausente) → 0 filas.
//  (d) grupo: cada línea con régimen aporta SU fila (× sus unidades) en la LÍDER; Σ = `mealPlanTotal`
//      del grupo; la línea sin régimen no aporta nada.
import { describe, it, expect } from 'bun:test'
import { buildBookingEngineAddons, BOOKING_ENGINE_ADDON_KINDS, MEAL_PLAN_ADDON_DESCRIPTION_PREFIX } from '../booking-engine-addons'
import { createPublicBookingDirect } from '../../../modules/bookingengine/usecases/public-booking'
import { createPublicBookingGroup } from '../../../modules/bookingengine/usecases/public-booking-group'
import { round2 } from '../../utils/money'

const HOTEL_ID = 'h1'

/** Mismo ORM en memoria que `bookingengine/tests/public-booking-meal-plans.test.ts`. */
function makeDb(seed: { rooms?: any[]; mealPlans?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: [],
    ReservationAddons: [],
    RoomBlocks: [],
    RoomRates: [],
    SeasonAssignments: [],
    RateOverrides: [],
    Seasons: [],
    PromoCodes: [],
    MealPlans: seed.mealPlans ?? [],
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
  const mealPlansRepo = { findMany: async (f: any = {}) => t('MealPlans').filter((r) => matches(r, f)) } as any
  return { orm, tables, mealPlansRepo }
}

const BASE_BODY = {
  hotelId: HOTEL_ID,
  guestName: 'Ana Pérez',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: '2026-09-10',
  checkOut: '2026-09-13', // 3 noches
}

const POLICY = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } }
const TAXES_10 = [{ name: 'ITBIS', rate: 10, active: true }]

function configRepo() {
  return {
    findOne: async (f: any) => {
      if (f.key === 'child_policy') return POLICY
      if (f.key === 'taxes') return { hotelId: HOTEL_ID, key: 'taxes', value: TAXES_10 }
      return null
    },
    findMany: async (f: any = {}) => (f.key === 'taxes' ? [{ hotelId: HOTEL_ID, key: 'taxes', value: TAXES_10 }] : []),
  } as any
}

const CATALOG = [
  { id: 'mp-bf', hotelId: HOTEL_ID, code: 'breakfast', active: true, priceMode: 'per_person_per_night', price: 10 },
  { id: 'mp-ai', hotelId: HOTEL_ID, code: 'all_inclusive', active: true, priceMode: 'included', price: 0 },
]

const NO_STRIPE = [undefined, undefined, undefined, undefined, undefined] as const
const lineTotal = (rows: any[]) => round2(rows.reduce((s, r) => s + Number(r.amount) * Number(r.quantity), 0))
const mealPlanRows = (rows: any[]) => rows.filter((r) => r.kind === BOOKING_ENGINE_ADDON_KINDS.mealPlan)

describe('buildBookingEngineAddons — régimen como fila meal_plan (#268 × #269)', () => {
  it('(a) quantity = persons × nights × units, unitario del catálogo, descripción "Régimen: <etiqueta>"', () => {
    const rows = buildBookingEngineAddons({
      reservationId: 'res-1', hotelId: HOTEL_ID, taxRate: 10,
      mealPlans: [{ label: 'Desayuno', unitPrice: 10, persons: 3, nights: 3 }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      reservationId: 'res-1', hotelId: HOTEL_ID, kind: 'meal_plan', source: 'booking_engine', status: 'pending',
      description: `${MEAL_PLAN_ADDON_DESCRIPTION_PREFIX}Desayuno`, quantity: 9, amount: 10, unitPrice: 10, taxRate: 10,
    })
    expect(lineTotal(rows)).toBe(90)
  })

  it('(a) grupo: `units` multiplica; `included` (unitario 0) se materializa con importe 0; el régimen va al final', () => {
    const rows = buildBookingEngineAddons({
      reservationId: 'res-1', hotelId: HOTEL_ID, taxRate: 10,
      upsells: [{ name: 'Transfer', quantity: 1, unitPrice: 30 }],
      mealPlans: [
        { label: 'Desayuno', unitPrice: 10, persons: 2, nights: 3, units: 2 },
        { label: 'Todo incluido', unitPrice: 0, persons: 2, nights: 3 },
      ],
    })
    expect(rows.map((r) => r.kind)).toEqual(['upsell', 'meal_plan', 'meal_plan'])
    expect(rows[1]).toMatchObject({ quantity: 12, amount: 10 })
    expect(rows[2]).toMatchObject({ description: `${MEAL_PLAN_ADDON_DESCRIPTION_PREFIX}Todo incluido`, quantity: 6, amount: 0 })
    expect(lineTotal(mealPlanRows(rows))).toBe(120)
  })

  it('(a) sin `mealPlans` (o vacío) → no genera fila de régimen', () => {
    expect(buildBookingEngineAddons({ reservationId: 'r', hotelId: HOTEL_ID, taxRate: 10 })).toEqual([])
    expect(buildBookingEngineAddons({ reservationId: 'r', hotelId: HOTEL_ID, taxRate: 10, mealPlans: [] })).toEqual([])
  })
})

describe('createPublicBookingDirect — el régimen cobrado online queda como ReservationAddons', () => {
  const ROOM = { id: 'r1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' }

  it('(b) breakfast 10 × (2 adultos + 1 niño con plaza) × 3 noches → una fila meal_plan cuyo amount × quantity = mealPlanTotal (90)', async () => {
    const { orm, tables, mealPlansRepo } = makeDb({ rooms: [{ ...ROOM }], mealPlans: CATALOG.map((m) => ({ ...m })) })
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [8, 0], mealPlan: 'breakfast' },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    const reservation = tables.Reservations[0]
    expect(reservation.mealPlanTotal).toBe(90)
    // 100 × 3 + 90 = 390; 10 % → 429. Materializar la fila NO cambia lo que se cobra.
    expect(reservation.totalAmount).toBe(429)

    const rows = mealPlanRows(tables.ReservationAddons)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      reservationId: reservation.id, hotelId: HOTEL_ID, source: 'booking_engine', status: 'pending',
      description: 'Régimen: Desayuno', quantity: 9, amount: 10, unitPrice: 10, taxRate: 10,
    })
    expect(lineTotal(rows)).toBe(reservation.mealPlanTotal)
    // Ninguna otra fila: no había upsells ni amenidades.
    expect(tables.ReservationAddons).toHaveLength(1)
  })

  it('(c) sin régimen (ausente o room_only) → 0 filas', async () => {
    for (const body of [
      { ...BASE_BODY, roomType: 'family', adults: 2 },
      { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'room_only' },
    ]) {
      const { orm, tables, mealPlansRepo } = makeDb({ rooms: [{ ...ROOM }], mealPlans: CATALOG.map((m) => ({ ...m })) })
      const res = await createPublicBookingDirect(orm, body, ...NO_STRIPE, { config: configRepo(), mealPlans: mealPlansRepo })
      expect(res.status).toBe(201)
      expect(tables.Reservations[0].mealPlanTotal).toBe(0)
      expect(tables.ReservationAddons).toHaveLength(0)
    }
  })
})

describe('createPublicBookingGroup — una fila meal_plan por línea con régimen, en la LÍDER', () => {
  function groupDb() {
    return makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r-b1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
        { id: 'r-b2', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' },
      ],
      mealPlans: CATALOG.map((m) => ({ ...m })),
    })
  }

  it('(d) double ×1 sin régimen + family ×2 con breakfast (2 adultos) → UNA fila × 2 unidades, Σ = mealPlanTotal del grupo', async () => {
    const { orm, tables, mealPlansRepo } = groupDb()
    const res = await createPublicBookingGroup(
      orm,
      {
        ...BASE_BODY,
        rooms: [
          { roomType: 'double', adults: 2, quantity: 1 },
          { roomType: 'family', adults: 2, quantity: 2, mealPlan: 'breakfast' },
        ],
      },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
    const leader = tables.Reservations[0]
    // breakfast 10 × 2 personas × 3 noches = 60 por unidad × 2 unidades = 120.
    expect(leader.priceBreakdown.mealPlanTotal).toBe(120)

    const rows = mealPlanRows(tables.ReservationAddons)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ reservationId: leader.id, description: 'Régimen: Desayuno', quantity: 12, amount: 10, unitPrice: 10 })
    expect(lineTotal(rows)).toBe(120)
    for (const sibling of tables.Reservations.slice(1)) {
      expect(tables.ReservationAddons.filter((a: any) => a.reservationId === sibling.id)).toHaveLength(0)
    }
  })

  it('(d) dos líneas con régimen → dos filas, cada una con SU total; sin régimen en ninguna → 0', async () => {
    const withMeal = groupDb()
    const res = await createPublicBookingGroup(
      withMeal.orm,
      {
        ...BASE_BODY,
        rooms: [
          { roomType: 'double', adults: 2, quantity: 1, mealPlan: 'breakfast' },
          { roomType: 'family', adults: 3, quantity: 1, mealPlan: 'breakfast' },
        ],
      },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: withMeal.mealPlansRepo },
    )
    expect(res.status).toBe(201)
    const rows = mealPlanRows(withMeal.tables.ReservationAddons)
    // double: 10 × 2 × 3 = 60 · family: 10 × 3 × 3 = 90 → 150.
    expect(rows.map((r) => r.quantity * r.amount).sort((a, b) => a - b)).toEqual([60, 90])
    expect(lineTotal(rows)).toBe(withMeal.tables.Reservations[0].priceBreakdown.mealPlanTotal)

    const noMeal = groupDb()
    const res2 = await createPublicBookingGroup(
      noMeal.orm,
      { ...BASE_BODY, rooms: [{ roomType: 'double', adults: 2, quantity: 1 }, { roomType: 'family', adults: 2, quantity: 1 }] },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: noMeal.mealPlansRepo },
    )
    expect(res2.status).toBe(201)
    expect(noMeal.tables.ReservationAddons).toHaveLength(0)
  })
})
