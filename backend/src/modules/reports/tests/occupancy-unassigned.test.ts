// occupancy-unassigned.test.ts — #262 (REQ-HAC-07): la ocupación se cuenta por RESERVA y por tipo
// (roomType ?? room.type). Una reserva confirmada sin habitación asignada (roomId null) ocupa igual.
import { describe, it, expect } from 'bun:test'
import { ReportQueries, occupancyByTypeForNight, occupiedNightsOn } from '../usecases/report-queries'
import { RendimientoStrategy } from '../strategies/rendimiento'
import type { ReportContext } from '../strategies/types'

const AYER = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
const HOY = new Date().toISOString().slice(0, 10)
const MANANA = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

const rooms = [
  { id: 'd1', hotelId: 'h1', type: 'doble', status: 'available' },
  { id: 'd2', hotelId: 'h1', type: 'doble', status: 'available' },
  { id: 's1', hotelId: 'h1', type: 'suite', status: 'occupied' },
]
const reservations = [
  { id: 'r-sin-asignar', hotelId: 'h1', status: 'confirmed', roomId: null, roomType: 'doble', checkIn: HOY, checkOut: MANANA, totalAmount: 100 },
  { id: 'r-suite', hotelId: 'h1', status: 'checked_in', roomId: 's1', checkIn: AYER, checkOut: MANANA, totalAmount: 400 },
  { id: 'r-cancelada', hotelId: 'h1', status: 'cancelled', roomId: null, roomType: 'doble', checkIn: HOY, checkOut: MANANA, totalAmount: 100 },
]

function makeOrm() {
  return {
    findMany: async (table: string, _filter: any) => {
      if (table === 'Reservations') return reservations
      if (table === 'Rooms') return rooms
      if (table === 'Guests') return []
      if (table === 'Hotels') return [{ id: 'h1', taxRate: 0 }]
      return []
    },
    update: async (_m: string, id: string, patch: any) => ({ id, ...patch }),
  }
}

describe('ocupación con reserva sin habitación asignada (#262)', () => {
  it('occupancyByTypeForNight cuenta la reserva sin roomId por su roomType', () => {
    const out = occupancyByTypeForNight(reservations, rooms, HOY)
    expect(out).toContainEqual({ type: 'doble', total: 2, occupied: 1, percentage: 50 })
    expect(out).toContainEqual({ type: 'suite', total: 1, occupied: 1, percentage: 100 })
    expect(out).toHaveLength(2)
  })

  it('un tipo con reservas pero sin habitaciones aparece con total 0', () => {
    const out = occupancyByTypeForNight(reservations, [], HOY)
    expect(out).toContainEqual({ type: 'doble', total: 0, occupied: 1, percentage: 0 })
    // la de la suite no tiene roomType ni unidad conocida → 'unknown'
    expect(out).toContainEqual({ type: 'unknown', total: 0, occupied: 1, percentage: 0 })
  })

  it('occupiedNightsOn: checkIn <= noche < checkOut, solo confirmed/checked_in', () => {
    expect(occupiedNightsOn(reservations, HOY)).toBe(2)
    expect(occupiedNightsOn(reservations, AYER)).toBe(1)
    expect(occupiedNightsOn(reservations, MANANA)).toBe(0)
  })

  it('getReports corre con roomId null y devuelve occupancyByType por reserva', async () => {
    const out = await new ReportQueries(makeOrm()).getReports('h1')
    expect(out.occupancyByType).toContainEqual({ type: 'doble', total: 2, occupied: 1, percentage: 50 })
    expect(out.occupancyByType).toContainEqual({ type: 'suite', total: 1, occupied: 1, percentage: 100 })
    expect(out.todayCheckins).toBe(1)
  })

  it('el cierre diario cuenta la reserva sin asignar como ocupada', async () => {
    const out = await new ReportQueries(makeOrm()).getNightAudit('h1')
    expect(out.habitacionesOcupadas).toBe(2)
    expect(out.habitacionesTotales).toBe(3)
    expect(out.ocupacion).toBe(67)
  })

  it('RendimientoStrategy agrupa la reserva sin roomId en adrByType por roomType', () => {
    const revenueReservations = reservations.filter((r) => r.status !== 'cancelled')
    const ctx: ReportContext = {
      from: AYER, to: MANANA, totalRooms: rooms.length, taxRate: 0,
      reservations, revenueReservations, rooms, guests: [],
      expenses: [], payments: [], folioCharges: [], folios: [], folioToReservation: new Map(), blocks: [], hotel: { id: 'h1' },
    }
    const out = new RendimientoStrategy().execute(ctx)
    expect(out.adrByType.doble).toEqual({ nights: 1, revenue: 100, adr: 100 })
    expect(out.adrByType.suite).toEqual({ nights: 2, revenue: 400, adr: 200 })
    expect(out.adrByType.unknown).toBeUndefined()
  })
})
