// #276 (MR-11) — el push de disponibilidad a Channex lo hace el usecase (una vez por habitación); el connector booking-channex ya no existe.
//
// Antes había un connector `booking-channex` suscripto a `onBookingCreated` que exigía
// `status === 'confirmed'` — y la reserva pública nace SIEMPRE `pending`, así que nunca empujaba.
// El push real es el callback `pushAvailability` que reciben `createPublicBookingDirect` y
// `createPublicBookingGroup`: una llamada por unidad física asignada, con el roomId resuelto.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'

const HOTEL_ID = 'h1'

/** ORM en memoria real (mismo patrón que public-booking-group.test.ts). */
function makeDb(seed: { rooms?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: [],
    RoomBlocks: [],
    RoomRates: [],
    SeasonAssignments: [],
    PromoCodes: [],
    Guests: [],
    Groups: [],
    Configuration: [],
  }
  const t = (name: string) => (tables[name] ??= [])
  const matches = (row: any, filter: any = {}) =>
    Object.entries(filter).every(([k, v]) => row[k] === v)
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
  checkOut: '2026-09-12',
}

const fakeStripe = {
  createReservationCheckout: async (reservationId: string, amount: number) => ({
    id: `cs_${reservationId}`, url: `https://stripe.test/checkout/${reservationId}?amount=${amount}`, payment_status: 'unpaid',
  }),
}
const stripeUrls = { successUrl: 'https://hotel.test/success', cancelUrl: 'https://hotel.test/cancel' }

function makePush() {
  const pushCalls: Array<{ hotelId: string; roomId: string }> = []
  const pushAvailability = (hotelId: string, roomId: string) => { pushCalls.push({ hotelId, roomId }) }
  return { pushCalls, pushAvailability }
}

describe('#276 — pushAvailability lo dispara el usecase, una vez por habitación', () => {
  it('reserva directa (pending) → exactamente 1 push con el hotelId y el roomId resuelto', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' }],
    })
    const { pushCalls, pushAvailability } = makePush()

    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'deluxe', adults: 2 }, pushAvailability, undefined, fakeStripe as any, undefined, stripeUrls,
    )

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(1)
    expect(tables.Reservations[0].status).toBe('pending') // el connector viejo exigía 'confirmed' → nunca empujaba
    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0]).toEqual({ hotelId: HOTEL_ID, roomId: 'r-deluxe' })
    expect(pushCalls[0].roomId).toBe(tables.Reservations[0].roomId)
  })

  it('grupo de 3 habitaciones → 3 pushes, uno por roomId distinto', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-deluxe-1', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-deluxe-2', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-standard', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const { pushCalls, pushAvailability } = makePush()

    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 2 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, pushAvailability, undefined, fakeStripe as any, undefined, stripeUrls)

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
    expect(pushCalls).toHaveLength(3)
    expect(pushCalls.every((c) => c.hotelId === HOTEL_ID)).toBe(true)
    const pushedRooms = pushCalls.map((c) => c.roomId).sort()
    expect(new Set(pushedRooms).size).toBe(3)
    expect(pushedRooms).toEqual(tables.Reservations.map((r: any) => r.roomId).sort())
    expect(pushedRooms).toEqual(['r-deluxe-1', 'r-deluxe-2', 'r-standard'])
  })
})
