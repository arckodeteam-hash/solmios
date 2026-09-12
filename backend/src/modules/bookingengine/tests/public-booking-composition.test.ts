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
function makeDb(seed: { rooms?: any[]; roomAmenities?: any[]; reservations?: any[]; assignments?: any[]; rates?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    RoomAmenities: seed.roomAmenities ?? [],
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

  it('caller sin childrenAges (legacy, MR-10 Opción A): children plano se sintetiza a maxChildAge y SÍ ancla childrenAgesAsOf', async () => {
    // MR-10 (#275): antes un caller con `children` plano no pasaba por el motor de niños (sin
    // edades, sin `childrenAgesAsOf`). Ahora cada niño se sintetiza a `maxChildAge` (niño con
    // plaza, el caso más caro) y sigue el MISMO camino que un caller con edades — incluida la
    // edad de referencia, para que un reagendado vuelva a cotizar con la misma base.
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, children: 1 })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].childrenAges).toEqual([17]) // DEFAULT_CHILD_POLICY.maxChildAge
    expect(tables.Reservations[0].children).toBe(1)
    expect(tables.Reservations[0].childrenAgesAsOf).toBe(BASE_BODY.checkIn)
  })

  it('caller sin childrenAges y children:0 → sin edades ni childrenAgesAsOf (nada que sintetizar)', async () => {
    const { orm, tables } = makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, children: 0 })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].childrenAges).toEqual([])
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

describe('REQ-03 (#235) — máximo de niños sin plaza por habitación', () => {
  /** maxFreeAge=3: las edades 1 y 2 son "libres" (no consumen plaza) — es a ellas a las que
   *  aplica `maxFreeChildrenPerRoom`. */
  const BASE_POLICY = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }
  function configRepo(value: unknown) {
    return { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL_ID, key: 'child_policy', value } : null) } as any
  }
  function db() {
    return makeDb({ rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 4, basePrice: 100, status: 'available' }] })
  }

  it('max=1 y 2 niños libres → 409 con motivo que nombra el máximo, sin crear la reserva', async () => {
    const { orm, tables } = db()
    const cfg = configRepo({ ...BASE_POLICY, maxFreeChildrenPerRoom: 1 })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [1, 2] }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('no consumen plaza')
    expect(res.body.error).toContain('1')
    expect(tables.Reservations).toHaveLength(0)
  })

  it('max=1 y 1 niño libre (capacidad ok) → se crea', async () => {
    const { orm, tables } = db()
    const cfg = configRepo({ ...BASE_POLICY, maxFreeChildrenPerRoom: 1 })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [1] }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(1)
    expect(tables.Reservations[0].childrenAges).toEqual([1])
  })

  it('política sin el campo (sin límite) y 2 niños libres → se crea', async () => {
    const { orm, tables } = db()
    const cfg = configRepo(BASE_POLICY)
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [1, 2] }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(1)
  })

  it('caller legacy (children plano, sin childrenAges): el tope no aplica — se crea', async () => {
    const { orm, tables } = db()
    const cfg = configRepo({ ...BASE_POLICY, maxFreeChildrenPerRoom: 1 })
    const res = await createPublicBookingDirect(orm, { ...BASE_BODY, roomType: 'double', adults: 2, children: 2 }, undefined, undefined, undefined, undefined, undefined, { config: cfg })
    expect(res.status).toBe(201)
    expect(tables.Reservations).toHaveLength(1)
    expect(tables.Reservations[0].children).toBe(2)
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

// ─── Tarea 22 (Cuna, 2026-09-08) — #292: la cuna es la amenidad `custom:cuna` de la habitación ──
// La cobertura completa del gate por habitación (precio, línea en `roomAmenities`, grupo) vive en
// `public-booking-crib.test.ts`; acá queda el contrato Sí/No + bebé del flujo de 1 habitación.
describe('createPublicBookingDirect — Tarea 22: cuna (simplificada 2026-09-09 a Sí/No)', () => {
  // maxBabyAge=1: edades 0-1 son bebé, 2-3 libre (no bebé), 4-12 con plaza.
  const BABY_POLICY = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1 }
  function childPolicyRepo(value: unknown = BABY_POLICY) {
    return { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL_ID, key: 'child_policy', value } : null) } as any
  }

  /** Una room 'double' que OFRECE cuna (`RoomAmenities` custom:cuna activa) — salvo `withCrib: false`. */
  function dbWithRoom(withCrib = true) {
    return makeDb({
      rooms: [{ id: 'r1', hotelId: HOTEL_ID, type: 'double', capacity: 6, basePrice: 100, status: 'available' }],
      roomAmenities: withCrib ? [{ id: 'r1-cuna', roomId: 'r1', amenityKey: 'custom:cuna', name: 'Cuna', price: 0, isActive: true }] : [],
    })
  }

  it('#341 — sin bebé en la composición: la cuna es una amenidad normal, se cumple si el tipo la ofrece', async () => {
    const { orm, tables } = dbWithRoom()
    const res = await createPublicBookingDirect(
      orm, {
        ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [8], // 8 > maxBabyAge=1, no es bebé
        needsCrib: true,
      },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo() },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(true)
    expect(tables.Reservations[0].cribCount).toBe(1)
  })

  it('tipo SIN custom:cuna: needsCrib se ignora aunque haya bebé y el body lo pida', async () => {
    const { orm, tables } = dbWithRoom(false)
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo() },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(false)
    expect(tables.Reservations[0].cribCount).toBe(0)
  })

  it('con un bebé y un tipo que ofrece custom:cuna: needsCrib true se persiste, cribCount siempre 1', async () => {
    const { orm, tables } = dbWithRoom()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo() },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(true)
    expect(tables.Reservations[0].cribCount).toBe(1)
  })

  // Simplificación del pedido: "no preguntar si desea una, dos o más cunas" — aunque el body
  // mande un cribCount explícito (cliente viejo/manipulado), el servidor lo ignora por completo.
  it('Sí/No únicamente: un cribCount enviado en el body NUNCA se usa — siempre queda en 1', async () => {
    const { orm, tables } = dbWithRoom()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true, cribCount: 9 },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo() },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].cribCount).toBe(1)
  })

  it('múltiples bebés: sigue siendo Sí/No — cribCount no escala con la cantidad de bebés', async () => {
    const { orm, tables } = dbWithRoom()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [0, 1], needsCrib: true },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo() },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].cribCount).toBe(1)
  })

  it('needsCrib false (o ausente): cribCount siempre 0, sin importar cribCount del body', async () => {
    const { orm, tables } = dbWithRoom()
    const res = await createPublicBookingDirect(
      orm, { ...BASE_BODY, roomType: 'double', adults: 2, childrenAges: [1], cribCount: 3 }, // sin needsCrib
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo() },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(false)
    expect(tables.Reservations[0].cribCount).toBe(0)
  })
})

// ─── Tarea "Cobro % niños" (2026-09-09, generalizada desde "Cobro 50% niños") ───────────────────
describe('createPublicBookingDirect — Tarea "Cobro % niños"', () => {
  // 1 noche, misma grilla que el describe de Requerimiento 5 (occupancy 1/2/3 = 100/200/300) —
  // reutilizada acá porque es exactamente lo que necesita el ejemplo del pedido ("1 adulto = $100").
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
  function childPolicyRepo(value: unknown) {
    return { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL_ID, key: 'child_policy', value } : null) } as any
  }
  // maxFreeAge=3, maxBabyAge=1: edad 0-1 bebé, 2-3 libre (no bebé), 4-12 con plaza.
  const BASE_POLICY = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1 }
  const POLICY_OFF = { ...BASE_POLICY, childrenDiscountEnabled: false, childrenRatePercent: 50 }
  const policyOn = (childrenRatePercent: number) => ({ ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent })

  it('regla deshabilitada (default): un niño con plaza sigue cotizando como siempre — CERO regresión', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(POLICY_OFF) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(200) // fila de ocupación=2 tal cual
    expect(tables.Reservations[0].childrenRatePercentApplied).toBeNull()
  })

  it('ejemplo LITERAL del pedido: tarifa 2 adultos $200 → $100/adulto, hotel configura 60% → niño paga $60', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 2, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(60)) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(260) // 200 + 60
    expect(tables.Reservations[0].childrenRatePercentApplied).toBe(60)
  })

  it('borde 1%: 1 adulto ($100) + 1 niño con plaza al 1% → niño $1, total $101', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(1)) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(101)
    expect(tables.Reservations[0].childrenRatePercentApplied).toBe(1)
  })

  it('50%: 1 adulto ($100) + 1 niño con plaza → niño $50, total $150', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(50)) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(150)
  })

  it('borde 100%: 1 adulto ($100) + 1 niño con plaza al 100% → niño paga igual que el adulto, total $200', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(100)) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(200)
    expect(tables.Reservations[0].childrenRatePercentApplied).toBe(100)
  })

  it('2 adultos ($200, tarifa de grupo) + 1 niño con plaza al 50% → niño = 50% de $100 (200/2) = $50, total $250', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 2, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(50)) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(250)
  })

  it('bebé (edad 1, ≤ maxBabyAge): NO recibe la regla — no consume plaza, sigue sin cargo', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [1] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(50)) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(100) // solo el adulto, occupancy=1
    expect(tables.Reservations[0].childrenRatePercentApplied).toBeNull() // ningún niño con plaza
  })

  it('niño libre (edad 3, ≤ maxFreeAge pero NO bebé): tampoco recibe la regla — sigue gratis', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [3] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(50)) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(100)
  })

  it('mezcla: 1 adulto + 1 bebé (gratis) + 1 niño con plaza (50%) → solo el que paga se descuenta', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [1, 8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(50)) },
    )
    expect(res.status).toBe(201)
    // adultsTotal=100 (occupancy=1, el bebé no cuenta para ocupación de precio) + 1 niño×50% de 100 = 150.
    expect(tables.Reservations[0].totalAmount).toBe(150)
  })

  it('caller legacy (contador `children` plano, sin edades) — MR-10 Opción A: cotiza como niño con plaza a maxChildAge, la regla SÍ aplica', async () => {
    // Antes de MR-10 (#275) este caller cotizaba la fila de ocupación=2 plana (200): el mismo
    // pedido daba dos totales según la puerta de entrada. Ahora el niño plano se sintetiza a
    // `maxChildAge` (con plaza) y paga el % del hotel igual que `childrenAges:[maxChildAge]`.
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, children: 1 },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(50)) },
    )
    expect(res.status).toBe(201)
    // adultsTotal=100 (ocupación=1) + 1 niño × 50 % de 100 = 150 — idéntico al caso con edades.
    expect(tables.Reservations[0].totalAmount).toBe(150)
    expect(tables.Reservations[0].childrenRatePercentApplied).toBe(50)
  })

  it('el resumen (totalBreakdown) usa el MISMO importe que queda persistido en la reserva', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo(policyOn(50)) },
    )
    expect(res.status).toBe(201)
    expect(res.body.totalBreakdown.total).toBe(tables.Reservations[0].totalAmount)
    expect(res.body.totalBreakdown.total).toBe(150)
  })

  it('un % fuera de [1,100] guardado en config (dato corrupto) se clampea, nunca rompe la reserva', async () => {
    const { orm, tables } = dbWithOccupancyRates()
    const res = await createPublicBookingDirect(
      orm, { ...ONE_NIGHT, roomType: 'double', adults: 1, childrenAges: [8] },
      undefined, undefined, undefined, undefined, undefined, { config: childPolicyRepo({ ...policyOn(500) }) },
    )
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].totalAmount).toBe(200) // clampeado a 100%
    expect(tables.Reservations[0].childrenRatePercentApplied).toBe(100)
  })
})
