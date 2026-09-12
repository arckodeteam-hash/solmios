// bookingengine/tests/pricing-to-public-rates.e2e.test.ts
//
// E2E REAL entre 2 módulos que NO se importan entre sí (`pricing` y `bookingengine`, regla del
// proyecto: "no importar de otros módulos directamente"). Corre el flujo completo que un
// hotelero y un huésped ejecutarían de verdad, con una única base de datos en memoria compartida
// entre los dos módulos (lo que uno escribe, el otro lo lee — a diferencia de los tests
// unitarios de cada módulo, que mockean sus propios repos por separado):
//
//   1. El hotelero abre "Temporadas y Tarifas" (`GET /rates`) con un tipo de habitación que
//      agrupa 2 unidades FÍSICAS de capacidad y precio distintos (2/$150 y 4/$120) — sin
//      tarifas guardadas todavía, `PricingQueries.listBaseRates()` genera el esqueleto.
//   2. Guarda sin tocar nada (`PUT /rates` → `PricingService.updateRates`) — quedan filas REALES
//      en `room_rates`, no solo generadas en memoria.
//   3. Un huésped busca el motor público (`GET /api/public/hotels/:slug/rates`) para el GRUPO
//      COMPLETO que la habitación más grande puede alojar (4 personas) — tiene que resolver un
//      precio real ($120), no degradar a "sin tarifa" ni cobrar el precio pensado para la
//      habitación de 2 personas.
//
// Regresión de la revisión del bug "primer room gana" en `PricingQueries.roomTypesFor` (Tarea 2,
// QA 2026-08-20, revisión posterior): antes de ese fix, con la habitación de capacidad 2 primera
// en la respuesta de la query, la fila única que `per_room` generaba quedaba en occupancy=2 — una
// búsqueda real para 4 personas no encontraba fila que "cubra" el grupo (`pickCoveringRate` exige
// occupancy >= guests) y el motor caía al fallback "la mayor disponible", sirviendo una fila
// pensada para menos gente. Los tests unitarios de `pricing` (`service.test.ts`) ya cubren que
// `roomTypesFor` calcula bien capacidad/precio — este archivo prueba la otra mitad: que lo que
// `pricing` genera y guarda es EXACTAMENTE lo que el motor público termina cobrando.
import { describe, it, expect } from 'bun:test'
import type { CacheAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { PricingService } from '../../pricing/service'
import { PricingQueries } from '../../pricing/usecases/pricing-queries'
import { getPublicRates } from '../usecases/public-rates'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { AvailabilityUseCase } from '../usecases/availability'

const log = silentLogger()
const noCache = { get: async () => null, set: async () => {} } as unknown as CacheAdapter

/**
 * ORM en memoria REAL — no funciones stub que devuelven fixtures fijos por tabla (como en los
 * tests unitarios de cada módulo), sino un store mutable de verdad: `create`/`update` de un
 * módulo tienen que ser visibles para el `findMany` del otro, o esto no sería un e2e.
 */
function makeDb() {
  const tables: Record<string, any[]> = {}
  const t = (name: string) => (tables[name] ??= [])
  const matches = (row: any, filter: any = {}) =>
    Object.entries(filter).every(([k, v]) => row[k] === v)
  const orm = {
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
    delete: async (table: string, id: string) => {
      tables[table] = t(table).filter((r) => r.id !== id)
    },
    updateMany: async (table: string, filter: any, patch: any) => {
      const rows = t(table).filter((r) => matches(r, filter))
      for (const r of rows) Object.assign(r, patch)
      return rows.length
    },
    // `createPublicBookingDirect` escribe dentro de `orm.transaction` — misma tabla, sin aislamiento.
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
  }
  return { orm, tables }
}

function repoOf(orm: ReturnType<typeof makeDb>['orm'], table: string) {
  return {
    findMany: async (filter?: any) => orm.findMany(table, filter),
    findById: async (id: string) => orm.findById(table, id),
    findOne: async (filter?: any) => orm.findOne(table, filter),
    create: async (data: any) => orm.create(table, data),
    update: async (id: string, data: any) => orm.update(table, id, data),
    delete: async (id: string) => orm.delete(table, id),
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  } as any
}

describe('E2E — pricing genera/guarda → el motor público cobra exactamente eso', () => {
  it('búsqueda para el grupo completo (capacidad máxima real) recibe precio real, no degradado', async () => {
    const { orm, tables } = makeDb()
    const HOTEL_ID = 'h1'
    const SLUG = 'boutique-test'
    const NIGHT = '2026-09-10'

    tables.Hotels = [{ id: HOTEL_ID, slug: SLUG, onlineBookingStatus: 'active', currency: 'USD', taxRate: 0 }]
    // 2 habitaciones FÍSICAS del mismo tipo, capacidad y precio distintos — el caso del hallazgo.
    tables.Rooms = [
      { id: 'r-chica', hotelId: HOTEL_ID, type: 'familiar', capacity: 2, basePrice: 150, status: 'available' },
      { id: 'r-grande', hotelId: HOTEL_ID, type: 'familiar', capacity: 4, basePrice: 120, status: 'available' },
    ]
    // La noche buscada cae en una temporada con fila cargada — si no, rate-resolution degrada al
    // fallback `rooms.basePrice` y no se ejercita lo que "Tarifas" guardó.
    tables.SeasonAssignments = [{ hotelId: HOTEL_ID, date: NIGHT, season: 'baja' }]

    // ─── Paso 1: el hotelero abre "Temporadas y Tarifas" ──────────────────────────────────
    const queries = new PricingQueries(orm)
    const pricingService = new PricingService(
      repoOf(orm, 'Seasons'), repoOf(orm, 'RoomRates'), repoOf(orm, 'RoomBlocks'),
      repoOf(orm, 'RateRestrictions'), log, queries,
    )

    // Sin tarifas guardadas todavía → GET /rates genera el esqueleto. Esto es lo que arreglé:
    // capacidad MÁXIMA=4, precio MÍNIMO=120 — no los de la primera habitación de la query.
    // El esqueleto abre una fila por ocupación 1..capacidad (el hotel tarifa por persona).
    const skeleton = await pricingService.listRates(HOTEL_ID)
    expect(skeleton.length).toBeGreaterThan(0)
    expect(Math.max(...skeleton.map((r: any) => r.occupancy))).toBe(4)
    expect(skeleton.every((r: any) => r.basePrice === 120)).toBe(true)

    // ─── Paso 2: guarda sin tocar nada (mismo payload que buildRatesPayload() del frontend) ──
    const payload = skeleton.map((r: any) => ({
      roomType: r.roomType, occupancy: r.occupancy, season: r.season,
      basePrice: r.basePrice, percentage: r.percentage, price: r.price, closed: r.closed,
    }))
    await pricingService.updateRates(HOTEL_ID, payload)
    // Ahora SÍ hay filas reales en room_rates — no generadas en memoria en cada request.
    expect(tables.RoomRates!.length).toBeGreaterThan(0)
    expect(tables.RoomRates!.some((r: any) => r.occupancy === 4)).toBe(true)

    // ─── Paso 3: un huésped busca el motor público para el GRUPO COMPLETO (4 personas) ─────
    const availability = new AvailabilityUseCase(
      noCache, repoOf(orm, 'Rooms'), repoOf(orm, 'Reservations'), repoOf(orm, 'Hotels'),
      repoOf(orm, 'RoomBlocks'), repoOf(orm, 'SeasonAssignments'), repoOf(orm, 'RoomRates'),
    )
    const res = await getPublicRates(
      {
        hotels: repoOf(orm, 'Hotels'),
        availability: { checkAvailability: (q: any) => availability.check(q) },
        config: repoOf(orm, 'Configuration'),
        seasonAssignments: repoOf(orm, 'SeasonAssignments'),
        roomRates: repoOf(orm, 'RoomRates'),
      },
      SLUG,
      { checkIn: NIGHT, checkOut: '2026-09-11', guests: 4 },
    )

    expect(res.status).toBe(200)
    const type = res.body.roomTypes.find((rt: any) => rt.id === 'familiar')
    expect(type).toBeDefined()
    const row4 = type.occupancies.find((o: any) => o.occupancy === 4)
    // LA REGRESIÓN QUE ESTO ANCLA: antes del fix de `roomTypesFor`, esta fila salía
    // `available:false` (no había fila que cubra occupancy=4) o con un precio pensado para la
    // habitación de 2, no para la búsqueda real de 4 personas.
    expect(row4).toMatchObject({ available: true, price: 120 })
  })
})

// ─── MR-03 #268 — régimen (meal plan) en GET /rates ─────────────────────────────────────────
// Mismo ORM en memoria compartido: lo que el hotelero guarda en `MealPlans` (PUT /meal-plans)
// es lo que el motor público cotiza en `mealPlans[]`, con el total ya resuelto para
// `(guests + children) × nights`, y lo que `POST /booking` termina cobrando para la MISMA
// composición (`effectiveAdults + payingChildren`) sobre el MISMO catálogo.
describe('E2E — meal plans del hotel → GET /rates devuelve mealPlans[] con totalForStay', () => {
  const HOTEL_ID = 'h-mp'
  const SLUG = 'meal-plans-test'

  function seed() {
    const { orm, tables } = makeDb()
    tables.Hotels = [{ id: HOTEL_ID, slug: SLUG, onlineBookingStatus: 'active', currency: 'USD', taxRate: 0 }]
    tables.Rooms = [
      { id: 'r1', hotelId: HOTEL_ID, type: 'standard', capacity: 3, basePrice: 100, status: 'available' },
    ]
    // child_policy: maxBabyAge default 0 → edad 0 = bebé, 1..3 = libre (sin plaza), 4..12 = niño
    // CON plaza (paga régimen). Misma política que `public-booking-meal-plans.test.ts`.
    tables.Configuration = [
      { id: 'cfg-cp', hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } },
    ]
    tables.MealPlans = [
      { id: 'mp-b', hotelId: HOTEL_ID, code: 'breakfast', active: true, priceMode: 'per_person_per_night', price: 10 },
      { id: 'mp-hb', hotelId: HOTEL_ID, code: 'half_board', active: true, priceMode: 'included', price: 0 },
      { id: 'mp-ai', hotelId: HOTEL_ID, code: 'all_inclusive', active: false, priceMode: 'per_person_per_night', price: 50 },
      // Régimen de OTRO hotel: no puede filtrarse en la respuesta de este.
      { id: 'mp-other', hotelId: 'h-otro', code: 'all_inclusive', active: true, priceMode: 'per_person_per_night', price: 99 },
    ]
    const availability = new AvailabilityUseCase(
      noCache, repoOf(orm, 'Rooms'), repoOf(orm, 'Reservations'), repoOf(orm, 'Hotels'),
      repoOf(orm, 'RoomBlocks'), repoOf(orm, 'SeasonAssignments'), repoOf(orm, 'RoomRates'),
    )
    const baseDeps = {
      hotels: repoOf(orm, 'Hotels'),
      availability: { checkAvailability: (q: any) => availability.check(q) },
      config: repoOf(orm, 'Configuration'),
    }
    return { orm, baseDeps }
  }

  // 2 huéspedes × 3 noches.
  const query = { checkIn: '2026-09-10', checkOut: '2026-09-13', guests: 2 }

  it('lista solo los activos del hotel, en orden, con totalForStay = price × guests × nights', async () => {
    const { orm, baseDeps } = seed()
    const res = await getPublicRates({ ...baseDeps, mealPlans: repoOf(orm, 'MealPlans') }, SLUG, query)

    expect(res.status).toBe(200)
    expect(res.body.nights).toBe(3)
    expect(res.body.mealPlans).toHaveLength(2)
    expect(res.body.mealPlans.map((m: any) => m.code)).toEqual(['breakfast', 'half_board'])

    const breakfast = res.body.mealPlans[0]
    expect(breakfast).toMatchObject({ code: 'breakfast', priceMode: 'per_person_per_night', price: 10, persons: 2, nights: 3 })
    expect(breakfast.perNight).toBe(20)        // 10 × 2 huéspedes
    expect(breakfast.totalForStay).toBe(60)    // 10 × 2 × 3 noches

    const halfBoard = res.body.mealPlans[1]
    expect(halfBoard).toMatchObject({ code: 'half_board', priceMode: 'included', perNight: 0, totalForStay: 0 })

    // Inactivo → no aparece (ni el de otro hotel).
    expect(res.body.mealPlans.some((m: any) => m.code === 'all_inclusive')).toBe(false)
  })

  it('sin dep mealPlans (callers viejos) el body trae mealPlans: []', async () => {
    const { baseDeps } = seed()
    const res = await getPublicRates(baseDeps, SLUG, query)

    expect(res.status).toBe(200)
    expect(res.body.mealPlans).toEqual([])
  })

  // ─── Coherencia GET /rates ↔ POST /booking (hallazgo de revisión #268) ──────────────────
  // `/rates` cotiza el régimen para `guests + children` (niños con plaza) y ecoa `persons`;
  // `POST /booking` cobra `effectiveAdults + payingChildren` releyendo el MISMO catálogo. Para la
  // misma composición los dos lados tienen que dar el mismo número — si no, el widget muestra un
  // total y el huésped paga otro.
  const BOOKING_BODY = {
    hotelId: HOTEL_ID,
    guestName: 'Ana Pérez',
    guestEmail: 'ana@example.com',
    guestPhone: '+18095550000',
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    roomType: 'standard',
    mealPlan: 'breakfast',
  }
  const NO_STRIPE = [undefined, undefined, undefined, undefined, undefined] as const

  it('2 adultos + 1 niño CON plaza: /rates (guests=2&children=1) totalForStay 90 === POST mealPlanTotal 90', async () => {
    const { orm, baseDeps } = seed()
    const mealPlans = repoOf(orm, 'MealPlans')

    const rates = await getPublicRates({ ...baseDeps, mealPlans }, SLUG, { ...query, guests: 2, children: 1 })
    expect(rates.status).toBe(200)
    const breakfast = rates.body.mealPlans[0]
    expect(breakfast).toMatchObject({ code: 'breakfast', persons: 3, nights: 3, perNight: 30, totalForStay: 90 })

    // Edad 8 → niño con plaza según la child_policy sembrada; paga régimen.
    const booking = await createPublicBookingDirect(
      orm,
      { ...BOOKING_BODY, adults: 2, childrenAges: [8] },
      ...NO_STRIPE,
      { config: repoOf(orm, 'Configuration'), mealPlans },
    )
    expect(booking.status).toBe(201)
    expect(booking.body.totalBreakdown.mealPlanTotal).toBe(90)
    expect(booking.body.totalBreakdown.mealPlanTotal).toBe(breakfast.totalForStay)
  })

  it('2 adultos sin niños: /rates (guests=2) totalForStay 60 === POST mealPlanTotal 60', async () => {
    const { orm, baseDeps } = seed()
    const mealPlans = repoOf(orm, 'MealPlans')

    const rates = await getPublicRates({ ...baseDeps, mealPlans }, SLUG, { ...query, guests: 2 })
    expect(rates.status).toBe(200)
    const breakfast = rates.body.mealPlans[0]
    expect(breakfast).toMatchObject({ code: 'breakfast', persons: 2, nights: 3, totalForStay: 60 })

    const booking = await createPublicBookingDirect(
      orm,
      { ...BOOKING_BODY, adults: 2 },
      ...NO_STRIPE,
      { config: repoOf(orm, 'Configuration'), mealPlans },
    )
    expect(booking.status).toBe(201)
    expect(booking.body.totalBreakdown.mealPlanTotal).toBe(60)
    expect(booking.body.totalBreakdown.mealPlanTotal).toBe(breakfast.totalForStay)
  })
})
