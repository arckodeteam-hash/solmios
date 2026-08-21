// reservas/tests/reservas-queries-tenancy.test.ts — SEC-4: los extras de una reserva se leen con
// el hotel, no sólo con el `reservationId`.
//
// `getReservationAddons` hacía `findMany('ReservationAddons', { reservationId })` a secas, contra
// el comentario del propio archivo ("Multi-tenancy: TODAS llevan hotelId"). Desde GH-0.1 esos
// importes entran al saldo cobrable (`shared/utils/reservation-balance`), que es el techo de la
// Checkout Session de Stripe: un extra de otro hotel movía cuánto se le podía cobrar al huésped.

import { describe, it, expect } from 'bun:test'
import { ReservasQueries } from '../usecases/reservas-queries'

function fakeOrm() {
  const calls: Array<{ model: string; where: any }> = []
  return {
    calls,
    findMany: async (model: string, where: any) => { calls.push({ model, where }); return [] },
  }
}

describe('SEC-4 · getReservationAddons filtra por hotel', () => {
  it('manda `hotelId` en el WHERE', async () => {
    const orm = fakeOrm()
    const q = new ReservasQueries(orm)
    await q.getReservationAddons('r1', 'h1')
    expect(orm.calls).toEqual([{ model: 'ReservationAddons', where: { reservationId: 'r1', hotelId: 'h1' } }])
  })

  it('sin hotel rompe fuerte y NO consulta la tabla', async () => {
    const orm = fakeOrm()
    const q = new ReservasQueries(orm)
    await expect(q.getReservationAddons('r1', '')).rejects.toThrow(/sin hotelId/)
    expect(orm.calls).toHaveLength(0)
  })
})
