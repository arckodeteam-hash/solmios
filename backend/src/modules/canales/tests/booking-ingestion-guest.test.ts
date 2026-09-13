// canales/tests/booking-ingestion-guest.test.ts — #306 (REQ-RWP-03): la reserva OTA nace con ficha.
//
// Antes la ingesta Channex creaba la fila de Reservations sin `guestId` y el aviso al hotel
// (`notify-reservation-received.ts` → resolveGuest) decía "Huésped sin nombre" aunque la OTA
// mandara nombre, mail y teléfono. Ahora `applyBookingRevision` resuelve `booking.customer` a una
// ficha `Guests` con el helper compartido `findOrCreateGuest` (un huésped = una ficha, MR-08) y
// enlaza `guestId`. Best-effort: si la ficha falla, la reserva se ingesta igual — la OTA ya cobró.
import { describe, it, expect } from 'bun:test'
import { mapBookingRevision, applyBookingRevision } from '../usecases/booking-ingestion'
import type { BookingRevisionDTO } from '../types'

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

/** Room types publicados en Channex: 'rt-twin' → "Twin Room". */
const ROOM_TYPES: Record<string, { id: string; title: string }> = {
  'rt-twin': { id: 'rt-twin', title: 'Twin Room' },
}

function makeChannexStub() {
  const channex: any = {
    fetchBookingFeed: async () => [],
    ackBooking: async () => true,
    getRoomTypeById: async (_key: string, id: string) => ROOM_TYPES[id] ?? null,
  }
  return { channex }
}

const ROOMS = [
  { id: 'r-d', number: '201', type: 'double', status: 'available' },
  { id: 'r-t1', number: '101', type: 'twin', status: 'available' },
  { id: 'r-t2', number: '102', type: 'twin', status: 'available' },
]

/** ORM fake con Reservations, Rooms y Guests (findOne/findMany/create/update) para `guestsOnTx`. */
function makeOrm(opts: { rooms?: any[]; guestCreateFails?: boolean } = {}) {
  const created: any[] = []
  const guests: any[] = []
  const rooms = opts.rooms ?? ROOMS
  const matches = (row: any, q: any) => Object.entries(q || {}).every(([k, v]) => row[k] === v)
  const orm: any = {
    findOne: async (model: string, q: any = {}) => {
      if (model === 'Guests') return guests.find((g) => matches(g, q)) ?? null
      return null
    },
    findMany: async (model: string, q: any = {}) => {
      if (model === 'Reservations') return created.filter((r) => !q.externalLocator || r.externalLocator === q.externalLocator)
      if (model === 'Rooms') return rooms.filter((r) => !q.type || r.type === q.type)
      if (model === 'Guests') return guests.filter((g) => matches(g, q))
      return []
    },
    create: async (model: string, payload: any) => {
      if (model === 'Guests') {
        if (opts.guestCreateFails) throw new Error('Guests down')
        guests.push(payload)
        return payload
      }
      created.push(payload)
      return payload
    },
    update: async (model: string, id: string, data: any) => {
      if (model === 'Guests') Object.assign(guests.find((g) => g.id === id) ?? {}, data)
    },
  }
  return { orm, created, guests }
}

function makeLogger() {
  const errors: Array<{ msg: string; meta?: Record<string, unknown> }> = []
  return { logger: { error: (msg: string, meta?: Record<string, unknown>) => { errors.push({ msg, meta }) } }, errors }
}

const ingestDeps = (orm: any, channex: any, logger?: any) =>
  ({ orm, channex, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel, logger })

describe('ingesta OTA enlaza la ficha del huésped — #306 (REQ-RWP-03)', () => {
  it('(a) customer John Doe → UNA fila Guests y la reserva con guestId; los datos del huésped no van a la fila', async () => {
    const { channex } = makeChannexStub()
    const { orm, created, guests } = makeOrm()
    const dto = mapBookingRevision(makeRevision(), 'h1')
    expect(dto).toMatchObject({ guestName: 'John Doe', guestEmail: 'j@x.com', guestPhone: '+18095550000' })

    const r = await applyBookingRevision(ingestDeps(orm, channex), dto)

    expect(r).toEqual({ created: true })
    expect(guests).toHaveLength(1)
    expect(guests[0]).toMatchObject({ hotelId: 'h1', name: 'John Doe', email: 'j@x.com', phone: '+18095550000' })
    expect(created).toHaveLength(1)
    expect(created[0].guestId).toBe(String(guests[0].id))
    expect(created[0]).toMatchObject({ roomId: null, roomType: 'twin', externalLocator: 'OTA-1' })
    // Igual que CreateReservasDTO: guestName/guestEmail/guestPhone NO se persisten en Reservations.
    expect(created[0].guestName).toBeUndefined()
    expect(created[0].guestEmail).toBeUndefined()
    expect(created[0].guestPhone).toBeUndefined()
    expect(created[0].channexRoomTypeId).toBeUndefined()
  })

  it('(b) dos revisiones distintas con el mismo mail → una sola ficha y las dos reservas con el mismo guestId', async () => {
    const { channex } = makeChannexStub()
    const { orm, created, guests } = makeOrm()
    const first = mapBookingRevision(makeRevision(), 'h1')
    const second = mapBookingRevision(makeRevision({
      id: 'rev-2', uniqueId: 'U-2', otaReservationCode: 'OTA-2', bookingId: 'bk-2',
      customer: { name: 'John', surname: 'Doe', mail: 'J@X.com', phone: '' },
    }), 'h1')

    await applyBookingRevision(ingestDeps(orm, channex), first)
    await applyBookingRevision(ingestDeps(orm, channex), second)

    expect(created).toHaveLength(2)
    expect(guests).toHaveLength(1)
    expect(created[0].guestId).toBe(String(guests[0].id))
    expect(created[1].guestId).toBe(created[0].guestId)
  })

  it('(c) Guests.create lanza → la reserva se crea igual sin guestId y se registra el error', async () => {
    const { channex } = makeChannexStub()
    const { orm, created, guests } = makeOrm({ guestCreateFails: true })
    const { logger, errors } = makeLogger()
    const dto = mapBookingRevision(makeRevision(), 'h1')

    const r = await applyBookingRevision(ingestDeps(orm, channex, logger), dto)

    expect(r).toEqual({ created: true })
    expect(guests).toHaveLength(0)
    expect(created).toHaveLength(1)
    expect(created[0].guestId).toBeUndefined()
    expect(created[0]).toMatchObject({ roomId: null, roomType: 'twin', externalLocator: 'OTA-1' })
    expect(errors).toHaveLength(1)
    expect(errors[0].msg).toBe('No se pudo enlazar la ficha del huésped OTA')
    expect(errors[0].meta).toMatchObject({ hotelId: 'h1', externalLocator: 'OTA-1', error: 'Guests down' })
  })

  it('(d) customer sin name/surname/mail/phone → no se crea ficha y la reserva no tiene guestId', async () => {
    const { channex } = makeChannexStub()
    const { orm, created, guests } = makeOrm()
    const { logger, errors } = makeLogger()
    const dto = mapBookingRevision(makeRevision({ customer: {} }), 'h1')
    // El fallback 'OTA Guest' queda sólo en otaNotes; el DTO expone el nombre real (vacío).
    expect(dto).toMatchObject({ guestName: '', guestEmail: '', guestPhone: '' })
    expect(dto.otaNotes).toContain('OTA Guest')

    const r = await applyBookingRevision(ingestDeps(orm, channex, logger), dto)

    expect(r).toEqual({ created: true })
    expect(guests).toHaveLength(0)
    expect(created).toHaveLength(1)
    expect(created[0].guestId).toBeUndefined()
    expect(errors).toHaveLength(0)
  })
})
