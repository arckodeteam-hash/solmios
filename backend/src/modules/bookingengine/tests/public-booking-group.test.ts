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
function makeDb(seed: { rooms?: any[]; reservations?: any[]; promoCodes?: any[]; assignments?: any[]; rates?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: seed.reservations ?? [],
    RoomBlocks: [],
    RoomRates: seed.rates ?? [],
    SeasonAssignments: seed.assignments ?? [],
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

describe('Tarea 3.4 (corrección 2026-08-25) — instantConfirmation apagada → approvalStatus:"pending" (grupo)', () => {
  it('TODAS las reservas del grupo nacen approvalStatus:"pending" si el hotel apagó confirmación instantánea', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' },
        { id: 'r-standard', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const bookingConfig = { findOne: async () => ({ hotelId: HOTEL_ID, enabled: true, instantConfirmation: false }) }
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'standard', adults: 2, quantity: 1 },
      ],
    }, undefined, undefined, fakeStripe as any, undefined, stripeUrls, { bookingConfig: bookingConfig as any })

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    expect(tables.Reservations.every((r: any) => r.approvalStatus === 'pending')).toBe(true)
  })

  it('instantConfirmation=true → approvalStatus queda undefined', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-deluxe', hotelId: HOTEL_ID, type: 'deluxe', capacity: 2, basePrice: 150, status: 'available' }],
    })
    const bookingConfig = { findOne: async () => ({ hotelId: HOTEL_ID, enabled: true, instantConfirmation: true }) }
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'deluxe', adults: 2, quantity: 1 }],
    }, undefined, undefined, fakeStripe as any, undefined, stripeUrls, { bookingConfig: bookingConfig as any })

    expect(res.status).toBe(201)
    expect(tables.Reservations[0].approvalStatus).toBeUndefined()
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

// ─── Feature adultos+niños+edades (2026-09-02) — cada línea del grupo declara sus propios niños ──
describe('createPublicBookingGroup — childrenAges por línea', () => {
  function configRepo(policyRow?: any) {
    return { findOne: async (filter: any) => (filter.key === 'child_policy' ? (policyRow ?? null) : null) }
  }

  it('cada habitación del grupo lleva SUS propias edades, calculadas contra la política del hotel', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 4, basePrice: 100, status: 'available' },
        { id: 'r-b', hotelId: HOTEL_ID, type: 'familiar', capacity: 4, basePrice: 100, status: 'available' },
      ],
    })
    const policy = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } }
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'familiar', adults: 2, quantity: 1, childrenAges: [2] }, // niño libre, no consume plaza
        { roomType: 'familiar', adults: 2, quantity: 1, childrenAges: [8] }, // niño con plaza
      ],
    }, undefined, undefined, undefined, undefined, undefined, { config: configRepo(policy) } as any)

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    // Línea 1 (niño libre): sigue costando "para 2" — 2 noches × $100 = $200.
    expect(byRoom['r-a'].childrenAges).toEqual([2])
    expect(byRoom['r-a'].totalAmount).toBe(200)
    // Línea 2 (niño con plaza): cotiza "para 3" — sin tarifas cargadas cae al basePrice × noches
    // igual (el fallback no distingue ocupación), pero la composición sigue quedando registrada.
    expect(byRoom['r-b'].childrenAges).toEqual([8])
    expect(byRoom['r-b'].adults).toBe(2)
    expect(byRoom['r-b'].children).toBe(1)
    // Requerimiento 12 (edad de referencia, 2026-09-03) — cada línea con edades ancla su propio
    // `childrenAgesAsOf` al checkIn del grupo, para poder proyectar si se reagenda esa reserva.
    expect(byRoom['r-a'].childrenAgesAsOf).toBe(BASE_BODY.checkIn)
    expect(byRoom['r-b'].childrenAgesAsOf).toBe(BASE_BODY.checkIn)
  })

  it('hotel con "aceptar niños" apagado → 400, ninguna reserva se crea', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 4, basePrice: 100, status: 'available' }],
    })
    const policy = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: false, maxChildAge: 12, maxFreeAge: 3 } }
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'familiar', adults: 2, quantity: 1, childrenAges: [8] }],
    }, undefined, undefined, undefined, undefined, undefined, { config: configRepo(policy) } as any)

    expect(res.status).toBe(400)
    expect(tables.Reservations).toHaveLength(0)
  })

  it('respeta maxChildren de la habitación aunque la capacidad total alcance', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, maxAdults: 2, maxChildren: 1, basePrice: 100, status: 'available' }],
    })
    const policy = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 0 } }
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'familiar', adults: 2, quantity: 1, childrenAges: [5, 6] }], // 2 niños con plaza, maxChildren=1
    }, undefined, undefined, undefined, undefined, undefined, { config: configRepo(policy) } as any)

    expect(res.status).toBe(409)
    expect(tables.Reservations).toHaveLength(0)
  })

  it('sin `childrenAges` en ninguna línea (caller legacy): cotiza exactamente como antes, sin leer política', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 4, basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'familiar', adults: 3, quantity: 1 }],
    })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].childrenAges).toEqual([])
    expect(tables.Reservations[0].adults).toBe(3)
    expect(tables.Reservations[0].childrenAgesAsOf).toBeFalsy()
  })

  // Requerimiento 10 (Varias habitaciones, 2026-09-03) — quantity>1 combinado con childrenAges:
  // ninguna de las N reservas físicas que expande esa línea puede perder la composición.
  it('quantity=3 con childrenAges: las TRES habitaciones físicas conservan la MISMA composición completa', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 100, status: 'available' },
        { id: 'r-b', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 100, status: 'available' },
        { id: 'r-c', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 100, status: 'available' },
      ],
    })
    const policy = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } }
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'familiar', adults: 2, quantity: 3, childrenAges: [2, 8] }], // 1 libre + 1 con plaza
    }, undefined, undefined, undefined, undefined, undefined, { config: configRepo(policy) } as any)

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(3)
    for (const r of tables.Reservations) {
      expect(r.adults).toBe(2)
      expect(r.childrenAges).toEqual([2, 8])
      expect(r.children).toBe(2) // 1 libre + 1 con plaza, ninguno se perdió al expandir
    }
    // Ninguna de las 3 comparte roomId — son 3 UNIDADES reales, no una fila repetida.
    expect(new Set(tables.Reservations.map((r: any) => r.roomId)).size).toBe(3)
  })
})

// ─── Requerimiento 10 (Varias habitaciones, 2026-09-03) ─────────────────────────────────────
// Una línea inválida NO puede reservar silenciosamente las demás líneas válidas del mismo
// pedido: la resolución de TODAS las líneas ocurre ANTES de crear ninguna reserva (el loop de
// `createPublicBookingGroup` corta con `return` apenas una línea falla), así que el pedido entero
// es atómico — o entran todas las habitaciones pedidas, o no se crea ninguna.
describe('createPublicBookingGroup — una línea inválida aborta TODO el pedido (no reserva silenciosamente)', () => {
  it('línea 1 válida + línea 2 sin capacidad → 409 y CERO reservas, ni siquiera la línea 1 válida', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'deluxe', capacity: 4, basePrice: 150, status: 'available' },
        { id: 'r-b', hotelId: HOTEL_ID, type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 }, // línea 1: perfectamente válida
        { roomType: 'standard', adults: 4, quantity: 1 }, // línea 2: 4 adultos no entran en capacity=2
      ],
    })
    expect(res.status).toBe(409)
    expect(tables.Reservations).toHaveLength(0) // NO quedó la línea 1 "a medias" reservada
    expect(tables.Groups).toHaveLength(0)
  })

  it('línea 1 válida + línea 2 con niño mayor a maxChildren del tipo → 409 y CERO reservas', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'deluxe', capacity: 4, basePrice: 150, status: 'available' },
        { id: 'r-b', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, maxAdults: 2, maxChildren: 1, basePrice: 100, status: 'available' },
      ],
    })
    const policy = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 0 } }
    const configRepo = { findOne: async (f: any) => (f.key === 'child_policy' ? policy : null) }
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 }, // línea 1: válida
        { roomType: 'familiar', adults: 2, quantity: 1, childrenAges: [5, 6] }, // línea 2: 2 con plaza > maxChildren=1
      ],
    }, undefined, undefined, undefined, undefined, undefined, { config: configRepo } as any)
    expect(res.status).toBe(409)
    expect(tables.Reservations).toHaveLength(0)
  })

  it('línea 1 válida + línea 2 de tipo inexistente → 404 y CERO reservas', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-a', hotelId: HOTEL_ID, type: 'deluxe', capacity: 4, basePrice: 150, status: 'available' }],
    })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [
        { roomType: 'deluxe', adults: 2, quantity: 1 },
        { roomType: 'inexistente', adults: 2, quantity: 1 },
      ],
    })
    expect(res.status).toBe(404)
    expect(tables.Reservations).toHaveLength(0)
  })
})

describe('createPublicBookingGroup — Requerimiento 2: capacidad por tipo (room_type_capacity)', () => {
  function roomTypeCapacityConfigRepo(value: unknown) {
    return { findOne: async (filter: any) => (filter.key === 'room_type_capacity' ? { hotelId: filter.hotelId, key: 'room_type_capacity', value } : null) }
  }

  it('política del tipo reemplaza la capacidad física en TODAS las líneas de ese tipo', async () => {
    const { orm } = makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 100, status: 'available' },
        { id: 'r-b', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 100, status: 'available' },
      ],
    })
    const cfg = roomTypeCapacityConfigRepo({ familiar: { capacity: 2, maxAdults: 2, maxChildren: 0 } })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'familiar', adults: 3, quantity: 1 }],
    }, undefined, undefined, undefined, undefined, undefined, { config: cfg } as any)
    // 3 adultos > maxAdults del tipo (2), aunque la habitación física admita 6.
    expect(res.status).toBe(409)
  })

  it('aplica aunque ninguna línea mande childrenAges (conteo plano de children)', async () => {
    const { orm } = makeDb({
      rooms: [{ id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 100, status: 'available' }],
    })
    const cfg = roomTypeCapacityConfigRepo({ familiar: { capacity: 6, maxAdults: 2, maxChildren: 1 } })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'familiar', adults: 2, quantity: 1, children: 2 }],
    }, undefined, undefined, undefined, undefined, undefined, { config: cfg } as any)
    expect(res.status).toBe(409)
  })

  it('sin política para ese tipo: cae a la capacidad de la habitación física', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r-a', hotelId: HOTEL_ID, type: 'suite', capacity: 4, basePrice: 100, status: 'available' }],
    })
    const cfg = roomTypeCapacityConfigRepo({ familiar: { capacity: 2, maxAdults: 2, maxChildren: 0 } })
    const res = await createPublicBookingGroup(orm, {
      ...BASE_BODY,
      rooms: [{ roomType: 'suite', adults: 4, quantity: 1 }],
    }, undefined, undefined, undefined, undefined, undefined, { config: cfg } as any)
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].adults).toBe(4)
  })
})

// ─── Requerimiento 5 (Cálculo de ocupación, 2026-09-03) — multi-habitación ──────────────────
// Mismo tipo de prueba end-to-end que `public-booking-composition.test.ts` (flujo individual),
// acá para el GRUPO: cada línea del carrito trae SU PROPIA composición y tiene que cotizar según
// SU ocupación efectiva — no la del hotel promediada, ni la de otra línea del mismo grupo.
describe('createPublicBookingGroup — Requerimiento 5: ocupación efectiva por línea, con edades distintas', () => {
  const POLICY_VALUE = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }
  function childPolicyConfigRepo() {
    return { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL_ID, key: 'child_policy', value: POLICY_VALUE } : null) } as any
  }
  const ONE_NIGHT = { ...BASE_BODY, checkIn: '2026-10-01', checkOut: '2026-10-02' }

  it('2 habitaciones del mismo tipo, edades distintas: cada una cotiza SU ocupación efectiva', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 999, status: 'available' },
        { id: 'r-b', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 999, status: 'available' },
      ],
      assignments: [{ hotelId: HOTEL_ID, date: '2026-10-01', season: 'alta' }],
      rates: [
        { hotelId: HOTEL_ID, roomType: 'familiar', occupancy: 2, season: 'alta', channel: '', price: 200 },
        { hotelId: HOTEL_ID, roomType: 'familiar', occupancy: 3, season: 'alta', channel: '', price: 300 },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...ONE_NIGHT,
      rooms: [
        // Línea A: 2 adultos + niño de 2 (≤ maxFreeAge, libre) → ocupación efectiva 2 → $200.
        { roomType: 'familiar', adults: 2, quantity: 1, childrenAges: [2] },
        // Línea B: 2 adultos + niño de 8 (con plaza) → ocupación efectiva 3 → $300.
        { roomType: 'familiar', adults: 2, quantity: 1, childrenAges: [8] },
      ],
    }, undefined, undefined, fakeStripe as any, undefined, stripeUrls, { config: childPolicyConfigRepo() })

    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(2)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    expect(byRoom['r-a'].childrenAges).toEqual([2])
    expect(byRoom['r-a'].totalAmount).toBe(200) // niño libre no sube la ocupación
    expect(byRoom['r-b'].childrenAges).toEqual([8])
    expect(byRoom['r-b'].totalAmount).toBe(300) // niño con plaza SÍ la sube
    // El total del Group es la SUMA de ambas líneas a su propio precio — no 2×200 ni 2×300.
    expect(tables.Groups[0].totalAmount).toBe(500)
  })

  it('niño mayor a maxChildAge en una línea: esa línea lo cuenta como adulto, la otra línea no se contamina', async () => {
    const { orm, tables } = makeDb({
      rooms: [
        { id: 'r-a', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 999, status: 'available' },
        { id: 'r-b', hotelId: HOTEL_ID, type: 'familiar', capacity: 6, basePrice: 999, status: 'available' },
      ],
      assignments: [{ hotelId: HOTEL_ID, date: '2026-10-01', season: 'alta' }],
      rates: [
        { hotelId: HOTEL_ID, roomType: 'familiar', occupancy: 2, season: 'alta', channel: '', price: 200 },
        { hotelId: HOTEL_ID, roomType: 'familiar', occupancy: 3, season: 'alta', channel: '', price: 300 },
      ],
    })
    const res = await createPublicBookingGroup(orm, {
      ...ONE_NIGHT,
      rooms: [
        // Línea A: 2 adultos + "niño" de 15 (> maxChildAge) → se cuenta como adulto → ocupación 3.
        { roomType: 'familiar', adults: 2, quantity: 1, childrenAges: [15] },
        // Línea B: 2 adultos, sin niños → ocupación 2. Si el cálculo se filtrara entre líneas,
        // acá también saldría 3 — el bug que este test existe para atrapar.
        { roomType: 'familiar', adults: 2, quantity: 1 },
      ],
    }, undefined, undefined, fakeStripe as any, undefined, stripeUrls, { config: childPolicyConfigRepo() })

    expect(res.status).toBe(201)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    expect(byRoom['r-a'].adults).toBe(3)
    expect(byRoom['r-a'].children).toBe(0)
    expect(byRoom['r-a'].totalAmount).toBe(300)
    expect(byRoom['r-b'].adults).toBe(2)
    expect(byRoom['r-b'].totalAmount).toBe(200)
  })
})
