// bookingengine/tests/public-booking-group.test.ts
//
// Tarea 10 (QA 2026-08-20, ampliada 2026-08-21) — reserva pública de VARIAS habitaciones (mismo
// tipo ×N y/o tipos distintos) en una sola operación. Cubre:
//   1. Happy path: tipos distintos combinados → 1 Group + N Reservations con el mismo groupId.
//   2. Mismo tipo ×N (el caso literal original: "Deluxe × 2").
//   3. Pedir más unidades de las que hay libres → 409 con el máximo real.
//   4. Techo defensivo (MAX_GROUP_UNITS).
//   5. Anti-doble-claim: 2 líneas del MISMO tipo (distinta ocupación) no se pueden llevar la
//      MISMA unidad física.
//   6. Promo se aplica UNA vez sobre el subtotal combinado, no por línea.
//   7. Stripe: 1 sola Checkout Session, sobre la reserva LÍDER, por el total combinado.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingGroup, MAX_GROUP_UNITS } from '../usecases/public-booking-group'

const HOTEL_ID = 'h1'

/** ORM en memoria REAL (mismo patrón que el e2e pricing↔bookingengine de esta sesión): las
 *  aserciones leen directo de `tables`, no de un mock por-tabla estático. */
function makeDb(seed: { rooms?: any[]; reservations?: any[]; promoCodes?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: seed.reservations ?? [],
    RoomBlocks: [],
    RoomRates: [],
    SeasonAssignments: [],
    PromoCodes: seed.promoCodes ?? [],
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
  checkOut: '2026-09-12', // 2 noches
}

const fakeStripe = {
  createReservationCheckout: async (reservationId: string, amount: number) => ({
    id: `cs_${reservationId}`, url: `https://stripe.test/checkout/${reservationId}?amount=${amount}`, payment_status: 'unpaid',
  }),
}
const stripeUrls = { successUrl: 'https://hotel.test/success', cancelUrl: 'https://hotel.test/cancel' }

describe('createPublicBookingGroup — tipos distintos combinados', () => {
  it('happy path: 1 Deluxe + 1 Standard → 1 Group + 2 Reservations, mismo groupId y accessToken', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-standard', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, undefined, undefined, fakeStripe as any, undefined, stripeUrls)

    expect(res.status).toBe(201)
    expect(tables.Groups).toHaveLength(1)
    expect(tables.Groups[0].totalRooms).toBe(2)
    // 2 noches: (150+80) × 2 = 460, sin impuestos (config vacío).
    expect(tables.Groups[0].totalAmount).toBe(460)
    expect(tables.Reservations).toHaveLength(2)
    const groupId = tables.Groups[0].id
    expect(tables.Reservations.every((r: any) => r.groupId === groupId)).toBe(true)
    // Mismo token para las 2 — el huésped consulta TODO su grupo con un solo link.
    const tokens = new Set(tables.Reservations.map((r: any) => r.accessToken))
    expect(tokens.size).toBe(1)
    expect(res.body.reservations).toHaveLength(2)
    expect(res.body.totalBreakdown.total).toBe(460)
  })

  it('1 sola Checkout Session, sobre la reserva LÍDER, por el TOTAL combinado', async () => {
    const { orm } = makeDb({
      rooms: [
        { id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-standard', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, undefined, undefined, fakeStripe as any, undefined, stripeUrls)

    expect(res.body.checkoutUrl).toContain('amount=460')
    expect(res.body.reservationId).toBe(res.body.reservations[0].id)
  })
})

describe('Tarea 3.1 — estimatedArrival llega a Reservations.notes (grupo)', () => {
  it('estimatedArrival aparece en el notes de TODAS las reservas del grupo', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-standard', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      estimatedArrival: '15:00',
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, undefined, undefined, fakeStripe as any, undefined, stripeUrls)

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    expect(tables.Reservations.every((r: any) => String(r.notes).includes('Llegada estimada: 15:00'))).toBe(true)
  })

  it('Corrección 2026-08-22 — specialRequests aparece en el notes de TODAS las reservas del grupo', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-standard', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      specialRequests: 'Necesitamos 2 cunas',
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, undefined, undefined, fakeStripe as any, undefined, stripeUrls)

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    expect(tables.Reservations.every((r: any) => String(r.notes).includes('Pedido especial: Necesitamos 2 cunas'))).toBe(true)
  })
})

describe('createPublicBookingGroup — mismo tipo ×N (caso literal original)', () => {
  it('3 Deluxe disponibles, pide ×2 → crea 1 reserva por unidad, 2 en total', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r1', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' },
        { id: 'r2', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' },
        { id: 'r3', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'deluxe', adults: 2, quantity: 2 }],
    })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    expect(new Set(tables.Reservations.map((r: any) => r.roomId)).size).toBe(2) // 2 unidades DISTINTAS
  })

  it('pide ×4 con solo 3 libres → 409 informando el máximo real (3)', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r1', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' },
        { id: 'r2', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' },
        { id: 'r3', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'deluxe', adults: 2, quantity: 4 }],
    })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(3)
    expect(tables.Reservations).toHaveLength(0) // nada se crea — todo o nada
    expect(tables.Groups).toHaveLength(0)
  })
})

describe('createPublicBookingGroup — techo defensivo y anti-doble-claim', () => {
  it(`rechaza pedir más de ${MAX_GROUP_UNITS} unidades en un solo POST`, async () => {
    const { orm } = makeDb({ rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' }] })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'deluxe', adults: 2, quantity: MAX_GROUP_UNITS + 1 }],
    })
    expect(res.status).toBe(400)
  })

  it('2 líneas del MISMO tipo (distinta ocupación) no se reparten la MISMA unidad física', async () => {
    // Solo 1 habitación deluxe físicamente — pedir "para 2 ×1" + "para 4 ×1" del mismo tipo
    // no puede satisfacerse con una sola unidad.
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'deluxe', capacity: 4, basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'deluxe', adults: 4, quantity: 1 },
      ],
    })
    expect(res.status).toBe(409)
    expect(tables.Reservations).toHaveLength(0)
  })

  it('con 2 unidades físicas, 2 líneas del mismo tipo SÍ se satisfacen (una por unidad)', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r1', hotelId: HOTEL_ID, type: 'deluxe', capacity: 4, basePrice: 100, status: 'available' },
        { id: 'r2', hotelId: HOTEL_ID, type: 'deluxe', capacity: 4, basePrice: 100, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'deluxe', adults: 4, quantity: 1 },
      ],
    })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    expect(new Set(tables.Reservations.map((r: any) => r.roomId)).size).toBe(2)
  })
})

describe('createPublicBookingGroup — promo se aplica UNA vez sobre el total combinado', () => {
  it('WELCOME10 (10%) descuenta sobre la suma de las 2 líneas, no por línea', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-standard', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
      promoCodes: [{ id: 'p1', hotelId: HOTEL_ID, code: 'WELCOME10', kind: 'percent', value: 10, active: true, uses: 0, maxUses: 100 }],
    })
    const promoCodesRepo = {
      findMany: (f: any) => orm.findMany('PromoCodes', f),
      findOne: (f: any) => orm.findOne('PromoCodes', f),
    }
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      promoCode: 'WELCOME10',
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, undefined, undefined, undefined, undefined, undefined, { promoCodes: promoCodesRepo as any })

    expect(res.status).toBe(201)
    // Subtotal 460 (ver test de arriba) - 10% = 414.
    expect(res.body.totalBreakdown.promoDiscount).toBe(46)
    expect(res.body.totalBreakdown.total).toBe(414)
    // El uso se incrementa UNA sola vez (no 2, una por habitación).
    expect(tables.PromoCodes[0].uses).toBe(1)
  })
})

describe('createPublicBookingGroup — capacidad física (defensa en profundidad)', () => {
  it('todas las unidades del tipo tienen capacidad insuficiente → 409, no crea nada', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'deluxe', adults: 4, quantity: 1 }],
    })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(0)
    expect(tables.Reservations).toHaveLength(0)
    expect(tables.Groups).toHaveLength(0)
  })

  it('capacidad MIXTA: solo cuenta/asigna las unidades que SÍ entran, no las más baratas sin más', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-chica', hotelId: HOTEL_ID, type: 'familiar', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r-grande-1', hotelId: HOTEL_ID, type: 'familiar', capacity: 4, basePrice: 150, status: 'available' },
        { id: 'r-grande-2', hotelId: HOTEL_ID, type: 'familiar', capacity: 4, basePrice: 160, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'familiar', adults: 4, quantity: 2 }],
    })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    // 'r-chica' (capacity 2) nunca podía entrar en la línea "para 4" aunque fuera la más barata.
    expect(tables.Reservations.map((r: any) => r.roomId).sort()).toEqual(['r-grande-1', 'r-grande-2'])
  })

  it('con capacidad mixta, pedir más unidades grandes de las que hay → 409 con el máximo real (no cuenta las chicas)', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-chica', hotelId: HOTEL_ID, type: 'familiar', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r-grande', hotelId: HOTEL_ID, type: 'familiar', capacity: 4, basePrice: 150, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'familiar', adults: 4, quantity: 2 }],
    })
    expect(res.status).toBe(409)
    expect(res.body.available).toBe(1) // solo 'r-grande' entra, no las 2 físicas del tipo
    expect(tables.Reservations).toHaveLength(0)
  })

  it('sin `capacity` en la fila (dato viejo/incompleto) no bloquea — mismo criterio que availability.ts', async () => {
    const { orm } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'deluxe', basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'deluxe', adults: 6, quantity: 1 }],
    })
    expect(res.status).toBe(201)
  })
})
