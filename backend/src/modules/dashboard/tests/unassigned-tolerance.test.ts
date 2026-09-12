import { describe, it, expect } from 'bun:test'
import { DashboardQueries } from '../usecases/dashboard-queries'

// #262 REQ-HAC-07: con HAC-01 la reserva nace con roomId = null hasta el check-in. Las consultas
// del dashboard que enriquecen reservas con la habitación (lista de check-ins y planning) tienen
// que tolerar el null: sin excepción y `roomNumber: ''` para que el front muestre "por asignar".
const MS_PER_DAY = 86_400_000
const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + MS_PER_DAY).toISOString().slice(0, 10)

function makeOrm(reservations: any[]) {
  return {
    findMany: async (table: string, _filter: any) => {
      if (table === 'Rooms') return [{ id: 'rm1', hotelId: 'h1', type: 'double', status: 'available', number: '101' }]
      if (table === 'Reservations') return reservations
      if (table === 'Guests') return [{ id: 'g1', hotelId: 'h1', name: 'Ana', email: 'ana@test.com' }]
      return []
    },
  }
}

const unassigned = { id: 'r1', hotelId: 'h1', guestId: 'g1', status: 'confirmed', checkIn: today, checkOut: tomorrow, roomId: null, totalAmount: 100 }
const assigned = { id: 'r2', hotelId: 'h1', guestId: 'g1', status: 'confirmed', checkIn: today, checkOut: tomorrow, roomId: 'rm1', totalAmount: 100 }

describe('#262 REQ-HAC-07 — dashboard tolera roomId nulo', () => {
  it('getCheckinList: llegada de hoy confirmed sin roomId entra en checkins con roomNumber vacío', async () => {
    const q = new DashboardQueries(makeOrm([unassigned, assigned]))

    const result = await q.getCheckinList('h1')

    expect(result.pendingCheckins).toBe(2)
    const r1 = result.checkins.find((r: any) => r.id === 'r1')
    expect(r1).toBeDefined()
    expect(r1).toMatchObject({ roomId: null, roomNumber: '', guestName: 'Ana', guestEmail: 'ana@test.com' })
    // La que sí tiene habitación sigue resolviendo el número.
    expect(result.checkins.find((r: any) => r.id === 'r2')?.roomNumber).toBe('101')
    expect(result.checkouts).toEqual([])
  })

  it('getPlanning: enriquece la reserva sin roomId con roomNumber vacío y sin excepción', async () => {
    const q = new DashboardQueries(makeOrm([unassigned, assigned]))

    const result = await q.getPlanning('h1')

    expect(result.rooms).toHaveLength(1)
    expect(result.reservas).toHaveLength(2)
    const r1 = result.reservas.find((r: any) => r.id === 'r1')
    expect(r1).toMatchObject({ roomId: null, roomNumber: '', guestName: 'Ana', paymentStatus: expect.any(String) })
    expect(result.reservas.find((r: any) => r.id === 'r2')?.roomNumber).toBe('101')
  })

  it('getDashboard: la llegada sin habitación cuenta en checkins y arrivalsUnassigned sin romper', async () => {
    const q = new DashboardQueries(makeOrm([unassigned, assigned]))

    const result = await q.getDashboard('h1')

    expect(result.checkins).toBe(2)
    expect(result.arrivalsUnassigned).toBe(1)
    expect(result.reservas).toBe(2)
  })
})
