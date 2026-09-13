// #276 (MR-11) — el push de disponibilidad a Channex lo hace el usecase (una vez por habitación); el connector booking-channex ya no existe.
//
// Antes había un connector `booking-channex` suscripto a `onBookingCreated` que exigía
// `status === 'confirmed'` — y la reserva pública nace SIEMPRE `pending`, así que nunca empujaba.
// El push real lo disparan `createPublicBookingDirect` y `createPublicBookingGroup`.
// REQ-HAC-05 (#260): la reserva (individual y de grupo) nace SIN unidad (`roomId` null), así que
// ambos usecases empujan por TIPO (`pushAvailabilityByType`, 9.º arg) — una vez por tipo distinto,
// no por fila — y NO invocan al callback legado por unidad (`pushAvailability`).
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

function makePushByType() {
  const pushTypeCalls: Array<{ hotelId: string; roomType: string }> = []
  const pushAvailabilityByType = (hotelId: string, roomType: string) => { pushTypeCalls.push({ hotelId, roomType }) }
  return { pushTypeCalls, pushAvailabilityByType }
}

describe('#276 — pushAvailability lo dispara el usecase, una vez por habitación', () => {
  it('reserva directa (pending) → exactamente 1 push POR TIPO con el hotelId y el roomType vendido (HAC-05); ninguno por unidad', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' }],
    })
    const { pushCalls, pushAvailability } = makePush()
    const { pushTypeCalls, pushAvailabilityByType } = makePushByType()

    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'deluxe', adults: 2 }, pushAvailability, undefined, fakeStripe as any, undefined, stripeUrls,
      undefined, pushAvailabilityByType,
    )

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(1)
    expect(tables.Reservations[0].status).toBe('pending') // el connector viejo exigía 'confirmed' → nunca empujaba
    expect(tables.Reservations[0].roomId).toBeNull()
    expect(tables.Reservations[0].roomType).toBe('deluxe')
    expect(pushTypeCalls).toHaveLength(1)
    expect(pushTypeCalls[0]).toEqual({ hotelId: HOTEL_ID, roomType: 'deluxe' })
    // Sin unidad asignada no hay nada que empujar por habitación.
    expect(pushCalls).toHaveLength(0)
  })

  it('grupo de 3 habitaciones (deluxe ×2 + standard ×1) → 2 pushes POR TIPO (uno por tipo distinto, HAC-05); ninguno por unidad', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-deluxe-1', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-deluxe-2', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-standard', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const { pushCalls, pushAvailability } = makePush()
    const { pushTypeCalls, pushAvailabilityByType } = makePushByType()

    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 2 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, pushAvailability, undefined, fakeStripe as any, undefined, stripeUrls, undefined, pushAvailabilityByType)

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
    expect(tables.Reservations.every((r: any) => r.roomId === null)).toBe(true)
    expect(tables.Reservations.map((r: any) => r.roomType).sort()).toEqual(['deluxe', 'deluxe', 'standard'])
    // Un push por TIPO distinto (no uno por fila): deluxe una sola vez aunque se vendieron 2.
    expect(pushTypeCalls).toHaveLength(2)
    expect(pushTypeCalls.every((c) => c.hotelId === HOTEL_ID)).toBe(true)
    expect(pushTypeCalls.map((c) => c.roomType).sort()).toEqual(['deluxe', 'standard'])
    // Sin unidad asignada no hay nada que empujar por habitación.
    expect(pushCalls).toHaveLength(0)
  })
})
