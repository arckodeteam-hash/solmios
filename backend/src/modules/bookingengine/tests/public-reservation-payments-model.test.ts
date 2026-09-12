// #312 — La confirmación pública consultaba el modelo 'Payments' y el ORM lo registra como
// 'Payment' (payments/model.ts:73). La consulta tiraba, el `try/catch` de public-reservation.ts
// se lo tragaba y `paid` caía a `reservation.deposit`: un cobro que NO pasó por el motor web
// (efectivo por folio, transferencia asentada a mano) era invisible para el huésped.
//
// Por qué no lo vio ningún test: el mock de `public-reservation-payment.test.ts` responde al MISMO
// nombre equivocado ('Payments'), así que estaba de acuerdo con el defecto. Este mock usa el nombre
// REAL del registro; si alguien vuelve a escribir 'Payments', estos tests se ponen en rojo.
import { describe, it, expect } from 'bun:test'
import { getPublicReservation } from '../usecases/public-reservation'

const RES = {
  id: 'r-312', hotelId: 'h1', guestId: 'g1', accessToken: 'tok-312',
  checkIn: '2026-09-20', checkOut: '2026-09-22', status: 'confirmed',
  // `deposit` en 0 a propósito: es el valor al que caía el fallback. Si el test pasa con el bug
  // puesto, es que está mirando el espejo y no `payments`.
  totalAmount: 500, deposit: 0, currency: 'USD',
}

/** ORM que SOLO conoce los nombres realmente registrados (`Payment` singular, `Folios`, `Invoices`). */
function orm(payments: any[] = []) {
  return {
    findMany: async (model: string, filter: any) => {
      switch (model) {
        case 'Reservations': return filter.id === RES.id ? [RES] : []
        case 'Guests': return [{ id: 'g1', name: 'Ana Test', email: 'a@x.com' }]
        case 'Payment': return payments.filter((p) => p.hotelId === filter.hotelId)
        case 'Folios': case 'Invoices': case 'ReservationAddons': case 'Rooms': case 'BookingConfig': return []
        // Cualquier otro nombre es un error del caller: que reviente, no que devuelva [].
        default: throw new Error(`modelo no registrado en el ORM: '${model}'`)
      }
    },
  }
}

const pago = (over: Record<string, unknown> = {}) => ({
  id: 'p1', hotelId: 'h1', reservationId: RES.id, amount: 300, status: 'completed',
  method: 'cash', type: 'charge', ...over,   // 'charge' es lo que cuenta (CREDIT_TYPES)
})

describe('#312 — la confirmación pública lee los pagos del modelo que el ORM registra', () => {
  it('un cobro fuera del motor web (efectivo) se ve, aunque `deposit` sea 0', async () => {
    const r = await getPublicReservation(orm([pago()]), RES.id, RES.accessToken)
    expect(r.status).toBe(200)
    expect(r.body.reservation.amountPaid).toBe(300)
    expect(r.body.reservation.pendingAmount).toBe(200)
    expect(r.body.reservation.paymentStatus).toBe('partial')
  })

  it('cobrada al 100% por fuera del motor: paid, sin saldo', async () => {
    const r = await getPublicReservation(orm([pago({ amount: 500 })]), RES.id, RES.accessToken)
    expect(r.body.reservation.amountPaid).toBe(500)
    expect(r.body.reservation.pendingAmount).toBe(0)
    expect(r.body.reservation.paymentStatus).toBe('paid')
  })

  it('sin pagos no inventa un cobro', async () => {
    const r = await getPublicReservation(orm([]), RES.id, RES.accessToken)
    expect(r.body.reservation.amountPaid).toBe(0)
    expect(r.body.reservation.paymentStatus).toBe('unpaid')
  })

  it('aislamiento: un pago de OTRO hotel no suma', async () => {
    const r = await getPublicReservation(orm([pago({ hotelId: 'OTRO', amount: 999 })]), RES.id, RES.accessToken)
    expect(r.body.reservation.amountPaid).toBe(0)
  })
})
