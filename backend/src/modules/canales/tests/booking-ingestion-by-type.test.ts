// canales/tests/booking-ingestion-by-type.test.ts — REQ-HAC-05 (#260): la OTA vende un TIPO.
//
// La reserva ingresada nace con `roomType` (mapeo Channex → código local) y `roomId` null; la
// unidad la asigna recepción después (assign-room). La ingesta NUNCA rechaza — la OTA ya cobró —
// y nunca elige unidad: dos bookings del mismo tipo y fechas son dos filas del tipo, no una unidad
// repetida ni una marca de sobreventa. Sin mapeo cae al primer tipo del hotel con la nota
// `⚠ TIPO SIN MAPEAR` para que recepción lo corrija.
import { describe, it, expect } from 'bun:test'
import { mapBookingRevision, applyBookingRevision } from '../usecases/booking-ingestion'
import { BookingSyncUseCase } from '../usecases/booking-sync'
import type { BookingRevisionDTO } from '../types'

const fakeLogger = { info: () => {}, warn: () => {}, error: () => {} }
const noopCancel = async () => ({ ok: true })

function makeRevision(over: Partial<BookingRevisionDTO> = {}): BookingRevisionDTO {
  return {
    id: 'rev-1', propertyId: 'propA', bookingId: 'bk-1', uniqueId: 'U-1', otaReservationCode: 'OTA-1',
    otaName: 'booking.com', status: 'new', arrivalDate: '2026-10-10', departureDate: '2026-10-12',
    amount: '120.50', currency: 'USD',
    customer: { name: 'John', surname: 'Doe', mail: 'j@x.com', phone: '+18095550000' },
    rooms: [{
      roomTypeId: 'rt-twin', ratePlanId: 'rp-1', checkinDate: '2026-10-10', checkoutDate: '2026-10-12', amount: '120.50',
      occupancy: { adults: 2, children: 0, infants: 0 },
    }],
    insertedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

/** Room types publicados en Channex: 'rt-twin' → "Twin Room"; 'rt-loft' no existe como tipo local. */
const ROOM_TYPES: Record<string, { id: string; title: string }> = {
  'rt-twin': { id: 'rt-twin', title: 'Twin Room' },
  'rt-loft': { id: 'rt-loft', title: 'Loft Panorámico' },
}

function makeChannexStub(feed: BookingRevisionDTO[]) {
  const ackCalls: string[] = []
  const channex: any = {
    fetchBookingFeed: async () => feed,
    ackBooking: async (_key: string, revId: string) => { ackCalls.push(revId); return true },
    getRoomTypeById: async (_key: string, id: string) => ROOM_TYPES[id] ?? null,
  }
  return { channex, ackCalls }
}

/** Hotel con 2 twin y 1 double; las reservas creadas quedan visibles para el dedupe y para el conteo. */
const ROOMS = [
  { id: 'r-d', number: '201', type: 'double', status: 'available' },
  { id: 'r-t1', number: '101', type: 'twin', status: 'available' },
  { id: 'r-t2', number: '102', type: 'twin', status: 'available' },
]

function makeOrm(opts: { rooms?: any[]; configs?: any[] } = {}) {
  const created: any[] = []
  const rooms = opts.rooms ?? ROOMS
  const orm: any = {
    findMany: async (model: string, q: any = {}) => {
      if (model === 'Canales') return opts.configs ?? [{ hotelId: 'h1', channexPropertyId: 'propA', syncEnabled: 1 }]
      if (model === 'Reservations') return created.filter((r) => !q.externalLocator || r.externalLocator === q.externalLocator)
      if (model === 'Rooms') return rooms.filter((r) => !q.type || r.type === q.type)
      return []
    },
    create: async (_model: string, payload: any) => { created.push(payload); return payload },
    update: async () => {},
  }
  return { orm, created }
}

const ingestDeps = (orm: any, channex: any) => ({ orm, channex, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel })

describe('ingesta OTA por tipo — REQ-HAC-05 (#260)', () => {
  it('(a) 2 bookings del mismo tipo y fechas → 2 filas con roomId null y roomType twin, sin marcas', async () => {
    const feed = [
      makeRevision({ id: 'rev-1', uniqueId: 'U-1', otaReservationCode: 'OTA-1' }),
      makeRevision({ id: 'rev-2', uniqueId: 'U-2', otaReservationCode: 'OTA-2', bookingId: 'bk-2' }),
    ]
    const { channex, ackCalls } = makeChannexStub(feed)
    const { orm, created } = makeOrm()

    const res = await new BookingSyncUseCase({ channex, queries: {} as any, orm, logger: fakeLogger as any }).run()

    expect(res.ingested).toBe(2)
    expect(created).toHaveLength(2)
    for (const row of created) {
      expect(row.roomId).toBeNull()
      expect(row.roomType).toBe('twin')
      // Sin ninguna marca ⚠ (ni auto-asignación, ni sobreventa, ni tipo sin mapear).
      expect(row.notes).toMatch(/^OTA: booking\.com \| Ref: U-\d$/)
      // Lo interno de Channex no viaja a la fila.
      expect(row.channexRoomTypeId).toBeUndefined()
    }
    expect(created.map((r) => r.externalLocator)).toEqual(['OTA-1', 'OTA-2'])
    expect(ackCalls).toEqual(['rev-1', 'rev-2'])
  })

  it('(a bis) una tercera del mismo tipo con las 2 twin "agotadas" se ingesta igual: la OTA ya vendió', async () => {
    const { channex } = makeChannexStub([])
    const { orm, created } = makeOrm()
    for (const n of [1, 2, 3]) {
      const dto = mapBookingRevision(makeRevision({ uniqueId: `U-${n}`, otaReservationCode: `OTA-${n}` }), 'h1')
      const r = await applyBookingRevision(ingestDeps(orm, channex), dto)
      expect(r).toEqual({ created: true })
    }
    expect(created).toHaveLength(3)
    expect(created.every((r) => r.roomId === null && r.roomType === 'twin')).toBe(true)
    expect(created.every((r) => !r.notes.includes('⚠'))).toBe(true)
  })

  it('(b) room type de Channex que no mapea a ningún tipo del hotel → primer tipo del hotel + ⚠ TIPO SIN MAPEAR', async () => {
    const { channex } = makeChannexStub([])
    const { orm, created } = makeOrm()
    const dto = mapBookingRevision(makeRevision({ rooms: [{ ...makeRevision().rooms[0], roomTypeId: 'rt-loft' }] }), 'h1')

    const r = await applyBookingRevision(ingestDeps(orm, channex), dto)

    expect(r).toEqual({ created: true })
    expect(created).toHaveLength(1)
    // Primer tipo = el de la unidad con el número más bajo (101 → twin), no el orden de la lista.
    expect(created[0]).toMatchObject({ roomId: null, roomType: 'twin' })
    expect(created[0].notes).toBe('OTA: booking.com | Ref: U-1 | ⚠ TIPO SIN MAPEAR (Loft Panorámico)')
  })

  it('(b bis) el tipo mapea pero el hotel no tiene unidades de ese tipo → también TIPO SIN MAPEAR', async () => {
    const { channex } = makeChannexStub([])
    const { orm, created } = makeOrm({ rooms: [{ id: 'r-d', number: '201', type: 'double' }] })
    const dto = mapBookingRevision(makeRevision(), 'h1') // rt-twin → 'twin', pero sólo hay double

    await applyBookingRevision(ingestDeps(orm, channex), dto)

    expect(created[0]).toMatchObject({ roomId: null, roomType: 'double' })
    expect(created[0].notes).toContain('⚠ TIPO SIN MAPEAR (Twin Room)')
  })

  it('(c) sin channexRoomTypeId → primer tipo del hotel + ⚠ TIPO SIN MAPEAR', async () => {
    const { channex } = makeChannexStub([])
    const { orm, created } = makeOrm()
    const dto = mapBookingRevision(makeRevision({ rooms: [{ ...makeRevision().rooms[0], roomTypeId: null }] }), 'h1')

    const r = await applyBookingRevision(ingestDeps(orm, channex), dto)

    expect(r).toEqual({ created: true })
    expect(created[0]).toMatchObject({ roomId: null, roomType: 'twin' })
    expect(created[0].notes).toBe('OTA: booking.com | Ref: U-1 | ⚠ TIPO SIN MAPEAR (sin room type)')
  })

  it('(c bis) sin notes previas la marca va sola; getRoomTypeById sin título usa el id de Channex', async () => {
    const { channex } = makeChannexStub([])
    const { orm, created } = makeOrm()
    await applyBookingRevision(ingestDeps(orm, channex), {
      externalLocator: 'OTA-X', status: 'confirmed', channel: 'Expedia', checkIn: '2026-10-10', checkOut: '2026-10-12', channexRoomTypeId: 'rt-desconocido',
    })
    expect(created[0]).toMatchObject({ roomId: null, roomType: 'twin' })
    expect(created[0].notes).toBe('⚠ TIPO SIN MAPEAR (rt-desconocido)')
  })

  it('(d) hotel sin habitaciones → error y NO se crea nada', async () => {
    const { channex } = makeChannexStub([])
    const { orm, created } = makeOrm({ rooms: [] })
    const dto = mapBookingRevision(makeRevision(), 'h1')

    await expect(applyBookingRevision(ingestDeps(orm, channex), dto)).rejects.toThrow(/Sin habitaciones para el hotel h1/)
    expect(created).toHaveLength(0)
  })

  it('el fallback ignora unidades sin tipo y es determinístico por número de habitación', async () => {
    const { channex } = makeChannexStub([])
    const { orm, created } = makeOrm({ rooms: [
      { id: 'r-z', number: '3', type: '' },
      { id: 'r-b', number: '10', type: 'suite' },
      { id: 'r-a', number: '9', type: 'double' },
    ] })
    await applyBookingRevision(ingestDeps(orm, channex), { externalLocator: 'OTA-Y', status: 'confirmed', channexRoomTypeId: null })
    // Orden numérico (9 < 10), no lexicográfico ('10' < '9'): la 9 es double.
    expect(created[0]).toMatchObject({ roomId: null, roomType: 'double' })
  })
})
