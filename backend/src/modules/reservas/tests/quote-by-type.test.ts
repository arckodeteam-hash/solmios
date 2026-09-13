// reservas/tests/quote-by-type.test.ts — REQ-HAC-05 (#260): cotización y disponibilidad POR TIPO.
//
//  - `quoteStay({ roomType })` cotiza con la MISMA cadena que `quoteStay({ roomId })`: la grilla
//    `room_rates` ya es por tipo, así que el subtotal/noches coinciden con los de cualquier unidad
//    del tipo. Sin grilla, el fallback es el MÍNIMO `basePrice` de las unidades del tipo.
//  - `listTypeAvailability` devuelve un item por tipo con `available` de `countAvailableOfType`
//    (fuente única, la misma que rebota el alta con `type_sold_out`).

import { describe, it, expect } from 'bun:test'
import { ConflictError, NotFoundError } from 'arckode-framework'
import { quoteStay } from '../usecases/quote'
import { listTypeAvailability } from '../usecases/type-availability-list'

const HOTEL = 'h1'
const rooms = [
  { id: 'd-1', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, basePrice: 120, number: '101' },
  { id: 'd-2', hotelId: HOTEL, type: 'double', status: 'available', capacity: 3, basePrice: 100, number: '102' },
  { id: 's-1', hotelId: HOTEL, type: 'suite', status: 'available', capacity: 4, basePrice: 300, number: '201' },
  { id: 'z-1', hotelId: 'h2', type: 'double', status: 'available', capacity: 2, basePrice: 1, number: '999' },
]
const roomRepo = {
  findOne: async (f: any) => rooms.find((r) => r.id === f?.id) ?? null,
  findMany: async (q: any = {}) => rooms.filter((r) =>
    (q.hotelId == null || r.hotelId === q.hotelId) && (q.type == null || r.type === q.type)),
} as any

const rate = (roomType: string, season: string, price: number, occ = 2) => ({
  id: `${roomType}-${season}-${occ}`, hotelId: HOTEL, roomType, occupancy: occ, season, channel: '', price, basePrice: price, percentage: 0, closed: 0,
})
const assignment = (date: string, season: string) => ({ id: date, hotelId: HOTEL, date, season })
const repos = (assignments: any[], rates: any[]) => ({
  roomRepo,
  seasonAssignmentRepo: { findMany: async () => assignments },
  roomRateRepo: { findMany: async () => rates },
  seasonsRepo: { findMany: async () => [{ name: 'alta', label: 'Alta', color: '#f00' }] },
}) as any

const stay = { checkIn: '2026-09-01', checkOut: '2026-09-04', guests: 2 }

describe('quoteStay por roomType (REQ-HAC-05)', () => {
  it('con las mismas tarifas, {roomType} da el mismo subtotal/nights que {roomId: unidad del tipo}', async () => {
    const r = repos([assignment('2026-09-01', 'alta'), assignment('2026-09-02', 'alta'), assignment('2026-09-03', 'alta')], [rate('double', 'alta', 180), rate('suite', 'alta', 400)])
    const byType = await quoteStay(r, { hotelId: HOTEL, roomType: 'double', ...stay })
    const byUnit = await quoteStay(r, { hotelId: HOTEL, roomId: 'd-1', ...stay })
    expect(byType.subtotal).toBe(byUnit.subtotal)
    expect(byType.subtotal).toBe(540)
    expect(byType.nightsCount).toBe(byUnit.nightsCount)
    expect(byType.nights).toEqual(byUnit.nights)
    expect(byType.fromRates).toBe(true)
    expect(byType.roomType).toBe('double')
    expect(byType.roomId).toBeNull()
    expect(byUnit.roomId).toBe('d-1')
  })

  it('sin tarifas: fallback = basePrice MÍNIMO del tipo (100, no 120) — y la unidad cotiza su propio basePrice', async () => {
    const r = repos([], [])
    const byType = await quoteStay(r, { hotelId: HOTEL, roomType: 'double', ...stay })
    expect(byType.fromRates).toBe(false)
    expect(byType.basePrice).toBe(100)
    expect(byType.subtotal).toBe(300)
    expect(byType.pricePerNight).toBe(100)
    const byUnit = await quoteStay(r, { hotelId: HOTEL, roomId: 'd-1', ...stay })
    expect(byUnit.subtotal).toBe(360)
  })

  it('con roomId Y roomType, manda roomId (compat)', async () => {
    const q = await quoteStay(repos([], []), { hotelId: HOTEL, roomId: 's-1', roomType: 'double', ...stay })
    expect(q.roomType).toBe('suite')
    expect(q.subtotal).toBe(900)
  })

  it('unidades de otro hotel no entran en el mínimo (scoped por hotelId)', async () => {
    const q = await quoteStay(repos([], []), { hotelId: HOTEL, roomType: 'double', ...stay })
    expect(q.basePrice).toBe(100) // z-1 (h2, $1) no cuenta
  })

  it('errores: sin roomId ni roomType → 409; tipo sin unidades → 404', async () => {
    await expect(quoteStay(repos([], []), { hotelId: HOTEL, ...stay })).rejects.toBeInstanceOf(ConflictError)
    await expect(quoteStay(repos([], []), { hotelId: HOTEL, roomType: 'penthouse', ...stay })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('listTypeAvailability — un item por tipo (REQ-HAC-05)', () => {
  const reservations = [
    { id: 'r-a', hotelId: HOTEL, roomId: null, roomType: 'double', status: 'confirmed', checkIn: '2026-09-02', checkOut: '2026-09-04' },
    { id: 'r-x', hotelId: HOTEL, roomId: null, roomType: 'double', status: 'cancelled', checkIn: '2026-09-01', checkOut: '2026-09-04' },
  ]
  const port = (extra: any[] = [], blocks: any[] = []) => ({
    rooms: { findMany: async (q: any) => rooms.filter((r) => r.hotelId === q.hotelId) },
    reservations: { findMany: async (q: any) => [...reservations, ...extra].filter((r) => r.hotelId === q.hotelId) },
    blocks: { findMany: async () => blocks },
  })

  it('2 dobles + 1 reserva sin asignar → double.available 1; suite intacta; ordenado por roomType', async () => {
    const items = await listTypeAvailability(port(), { hotelId: HOTEL, checkIn: '2026-09-01', checkOut: '2026-09-04' })
    expect(items.map((i) => i.roomType)).toEqual(['double', 'suite'])
    const dbl = items[0]
    expect(dbl.rooms).toBe(2)
    expect(dbl.available).toBe(1)
    expect(dbl.booked).toBe(1)
    expect(dbl.perNight).toEqual([
      { date: '2026-09-01', booked: 0, available: 2 },
      { date: '2026-09-02', booked: 1, available: 1 },
      { date: '2026-09-03', booked: 1, available: 1 },
    ])
    expect(dbl.minBasePrice).toBe(100)
    expect(dbl.capacity).toBe(3)
    expect(items[1]).toMatchObject({ roomType: 'suite', rooms: 1, available: 1, booked: 0, minBasePrice: 300, capacity: 4 })
  })

  it('reserva ASIGNADA a una unidad del tipo también descuenta; excludeReservationId no se cuenta a sí misma', async () => {
    const assigned = { id: 'r-b', hotelId: HOTEL, roomId: 'd-1', roomType: 'double', status: 'confirmed', checkIn: '2026-09-01', checkOut: '2026-09-04' }
    const p = port([assigned])
    const full = await listTypeAvailability(p, { hotelId: HOTEL, checkIn: '2026-09-01', checkOut: '2026-09-04' })
    expect(full[0].available).toBe(0)
    const editing = await listTypeAvailability(p, { hotelId: HOTEL, checkIn: '2026-09-01', checkOut: '2026-09-04', excludeReservationId: 'r-b' })
    expect(editing[0].available).toBe(1)
  })

  it('un bloqueo sobre la suite la deja en 0; fechas inválidas → 409', async () => {
    const items = await listTypeAvailability(port([], [{ roomId: 's-1', startDate: '2026-09-02', endDate: '2026-09-02' }]), { hotelId: HOTEL, checkIn: '2026-09-01', checkOut: '2026-09-04' })
    expect(items[1].available).toBe(0)
    await expect(listTypeAvailability(port(), { hotelId: HOTEL, checkIn: '2026-09-04', checkOut: '2026-09-01' })).rejects.toBeInstanceOf(ConflictError)
  })
})
