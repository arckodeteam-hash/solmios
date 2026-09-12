// #276 (MR-11) — un solo interruptor del motor público: isEngineOpen
//
// Antes cada endpoint decidía por su cuenta: los GET miraban `hotels.onlineBookingStatus`, los
// POST sólo `booking_config.enabled` (y respondían 'Hotel no encontrado', distinto del
// 'Hotel not found' de los GET). Este archivo cubre, endpoint por endpoint, que los DOS flags
// cierran TODOS los endpoints con el MISMO 404 body (anti-enumeración):
//   (A) plataforma pausada (`onlineBookingStatus:'paused'`) + hotel con `enabled:true`
//   (B) plataforma activa + hotel con `enabled:false` (toggle de /panel/booking-engine)
//   (C) plataforma activa + `enabled:true` → todo abierto (200 en los GET, 201 en los POST)
import { describe, it, expect } from 'bun:test'
import { getPublicRates } from '../usecases/public-rates'
import { getPublicMealPlans } from '../usecases/public-meal-plans'
import { getPublicUpsells } from '../usecases/public-upsells'
import { getPublicChildAmenities } from '../usecases/public-child-amenities'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'
import { ENGINE_CLOSED_BODY } from '../../../shared/usecases/booking-engine-gate'

const HOTEL_ID = 'h1'
const SLUG = 'caribe'
const CLOSED = { error: 'Hotel not found' }

const makeHotel = (onlineBookingStatus: string) => ({
  id: HOTEL_ID, slug: SLUG, name: 'Caribe', onlineBookingStatus, currency: 'USD', taxRate: 0,
})

/** Repo fake de `hotels`: resuelve por `slug` (GET) o por `id` (POST) — la misma fila. */
const hotelsRepo = (hotel: any) => ({
  findOne: async (f: any = {}) =>
    hotel && ((f.slug && f.slug === hotel.slug) || (f.id && f.id === hotel.id) || (!f.slug && !f.id)) ? hotel : null,
})
const bookingConfigRepo = (row: any | null) => ({ findOne: async () => row })
const emptyRepo = { findMany: async () => [] }

const ROOM = { id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 100, status: 'available' }

/** ORM en memoria para los POST (mismo patrón que public-booking-group.test.ts#makeDb). */
function makeDb() {
  const tables: Record<string, any[]> = {
    Rooms: [{ ...ROOM }], Reservations: [], RoomBlocks: [], RoomRates: [], SeasonAssignments: [],
    RateOverrides: [], Seasons: [], PromoCodes: [], Guests: [], Groups: [], Configuration: [],
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
    updateMany: async () => 0,
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
  }
  return orm
}

const DIRECT_BODY = {
  hotelId: HOTEL_ID, roomId: 'r1', guestName: 'Ana', guestEmail: 'ana@example.com',
  guestPhone: '+18095550000', checkIn: '2026-10-10', checkOut: '2026-10-12', adults: 2, children: 0,
}
const GROUP_BODY = {
  hotelId: HOTEL_ID, guestName: 'Ana', guestEmail: 'ana@example.com', guestPhone: '+18095550000',
  checkIn: '2026-10-10', checkOut: '2026-10-12', rooms: [{ roomType: 'double', adults: 2, quantity: 1 }],
}
const RATES_QUERY = { checkIn: '2026-10-10', checkOut: '2026-10-12' }
const availability = {
  checkAvailability: async () => ({
    hotelId: HOTEL_ID, hotelName: 'Caribe', checkIn: '2026-10-10', checkOut: '2026-10-12', nights: 2,
    roomTypes: [{ roomType: 'double', available: 1, price: 100, currency: 'USD', capacity: 2, surfaceArea: 20, amenities: [] }],
  }),
}

/** Corre los 6 endpoints con el mismo hotel + la misma fila de booking_config. */
async function runAll(hotel: any, cfg: any) {
  const hotels = hotelsRepo(hotel)
  const bookingConfig = bookingConfigRepo(cfg)
  const extraDeps = { hotels: hotels as any, bookingConfig: bookingConfig as any }
  return {
    rates: await getPublicRates({ hotels, bookingConfig, availability, config: emptyRepo } as any, SLUG, RATES_QUERY),
    mealPlans: await getPublicMealPlans({ hotels, bookingConfig, mealPlans: emptyRepo } as any, SLUG),
    upsells: await getPublicUpsells({ hotels, bookingConfig, upsells: emptyRepo } as any, SLUG),
    childAmenities: await getPublicChildAmenities({ hotels, bookingConfig, childAmenities: emptyRepo } as any, SLUG),
    direct: await createPublicBookingDirect(makeDb(), DIRECT_BODY, undefined, undefined, undefined, undefined, undefined, extraDeps),
    group: await createPublicBookingGroup(makeDb(), GROUP_BODY, undefined, undefined, undefined, undefined, undefined, extraDeps),
  }
}

const ENDPOINTS = ['rates', 'mealPlans', 'upsells', 'childAmenities', 'direct', 'group'] as const

describe('#276 (MR-11) — un solo interruptor del motor público: isEngineOpen', () => {
  it('(A) plataforma pausada (onlineBookingStatus:paused) + enabled:true → 404 MISMO body en los 6', async () => {
    const res = await runAll(makeHotel('paused'), { hotelId: HOTEL_ID, enabled: true })
    for (const name of ENDPOINTS) {
      expect(res[name].status).toBe(404)
      expect(res[name].body).toEqual(CLOSED)
      expect(res[name].body).toEqual(ENGINE_CLOSED_BODY)
    }
  })

  it('(B) plataforma activa + enabled:false (toggle del hotel) → 404 MISMO body en los 6', async () => {
    const res = await runAll(makeHotel('active'), { hotelId: HOTEL_ID, enabled: false })
    for (const name of ENDPOINTS) {
      expect(res[name].status).toBe(404)
      expect(res[name].body).toEqual(CLOSED)
    }
  })

  it('(C) plataforma activa + enabled:true → los 4 GET responden 200 y los 2 POST 201', async () => {
    const res = await runAll(makeHotel('active'), { hotelId: HOTEL_ID, enabled: true })
    expect(res.rates.status).toBe(200)
    expect(res.mealPlans.status).toBe(200)
    expect(res.upsells.status).toBe(200)
    expect(res.childAmenities.status).toBe(200)
    expect(res.direct.status).toBe(201)
    expect(res.group.status).toBe(201)
  })

  it('hotel inexistente → el MISMO 404 que pausado/apagado (anti-enumeración)', async () => {
    const res = await runAll(null, null)
    for (const name of ['rates', 'mealPlans', 'upsells', 'childAmenities'] as const) {
      expect(res[name].status).toBe(404)
      expect(res[name].body).toEqual(CLOSED)
    }
    // Los POST con `hotels` cableado también cierran si el id no resuelve a ningún hotel.
    expect(res.direct.status).toBe(404)
    expect(res.direct.body).toEqual(CLOSED)
    expect(res.group.status).toBe(404)
    expect(res.group.body).toEqual(CLOSED)
  })

  it('POST sin `extraDeps.hotels` (compat callers/tests viejos) → sólo pesa booking_config.enabled', async () => {
    const onlyCfg = { bookingConfig: bookingConfigRepo({ hotelId: HOTEL_ID, enabled: true }) as any }
    const direct = await createPublicBookingDirect(makeDb(), DIRECT_BODY, undefined, undefined, undefined, undefined, undefined, onlyCfg)
    expect(direct.status).toBe(201)
    const off = { bookingConfig: bookingConfigRepo({ hotelId: HOTEL_ID, enabled: false }) as any }
    const group = await createPublicBookingGroup(makeDb(), GROUP_BODY, undefined, undefined, undefined, undefined, undefined, off)
    expect(group.status).toBe(404)
    expect(group.body).toEqual(CLOSED)
  })
})
