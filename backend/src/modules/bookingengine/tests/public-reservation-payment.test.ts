import { describe, it, expect } from 'bun:test'
import { getPublicReservation } from '../usecases/public-reservation'
import { createHmac } from 'node:crypto'

// La pantalla de confirmación mostraba "Total 613.6" y nada más: no se sabía si estaba pagado.
// Causa: el endpoint leía `reservation.paymentStatus`, columna que NO existe en `reservations`
// (la operacional es `depositStatus`), así que devolvía 'unpaid' incluso cobrada al 100%.

const RES = {
  id: 'e2a20714', hotelId: 'h1', guestId: 'g1', accessToken: 'tok-secreto',
  checkIn: '2026-08-31', checkOut: '2026-09-04', status: 'confirmed',
  totalAmount: 613.6, deposit: 613.6, currency: 'USD',
}

function tokenFor(reservation: any): string {
  return reservation.accessToken
}

function ormWith(over: { reserva?: any; payments?: any[] } = {}) {
  const reserva = over.reserva === undefined ? RES : over.reserva
  return {
    findMany: async (table: string, filter: any) => {
      if (table === 'Reservations') return reserva && reserva.id === filter.id ? [reserva] : []
      if (table === 'Guests') return [{ id: 'g1', name: 'LUIS BERNIEL', email: 'l@x.com' }]
      if (table === 'Payments') return over.payments ?? []
      return []
    },
  }
}

describe('confirmación pública: el huésped ve su pago', () => {
  it('una reserva cobrada al 100% NO dice unpaid', async () => {
    const r = await getPublicReservation(ormWith(), RES.id, tokenFor(RES))
    expect(r.status).toBe(200)
    expect(r.body.reservation.paymentStatus).toBe('paid')
    expect(r.body.paymentStatus).toBe('paid')
  })

  it('informa cuánto pagó y cuánto queda', async () => {
    const r = await getPublicReservation(ormWith(), RES.id, tokenFor(RES))
    expect(r.body.reservation.amountPaid).toBe(613.6)
    expect(r.body.reservation.pendingAmount).toBe(0)
  })

  it('pago parcial: estado y saldo correctos', async () => {
    const orm = ormWith({ reserva: { ...RES, deposit: 200 } })
    const r = await getPublicReservation(orm, RES.id, tokenFor(RES))
    expect(r.body.reservation.paymentStatus).toBe('partial')
    expect(r.body.reservation.pendingAmount).toBe(413.6)
  })

  it('sin pagos dice unpaid y no inventa un cobro', async () => {
    const orm = ormWith({ reserva: { ...RES, deposit: 0 } })
    const r = await getPublicReservation(orm, RES.id, tokenFor(RES))
    expect(r.body.reservation.paymentStatus).toBe('unpaid')
    expect(r.body.reservation.amountPaid).toBe(0)
  })

  it('cuenta el cobro asentado en payments aunque deposit sea 0 (pago en efectivo)', async () => {
    const orm = ormWith({
      reserva: { ...RES, deposit: 0 },
      payments: [{ id: 'p1', reservationId: RES.id, hotelId: 'h1', amount: 613.6, type: 'charge', status: 'completed' }],
    })
    const r = await getPublicReservation(orm, RES.id, tokenFor(RES))
    expect(r.body.reservation.paymentStatus).toBe('paid')
    expect(r.body.reservation.amountPaid).toBe(613.6)
  })

  it('devuelve la moneda para que el importe no salga pelado', async () => {
    const r = await getPublicReservation(ormWith(), RES.id, tokenFor(RES))
    expect(r.body.reservation.currency).toBe('USD')
  })

  it('sigue siendo anti-IDOR: token incorrecto no revela nada', async () => {
    const r = await getPublicReservation(ormWith(), RES.id, 'token-falso')
    expect(r.status).toBe(404)
    expect(r.body.reservation).toBeUndefined()
  })

  it('NO filtra datos internos del hotel junto con el pago', async () => {
    const orm = ormWith({ reserva: { ...RES, ownerNotes: 'interno', cardLast4: '4242', accessToken: 'tok-secreto' } })
    const r = await getPublicReservation(orm, RES.id, tokenFor(RES))
    expect(r.body.reservation.ownerNotes).toBeUndefined()
    expect(r.body.reservation.cardLast4).toBeUndefined()
    expect(r.body.reservation.accessToken).toBeUndefined()
    expect(r.body.reservation.deposit).toBeUndefined()
  })
})
