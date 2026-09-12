// bookingengine/tests/public-booking-blocks-stopsell.test.ts
//
// El gate de disponibilidad no puede vivir solo en la lectura. `AvailabilityUseCase` ya no
// OFRECE habitaciones bloqueadas (`room_blocks`) ni tipos con stop-sell (`room_rates.closed`),
// pero `POST /api/public/booking` NO pasa por ese usecase: resuelve la habitación por su cuenta
// (`usecases/public-booking.ts`). Sin este mismo gate en la escritura, un integrador —o un submit
// con datos stale de hace más de los 60s de caché— crearía la reserva igual sobre inventario que
// el hotel cerró, y el bug quedaría abierto justo donde importa.
//
// La regla la comparten los dos caminos vía `usecases/stay-restrictions.ts` (stop-sell) y
// `shared/usecases/type-availability.ts` (bloqueos, que descuentan inventario del TIPO).
// REQ-HAC-05 (#260): la reserva nace por tipo SIN unidad (`roomId` null); un `roomId` en el body
// sólo deriva el tipo, así que un bloqueo cuenta como una unidad menos del tipo, no como "esa"
// habitación cerrada.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'

const HOTEL_ID = 'h1'
/** Estadía de referencia: noches 10, 11 y 12 (la del 13 no existe: se va esa mañana). */
const IN = '2026-09-10'
const OUT = '2026-09-13'

const baseBody = {
  hotelId: HOTEL_ID,
  guestName: 'Ana',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: IN,
  checkOut: OUT,
  adults: 2,
  children: 0,
}

const block = (roomId: string, startDate: string, endDate: string) =>
  ({ id: `b-${roomId}-${startDate}`, hotelId: HOTEL_ID, roomId, reason: 'mantenimiento', startDate, endDate })

const rate = (roomType: string, season: string, closed = 0) =>
  ({ hotelId: HOTEL_ID, roomType, occupancy: 2, season, channel: '', price: 150, closed })

/** Septiembre en temporada 'alta', salvo `closedDate` que va a la temporada 'cerrada'. */
const seasonPerNight = (closedDate?: string) => {
  const days: any[] = []
  for (let d = 1; d <= 30; d++) {
    const date = `2026-09-${String(d).padStart(2, '0')}`
    days.push({ hotelId: HOTEL_ID, date, season: date === closedDate ? 'cerrada' : 'alta' })
  }
  return days
}

function makeOrm(opts: {
  rooms?: any[]
  reservations?: any[]
  blocks?: any[]
  rates?: any[]
  assignments?: any[]
} = {}) {
  const created: any[] = []
  const rooms = opts.rooms ?? []
  const orm: any = {
    findById: async (model: string, id: string) =>
      (model === 'Rooms' ? rooms.find((r) => r.id === id) ?? null : null),
    findMany: async (model: string, filters?: any) => {
      if (model === 'Rooms') {
        return rooms.filter((r) =>
          (!filters?.hotelId || r.hotelId === filters.hotelId) &&
          (!filters?.type || r.type === filters.type))
      }
      if (model === 'Reservations') return opts.reservations ?? []
      if (model === 'RoomBlocks') return opts.blocks ?? []
      if (model === 'RoomRates') return opts.rates ?? []
      if (model === 'SeasonAssignments') return opts.assignments ?? []
      return []
    },
    create: async (model: string, payload: any) => {
      const row = { id: payload.id || crypto.randomUUID(), ...payload }
      created.push({ model, row })
      return row
    },
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
    update: async () => null,
    findOne: async () => null,
  }
  return { orm, created }
}

const TWO_STANDARD = [
  { id: 'r-cheap', hotelId: HOTEL_ID, type: 'standard', basePrice: 100, status: 'available' },
  { id: 'r-pricey', hotelId: HOTEL_ID, type: 'standard', basePrice: 150, status: 'available' },
]

// ─── room_blocks ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/public/booking — no acepta una habitación bloqueada (room_blocks)', () => {
  it('roomType: la única unidad del tipo está bloqueada en el rango → 409, no 201', async () => {
    const { orm, created } = makeOrm({
      rooms: [TWO_STANDARD[0]!],
      blocks: [block('r-cheap', '2026-09-09', '2026-09-11')],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(409)
    // Ninguna reserva creada: el bloqueo frena ANTES de escribir.
    expect(created.filter((c) => c.model === 'Reservations')).toHaveLength(0)
  })

  it('roomType: 2 unidades y 1 bloqueada → 201 por tipo, sin unidad (el bloqueo descuenta una del tipo)', async () => {
    const { orm, created } = makeOrm({
      rooms: TWO_STANDARD,
      blocks: [block('r-cheap', '2026-09-11', '2026-09-11')],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('standard')
    expect(created.find((c) => c.model === 'Reservations')!.row.roomId).toBeNull()
  })

  it('roomId real de la unidad bloqueada: sólo deriva el tipo, que aún tiene otra libre → 201 sin unidad', async () => {
    const { orm } = makeOrm({
      rooms: TWO_STANDARD,
      blocks: [block('r-cheap', '2026-09-11', '2026-09-11')],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r-cheap' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('standard')
  })

  it('roomId real con TODAS las unidades del tipo bloqueadas → 409 (no se saltea el gate mandando el id físico)', async () => {
    const { orm, created } = makeOrm({
      rooms: TWO_STANDARD,
      blocks: [block('r-cheap', '2026-09-11', '2026-09-11'), block('r-pricey', '2026-09-11', '2026-09-11')],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r-cheap' })
    expect(res.status).toBe(409)
    expect(created.filter((c) => c.model === 'Reservations')).toHaveLength(0)
  })

  it('BORDE — bloqueo que termina el día del check-in (endDate inclusivo) → 409', async () => {
    const { orm } = makeOrm({ rooms: [TWO_STANDARD[0]!], blocks: [block('r-cheap', '2026-09-08', IN)] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(409)
  })

  it('BORDE — bloqueo que termina la víspera del check-in → 201', async () => {
    const { orm } = makeOrm({ rooms: [TWO_STANDARD[0]!], blocks: [block('r-cheap', '2026-09-08', '2026-09-09')] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(201)
  })

  it('BORDE — bloqueo que empieza el día del checkout → 201 (esa noche no se vende)', async () => {
    const { orm } = makeOrm({ rooms: [TWO_STANDARD[0]!], blocks: [block('r-cheap', OUT, '2026-09-20')] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(201)
  })

  it('bloqueo de OTRAS fechas no impide reservar', async () => {
    const { orm } = makeOrm({ rooms: [TWO_STANDARD[0]!], blocks: [block('r-cheap', '2026-09-20', '2026-09-25')] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('standard')
  })
})

// ─── room_rates.closed ───────────────────────────────────────────────────────────────────────

describe('POST /api/public/booking — no acepta un tipo con stop-sell (room_rates.closed)', () => {
  const closedMidStay = {
    assignments: seasonPerNight('2026-09-11'),
    rates: [rate('standard', 'alta'), rate('standard', 'cerrada', 1)],
  }

  it('roomType: `closed=1` en una noche del rango → 409 aunque haya unidades libres', async () => {
    const { orm, created } = makeOrm({ rooms: TWO_STANDARD, ...closedMidStay })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(409)
    expect(created.filter((c) => c.model === 'Reservations')).toHaveLength(0)
  })

  it('roomId real: mismo tipo cerrado → 409 (no se saltea el gate mandando el id físico)', async () => {
    const { orm } = makeOrm({ rooms: TWO_STANDARD, ...closedMidStay })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r-cheap' })
    expect(res.status).toBe(409)
  })

  it('`closed=1` FUERA del rango → 201', async () => {
    const { orm } = makeOrm({
      rooms: TWO_STANDARD,
      assignments: seasonPerNight('2026-09-20'),
      rates: [rate('standard', 'alta'), rate('standard', 'cerrada', 1)],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(201)
  })

  it('BORDE — `closed=1` en la noche del checkout → 201 (esa noche no se vende)', async () => {
    const { orm } = makeOrm({
      rooms: TWO_STANDARD,
      assignments: seasonPerNight(OUT),
      rates: [rate('standard', 'alta'), rate('standard', 'cerrada', 1)],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(201)
  })

  it('el stop-sell de un override de CANAL no cierra el motor directo → 201', async () => {
    const { orm } = makeOrm({
      rooms: TWO_STANDARD,
      assignments: seasonPerNight(),
      rates: [
        rate('standard', 'alta'),
        { hotelId: HOTEL_ID, roomType: 'standard', occupancy: 2, season: 'alta', channel: 'booking', price: 150, closed: 1 },
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'standard' })
    expect(res.status).toBe(201)
  })

  it('cerrar un tipo no cierra los OTROS tipos del hotel', async () => {
    const { orm } = makeOrm({
      rooms: [...TWO_STANDARD, { id: 'r-suite', hotelId: HOTEL_ID, type: 'suite', basePrice: 300, status: 'available' }],
      ...closedMidStay,
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'suite' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('suite')
  })
})
