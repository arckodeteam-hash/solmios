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

function ormWith(over: { reserva?: any; payments?: any[]; addons?: any[] } = {}) {
  const reserva = over.reserva === undefined ? RES : over.reserva
  return {
    findMany: async (table: string, filter: any) => {
      if (table === 'Reservations') return reserva && reserva.id === filter.id ? [reserva] : []
      if (table === 'Guests') return [{ id: 'g1', name: 'LUIS BERNIEL', email: 'l@x.com' }]
      if (table === 'Payments') return over.payments ?? []
      if (table === 'ReservationAddons') return over.addons ?? []
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

  // Auditoría final (2026-09-04) — FIX: comparaba lo cobrado contra `totalAmount` crudo, ignorando
  // `otherCharges`/extras — el MISMO bug (2026-08-19) que Administración (`getExtendedDetail`) ya
  // había resuelto, nunca migrado a esta pantalla pública. Sin el fix, esta reserva (alojamiento
  // 500 + 100 de extras = 600 cobrables, 500 cobrados) diría "paid"/"pendingAmount:0" — mintiendo
  // sobre los 100 de extras sin cobrar.
  it('el pendiente cuenta los extras (ReservationAddons), no solo el alojamiento', async () => {
    const orm = ormWith({
      reserva: { ...RES, totalAmount: 500, deposit: 500 },
      addons: [{ id: 'a1', reservationId: RES.id, hotelId: 'h1', description: 'Cena', amount: 100, quantity: 1, kind: 'service' }],
    })
    const r = await getPublicReservation(orm, RES.id, tokenFor(RES))
    expect(r.body.reservation.paymentStatus).toBe('partial') // 500 cobrados de 600 cobrables
    expect(r.body.reservation.pendingAmount).toBe(100)
  })

  it('sin extras: el comportamiento es idéntico al de antes (chargeableTotal degrada a totalAmount)', async () => {
    const r = await getPublicReservation(ormWith(), RES.id, tokenFor(RES))
    expect(r.body.reservation.paymentStatus).toBe('paid')
    expect(r.body.reservation.pendingAmount).toBe(0)
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
