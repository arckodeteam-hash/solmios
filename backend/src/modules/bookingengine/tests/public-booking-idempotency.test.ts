// bookingengine/tests/public-booking-idempotency.test.ts — #266
//
// POST /api/public/booking (1 habitación y grupo) con `idempotencyKey`:
//   1. Dos POST con la misma key y el mismo hotel → UNA sola fila en Reservations, misma
//      reservationId/accessToken, el segundo con status 200 (`replayed: true`), sin volver a
//      crear guest ni reserva; checkoutUrl recreado sobre la misma reserva.
//   2. Misma key, OTRO hotel → dos reservas (la key es única POR HOTEL).
//   3. `paymentDeadlineAt` = creación + booking_config.pendingTtlMinutes (default 60; 15 → +15).
//   4. Sin key → dos reservas distintas (comportamiento previo intacto).
//   5. Carrera: el insert falla por el índice único → se relee y responde el replay 200.
//   6. Replay de una reserva ya `cancelled` (vencida) → 409 `reservation_expired`.
//   7. Grupo: key solo en la líder; replay devuelve el grupo entero con 200.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect, normalizeIdempotencyKey, resolvePaymentDeadlineAt } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MINUTE = 60_000

/** ORM en memoria (mismo patrón que public-booking-group.test.ts) + índice único
 *  (hotelId, idempotencyKey) simulado, como el de migrate-db.ts. */
function makeDb(seed: { rooms?: any[]; reservations?: any[]; bookingConfig?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: seed.reservations ?? [],
    Hotels: [
      { id: 'h1', slug: 'h1', name: 'Hotel 1', currency: 'USD', taxRate: 0 },
      { id: 'h2', slug: 'h2', name: 'Hotel 2', currency: 'USD', taxRate: 0 },
    ],
    RoomBlocks: [], RoomRates: [], SeasonAssignments: [], RateOverrides: [], Seasons: [],
    PromoCodes: [], Guests: [], Groups: [], Configuration: [], RoomAmenities: [],
    BookingConfig: seed.bookingConfig ?? [],
  }
  const t = (name: string) => (tables[name] ??= [])
  const matches = (row: any, filter: any = {}) => Object.entries(filter).every(([k, v]) => row[k] === v)
  const orm: any = {
    findMany: async (table: string, filter: any = {}) => t(table).filter((r) => matches(r, filter)),
    findOne: async (table: string, filter: any = {}) => t(table).find((r) => matches(r, filter)) ?? null,
    findById: async (table: string, id: string) => t(table).find((r) => r.id === id) ?? null,
    create: async (table: string, data: any) => {
      if (table === 'Reservations' && data.idempotencyKey) {
        const dup = t(table).some((r) => r.hotelId === data.hotelId && r.idempotencyKey === data.idempotencyKey)
        if (dup) throw new Error('UNIQUE constraint failed: idx_reservations_hotel_idempotency')
      }
      const row = { id: data.id || crypto.randomUUID(), createdAt: new Date().toISOString(), ...data }
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
  const bookingConfigRepo = {
    findOne: async (filter: any) => t('BookingConfig').find((r) => matches(r, filter)) ?? null,
  }
  return { orm, tables, bookingConfigRepo }
}

const rooms = () => [
  { id: 'r1', hotelId: 'h1', type: 'double', number: '101', basePrice: 100, capacity: 2, status: 'available' },
  { id: 'r2', hotelId: 'h1', type: 'double', number: '102', basePrice: 100, capacity: 2, status: 'available' },
  { id: 'r3', hotelId: 'h2', type: 'double', number: '201', basePrice: 90, capacity: 2, status: 'available' },
]

const baseBody = {
  hotelId: 'h1',
  roomType: 'double',
  guestName: 'Ana',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: '2026-12-10',
  checkOut: '2026-12-12',
  adults: 2,
  children: 0,
}

function makeStripe() {
  const calls: string[] = []
  const deps = {
    createReservationCheckout: async (reservationId: string, amount: number) => {
      calls.push(reservationId)
      return { id: `cs_${reservationId}`, url: `https://stripe.test/checkout/${reservationId}?amount=${amount}`, payment_status: 'unpaid' }
    },
  }
  return { deps, calls }
}
const stripeUrls = { successUrl: 'https://hotel.test/success', cancelUrl: 'https://hotel.test/cancel' }

function extraDepsFor(db: ReturnType<typeof makeDb>) {
  return { bookingConfig: db.bookingConfigRepo as any }
}

describe('#266 — POST /api/public/booking idempotente', () => {
  it('misma key + mismo hotel → 1 fila, misma reservationId/accessToken, 2do POST status 200 replayed', async () => {
    const db = makeDb({ rooms: rooms() })
    const { deps, calls } = makeStripe()
    const body = { ...baseBody, idempotencyKey: 'widget-abc-123' }

    const first = await createPublicBookingDirect(db.orm, body, undefined, undefined, deps, undefined, stripeUrls, extraDepsFor(db))
    const second = await createPublicBookingDirect(db.orm, body, undefined, undefined, deps, undefined, stripeUrls, extraDepsFor(db))

    expect(first.status).toBe(201)
    expect(first.body.replayed).toBeUndefined()
    expect(second.status).toBe(200)
    expect(second.body.replayed).toBe(true)

    expect(db.tables.Reservations).toHaveLength(1)
    expect(db.tables.Guests).toHaveLength(1)
    expect(db.tables.Reservations[0].idempotencyKey).toBe('widget-abc-123')

    expect(second.body.reservation.id).toBe(first.body.reservation.id)
    expect(second.body.reservation.accessToken).toBe(first.body.reservation.accessToken)
    expect(UUID_RE.test(second.body.reservation.accessToken)).toBe(true)
    // Mismo checkout (Stripe reutiliza la sesión por Idempotency-Key=reservationId).
    expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl)
    expect(calls).toEqual([first.body.reservation.id, first.body.reservation.id])
    // Misma forma de respuesta que el 201.
    expect(second.body.guest?.id).toBe(first.body.guest.id)
    expect(second.body.totalBreakdown?.total).toBe(first.body.totalBreakdown.total)
  })

  it('misma key + OTRO hotel → dos reservas (la key es única por hotel)', async () => {
    const db = makeDb({ rooms: rooms() })
    const key = 'shared-key-xyz'
    const a = await createPublicBookingDirect(db.orm, { ...baseBody, hotelId: 'h1', idempotencyKey: key })
    const b = await createPublicBookingDirect(db.orm, { ...baseBody, hotelId: 'h2', idempotencyKey: key })

    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(db.tables.Reservations).toHaveLength(2)
    expect(a.body.reservation.id).not.toBe(b.body.reservation.id)
    expect(db.tables.Reservations.map((r: any) => r.hotelId).sort()).toEqual(['h1', 'h2'])
  })

  it('sin key → dos POST crean dos reservas distintas (comportamiento previo)', async () => {
    const db = makeDb({ rooms: rooms() })
    const a = await createPublicBookingDirect(db.orm, baseBody)
    const b = await createPublicBookingDirect(db.orm, baseBody)
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(db.tables.Reservations).toHaveLength(2)
    expect(db.tables.Reservations.every((r: any) => r.idempotencyKey === undefined)).toBe(true)
  })

  it('key que no es string (número/objeto) se ignora; string se recorta a 128 chars', async () => {
    expect(normalizeIdempotencyKey(123)).toBeNull()
    expect(normalizeIdempotencyKey({ k: 1 })).toBeNull()
    expect(normalizeIdempotencyKey('   ')).toBeNull()
    expect(normalizeIdempotencyKey(' abc ')).toBe('abc')
    expect(normalizeIdempotencyKey('x'.repeat(300))).toHaveLength(128)

    const db = makeDb({ rooms: rooms() })
    const a = await createPublicBookingDirect(db.orm, { ...baseBody, idempotencyKey: 42 })
    const b = await createPublicBookingDirect(db.orm, { ...baseBody, idempotencyKey: 42 })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(db.tables.Reservations).toHaveLength(2)
  })

  it('paymentDeadlineAt = creación + 60 min por default (sin booking_config / pendingTtlMinutes null)', async () => {
    const db = makeDb({ rooms: rooms(), bookingConfig: [{ id: 'bc1', hotelId: 'h1', enabled: true, pendingTtlMinutes: null }] })
    const before = Date.now()
    const res = await createPublicBookingDirect(db.orm, baseBody, undefined, undefined, undefined, undefined, undefined, extraDepsFor(db))
    const after = Date.now()
    expect(res.status).toBe(201)
    const row = db.tables.Reservations[0]
    const deadline = new Date(row.paymentDeadlineAt).getTime()
    const createdAt = new Date(row.createdAt).getTime()
    expect(deadline).toBeGreaterThanOrEqual(before + 60 * MINUTE)
    expect(deadline).toBeLessThanOrEqual(after + 60 * MINUTE)
    expect(Math.abs(deadline - (createdAt + 60 * MINUTE))).toBeLessThan(5_000)

    // Sin extraDeps (caller viejo) también: default 60.
    const db2 = makeDb({ rooms: rooms() })
    const res2 = await createPublicBookingDirect(db2.orm, baseBody)
    expect(res2.status).toBe(201)
    const d2 = new Date(db2.tables.Reservations[0].paymentDeadlineAt).getTime()
    expect(d2).toBeGreaterThanOrEqual(before + 60 * MINUTE)
  })

  it('paymentDeadlineAt = creación + booking_config.pendingTtlMinutes (15 → +15 min)', async () => {
    const db = makeDb({ rooms: rooms(), bookingConfig: [{ id: 'bc1', hotelId: 'h1', enabled: true, pendingTtlMinutes: 15 }] })
    const before = Date.now()
    const res = await createPublicBookingDirect(db.orm, baseBody, undefined, undefined, undefined, undefined, undefined, extraDepsFor(db))
    const after = Date.now()
    expect(res.status).toBe(201)
    const deadline = new Date(db.tables.Reservations[0].paymentDeadlineAt).getTime()
    expect(deadline).toBeGreaterThanOrEqual(before + 15 * MINUTE)
    expect(deadline).toBeLessThanOrEqual(after + 15 * MINUTE)

    // Helper puro: TTL inválido cae al default.
    const now = new Date('2026-09-12T10:00:00.000Z')
    expect(resolvePaymentDeadlineAt({ pendingTtlMinutes: 15 }, now)).toBe('2026-09-12T10:15:00.000Z')
    expect(resolvePaymentDeadlineAt({ pendingTtlMinutes: 'abc' }, now)).toBe('2026-09-12T11:00:00.000Z')
    expect(resolvePaymentDeadlineAt(null, now)).toBe('2026-09-12T11:00:00.000Z')
  })

  it('carrera: el insert choca con el índice único → relee y responde el replay 200', async () => {
    const db = makeDb({ rooms: rooms() })
    const key = 'race-key'
    // Simula que OTRO request commiteó entre la búsqueda inicial y el insert: la búsqueda
    // inicial no ve nada (primer findOne devuelve null), el índice único rechaza el create.
    let firstLookup = true
    const realFindOne = db.orm.findOne
    db.orm.findOne = async (table: string, filter: any) => {
      if (table === 'Reservations' && filter?.idempotencyKey === key && firstLookup) {
        firstLookup = false
        // El "otro" request gana justo acá.
        await createPublicBookingDirect(db.orm, { ...baseBody, idempotencyKey: key })
        return null
      }
      return realFindOne(table, filter)
    }
    const res = await createPublicBookingDirect(db.orm, { ...baseBody, idempotencyKey: key })
    expect(res.status).toBe(200)
    expect(res.body.replayed).toBe(true)
    expect(db.tables.Reservations).toHaveLength(1)
    expect(res.body.reservation.id).toBe(db.tables.Reservations[0].id)
  })

  it('replay de una reserva ya cancelled (vencida) → 409 reservation_expired', async () => {
    const db = makeDb({ rooms: rooms() })
    const body = { ...baseBody, idempotencyKey: 'expired-key' }
    const first = await createPublicBookingDirect(db.orm, body)
    expect(first.status).toBe(201)
    db.tables.Reservations[0].status = 'cancelled'
    db.tables.Reservations[0].cancellationReason = 'payment_timeout'
    const second = await createPublicBookingDirect(db.orm, body)
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('reservation_expired')
    expect(db.tables.Reservations).toHaveLength(1)
  })
})

describe('#266 — POST /api/public/booking/group idempotente', () => {
  const groupBody = {
    hotelId: 'h1',
    guestName: 'Ana Pérez',
    guestEmail: 'ana@example.com',
    guestPhone: '+18095550000',
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
    rooms: [{ roomType: 'double', adults: 2, quantity: 2 }],
  }

  it('key solo en la líder; paymentDeadlineAt en todas; replay devuelve el grupo entero con 200', async () => {
    const db = makeDb({ rooms: rooms(), bookingConfig: [{ id: 'bc1', hotelId: 'h1', enabled: true, pendingTtlMinutes: 30 }] })
    const { deps, calls } = makeStripe()
    const body = { ...groupBody, idempotencyKey: 'group-key-1' }
    const before = Date.now()

    const first = await createPublicBookingGroup(db.orm, body, undefined, undefined, deps, undefined, stripeUrls, extraDepsFor(db))
    expect(first.status).toBe(201)
    expect(db.tables.Reservations).toHaveLength(2)
    expect(db.tables.Groups).toHaveLength(1)
    const withKey = db.tables.Reservations.filter((r: any) => r.idempotencyKey === 'group-key-1')
    expect(withKey).toHaveLength(1)
    expect(withKey[0].id).toBe(first.body.reservationId)
    for (const r of db.tables.Reservations) {
      const deadline = new Date(r.paymentDeadlineAt).getTime()
      expect(deadline).toBeGreaterThanOrEqual(before + 30 * MINUTE)
      expect(deadline).toBeLessThanOrEqual(Date.now() + 30 * MINUTE)
    }

    const second = await createPublicBookingGroup(db.orm, body, undefined, undefined, deps, undefined, stripeUrls, extraDepsFor(db))
    expect(second.status).toBe(200)
    expect(second.body.replayed).toBe(true)
    expect(db.tables.Reservations).toHaveLength(2)
    expect(db.tables.Groups).toHaveLength(1)
    expect(second.body.reservationId).toBe(first.body.reservationId)
    expect(second.body.accessToken).toBe(first.body.accessToken)
    expect(second.body.group.id).toBe(first.body.group.id)
    expect(second.body.reservations.map((r: any) => r.id)).toEqual(first.body.reservations.map((r: any) => r.id))
    expect(second.body.reservations.every((r: any) => r.roomType === 'double')).toBe(true)
    expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl)
    // Checkout sobre la líder por el total del grupo, las dos veces.
    expect(calls).toEqual([first.body.reservationId, first.body.reservationId])
    expect(second.body.totalBreakdown?.total).toBe(first.body.totalBreakdown.total)
  })

  it('grupo sin key → dos POST crean dos grupos (comportamiento previo)', async () => {
    const db = makeDb({ rooms: [
      ...rooms(),
      { id: 'r4', hotelId: 'h1', type: 'double', number: '103', basePrice: 100, capacity: 2, status: 'available' },
      { id: 'r5', hotelId: 'h1', type: 'double', number: '104', basePrice: 100, capacity: 2, status: 'available' },
    ] })
    const a = await createPublicBookingGroup(db.orm, groupBody)
    const b = await createPublicBookingGroup(db.orm, groupBody)
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(db.tables.Groups).toHaveLength(2)
    expect(db.tables.Reservations).toHaveLength(4)
  })
})
