// bookingengine/tests/public-booking-meal-plans.test.ts — MR-03 (#268): régimen (desayuno /
// media pensión / todo incluido) reservable desde la web y cobrado por persona y noche.
//
// Cubre:
//  (a) single: breakfast per_person_per_night 10 × (2 adultos + 1 niño con plaza, el bebé no) ×
//      3 noches → mealPlanTotal=90, subtotal la incluye, impuestos sobre subtotal−promo, snapshot
//      persistido (`mealPlan`, `mealPlanUnitPrice`, `mealPlanTotal`, `regime`) y nota ES.
//  (b) régimen inactivo en el hotel → 400 `meal_plan_unavailable`, 0 reservas.
//  (c) priceMode `included` → mealPlanTotal 0 pero el código se persiste.
//  (d) grupo: 2 líneas con regímenes distintos → cada fila el suyo, breakdown = Σ.
//  (e) snapshot: cambiar el precio del catálogo después NO cambia lo cobrado.
//  (f) sin `mealPlan` en el body → `room_only`, 0 (compat).
//  (g) `getPublicReservation` expone `mealPlan`/`mealPlanTotal` al huésped.
//  (h) sin `extraDeps.mealPlans` cableado → 400 (no se ignora en silencio).
//  #360 (catálogo abierto):
//  (i) la reserva guarda `mealPlanName` con el `name` del catálogo (fila custom: code y name libres)
//      y `notes` usa ese nombre; fila legacy sin `name` → LEGACY_NAMES.
//  (j) `booking_config.showMealPlans: false` + mealPlan custom → 400 `meal_plan_unavailable`
//      (single y grupo); `room_only`/vacío siguen pasando.
//  (k) `room_only` como fila activa del catálogo → línea real con su `name` (total 0).
//  (l) `getPublicReservation` expone `mealPlanName`.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'
import { getPublicReservation } from '../usecases/public-reservation'

const HOTEL_ID = 'h1'
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Mismo ORM en memoria que `public-booking-child-amenities.test.ts`, más la tabla `MealPlans`. */
function makeDb(seed: { rooms?: any[]; reservations?: any[]; promoCodes?: any[]; mealPlans?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: seed.reservations ?? [],
    RoomBlocks: [],
    RoomRates: [],
    SeasonAssignments: [],
    RateOverrides: [],
    Seasons: [],
    PromoCodes: seed.promoCodes ?? [],
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
  /** Repo del catálogo `meal_plans` sobre la MISMA tabla (para poder mutarla en el caso (e)). */
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

// maxBabyAge cae al default 0 → edad 0 = bebé, 1..3 = libre (sin plaza), 4..12 = niño con plaza.
const POLICY = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } }

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

/** Filas legacy (sin `name`, anteriores a #360): el nombre cae a `LEGACY_NAMES` al leer. */
const CATALOG = [
  { id: 'mp-bf', hotelId: HOTEL_ID, code: 'breakfast', active: true, priceMode: 'per_person_per_night', price: 10 },
  { id: 'mp-hb', hotelId: HOTEL_ID, code: 'half_board', active: false, priceMode: 'per_person_per_night', price: 25 },
  { id: 'mp-ai', hotelId: HOTEL_ID, code: 'all_inclusive', active: true, priceMode: 'included', price: 0 },
  { id: 'mp-otro', hotelId: 'h2', code: 'half_board', active: true, priceMode: 'per_person_per_night', price: 1 },
]

/** #360 — fila con code y name libres, como las crea el admin desde Configuración → Regímenes. */
const GOURMET = { id: 'mp-gourmet', hotelId: HOTEL_ID, code: 'pension_gourmet', name: 'Pensión gourmet', description: 'Cena de 5 pasos', active: true, priceMode: 'per_person_per_night', price: 40, sortOrder: 5 }

/** #360 — repo de `booking_config` con el toggle `showMealPlans` (default ausente = visible). */
function bookingConfigRepo(cfg: any = { hotelId: HOTEL_ID, enabled: true }) {
  return { findOne: async (f: any) => (f.hotelId === HOTEL_ID ? cfg : null) } as any
}

const ROOM = { id: 'r1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' }

function singleRoomDb(mealPlans: any[] = CATALOG) {
  return makeDb({ rooms: [{ ...ROOM }], mealPlans: mealPlans.map((m) => ({ ...m })) })
}

const NO_STRIPE = [undefined, undefined, undefined, undefined, undefined] as const

describe('createPublicBookingDirect — régimen (MR-03 #268)', () => {
  it('(a) breakfast 10 × (2 adultos + 1 niño con plaza, bebé no) × 3 noches → 90 en subtotal, impuestos sobre subtotal−promo, snapshot', async () => {
    const { orm, tables, mealPlansRepo } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [8, 0], mealPlan: 'breakfast' },
      ...NO_STRIPE,
      { config: configRepo({ taxes: [{ name: 'ITBIS', rate: 10, active: true }] }), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    const tb = res.body.totalBreakdown
    expect(tb.mealPlanTotal).toBe(90)
    const roomSubtotal = tb.subtotal - tb.mealPlanTotal
    expect(roomSubtotal).toBeGreaterThan(0)
    expect(tb.subtotal).toBe(round2(roomSubtotal + 90))
    expect(tb.promoDiscount).toBe(0)
    expect(tb.taxes).toBe(round2((tb.subtotal - tb.promoDiscount) * 0.10))
    expect(tb.total).toBe(round2(tb.subtotal - tb.promoDiscount + tb.taxes))

    const saved = tables.Reservations[0]
    expect(saved.mealPlan).toBe('breakfast')
    expect(saved.mealPlanPriceMode).toBe('per_person_per_night')
    expect(saved.mealPlanUnitPrice).toBe(10)
    expect(saved.mealPlanTotal).toBe(90)
    // Personas persistidas (2 adultos + 1 niño con plaza; el bebé no): el panel no las deriva
    // de total ÷ (unitario × noches), que se inventa al reagendar.
    expect(saved.mealPlanPersons).toBe(3)
    expect(saved.regime).toBe('breakfast')
    expect(saved.priceBreakdown.mealPlanTotal).toBe(90)
    expect(saved.totalAmount).toBe(tb.total)
    // #360 — nombre congelado (fila legacy sin `name` → LEGACY_NAMES) y `notes` con ese nombre.
    expect(saved.mealPlanName).toBe('Desayuno incluido')
    expect(saved.notes).toContain('Régimen: Desayuno incluido')
    expect(saved.notes).toContain('3 pers × 3 noches = 90.00')
  })

  it('(a2) el régimen entra en el subtotal sobre el que se calcula la promo', async () => {
    const promo = { id: 'p1', hotelId: HOTEL_ID, code: 'DESC10', kind: 'percent', value: 10, active: true, uses: 0, maxUses: null }
    const { orm, tables, mealPlansRepo } = makeDb({ rooms: [{ ...ROOM }], promoCodes: [promo], mealPlans: CATALOG })
    const promoCodes = {
      findOne: async (f: any) => tables.PromoCodes.find((p) => Object.entries(f).every(([k, v]) => p[k] === v)) ?? null,
      findMany: async (f: any = {}) => tables.PromoCodes.filter((p) => Object.entries(f).every(([k, v]) => p[k] === v)),
    } as any
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, promoCode: 'DESC10', mealPlan: 'breakfast' },
      ...NO_STRIPE,
      { config: configRepo({ taxes: [{ name: 'ITBIS', rate: 10, active: true }] }), promoCodes, mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    const tb = res.body.totalBreakdown
    // 3 noches × 100 = 300 de habitación + 10 × 2 pers × 3 noches = 60 de régimen.
    expect(tb.mealPlanTotal).toBe(60)
    expect(tb.subtotal).toBe(360)
    expect(tb.promoDiscount).toBe(36)
    expect(tb.taxes).toBe(round2((360 - 36) * 0.10))
    expect(tb.total).toBe(round2(360 - 36 + tb.taxes))
  })

  it('(b) half_board inactivo en el hotel → 400 meal_plan_unavailable y 0 reservas', async () => {
    const { orm, tables, mealPlansRepo } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'half_board' },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('meal_plan_unavailable')
    expect(res.body.mealPlan).toBe('half_board')
    expect(tables.Reservations.length).toBe(0)
    expect(tables.Guests.length).toBe(0)
  })

  it('(c) all_inclusive con priceMode included → mealPlanTotal 0, código persistido', async () => {
    const { orm, tables, mealPlansRepo } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'all_inclusive' },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.mealPlanTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(300)
    const saved = tables.Reservations[0]
    expect(saved.mealPlan).toBe('all_inclusive')
    expect(saved.mealPlanPriceMode).toBe('included')
    expect(saved.mealPlanUnitPrice).toBe(0)
    expect(saved.mealPlanTotal).toBe(0)
    expect(saved.regime).toBe('all_inclusive')
    expect(saved.mealPlanName).toBe('Todo incluido')
    expect(saved.notes).toContain('Régimen: Todo incluido (incluido)')
  })

  it('(e) snapshot: subir el precio del catálogo después NO cambia lo cobrado; una reserva nueva sí paga el nuevo', async () => {
    const { orm, tables, mealPlansRepo } = makeDb({
      rooms: [{ ...ROOM }, { ...ROOM, id: 'r2' }],
      mealPlans: CATALOG.map((m) => ({ ...m })),
    })
    const deps = { config: configRepo(), mealPlans: mealPlansRepo }
    const first = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [8], mealPlan: 'breakfast' }, ...NO_STRIPE, deps,
    )
    expect(first.status).toBe(201)
    expect(tables.Reservations[0].mealPlanTotal).toBe(90)

    tables.MealPlans.find((m) => m.code === 'breakfast')!.price = 99

    const second = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2, childrenAges: [8], mealPlan: 'breakfast' }, ...NO_STRIPE, deps,
    )
    expect(second.status).toBe(201)
    expect(tables.Reservations[0].mealPlanTotal).toBe(90)
    expect(tables.Reservations[0].mealPlanUnitPrice).toBe(10)
    expect(tables.Reservations[1].mealPlanUnitPrice).toBe(99)
    expect(tables.Reservations[1].mealPlanTotal).toBe(99 * 3 * 3)
  })

  it('(f) sin mealPlan en el body → room_only, 0 (compat callers viejos)', async () => {
    const { orm, tables, mealPlansRepo } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2 }, ...NO_STRIPE, { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.mealPlanTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(300)
    const saved = tables.Reservations[0]
    expect(saved.mealPlan).toBe('room_only')
    expect(saved.mealPlanName).toBeNull()
    expect(saved.mealPlanPriceMode).toBeNull()
    expect(saved.mealPlanTotal).toBe(0)
    expect(saved.mealPlanPersons).toBeNull()
    expect(saved.regime).toBe('room_only')
    expect(saved.notes).not.toContain('Régimen')
  })

  it('(f2) mealPlan "room_only" explícito sin fila en el catálogo → igual que sin mealPlan', async () => {
    const { orm, tables, mealPlansRepo } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'room_only' }, ...NO_STRIPE, { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.mealPlanTotal).toBe(0)
    expect(tables.Reservations[0].mealPlan).toBe('room_only')
    expect(tables.Reservations[0].mealPlanName).toBeNull()
    expect(tables.Reservations[0].notes).not.toContain('Régimen')
  })

  it('(i) #360 fila custom (code/name libres) → mealPlanName con el name del catálogo, precio del server, notes con el name', async () => {
    const { orm, tables, mealPlansRepo } = singleRoomDb([...CATALOG, GOURMET])
    const res = await createPublicBookingDirect(
      orm,
      { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'pension_gourmet' },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo, bookingConfig: bookingConfigRepo() },
    )
    expect(res.status).toBe(201)
    // 40 × 2 pers × 3 noches.
    expect(res.body.totalBreakdown.mealPlanTotal).toBe(240)
    const saved = tables.Reservations[0]
    expect(saved.mealPlan).toBe('pension_gourmet')
    expect(saved.mealPlanName).toBe('Pensión gourmet')
    expect(saved.mealPlanPriceMode).toBe('per_person_per_night')
    expect(saved.mealPlanUnitPrice).toBe(40)
    expect(saved.mealPlanTotal).toBe(240)
    expect(saved.regime).toBe('pension_gourmet')
    expect(saved.notes).toContain('Régimen: Pensión gourmet (2 pers × 3 noches = 240.00)')
  })

  it('(i2) #360 snapshot del nombre: renombrar el régimen después NO cambia mealPlanName de la reserva', async () => {
    const { orm, tables, mealPlansRepo } = makeDb({ rooms: [{ ...ROOM }, { ...ROOM, id: 'r2' }], mealPlans: [...CATALOG, { ...GOURMET }] })
    const deps = { config: configRepo(), mealPlans: mealPlansRepo }
    const first = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'pension_gourmet' }, ...NO_STRIPE, deps)
    expect(first.status).toBe(201)
    tables.MealPlans.find((m) => m.code === 'pension_gourmet')!.name = 'Pensión deluxe'
    const second = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'pension_gourmet' }, ...NO_STRIPE, deps)
    expect(second.status).toBe(201)
    expect(tables.Reservations[0].mealPlanName).toBe('Pensión gourmet')
    expect(tables.Reservations[1].mealPlanName).toBe('Pensión deluxe')
  })

  it('(j) #360 showMealPlans:false + mealPlan custom → 400 meal_plan_unavailable, 0 reservas; room_only/vacío siguen pasando', async () => {
    const { orm, tables, mealPlansRepo } = singleRoomDb([...CATALOG, GOURMET])
    const deps = { config: configRepo(), mealPlans: mealPlansRepo, bookingConfig: bookingConfigRepo({ hotelId: HOTEL_ID, enabled: true, showMealPlans: false }) }
    for (const code of ['pension_gourmet', 'breakfast']) {
      const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: code }, ...NO_STRIPE, deps)
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('meal_plan_unavailable')
      expect(res.body.mealPlan).toBe(code)
    }
    expect(tables.Reservations.length).toBe(0)

    const roomOnly = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'room_only' }, ...NO_STRIPE, deps)
    expect(roomOnly.status).toBe(201)
    expect(tables.Reservations[0].mealPlan).toBe('room_only')
    expect(tables.Reservations[0].mealPlanName).toBeNull()
  })

  it('(j2) #360 showMealPlans ausente/true → el catálogo se ofrece (default del toggle)', async () => {
    for (const cfg of [{ hotelId: HOTEL_ID, enabled: true }, { hotelId: HOTEL_ID, enabled: true, showMealPlans: true }]) {
      const { orm, tables, mealPlansRepo } = singleRoomDb([...CATALOG, GOURMET])
      const res = await createPublicBookingDirect(
        orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'pension_gourmet' }, ...NO_STRIPE,
        { config: configRepo(), mealPlans: mealPlansRepo, bookingConfig: bookingConfigRepo(cfg) },
      )
      expect(res.status).toBe(201)
      expect(tables.Reservations[0].mealPlanName).toBe('Pensión gourmet')
    }
  })

  it('(k) #360 room_only como fila ACTIVA del catálogo → línea real con su name, total 0', async () => {
    const roomOnlyRow = { id: 'mp-ro', hotelId: HOTEL_ID, code: 'room_only', name: 'Sólo habitación', active: true, priceMode: 'included', price: 0, sortOrder: 0 }
    const { orm, tables, mealPlansRepo } = singleRoomDb([roomOnlyRow, ...CATALOG])
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'room_only' }, ...NO_STRIPE, { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.mealPlanTotal).toBe(0)
    expect(res.body.totalBreakdown.subtotal).toBe(300)
    const saved = tables.Reservations[0]
    expect(saved.mealPlan).toBe('room_only')
    expect(saved.mealPlanName).toBe('Sólo habitación')
    expect(saved.mealPlanPriceMode).toBe('included')
    expect(saved.mealPlanTotal).toBe(0)
    expect(saved.regime).toBe('room_only')
    expect(saved.notes).toContain('Régimen: Sólo habitación (incluido)')
  })

  it('(h) mealPlan sin extraDeps.mealPlans cableado → 400 (no se ignora en silencio) y room_only sigue pasando', async () => {
    const { orm, tables } = singleRoomDb()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'breakfast' }, ...NO_STRIPE, { config: configRepo() },
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('meal_plan_unavailable')
    expect(tables.Reservations.length).toBe(0)

    const ok = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'family', adults: 2, mealPlan: 'room_only' }, ...NO_STRIPE, { config: configRepo() },
    )
    expect(ok.status).toBe(201)
  })
})

describe('createPublicBookingGroup — régimen por línea (MR-03 #268)', () => {
  const GROUP_BODY = { ...BASE_BODY, checkOut: '2026-09-12' } // 2 noches

  it('(d) 2 líneas con regímenes distintos → cada fila el suyo, totalBreakdown.mealPlanTotal = Σ', async () => {
    const catalog = CATALOG.map((m) => (m.id === 'mp-hb' ? { ...m, active: true } : { ...m }))
    const { orm, tables, mealPlansRepo } = makeDb({
      rooms: [
        { ...ROOM, id: 'r1', type: 'family' },
        { ...ROOM, id: 'r2', type: 'single', capacity: 1, basePrice: 50 },
      ],
      mealPlans: catalog,
    })
    const res = await createPublicBookingGroup(
      orm,
      {
        ...GROUP_BODY,
        rooms: [
          { roomType: 'family', adults: 2, quantity: 1, mealPlan: 'breakfast' },
          { roomType: 'single', adults: 1, quantity: 1, mealPlan: 'half_board' },
        ],
      },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    const tb = res.body.totalBreakdown
    // breakfast 10 × 2 pers × 2 noches = 40; half_board 25 × 1 × 2 = 50.
    expect(tb.mealPlanTotal).toBe(90)
    // habitación: 100×2 + 50×2 = 300, + 90 de régimen.
    expect(tb.subtotal).toBe(390)
    expect(tables.Reservations.length).toBe(2)
    // REQ-HAC-05 (#260): las filas nacen sin unidad (`roomId` null), se identifican por el tipo de su línea.
    expect(tables.Reservations.every((r) => r.roomId === null)).toBe(true)
    const byType = new Map(tables.Reservations.map((r) => [r.roomType, r]))
    expect(byType.get('family').mealPlan).toBe('breakfast')
    expect(byType.get('family').mealPlanTotal).toBe(40)
    expect(byType.get('family').mealPlanUnitPrice).toBe(10)
    expect(byType.get('family').mealPlanPersons).toBe(2)
    expect(byType.get('family').regime).toBe('breakfast')
    expect(byType.get('single').mealPlan).toBe('half_board')
    expect(byType.get('single').mealPlanTotal).toBe(50)
    expect(byType.get('single').mealPlanPersons).toBe(1)
    expect(byType.get('single').regime).toBe('half_board')
    // #360 — nombre congelado por fila (legacy sin `name` → LEGACY_NAMES) y `notes` con ese nombre.
    expect(byType.get('family').mealPlanName).toBe('Desayuno incluido')
    expect(byType.get('single').mealPlanName).toBe('Desayuno y cena')
    expect(byType.get('family').notes).toContain('family: Régimen: Desayuno incluido (2 pers × 2 noches = 40.00)')
    expect(byType.get('family').notes).toContain('single: Régimen: Desayuno y cena (1 pers × 2 noches = 50.00)')
  })

  it('(i-grupo) #360 fila custom → cada fila guarda mealPlanName con el name del catálogo', async () => {
    const { orm, tables, mealPlansRepo } = makeDb({
      rooms: [{ ...ROOM, id: 'r1' }, { ...ROOM, id: 'r2' }],
      mealPlans: [...CATALOG, GOURMET],
    })
    const res = await createPublicBookingGroup(
      orm,
      { ...GROUP_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 2, mealPlan: 'pension_gourmet' }] },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo, bookingConfig: bookingConfigRepo() },
    )
    expect(res.status).toBe(201)
    // 40 × 2 pers × 2 noches = 160 por unidad × 2.
    expect(res.body.totalBreakdown.mealPlanTotal).toBe(320)
    expect(tables.Reservations.length).toBe(2)
    for (const r of tables.Reservations) {
      expect(r.mealPlan).toBe('pension_gourmet')
      expect(r.mealPlanName).toBe('Pensión gourmet')
      expect(r.mealPlanTotal).toBe(160)
      expect(r.notes).toContain('family: Régimen: Pensión gourmet (2 pers × 2 noches = 160.00)')
    }
  })

  it('(j-grupo) #360 showMealPlans:false + una línea con mealPlan custom → 400 meal_plan_unavailable, nada creado; solo room_only pasa', async () => {
    const { orm, tables, mealPlansRepo } = makeDb({
      rooms: [{ ...ROOM, id: 'r1' }, { ...ROOM, id: 'r2' }],
      mealPlans: [...CATALOG, GOURMET],
    })
    const deps = { config: configRepo(), mealPlans: mealPlansRepo, bookingConfig: bookingConfigRepo({ hotelId: HOTEL_ID, enabled: true, showMealPlans: false }) }
    const bad = await createPublicBookingGroup(
      orm,
      { ...GROUP_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 1, mealPlan: 'room_only' }, { roomType: 'family', adults: 2, quantity: 1, mealPlan: 'pension_gourmet' }] },
      ...NO_STRIPE,
      deps,
    )
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('meal_plan_unavailable')
    expect(bad.body.mealPlan).toBe('pension_gourmet')
    expect(tables.Reservations.length).toBe(0)
    expect(tables.Groups.length).toBe(0)

    const ok = await createPublicBookingGroup(
      orm,
      { ...GROUP_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 2, mealPlan: 'room_only' }] },
      ...NO_STRIPE,
      deps,
    )
    expect(ok.status).toBe(201)
    expect(ok.body.totalBreakdown.mealPlanTotal).toBe(0)
    for (const r of tables.Reservations) {
      expect(r.mealPlan).toBe('room_only')
      expect(r.mealPlanName).toBeNull()
    }
  })

  it('(d2) quantity 2 → la línea cobra × 2 pero cada fila persiste el unitario', async () => {
    const { orm, tables, mealPlansRepo } = makeDb({
      rooms: [{ ...ROOM, id: 'r1' }, { ...ROOM, id: 'r2' }],
      mealPlans: CATALOG,
    })
    const res = await createPublicBookingGroup(
      orm,
      { ...GROUP_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 2, mealPlan: 'breakfast' }] },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.mealPlanTotal).toBe(80)
    expect(tables.Reservations.length).toBe(2)
    for (const r of tables.Reservations) {
      expect(r.mealPlan).toBe('breakfast')
      expect(r.mealPlanTotal).toBe(40)
    }
  })

  it('(d3) una línea con régimen inactivo → 400 meal_plan_unavailable, nada creado; línea sin mealPlan → room_only', async () => {
    const { orm, tables, mealPlansRepo } = makeDb({
      rooms: [{ ...ROOM, id: 'r1' }, { ...ROOM, id: 'r2' }],
      mealPlans: CATALOG,
    })
    const bad = await createPublicBookingGroup(
      orm,
      { ...GROUP_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 1 }, { roomType: 'family', adults: 2, quantity: 1, mealPlan: 'half_board' }] },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe('meal_plan_unavailable')
    expect(tables.Reservations.length).toBe(0)
    expect(tables.Groups.length).toBe(0)

    const ok = await createPublicBookingGroup(
      orm,
      { ...GROUP_BODY, rooms: [{ roomType: 'family', adults: 2, quantity: 1 }] },
      ...NO_STRIPE,
      { config: configRepo(), mealPlans: mealPlansRepo },
    )
    expect(ok.status).toBe(201)
    expect(ok.body.totalBreakdown.mealPlanTotal).toBe(0)
    expect(tables.Reservations[0].mealPlan).toBe('room_only')
    expect(tables.Reservations[0].regime).toBe('room_only')
  })
})

describe('getPublicReservation — expone el régimen (MR-03 #268)', () => {
  const VALID_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const prevSecret = process.env.BOOKING_TOKEN_SECRET
  beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = 'test-secret-fixed' })
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.BOOKING_TOKEN_SECRET
    else process.env.BOOKING_TOKEN_SECRET = prevSecret
  })

  function ormFor(reservation: any) {
    const guest = { id: 'g1', hotelId: HOTEL_ID, name: 'Ana', email: 'ana@example.com' }
    return {
      findMany: async (model: string, query: any) => {
        if (model === 'Reservations') return reservation.id === query?.id ? [reservation] : []
        if (model === 'Guests') return guest.id === query?.id ? [guest] : []
        return []
      },
    } as any
  }

  it('(g) devuelve mealPlan/mealPlanName/mealPlanTotal (y priceMode/unitPrice) de la reserva', async () => {
    const orm = ormFor({
      id: 'res-1', hotelId: HOTEL_ID, guestId: 'g1', roomId: 'r1', accessToken: VALID_TOKEN,
      status: 'pending', checkIn: '2026-09-10', checkOut: '2026-09-13', totalAmount: 390,
      mealPlan: 'breakfast', mealPlanName: 'Desayuno buffet', mealPlanPriceMode: 'per_person_per_night', mealPlanUnitPrice: 10, mealPlanTotal: 90,
    })
    const res = await getPublicReservation(orm, 'res-1', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.reservation.mealPlan).toBe('breakfast')
    // (l) #360 — nombre congelado al reservar, para que la confirmación no dependa de una tabla fija.
    expect(res.body.reservation.mealPlanName).toBe('Desayuno buffet')
    expect(res.body.reservation.mealPlanPriceMode).toBe('per_person_per_night')
    expect(res.body.reservation.mealPlanUnitPrice).toBe(10)
    expect(res.body.reservation.mealPlanTotal).toBe(90)
  })

  it('(g2) reserva vieja sin columnas → null/0', async () => {
    const orm = ormFor({
      id: 'res-2', hotelId: HOTEL_ID, guestId: 'g1', roomId: 'r1', accessToken: VALID_TOKEN,
      status: 'pending', checkIn: '2026-09-10', checkOut: '2026-09-13', totalAmount: 300,
    })
    const res = await getPublicReservation(orm, 'res-2', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.reservation.mealPlan).toBeNull()
    expect(res.body.reservation.mealPlanName).toBeNull()
    expect(res.body.reservation.mealPlanTotal).toBe(0)
  })
})
