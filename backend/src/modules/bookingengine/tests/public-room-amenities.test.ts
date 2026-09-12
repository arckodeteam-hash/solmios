// bookingengine/tests/public-room-amenities.test.ts — REQ-01 (#290): catálogo público de
// amenidades PERSONALIZADAS por tipo de habitación + helpers puros que usa la reserva.
//
// Cubre:
//  (1) catálogo agrupa por tipo; solo custom activas con name (las keys fijas y las inactivas no).
//  (2) ignora rooms no vendibles (maintenance) y con onlineBookingEnabled=false.
//  (3) unión por key entre rooms del tipo con precio MÍNIMO; ordenado por name.
//  (4) slug desconocido / hotel pausado → 404.
//  (5) normalizeRoomAmenityKeys descarta keys no custom, duplicados y vacíos.
//  (6) resolveRoomAmenityLines ignora key no ofrecida (warn) y usa el precio del server.
//  (7) preferRoomsOffering ordena estable: primero las que ofrecen TODAS las keys.
import { describe, it, expect } from 'bun:test'
import {
  getPublicRoomAmenities, normalizeRoomAmenityKeys, resolveRoomAmenityLines, preferRoomsOffering, roomOffersAll,
} from '../usecases/public-room-amenities'

const HOTEL = { id: 'h1', slug: 'caribe', onlineBookingStatus: 'active' }

/** ORM mínimo: `findMany(model, filter)` con match exacto por campo (como en el usecase). */
function makeOrm(tables: Record<string, any[]>) {
  const matches = (row: any, filter: any = {}) => Object.entries(filter).every(([k, v]) => row[k] === v)
  return { findMany: async (model: string, filter: any = {}) => (tables[model] ?? []).filter((r) => matches(r, filter)) }
}

const makeDeps = (hotel: any, tables: Record<string, any[]>) => ({
  hotels: { findOne: async (f: any) => (hotel && hotel.slug === f.slug ? hotel : null) } as any,
  orm: makeOrm(tables),
})

const am = (roomId: string, amenityKey: string, extra: any = {}) => ({ id: `${roomId}-${amenityKey}`, roomId, amenityKey, isActive: true, name: '', price: 0, ...extra })

describe('getPublicRoomAmenities — catálogo por tipo (REQ-01 #290)', () => {
  it('(1) agrupa por tipo y solo expone custom activas con name', async () => {
    const deps = makeDeps(HOTEL, {
      Rooms: [
        { id: 'r1', hotelId: 'h1', type: 'double', status: 'available' },
        { id: 'r2', hotelId: 'h1', type: 'suite', status: 'cleaning' },
        { id: 'rx', hotelId: 'h2', type: 'double', status: 'available' }, // otro hotel
      ],
      RoomAmenities: [
        am('r1', 'wifi'), // fija: gratis, no vendible
        am('r1', 'custom:cuna', { name: 'Cuna', price: 15 }),
        am('r1', 'custom:cama_extra', { name: 'Cama extra', price: 30, isActive: 0 }), // inactiva (0 legacy)
        am('r1', 'custom:sin_nombre', { name: '  ', price: 5 }), // sin name
        am('r2', 'custom:jacuzzi', { name: 'Jacuzzi privado', price: 0, isActive: 1 }), // precio 0 válido
        am('rx', 'custom:otro', { name: 'De otro hotel', price: 99 }),
      ],
    })
    const res = await getPublicRoomAmenities(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      byRoomType: {
        double: [{ key: 'custom:cuna', name: 'Cuna', price: 15 }],
        suite: [{ key: 'custom:jacuzzi', name: 'Jacuzzi privado', price: 0 }],
      },
    })
  })

  it('(2) ignora rooms no vendibles y con onlineBookingEnabled=false', async () => {
    const deps = makeDeps(HOTEL, {
      Rooms: [
        { id: 'r1', hotelId: 'h1', type: 'double', status: 'maintenance' },
        { id: 'r2', hotelId: 'h1', type: 'double', status: 'available', onlineBookingEnabled: false },
        { id: 'r3', hotelId: 'h1', type: 'double', status: 'available' },
      ],
      RoomAmenities: [
        am('r1', 'custom:cuna', { name: 'Cuna', price: 15 }),
        am('r2', 'custom:cama_extra', { name: 'Cama extra', price: 30 }),
        am('r3', 'custom:parking', { name: 'Parking', price: 8 }),
      ],
    })
    const res = await getPublicRoomAmenities(deps as any, 'caribe')
    expect(res.body.byRoomType).toEqual({ double: [{ key: 'custom:parking', name: 'Parking', price: 8 }] })
  })

  it('(3) unión por key entre rooms del tipo con precio mínimo, ordenado por name', async () => {
    const deps = makeDeps(HOTEL, {
      Rooms: [
        { id: 'r1', hotelId: 'h1', type: 'double', status: 'available' },
        { id: 'r2', hotelId: 'h1', type: 'double', status: 'available' },
        { id: 'r3', hotelId: 'h1', type: 'single', status: 'available' }, // tipo sin custom → no aparece
      ],
      RoomAmenities: [
        am('r1', 'custom:cuna', { name: 'Cuna', price: 20 }),
        am('r2', 'custom:cuna', { name: 'Cuna', price: 15 }),
        am('r2', 'custom:cama_extra', { name: 'Cama extra', price: 30 }),
        am('r3', 'tv'),
      ],
    })
    const res = await getPublicRoomAmenities(deps as any, 'caribe')
    expect(res.body.byRoomType).toEqual({
      double: [
        { key: 'custom:cama_extra', name: 'Cama extra', price: 30 },
        { key: 'custom:cuna', name: 'Cuna', price: 15 },
      ],
    })
    expect(res.body.byRoomType.single).toBeUndefined()
  })

  it('(4) slug desconocido o hotel pausado → 404', async () => {
    expect((await getPublicRoomAmenities(makeDeps(HOTEL, {}) as any, 'nope')).status).toBe(404)
    expect((await getPublicRoomAmenities(makeDeps({ ...HOTEL, onlineBookingStatus: 'paused' }, {}) as any, 'caribe')).status).toBe(404)
    expect((await getPublicRoomAmenities(makeDeps(HOTEL, {}) as any, '')).status).toBe(404)
  })

  it('hotel sin custom → byRoomType vacío (200, no 404)', async () => {
    const deps = makeDeps(HOTEL, { Rooms: [{ id: 'r1', hotelId: 'h1', type: 'double', status: 'available' }], RoomAmenities: [am('r1', 'wifi')] })
    const res = await getPublicRoomAmenities(deps as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ byRoomType: {} })
  })
})

describe('helpers puros — normalize / resolve / prefer (REQ-01 #290)', () => {
  it('(5) normalizeRoomAmenityKeys: acepta [{key}] y strings, descarta no custom, duplicados y vacíos', () => {
    expect(normalizeRoomAmenityKeys([{ key: ' custom:cuna ' }, 'custom:cama_extra', { key: 'wifi' }, 'custom:cuna', '', null, { id: 'x' }]))
      .toEqual(['custom:cuna', 'custom:cama_extra'])
    expect(normalizeRoomAmenityKeys(undefined)).toEqual([])
    expect(normalizeRoomAmenityKeys('custom:cuna')).toEqual([])
  })

  it('(6) resolveRoomAmenityLines: key no ofrecida/inactiva → warn e ignora; precio del server', () => {
    const warns: any[] = []
    const logger = { warn: (m: string, meta?: any) => { warns.push({ m, meta }) }, error: () => {} }
    const rows = [
      am('r1', 'custom:cuna', { name: 'Cuna', price: 15 }),
      am('r1', 'custom:cama_extra', { name: 'Cama extra', price: 30, isActive: false }),
      am('r1', 'custom:gratis', { name: 'Late checkout', price: 0 }),
    ]
    const res = resolveRoomAmenityLines(rows, ['custom:cuna', 'custom:cama_extra', 'custom:nope', 'custom:gratis'], 2, logger)
    expect(res.lines).toEqual([
      { key: 'custom:cuna', name: 'Cuna', price: 15, quantity: 2, total: 30 },
      { key: 'custom:gratis', name: 'Late checkout', price: 0, quantity: 2, total: 0 },
    ])
    expect(res.total).toBe(30)
    expect(warns).toHaveLength(2)
    expect(warns.map((w) => w.meta.amenityKey)).toEqual(['custom:cama_extra', 'custom:nope'])
  })

  it('(6b) precio negativo o no numérico en la fila → 0 (nunca resta)', () => {
    const rows = [am('r1', 'custom:cuna', { name: 'Cuna', price: -5 }), am('r1', 'custom:x', { name: 'X', price: 'abc' })]
    const res = resolveRoomAmenityLines(rows, ['custom:cuna', 'custom:x'], 1)
    expect(res.lines.map((l) => l.price)).toEqual([0, 0])
    expect(res.total).toBe(0)
  })

  it('(7) preferRoomsOffering: primero las que ofrecen TODAS las keys, orden estable; sin keys devuelve igual', () => {
    const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const byRoom = new Map<string, any[]>([
      ['a', [am('a', 'custom:cuna', { name: 'Cuna', price: 10 })]],
      ['b', [am('b', 'custom:cuna', { name: 'Cuna', price: 10 }), am('b', 'custom:cama_extra', { name: 'Cama', price: 20 })]],
      ['c', []],
      ['d', [am('d', 'custom:cuna', { name: 'Cuna', price: 10 }), am('d', 'custom:cama_extra', { name: 'Cama', price: 20, isActive: false })]],
    ])
    expect(preferRoomsOffering(candidates, byRoom, ['custom:cuna', 'custom:cama_extra']).map((r) => r.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(preferRoomsOffering(candidates, byRoom, ['custom:cuna']).map((r) => r.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(preferRoomsOffering(candidates, byRoom, [])).toBe(candidates)
    expect(roomOffersAll(byRoom.get('d')!, ['custom:cama_extra'])).toBe(false)
    expect(roomOffersAll([], [])).toBe(true)
  })
})
