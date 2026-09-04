import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { DashboardService } from '../service'
import { DashboardQueries } from '../usecases/dashboard-queries'

const log = silentLogger()

function makeOrm(overrides: Partial<Record<string, any>> = {}) {
  return {
    findMany: async (table: string, _filter: any) => {
      if (table === 'Rooms') return [
        { id: 'rm1', type: 'standard', status: 'occupied', number: '101' },
        { id: 'rm2', type: 'suite', status: 'vacant', number: '201' },
      ]
      if (table === 'Reservations') return [
        { id: 'r1', totalAmount: 200, status: 'checked_in', checkIn: new Date().toISOString(), checkOut: new Date(Date.now() + 86400000).toISOString(), roomId: 'rm1', guestId: 'g1' },
      ]
      if (table === 'Guests') return [{ id: 'g1', name: 'John', email: 'john@test.com' }]
      if (table === 'Users') return [{ id: 'u1', hotelId: 'h1' }]
      if (table === 'Hotels') return [{ id: 'h1' }]
      return []
    },
    ...overrides,
  }
}

describe('DashboardService', () => {
  describe('getDashboard', () => {
    it('returns aggregated dashboard data', async () => {
      const svc = new DashboardService(log, new DashboardQueries(makeOrm()))
      const result = await svc.getDashboard({ user: { id: 'u1' }, query: {} })
      expect(result.totalRooms).toBe(2)
      expect(result.occupied).toBe(1)
      expect(result.revenue).toBe(200)
    })

    it('excludes cancelled and no-show reservations from revenue', async () => {
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Reservations') return [
            { id: 'r1', totalAmount: 200, status: 'checked_in', checkIn: new Date().toISOString() },
            { id: 'r2', totalAmount: 500, status: 'cancelled', checkIn: new Date().toISOString() },
            { id: 'r3', totalAmount: 300, status: 'no_show', checkIn: new Date().toISOString() },
          ]
          if (table === 'Rooms') return [{ id: 'rm1', type: 'standard', status: 'occupied' }]
          if (table === 'Guests') return [{ id: 'g1', name: 'John' }]
          return []
        },
      })
      const svc = new DashboardService(log, new DashboardQueries(orm))
      const result = await svc.getDashboard({ query: { hotelId: 'h1' } })
      // Solo r1 (200) cuenta; cancelled (500) y no_show (300) se excluyen del dinero.
      expect(result.revenue).toBe(200)
      expect(result.revenueToday).toBe(200)
    })
  })

  describe('getPlanning', () => {
    it('returns rooms and enriched reservations', async () => {
      const svc = new DashboardService(log, new DashboardQueries(makeOrm()))
      const result = await svc.getPlanning({ user: { id: 'u1' }, query: {} })
      expect(result.rooms).toHaveLength(2)
      expect(result.reservas).toHaveLength(1)
    })

    // Auditoría final (Requerimiento 15, 2026-09-04) — FIX GH-0.2: `paymentStatus` se calculaba
    // con `reservations.deposit`, que `folios.applyPayment`/`facturas.pay` nunca tocan. Una reserva
    // cobrada en efectivo por folio (deposit=0) mostraba "pendiente" en el planning/calendario
    // mientras Administración (`getExtendedDetail`) ya la veía "pagada" — misma reserva, dos
    // pantallas contradictorias. `paidAmountsByReservation` (batch, sin N+1) resuelve el REAL
    // cobrado desde `payments`, igual que `getExtendedDetail`.
    it('reserva cobrada en efectivo por folio (deposit=0): paymentStatus="paid", NO "pending"', async () => {
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Reservations') return [{ id: 'r1', totalAmount: 200, deposit: 0, status: 'checked_in', roomId: 'rm1', guestId: 'g1' }]
          if (table === 'Rooms') return [{ id: 'rm1', type: 'standard', status: 'occupied', number: '101' }]
          if (table === 'Guests') return [{ id: 'g1', name: 'John', email: 'john@test.com' }]
          if (table === 'Folios') return [{ id: 'f1', hotelId: 'h1', reservationId: 'r1', status: 'open' }]
          if (table === 'Payment') return [{ id: 'pay1', hotelId: 'h1', folioId: 'f1', type: 'charge', status: 'completed', amount: 200 }]
          return []
        },
      })
      const svc = new DashboardService(log, new DashboardQueries(orm))
      const result = await svc.getPlanning({ query: { hotelId: 'h1' } })
      expect(result.reservas[0].paymentStatus).toBe('paid')
    })

    it('reserva sin ningún cobro: paymentStatus="pending" (comportamiento previo intacto)', async () => {
      const svc = new DashboardService(log, new DashboardQueries(makeOrm()))
      const result = await svc.getPlanning({ user: { id: 'u1' }, query: {} })
      expect(result.reservas[0].paymentStatus).toBe('pending')
    })

    it('un intento de pago FALLIDO no cuenta como cobrado: sigue "pending"', async () => {
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Reservations') return [{ id: 'r1', totalAmount: 200, deposit: 0, status: 'checked_in', roomId: 'rm1', guestId: 'g1' }]
          if (table === 'Rooms') return [{ id: 'rm1', type: 'standard', status: 'occupied', number: '101' }]
          if (table === 'Guests') return [{ id: 'g1', name: 'John', email: 'john@test.com' }]
          if (table === 'Payment') return [{ id: 'pay1', hotelId: 'h1', reservationId: 'r1', type: 'charge', status: 'failed', amount: 200 }]
          return []
        },
      })
      const svc = new DashboardService(log, new DashboardQueries(orm))
      const result = await svc.getPlanning({ query: { hotelId: 'h1' } })
      expect(result.reservas[0].paymentStatus).toBe('pending')
    })

    it('reserva de varias habitaciones (groupId): el cobro de una NO se filtra al paymentStatus de la hermana', async () => {
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Reservations') return [
            { id: 'r-a', groupId: 'g1', totalAmount: 200, deposit: 0, status: 'checked_in', roomId: 'rm1', guestId: 'g1' },
            { id: 'r-b', groupId: 'g1', totalAmount: 200, deposit: 0, status: 'checked_in', roomId: 'rm2', guestId: 'g1' },
          ]
          if (table === 'Rooms') return [
            { id: 'rm1', type: 'standard', status: 'occupied', number: '101' },
            { id: 'rm2', type: 'standard', status: 'occupied', number: '102' },
          ]
          if (table === 'Guests') return [{ id: 'g1', name: 'John', email: 'john@test.com' }]
          if (table === 'Payment') return [{ id: 'pay1', hotelId: 'h1', reservationId: 'r-a', type: 'charge', status: 'completed', amount: 200 }]
          return []
        },
      })
      const svc = new DashboardService(log, new DashboardQueries(orm))
      const result = await svc.getPlanning({ query: { hotelId: 'h1' } })
      const byId = Object.fromEntries(result.reservas.map((r: any) => [r.id, r]))
      expect(byId['r-a'].paymentStatus).toBe('paid')
      expect(byId['r-b'].paymentStatus).toBe('pending')
    })
  })
})
