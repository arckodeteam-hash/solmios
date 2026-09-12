import { describe, it, expect } from 'bun:test'
import { DashboardQueries } from '../usecases/dashboard-queries'

// HAC-06 (#261): el dashboard expone `arrivalsUnassigned` = reservas con check-in HOY, en estado
// pending|confirmed, sin habitación asignada (roomId null desde HAC-03).
const MS_PER_DAY = 86_400_000
const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + MS_PER_DAY).toISOString().slice(0, 10)

function makeOrm(reservations: any[]) {
  return {
    findMany: async (table: string, _filter: any) => {
      if (table === 'Rooms') return [{ id: 'rm1', type: 'double', status: 'available', number: '101' }]
      if (table === 'Reservations') return reservations
      return []
    },
  }
}

describe('DashboardQueries.getDashboard — arrivalsUnassigned', () => {
  it('cuenta solo las llegadas de hoy pending|confirmed sin roomId', async () => {
    const q = new DashboardQueries(makeOrm([
      { id: 'r1', status: 'confirmed', checkIn: today, checkOut: tomorrow, roomId: null, totalAmount: 100 },
      { id: 'r2', status: 'pending', checkIn: today, checkOut: tomorrow, roomId: null, totalAmount: 100 },
      { id: 'r3', status: 'confirmed', checkIn: today, checkOut: tomorrow, roomId: 'rm1', totalAmount: 100 },
      { id: 'r4', status: 'confirmed', checkIn: tomorrow, checkOut: tomorrow, roomId: null, totalAmount: 100 },
      { id: 'r5', status: 'cancelled', checkIn: today, checkOut: tomorrow, roomId: null, totalAmount: 100 },
    ]))
    const result = await q.getDashboard('h1')
    expect(result.arrivalsUnassigned).toBe(2)
    // `checkins` (confirmed|checked_in de hoy) no cambia por el nuevo contador.
    expect(result.checkins).toBe(2)
  })

  it('devuelve 0 sin reservas', async () => {
    const q = new DashboardQueries(makeOrm([]))
    const result = await q.getDashboard('h1')
    expect(result.arrivalsUnassigned).toBe(0)
  })
})
