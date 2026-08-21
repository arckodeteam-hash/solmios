// shared/tests/reservation-paid.test.ts — Lo cobrado de una reserva sale de `payments`.
//
// Hallazgo GH-0.2: `pendingBalance` tomaba `reservations.deposit` como "lo pagado". `deposit` no lo
// mueven `folios.applyPayment` ni `facturas.pay`, así que un cobro en efectivo por folio dejaba a
// la reserva figurando como impaga — y ese número es el techo con el que `charge-ceiling` autoriza
// una Checkout Session de Stripe.

import { describe, it, expect } from 'bun:test'
import { paidForReservation, sumPayments, paidSourceFrom } from '../usecases/reservation-paid'
import { pendingBalance } from '../utils/reservation-balance'

const HOTEL = 'h1'

function repos(data: { folios?: any[]; invoices?: any[]; payments?: any[] } = {}) {
  const calls: any[] = []
  return {
    calls,
    folioRepo: { findMany: async (f: any) => { calls.push(['folios', f]); return (data.folios ?? []).filter((x) => x.hotelId === f?.hotelId && x.reservationId === f?.reservationId) } },
    invoiceRepo: { findMany: async (f: any) => { calls.push(['invoices', f]); return (data.invoices ?? []).filter((x) => x.hotelId === f?.hotelId && x.reservationId === f?.reservationId) } },
    paymentRepo: {
      // Espeja el WHERE real: la consulta trae SÓLO las filas cuya columna consultada coincide.
      // Los tres vínculos (folioId / invoiceId / reservationId) se consultan por separado.
      findMany: async (f: any) => {
        calls.push(['payments', f])
        const key = f?.folioId !== undefined ? 'folioId' : f?.invoiceId !== undefined ? 'invoiceId' : 'reservationId'
        return (data.payments ?? []).filter((p) => p.hotelId === f?.hotelId && p[key] === f[key])
      },
    },
  }
}

const FOLIO = { id: 'f1', hotelId: HOTEL, reservationId: 'r1', status: 'open' }
const INVOICE = { id: 'inv1', hotelId: HOTEL, reservationId: 'r1' }

describe('sumPayments', () => {
  it('suma cobros y depósitos completados', () => {
    expect(sumPayments([
      { id: 'a', type: 'charge', status: 'completed', amount: 100 },
      { id: 'b', type: 'deposit', status: 'completed', amount: 50 },
    ])).toBe(150)
  })

  it('ignora lo que no está cobrado (pending / failed)', () => {
    expect(sumPayments([
      { id: 'a', type: 'charge', status: 'pending', amount: 100 },
      { id: 'b', type: 'charge', status: 'failed', amount: 100 },
    ])).toBe(0)
  })

  it('una devolución total netea a cero: el original queda `refunded` y suma, el refund resta', () => {
    // `payments/usecases/refund.ts` pasa el original a `refunded` y crea una fila `type:'refund'`
    // en `completed`. Descartar el original haría que la devolución restara dos veces.
    expect(sumPayments([
      { id: 'a', type: 'charge', status: 'refunded', amount: 500 },
      { id: 'b', type: 'refund', status: 'completed', amount: 500 },
    ])).toBe(0)
  })

  it('devolución parcial deja la diferencia', () => {
    expect(sumPayments([
      { id: 'a', type: 'charge', status: 'completed', amount: 500 },
      { id: 'b', type: 'refund', status: 'completed', amount: 200 },
    ])).toBe(300)
  })

  it('un retiro de caja no es un cobro al huésped: se ignora', () => {
    expect(sumPayments([{ id: 'a', type: 'withdrawal', status: 'completed', amount: 80 }])).toBe(0)
  })
})

describe('paidForReservation', () => {
  it('llega a `payments` por el folio de la reserva aunque `deposit` sea 0', async () => {
    const r = repos({
      folios: [FOLIO],
      payments: [{ id: 'p1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'completed', amount: 300 }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 0 })).toBe(300)
  })

  it('llega a `payments` por la factura de la reserva', async () => {
    const r = repos({
      invoices: [INVOICE],
      payments: [{ id: 'p1', hotelId: HOTEL, invoiceId: 'inv1', type: 'charge', status: 'completed', amount: 120 }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 0 })).toBe(120)
  })

  it('un pago que cuelga del folio Y de su factura se cuenta UNA vez', async () => {
    const pago = { id: 'p1', hotelId: HOTEL, folioId: 'f1', invoiceId: 'inv1', type: 'charge', status: 'completed', amount: 400 }
    const r = repos({ folios: [FOLIO], invoices: [INVOICE], payments: [pago] })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 0 })).toBe(400)
  })

  it('el webhook de Stripe suma a `deposit` Y a `payments`: se cuenta UNA vez, no dos', async () => {
    // Si se sumaran las dos fuentes, un cobro Stripe de $300 con folio abierto contaría $600.
    // La fila lleva `stripeSessionId` porque así la escribe `connectors/payment-requests-payments.ts`:
    // esa sesión es justamente lo que delata que la fila ESPEJA al `deposit` recién bumpeado.
    const r = repos({
      folios: [FOLIO],
      payments: [{ id: 'p1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'completed', amount: 300, stripeSessionId: 'cs_1' }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 300 })).toBe(300)
  })

  // ── GH-0.5: dos fuentes con plata DISTINTA ────────────────────────────────────────────────────
  // `max(deposit, sumPayments)` devolvía $200 con $300 realmente cobrados, y ese número es el techo
  // de `charge-ceiling.ts`: el panel podía emitir un link de Stripe por $100 ya cobrados en efectivo.
  it('anticipo manual en `deposit` + cobro en efectivo por folio se SUMAN', async () => {
    const r = repos({
      folios: [FOLIO],
      // Sin `stripeSessionId`: `folios.applyPayment` no toca `deposit`, así que no lo espeja.
      payments: [{ id: 'p1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'completed', amount: 100 }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 200 })).toBe(300)
  })

  it('anticipo manual + cobro Stripe + efectivo: el Stripe no se duplica y el efectivo sí suma', async () => {
    // `deposit` = 200 (anticipo manual) + 150 (bumpeado por el webhook) = 350.
    const r = repos({
      folios: [FOLIO],
      payments: [
        { id: 'p1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'completed', amount: 150, stripeSessionId: 'cs_1' },
        { id: 'p2', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'completed', amount: 100 },
      ],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 350 })).toBe(450)
  })

  it('devolver un cobro de Stripe baja lo cobrado aunque nadie decremente `deposit`', async () => {
    // Antes el refund quedaba tapado por el `max`: `deposit` seguía en 300 y el saldo no volvía.
    const r = repos({
      folios: [FOLIO],
      payments: [
        { id: 'p1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'refunded', amount: 300, stripeSessionId: 'cs_1' },
        { id: 'p2', hotelId: HOTEL, folioId: 'f1', type: 'refund', status: 'completed', amount: 300 },
      ],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 300 })).toBe(0)
  })

  it('un anticipo cargado a mano (sin fila en `payments`) sigue contando', async () => {
    const r = repos()
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 200 })).toBe(200)
  })

  it('multi-tenancy: TODAS las queries llevan el hotel y no ve el dinero de otro', async () => {
    const r = repos({
      folios: [{ ...FOLIO, hotelId: 'h2' }],
      payments: [{ id: 'p1', hotelId: 'h2', folioId: 'f1', type: 'charge', status: 'completed', amount: 999 }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 0 })).toBe(0)
    expect(r.calls.every(([, where]: any) => where?.hotelId === HOTEL)).toBe(true)
  })

  // COR-4: sin hotel NO se consulta nada Y NO se degrada en silencio. Devolver `deposit` calladito
  // era volver al bug que este archivo cierra: el techo del cobro quedaba medido contra la columna
  // espejo y autorizaba cobrar plata ya cobrada, sin que nada avisara.
  it('sin hotel rompe fuerte: no barre la tabla ni se cae a `deposit` en silencio', async () => {
    const r = repos({ folios: [FOLIO] })
    await expect(paidForReservation(r, '', 'r1', { deposit: 50 })).rejects.toThrow(/falta hotelId/)
    expect(r.calls).toHaveLength(0)
  })

  it('sin reserva tampoco: el id es obligatorio', async () => {
    const r = repos({ folios: [FOLIO] })
    await expect(paidForReservation(r, 'h1', '', { deposit: 50 })).rejects.toThrow(/falta reservationId/)
    expect(r.calls).toHaveLength(0)
  })
})

describe('paidSourceFrom + pendingBalance', () => {
  it('el saldo baja con lo cobrado por folio: es el techo que autoriza el cobro por Stripe', async () => {
    const r = repos({
      folios: [FOLIO],
      payments: [{ id: 'p1', hotelId: HOTEL, folioId: 'f1', type: 'charge', status: 'completed', amount: 300 }],
    })
    const reserva = { id: 'r1', hotelId: HOTEL, totalAmount: 500, otherCharges: 0, deposit: 0 }
    const paid = await paidSourceFrom(r)('r1', reserva)
    expect(pendingBalance(reserva, [], paid)).toBe(200)
    // Sin `paid` el mismo saldo daba 500: se autorizaba cobrar de nuevo los $300 ya cobrados.
    expect(pendingBalance(reserva, [])).toBe(500)
  })
})

// ── BUG-ceiling-bypass: el TERCER vínculo reserva → dinero ──────────────────────────────────────
// `shared/usecases/charge-reschedule-diff.ts` cobra la diferencia de una reprogramación en efectivo
// o con tarjeta y crea la fila de `payments` SIN folio y SIN factura. Mientras la reserva viajaba
// sólo en `metadata` (JSON, no filtrable por WHERE), esa plata no contaba como cobrada y el techo de
// `payment-requests` autorizaba una Checkout Session por el mismo importe.
describe('paidForReservation · cobro colgado directo de la reserva', () => {
  it('cuenta el cobro sin folio ni factura que lleva `payments.reservationId`', async () => {
    const r = repos({
      payments: [{ id: 'p1', hotelId: HOTEL, reservationId: 'r1', type: 'charge', method: 'cash', status: 'completed', amount: 150 }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 0 })).toBe(150)
  })

  it('no lo cuenta dos veces si además cuelga de un folio', async () => {
    const r = repos({
      folios: [FOLIO],
      payments: [{ id: 'p1', hotelId: HOTEL, reservationId: 'r1', folioId: 'f1', type: 'charge', status: 'completed', amount: 150 }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 0 })).toBe(150)
  })

  it('el cobro suelto se suma al anticipo, no compite con él en el `max`', async () => {
    // Sin sesión de Stripe ⇒ `independent`: no espeja `deposit`, se acumula encima.
    const r = repos({
      payments: [{ id: 'p1', hotelId: HOTEL, reservationId: 'r1', type: 'charge', method: 'cash', status: 'completed', amount: 100 }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 200 })).toBe(300)
  })

  it('multi-tenancy: no toma el cobro de otro hotel con el mismo reservationId', async () => {
    const r = repos({
      payments: [{ id: 'p1', hotelId: 'h2', reservationId: 'r1', type: 'charge', status: 'completed', amount: 999 }],
    })
    expect(await paidForReservation(r, HOTEL, 'r1', { deposit: 0 })).toBe(0)
  })

  it('la reprogramación cobrada en efectivo deja el pendiente en cero, no recobrable', async () => {
    // commitReschedule sube totalAmount 500 → 650 y cobra los 150 en efectivo (sin folio).
    const r = repos({
      payments: [{ id: 'p1', hotelId: HOTEL, reservationId: 'r1', type: 'charge', method: 'cash', status: 'completed', amount: 150 }],
    })
    const paid = await paidForReservation(r, HOTEL, 'r1', { deposit: 500 })
    expect(paid).toBe(650)
    expect(pendingBalance({ totalAmount: 650, otherCharges: 0 } as any, [], paid)).toBe(0)
  })
})
