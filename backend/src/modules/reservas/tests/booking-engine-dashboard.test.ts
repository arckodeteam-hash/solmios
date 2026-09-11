// reservas/tests/booking-engine-dashboard.test.ts — REQ-RWP-04
//
// Las reservas del motor público nacen con `source: 'web'` (bookingengine/usecases/public-booking.ts)
// pero `channel` sigue 'direct'. Este test prueba que el reporte de "directas" del dashboard
// cuenta por `channel`, así que cambiar `source` NO saca a la reserva web del reporte.
import { describe, it, expect } from 'bun:test'
import { getBookingEngineDashboard } from '../usecases/booking-engine'
import type { ReservasQueries } from '../usecases/reservas-queries'

const HOTEL = { id: 'h1', name: 'Hotel Test' }
const ROOMS = [{ id: 'r1', hotelId: 'h1' }, { id: 'r2', hotelId: 'h1' }]
const RESERVATIONS = [
  { id: 'res-web', channel: 'direct', source: 'web', totalAmount: 100 },
  { id: 'res-recepcion', channel: 'direct', source: 'direct', totalAmount: 50 },
  { id: 'res-ota', channel: 'booking', source: 'booking', totalAmount: 80 },
]

function makeQueries(reservations: any[] = RESERVATIONS) {
  const calls: string[] = []
  const queries = {
    findHotels: async () => { calls.push('findHotels'); return [HOTEL] },
    findHotelById: async (hotelId: string) => { calls.push(`findHotelById:${hotelId}`); return hotelId === HOTEL.id ? HOTEL : null },
    findRoomsByHotel: async (hotelId: string) => { calls.push(`findRoomsByHotel:${hotelId}`); return hotelId === HOTEL.id ? ROOMS : [] },
    findReservationsByHotel: async (hotelId: string) => { calls.push(`findReservationsByHotel:${hotelId}`); return hotelId === HOTEL.id ? reservations : [] },
  } as unknown as ReservasQueries
  return { queries, calls }
}

describe('getBookingEngineDashboard — directas cuentan por channel, no por source (REQ-RWP-04)', () => {
  it('la reserva web (source=web, channel=direct) sigue contando como directa', async () => {
    const { queries } = makeQueries()
    const out = await getBookingEngineDashboard(queries, { hotelId: 'h1' })

    expect(out.totalReservas).toBe(3)
    expect(out.directas).toBe(2)
    expect(out.revenueDirecta).toBe(150)
    expect(out.comisionesAhorradas).toBe(Math.round(150 * 0.15))
    expect(out.hotel).toEqual(HOTEL)
    expect(out.total).toBe(ROOMS.length)
  })

  it('usuario platform (sin hotelId) resuelve el primer hotel y cuenta igual', async () => {
    const { queries, calls } = makeQueries()
    const out = await getBookingEngineDashboard(queries, { hotelId: 'platform' })

    expect(calls[0]).toBe('findHotels')
    expect(calls).toContain('findReservationsByHotel:h1')
    expect(out.directas).toBe(2)
    expect(out.revenueDirecta).toBe(150)
  })

  it('sin reservas: 0 directas y 0 revenue', async () => {
    const { queries } = makeQueries([])
    const out = await getBookingEngineDashboard(queries, { hotelId: 'h1' })
    expect(out.totalReservas).toBe(0)
    expect(out.directas).toBe(0)
    expect(out.revenueDirecta).toBe(0)
  })
})
