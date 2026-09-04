// bookingengine/tests/public-booking-composition.test.ts — Feature adultos+niños+edades +
// Requerimiento 2 (capacidad por tipo), 2026-09-03, para el flujo de UNA habitación
// (`createPublicBookingDirect`). El flujo de grupo tiene su propia cobertura en
// `public-booking-group.test.ts`; este archivo no existía para el flujo individual — se agrega
// acá porque la revisión del Requerimiento 2 encontró un bug de regresión en este mismo código
// (ver primer describe) que un test habría atrapado antes de llegar a prod.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'

const HOTEL_ID = 'h1'

/** Mismo patrón de ORM en memoria que `public-booking-group.test.ts`. */
function makeDb(seed: { rooms?: any[]; reservations?: any[]; assignments?: any[]; rates?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    Reservations: seed.reservations ?? [],
    RoomBlocks: [],
    RoomRates: seed.rates ?? [],
    SeasonAssignments: seed.assignments ?? [],
    RateOverrides: [],
    Seasons: [],
    Guests: [],
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

/** Repo mínimo que solo responde `room_type_capacity` — los tests de esta sección no mandan
 *  `childrenAges`, así que `child_policy` nunca se consulta (gateado por `hasChildrenAges`). */
function roomTypeCapacityConfigRepo(value: unknown) {
  return { findOne: async (filter: any) => (filter.key === 'room_type_capacity' ? { hotelId: filter.hotelId, key: 'room_type_capacity', value } : null) } as any
}

describe('createPublicBookingDirect — capacidad legacy (regresión encontrada en revisión Req. 2)', () => {
  it('caller SIN childrenAges: el conteo plano `children` sigue contando para capacidad (bug: antes se ignoraba)', async () => {
    const { orm } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 100, status: 'available' }],
    })
    // 2 adultos + 2 niños (plano, sin edades) = 4 huéspedes físicos contra capacity=2 → debe rechazar.
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, children: 2 })
    expect(res.status).toBe(409)
  })

  it('caller SIN childrenAges: adults+children que SÍ entran en la capacidad se aceptan normal', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'family', capacity: 4, basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'family', adults: 2, children: 2 })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].adults).toBe(2)
    expect(tables.Reservations[0].children).toBe(2)
  })
})

describe('createPublicBookingDirect — childrenAges (composición del huésped)', () => {
  it('niño libre (no consume plaza): no bloquea capacidad ni sube el precio', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 100, status: 'available' }],
    })
    const policy = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } }
    const cfg = { findOne: async (f: any) => (f.key === 'child_policy' ? policy : null) } as any
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [2] }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].childrenAges).toEqual([2])
    expect(tables.Reservations[0].children).toBe(1) // 0 paying + 1 free
    // Requerimiento 12 (edad de referencia, 2026-09-03) — la edad se ancla al checkIn de la reserva,
    // para poder proyectarla si más adelante se reagenda a otra fecha.
    expect(tables.Reservations[0].childrenAgesAsOf).toBe(BASE_BODY.checkIn)
  })

  it('caller sin childrenAges (legacy): NO setea childrenAgesAsOf (nada que proyectar)', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, children: 1 })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].childrenAgesAsOf).toBeFalsy()
  })

  it('acceptChildren:false → 400, no crea la reserva', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 2, basePrice: 100, status: 'available' }],
    })
    const policy = { hotelId: HOTEL_ID, key: 'child_policy', value: { acceptChildren: false, maxChildAge: 12, maxFreeAge: 3 } }
    const cfg = { findOne: async (f: any) => (f.key === 'child_policy' ? policy : null) } as any
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [5] }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(400)
    expect(tables.Reservations).toHaveLength(0)
  })
})

describe('createPublicBookingDirect — Requerimiento 2: capacidad por tipo (room_type_capacity)', () => {
  it('política del tipo reemplaza la capacidad de la habitación física', async () => {
    // La habitación física dice capacity=6 (sobra), pero el TIPO "double" está configurado a 2.
    const { orm } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 6, basePrice: 100, status: 'available' }],
    })
    const cfg = roomTypeCapacityConfigRepo({ double: { capacity: 2, maxAdults: 2, maxChildren: 0 } })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 3, children: 0 }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    // 3 adultos > maxAdults del tipo (2) → rechazado aunque la habitación física admita 6.
    expect(res.status).toBe(409)
  })

  it('maxChildren del tipo aplica aunque el caller no mande edades (conteo plano)', async () => {
    const { orm } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 6, basePrice: 100, status: 'available' }],
    })
    const cfg = roomTypeCapacityConfigRepo({ double: { capacity: 6, maxAdults: 2, maxChildren: 1 } })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, children: 2 }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(409)
  })

  // Requerimiento 6 — caso explícito del pedido: cumple maxAdults Y maxChildren por separado,
  // pero la SUMA (capacity total) no entra. Ninguno de los tres límites sustituye a los otros dos.
  it('cumple maxAdults y maxChildren individualmente, pero excede capacity total → rechazada', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 6, basePrice: 100, status: 'available' }],
    })
    // Tipo: capacity=4, maxAdults=3, maxChildren=2 — 3 adultos + 2 niños con plaza cumple los dos
    // máximos individuales (3<=3, 2<=2) pero la ocupación efectiva (5) supera capacity=4.
    const cfg = roomTypeCapacityConfigRepo({ double: { capacity: 4, maxAdults: 3, maxChildren: 2 } })
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'double', adults: 3, childrenAges: [5, 6] },
      undefined, undefined, undefined, undefined, undefined, { config: cfg },
    )
    expect(res.status).toBe(409)
    expect(tables.Reservations).toHaveLength(0)
  })

  it('sin política para ese tipo: cae a la habitación física (retrocompatible)', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'suite', capacity: 4, basePrice: 100, status: 'available' }],
    })
    // Configuración existe pero solo para "double" — "suite" no está ahí.
    const cfg = roomTypeCapacityConfigRepo({ double: { capacity: 2, maxAdults: 2, maxChildren: 0 } })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'suite', adults: 4, children: 0 }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].adults).toBe(4)
  })

  it('el mensaje de error 409 usa la capacidad del TIPO, no la de la habitación física', async () => {
    const { orm } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, roomId: 'r1', type: 'double', capacity: 6, basePrice: 100, status: 'available' }],
    })
    const cfg = roomTypeCapacityConfigRepo({ double: { capacity: 2, maxAdults: 2, maxChildren: 0 } })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomId: 'r1', adults: 5, children: 0 }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('hasta 2 huésped')
  })
})

// ─── Requerimiento 5 (Cálculo de ocupación, 2026-09-03) ─────────────────────────────────────
// Prueba END-TO-END (no solo la matemática pura de child-composition.test.ts) que la ocupación
// CHARGEABLE calculada por `resolveChildComposition` es la que efectivamente cotiza la reserva:
// se cargan tarifas DISTINTAS por ocupación (2 vs 3) y se verifica que cada escenario cobra la
// tarifa de la ocupación efectiva correcta — no la de los adultos "tal cual los tipeó" el huésped
// ni un promedio. Escenarios pedidos explícitamente en la revisión del Requerimiento 5.
describe('createPublicBookingDirect — Requerimiento 5: ocupación efectiva usada para el PRECIO', () => {
  const POLICY_VALUE = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }
  function childPolicyConfigRepo() {
    return { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL_ID, key: 'child_policy', value: POLICY_VALUE } : null) } as any
  }

  // 1 noche, misma fecha en las 3 filas de tarifa — el total sale IGUAL a la tarifa de la
  // ocupación elegida, sin tener que multiplicar por noches en cada aserción.
  const ONE_NIGHT = { ...BASE_BODY, checkIn: '2026-10-01', checkOut: '2026-10-02' }
  function dbWithOccupancyRates() {
    return makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 6, basePrice: 999, status: 'available' }],
      assignments: [{ hotelId: HOTEL_ID, date: '2026-10-01', season: 'alta' }],
      rates: [
        { hotelId: HOTEL_ID, roomType: 'double', occupancy: 1, season: 'alta', channel: '', price: 100 },
        { hotelId: HOTEL_ID, roomType: 'double', occupancy: 2, season: 'alta', channel: '', price: 200 },
        { hotelId: HOTEL_ID, roomType: 'double', occupancy: 3, season: 'alta', channel: '', price: 300 },
      ],
    })
  }

  const scenarios: Array<{ label: string; adults: number; childrenAges: number[]; wantOccupancy: number; wantAdults: number; wantChildren: number; wantTotal: number }> = [
    { label: '2 adultos + niño ≤ maxFreeAge → ocupación efectiva 2', adults: 2, childrenAges: [2], wantOccupancy: 2, wantAdults: 2, wantChildren: 1, wantTotal: 200 },
    { label: '1 adulto + niño > maxFreeAge → ocupación efectiva 2', adults: 1, childrenAges: [8], wantOccupancy: 2, wantAdults: 1, wantChildren: 1, wantTotal: 200 },
    { label: '2 adultos + niño > maxFreeAge → ocupación efectiva 3', adults: 2, childrenAges: [8], wantOccupancy: 3, wantAdults: 2, wantChildren: 1, wantTotal: 300 },
    { label: 'niño exactamente en maxFreeAge (3): libre → ocupación efectiva 2', adults: 2, childrenAges: [3], wantOccupancy: 2, wantAdults: 2, wantChildren: 1, wantTotal: 200 },
    { label: 'niño exactamente en maxChildAge (12): con plaza → ocupación efectiva 3', adults: 2, childrenAges: [12], wantOccupancy: 3, wantAdults: 2, wantChildren: 1, wantTotal: 300 },
    { label: 'edad superior a maxChildAge (13): se trata como adulto → ocupación efectiva 3', adults: 2, childrenAges: [13], wantOccupancy: 3, wantAdults: 3, wantChildren: 0, wantTotal: 300 },
  ]

  for (const s of scenarios) {
    it(s.label, async () => {
      const { orm, tables } = dbWithOccupancyRates()
      const res = await createPublicBookingDirect(
        orm, { ...ONE_NIGHT, roomType: 'double', adults: s.adults, childrenAges: s.childrenAges },
        undefined, undefined, undefined, undefined, undefined, { config: childPolicyConfigRepo() },
      )
      expect(res.status).toBe(201)
      const reservation = tables.Reservations[0]
      expect(reservation.adults).toBe(s.wantAdults)
      expect(reservation.children).toBe(s.wantChildren)
      // La prueba de fondo: el TOTAL cobrado usó la tarifa de `wantOccupancy`, no otra — si el
      // cálculo de ocupación divergiera (ej. usara adultos tipeados en vez del efectivo), el
      // total saldría 100/200/300 en el orden equivocado y esta aserción lo detecta.
      expect(reservation.totalAmount).toBe(s.wantTotal)
      // Requerimiento 11 (Persistencia, 2026-09-03) — `childrenAges` persiste TAL CUAL se
      // declaró, sin filtrar a quien terminó reclasificado como adulto: es la auditoría de lo
      // que el huésped tipeó, distinta de `children` (cuántos siguen contando como niño). La
      // relación nunca es arbitraria: `children` siempre es <= `childrenAges.length`, y la
      // diferencia es exactamente la cantidad de reclasificados (acá, 0 o 1).
      expect(reservation.childrenAges).toEqual(s.childrenAges)
      expect(reservation.children).toBeLessThanOrEqual(reservation.childrenAges.length)
    })
  }

  it('hotel con acceptChildren=false: rechaza ANTES de calcular ninguna ocupación (400, no crea nada)', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const cfg = { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL_ID, key: 'child_policy', value: { ...POLICY_VALUE, acceptChildren: false } } : null) } as any
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 2, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: cfg },
    )
    expect(res.status).toBe(400)
    expect(tables.Reservations).toHaveLength(0)
  })
})
