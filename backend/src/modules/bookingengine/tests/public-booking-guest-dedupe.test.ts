// bookingengine/tests/public-booking-guest-dedupe.test.ts — MR-08 (#273): un huésped = una ficha.
//
// Antes, cada POST público hacía `tx.create('Guests')` a ciegas: el mismo huésped que reservaba
// dos veces terminaba con dos fichas. Ahora `createPublicBookingDirect` y `createPublicBookingGroup`
// pasan por `shared/usecases/find-or-create-guest.ts` DENTRO de su transacción. Este archivo lo
// prueba de punta a punta con el mismo ORM en memoria de `public-booking-group.test.ts`:
//   (a) dos reservas single con el mismo email en distinta mayúscula/espacios → 1 Guests, 2 Reservations.
//   (b) single + group con el mismo email → comparten ficha (y el grupo la usa como leadGuestId).
//   (c) dos reservas group con el mismo email → 1 ficha.
//   (d) mismo email en OTRO hotel → 2 fichas (la dedupe es por hotel).
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'

const HOTEL_ID = 'h1'
const OTHER_HOTEL_ID = 'h2'

/** ORM en memoria REAL (mismo patrón que `public-booking-group.test.ts`): las aserciones leen
 *  directo de `tables`. `findOne`/`findMany` son genéricos, así que `Guests` funciona sin más. */
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
    Hotels: [{ id: HOTEL_ID, name: 'Hotel Uno' }, { id: OTHER_HOTEL_ID, name: 'Hotel Dos' }],
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

const room = (id: string, hotelId = HOTEL_ID) =>
  ({ id, hotelId, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' })

const singleBody = (over: Record<string, any> = {}) => ({
  hotelId: HOTEL_ID, roomType: 'deluxe', adults: 2, children: 0,
  guestName: 'Ana Pérez', guestEmail: 'ana@mail.com', guestPhone: '+18095550000',
  checkIn: '2026-10-01', checkOut: '2026-10-03',
  ...over,
})

const groupBody = (over: Record<string, any> = {}) => ({
  hotelId: HOTEL_ID,
  guestName: 'Ana Pérez', guestEmail: 'ana@mail.com', guestPhone: '+18095550000',
  checkIn: '2026-10-01', checkOut: '2026-10-03',
  rooms: [{ roomType: 'deluxe', adults: 2, quantity: 1 }],
  ...over,
})

describe('MR-08 (#273) — reserva pública single: mismo email → misma ficha', () => {
  it("'Ana@Mail.com ' y 'ana@mail.com' → 1 Guests, 2 Reservations con el mismo guestId, email guardado normalizado", async () => {
    // Fechas distintas para que la segunda reserva no choque por solape con la primera.
    const { orm, tables } = makeDb({ rooms: [room('r1')] })

    const first = await createPublicBookingDirect(orm, singleBody({ guestEmail: 'Ana@Mail.com ' }))
    expect(first.status).toBe(201)
    const second = await createPublicBookingDirect(orm, singleBody({
      guestEmail: 'ana@mail.com', checkIn: '2026-10-10', checkOut: '2026-10-12',
    }))
    expect(second.status).toBe(201)

    expect(tables.Guests).toHaveLength(1)
    expect(tables.Guests[0].email).toBe('ana@mail.com')
    expect(tables.Reservations).toHaveLength(2)
    expect(tables.Reservations[0].guestId).toBe(tables.Guests[0].id)
    expect(tables.Reservations[1].guestId).toBe(tables.Guests[0].id)
  })

  it('la ficha existente no se pisa: nombre/teléfono cargados se conservan', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r1')] })
    await createPublicBookingDirect(orm, singleBody({ guestName: 'Ana Pérez', guestPhone: '+18095550000' }))
    await createPublicBookingDirect(orm, singleBody({
      guestName: 'A. Perez', guestPhone: '+18095559999', checkIn: '2026-10-10', checkOut: '2026-10-12',
    }))
    expect(tables.Guests).toHaveLength(1)
    expect(tables.Guests[0].name).toBe('Ana Pérez')
    expect(tables.Guests[0].phone).toBe('+18095550000')
  })
})

describe('MR-08 (#273) — reserva pública group: mismo email → misma ficha', () => {
  it('single + group con el mismo email (distinta mayúscula) comparten ficha; el Group apunta a ella como leadGuestId', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r1'), room('r2')] })

    const single = await createPublicBookingDirect(orm, singleBody({ guestEmail: 'ana@mail.com' }))
    expect(single.status).toBe(201)
    const group = await createPublicBookingGroup(orm, groupBody({
      guestEmail: '  ANA@mail.com', checkIn: '2026-10-10', checkOut: '2026-10-12',
    }))
    expect(group.status).toBe(201)

    expect(tables.Guests).toHaveLength(1)
    const guestId = tables.Guests[0].id
    expect(tables.Reservations).toHaveLength(2)
    expect(tables.Reservations.every((r: any) => r.guestId === guestId)).toBe(true)
    expect(tables.Groups).toHaveLength(1)
    expect(tables.Groups[0].leadGuestId).toBe(guestId)
  })

  it('dos reservas group con el mismo email → 1 Guests, 2 Groups, 2 Reservations con el mismo guestId', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r1')] })

    const a = await createPublicBookingGroup(orm, groupBody({ guestEmail: 'Ana@Mail.com ' }))
    expect(a.status).toBe(201)
    const b = await createPublicBookingGroup(orm, groupBody({
      guestEmail: 'ana@mail.com', checkIn: '2026-10-10', checkOut: '2026-10-12',
    }))
    expect(b.status).toBe(201)

    expect(tables.Guests).toHaveLength(1)
    expect(tables.Guests[0].email).toBe('ana@mail.com')
    expect(tables.Groups).toHaveLength(2)
    expect(tables.Reservations).toHaveLength(2)
    expect(new Set(tables.Reservations.map((r: any) => r.guestId)).size).toBe(1)
    expect(tables.Reservations[0].guestId).toBe(tables.Guests[0].id)
  })
})

describe('MR-08 (#273) — la dedupe es POR HOTEL', () => {
  it('mismo email en otro hotelId → 2 fichas (una por hotel)', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r1', HOTEL_ID), room('r2', OTHER_HOTEL_ID)] })

    const a = await createPublicBookingDirect(orm, singleBody({ hotelId: HOTEL_ID }))
    expect(a.status).toBe(201)
    const b = await createPublicBookingDirect(orm, singleBody({ hotelId: OTHER_HOTEL_ID }))
    expect(b.status).toBe(201)

    expect(tables.Guests).toHaveLength(2)
    expect(new Set(tables.Guests.map((g: any) => g.hotelId))).toEqual(new Set([HOTEL_ID, OTHER_HOTEL_ID]))
    expect(tables.Reservations).toHaveLength(2)
    expect(tables.Reservations[0].guestId).not.toBe(tables.Reservations[1].guestId)
  })
})
