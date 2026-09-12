// bookingengine/tests/public-booking-crib-followups.test.ts — revisión del PR #329 (#292).
//
// Dos hallazgos:
//  [alias] la cuna se reconocía SOLO por el literal `custom:cuna`. El slug lo deriva el panel del
//     NOMBRE, así que un hotel que cargó "Cuna para bebé" (`custom:cuna_para_bebe`), "Crib"
//     (`custom:crib`) o "Berço" (`custom:berco`) no ofrecía la cuna ni la cobraba. Ahora la pide la
//     key canónica y la resuelve cualquier fila que `isCribAmenityKey` reconozca; la línea
//     persistida conserva la key REAL de la fila y `needsCrib` la sigue.
//  [cribUnavailable] cuna pedida con bebé pero la unidad asignada no la ofrece → antes: reserva sin
//     cuna, sin nota, sólo `logger.warn`. Ahora: línea en `notes`, `cribUnavailable` persistido y
//     expuesto en la respuesta pública (POST y GET) para que el widget avise al huésped. La
//     asignación NO cambia.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createPublicBookingDirect, CRIB_UNAVAILABLE_NOTE } from '../usecases/public-booking'
import { createPublicBookingGroup } from '../usecases/public-booking-group'
import { getPublicReservation } from '../usecases/public-reservation'
import { CRIB_AMENITY_KEY, hasCribLine, resolveRoomAmenityLines, roomOffersAll } from '../usecases/public-room-amenities'

const HOTEL_ID = 'h1'

/** Mismo ORM en memoria que `public-booking-crib.test.ts`. */
function makeDb(seed: { rooms?: any[]; roomAmenities?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Rooms: seed.rooms ?? [],
    RoomAmenities: seed.roomAmenities ?? [],
    Reservations: [], ReservationAddons: [], RoomBlocks: [], RoomRates: [], SeasonAssignments: [],
    RateOverrides: [], Seasons: [], PromoCodes: [], Guests: [], Groups: [], Configuration: [],
  }
  const t = (name: string) => (tables[name] ??= [])
  const matches = (row: any, filter: any = {}) => Object.entries(filter).every(([k, v]) => row[k] === v)
  const orm: any = {
    findMany: async (table: string, filter: any = {}) => t(table).filter((r) => matches(r, filter)),
    findOne: async (table: string, filter: any = {}) => t(table).find((r) => matches(r, filter)) ?? null,
    findById: async (table: string, id: string) => t(table).find((r) => r.id === id) ?? null,
    create: async (table: string, data: any) => { const row = { id: data.id || crypto.randomUUID(), ...data }; t(table).push(row); return row },
    update: async (table: string, id: string, patch: any) => { const row = t(table).find((r) => r.id === id); if (row) Object.assign(row, patch); return row },
    updateMany: async (table: string, filter: any, patch: any) => { const rows = t(table).filter((r) => matches(r, filter)); for (const r of rows) Object.assign(r, patch); return rows.length },
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
  }
  return { orm, tables }
}

const BASE_BODY = { hotelId: HOTEL_ID, guestName: 'Ana Pérez', guestEmail: 'ana@example.com', guestPhone: '+18095550000', checkIn: '2026-09-10', checkOut: '2026-09-12' }
const BABY_POLICY = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1 }
const childPolicyDeps = () => ({ config: { findOne: async (f: any) => (f.key === 'child_policy' ? { hotelId: HOTEL_ID, key: 'child_policy', value: BABY_POLICY } : null) } as any })
const am = (roomId: string, amenityKey: string, extra: any = {}) => ({ id: `${roomId}-${amenityKey}`, roomId, amenityKey, isActive: true, name: '', price: 0, ...extra })
const room = (id: string, type: string, basePrice: number) => ({ id, hotelId: HOTEL_ID, type, capacity: 4, basePrice, status: 'available' })

const direct = (orm: any, body: any) => createPublicBookingDirect(orm, { ...BASE_BODY, ...body }, undefined, undefined, undefined, undefined, undefined, childPolicyDeps())
const group = (orm: any, body: any) => createPublicBookingGroup(orm, { ...BASE_BODY, ...body }, undefined, undefined, undefined, undefined, undefined, childPolicyDeps())

describe('[alias] la cuna se reconoce por nombre/slug, no sólo por custom:cuna', () => {
  it('helpers puros: roomOffersAll/resolveRoomAmenityLines aceptan custom:crib y "Cuna para bebé" cuando se pide la key canónica', () => {
    const crib = [am('r', 'custom:crib', { name: 'Crib', price: 12 })]
    const cunaBebe = [am('r', 'custom:cuna_para_bebe', { name: 'Cuna para bebé', price: 9 })]
    const renamed = [am('r', 'custom:extra_1', { name: 'Berço', price: 5 })]
    const cama = [am('r', 'custom:cama_extra', { name: 'Cama extra', price: 20 })]
    expect(roomOffersAll(crib, [CRIB_AMENITY_KEY])).toBe(true)
    expect(roomOffersAll(cunaBebe, [CRIB_AMENITY_KEY])).toBe(true)
    expect(roomOffersAll(renamed, [CRIB_AMENITY_KEY])).toBe(true)
    expect(roomOffersAll(cama, [CRIB_AMENITY_KEY])).toBe(false)
    // La línea conserva la key y el nombre REALES de la fila (no la canónica) y hasCribLine la ve.
    const { lines, total } = resolveRoomAmenityLines(crib, [CRIB_AMENITY_KEY], 1)
    expect(lines).toEqual([{ key: 'custom:crib', name: 'Crib', price: 12, quantity: 1, total: 12 }])
    expect(total).toBe(12)
    expect(hasCribLine(lines)).toBe(true)
    // Una key custom que NO es la cuna sigue resolviendo por igualdad exacta.
    expect(resolveRoomAmenityLines(cama, ['custom:cama_extra'], 1).lines[0]?.key).toBe('custom:cama_extra')
    expect(resolveRoomAmenityLines(cama, ['custom:cama'], 1).lines).toEqual([])
  })

  it('reserva directa: tipo con "Crib" (custom:crib, 12) + bebé + needsCrib → needsCrib true y la línea cobra custom:crib', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r-crib', 'double', 100)], roomAmenities: [am('r-crib', 'custom:crib', { name: 'Crib', price: 12 })] })
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.needsCrib).toBe(true)
    expect(saved.cribCount).toBe(1)
    expect(saved.roomAmenities).toEqual([{ key: 'custom:crib', name: 'Crib', price: 12, quantity: 1, total: 12 }])
    expect(saved.roomAmenitiesTotal).toBe(12)
    expect(res.body.totalBreakdown.total).toBe(212)
    expect(saved.notes).toContain('Cuna: solicitada')
    expect(saved.cribUnavailable).toBe(false)
    expect(res.body.cribUnavailable).toBeUndefined()
  })

  it('reserva directa: la key alias en el body con needsCrib:false se descarta igual que custom:cuna', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r-crib', 'double', 100)], roomAmenities: [am('r-crib', 'custom:cuna_para_bebe', { name: 'Cuna para bebé', price: 9 })] })
    const res = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: false, roomAmenities: [{ key: 'custom:cuna_para_bebe' }] })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].needsCrib).toBe(false)
    expect(tables.Reservations[0].roomAmenities).toEqual([])
    // y con needsCrib:true la misma key no duplica la línea.
    const res2 = await direct(orm, { roomType: 'double', adults: 2, childrenAges: [1], needsCrib: true, roomAmenities: [{ key: 'custom:cuna_para_bebe' }], checkIn: '2026-10-10', checkOut: '2026-10-11' })
    expect(res2.status).toBe(201)
    expect(tables.Reservations[1].roomAmenities).toHaveLength(1)
    expect(tables.Reservations[1].roomAmenities[0].key).toBe('custom:cuna_para_bebe')
    expect(tables.Reservations[1].needsCrib).toBe(true)
  })

  it('grupo: la línea con "Berço" (custom:berco) recibe la cuna con su precio', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r-berco', 'double', 100)], roomAmenities: [am('r-berco', 'custom:berco', { name: 'Berço', price: 7 })] })
    const res = await group(orm, { rooms: [{ roomType: 'double', adults: 2, childrenAges: [0], quantity: 1, needsCrib: true }] })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.needsCrib).toBe(true)
    expect(saved.roomAmenities[0]).toMatchObject({ key: 'custom:berco', name: 'Berço', price: 7 })
    expect(saved.cribUnavailable).toBe(false)
    expect(res.body.cribUnavailable).toBeUndefined()
  })
})

describe('[cribUnavailable] cuna pedida que la unidad asignada no ofrece', () => {
  it('reserva directa: nota en `notes`, `cribUnavailable` persistido y expuesto; la fila nace sin unidad (HAC-05)', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r-suite', 'suite', 150)], roomAmenities: [am('r-suite', 'wifi')] })
    const res = await direct(orm, { roomType: 'suite', adults: 2, childrenAges: [1], needsCrib: true })
    expect(res.status).toBe(201)
    const saved = tables.Reservations[0]
    expect(saved.roomId).toBeNull()
    expect(saved.roomType).toBe('suite')
    expect(saved.needsCrib).toBe(false)
    expect(saved.cribCount).toBe(0)
    expect(saved.roomAmenities).toEqual([])
    expect(saved.cribUnavailable).toBe(true)
    expect(saved.notes).toContain(CRIB_UNAVAILABLE_NOTE)
    expect(saved.notes).not.toContain('Cuna: solicitada')
    expect(res.body.cribUnavailable).toBe(true)
  })

  it('reserva directa: sin bebé el "sí" no cuenta como pedido → sin nota ni marca', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r-suite', 'suite', 150)] })
    const res = await direct(orm, { roomType: 'suite', adults: 2, needsCrib: true })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].cribUnavailable).toBe(false)
    expect(tables.Reservations[0].notes).not.toContain(CRIB_UNAVAILABLE_NOTE)
    expect(res.body.cribUnavailable).toBeUndefined()
  })

  it('reserva directa: roomId explícito sin cuna → misma marca (el path sin resolución por tipo también avisa)', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r-suite', 'suite', 150)] })
    const res = await direct(orm, { roomId: 'r-suite', adults: 2, childrenAges: [1], needsCrib: true })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].cribUnavailable).toBe(true)
    expect(res.body.cribUnavailable).toBe(true)
  })

  it('grupo: línea double (cuna) + línea suite (sin cuna), ambas con bebé + needsCrib → marca por FILA, nota con el tipo y respuesta del grupo', async () => {
    const { orm, tables } = makeDb({
      rooms: [room('r-double', 'double', 100), room('r-suite', 'suite', 150)],
      roomAmenities: [am('r-double', CRIB_AMENITY_KEY, { name: 'Cuna', price: 15 })],
    })
    const res = await group(orm, { rooms: [
      { roomType: 'double', adults: 2, childrenAges: [1], quantity: 1, needsCrib: true },
      { roomType: 'suite', adults: 2, childrenAges: [0], quantity: 1, needsCrib: true },
    ] })
    expect(res.status).toBe(201)
    const byRoom = Object.fromEntries(tables.Reservations.map((r: any) => [r.roomId, r]))
    expect(byRoom['r-double'].needsCrib).toBe(true)
    expect(byRoom['r-double'].cribUnavailable).toBe(false)
    expect(byRoom['r-suite'].needsCrib).toBe(false)
    expect(byRoom['r-suite'].cribUnavailable).toBe(true)
    expect(byRoom['r-suite'].notes).toContain(`${CRIB_UNAVAILABLE_NOTE} (suite)`)
    expect(byRoom['r-suite'].notes).toContain('Cuna: double')
    expect(res.body.cribUnavailable).toBe(true)
  })

  it('grupo: todas las unidades con cuna → sin marca ni nota', async () => {
    const { orm, tables } = makeDb({ rooms: [room('r-double', 'double', 100)], roomAmenities: [am('r-double', CRIB_AMENITY_KEY, { name: 'Cuna', price: 15 })] })
    const res = await group(orm, { rooms: [{ roomType: 'double', adults: 2, childrenAges: [1], quantity: 1, needsCrib: true }] })
    expect(res.status).toBe(201)
    expect(tables.Reservations[0].cribUnavailable).toBe(false)
    expect(tables.Reservations[0].notes).not.toContain(CRIB_UNAVAILABLE_NOTE)
    expect(res.body.cribUnavailable).toBeUndefined()
  })
})

describe('[cribUnavailable] GET /api/public/reservations/:id lo expone (la confirmación llega tras el redirect de Stripe)', () => {
  const VALID_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const prevSecret = process.env.BOOKING_TOKEN_SECRET
  beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = 'test-secret-fixed' })
  afterEach(() => { if (prevSecret === undefined) delete process.env.BOOKING_TOKEN_SECRET; else process.env.BOOKING_TOKEN_SECRET = prevSecret })

  const ormWith = (extra: Record<string, unknown>) => ({
    findMany: async (model: string, query: any) => {
      if (model === 'Reservations') return query?.id === 'res-1' ? [{ id: 'res-1', hotelId: 'h1', guestId: null, roomId: 'r1', accessToken: VALID_TOKEN, status: 'pending', checkIn: '2026-08-10', checkOut: '2026-08-12', totalAmount: 200, ...extra }] : []
      return []
    },
  })

  it('true con la marca (boolean o INTEGER 1 según el adapter); false sin ella y en filas viejas (null)', async () => {
    expect((await getPublicReservation(ormWith({ cribUnavailable: true }), 'res-1', VALID_TOKEN)).body.reservation.cribUnavailable).toBe(true)
    expect((await getPublicReservation(ormWith({ cribUnavailable: 1 }), 'res-1', VALID_TOKEN)).body.reservation.cribUnavailable).toBe(true)
    expect((await getPublicReservation(ormWith({ cribUnavailable: false }), 'res-1', VALID_TOKEN)).body.reservation.cribUnavailable).toBe(false)
    expect((await getPublicReservation(ormWith({ cribUnavailable: 0 }), 'res-1', VALID_TOKEN)).body.reservation.cribUnavailable).toBe(false)
    expect((await getPublicReservation(ormWith({}), 'res-1', VALID_TOKEN)).body.reservation.cribUnavailable).toBe(false)
  })
})
