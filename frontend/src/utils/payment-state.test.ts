// payment-state.test.ts — el badge de pago del listado y del modal sale de `paymentState` del
// backend; acá se fija el mapeo estado → etiqueta/color para que ambos lugares pinten lo mismo.
import { describe, it, expect } from 'vitest'
import { paymentStateBadge, reservationPaymentBadge } from './payment-state'

describe('paymentStateBadge — estado de pago → badge', () => {
  it('pending → "Pendiente" en coral', () => {
    const b = paymentStateBadge('pending')
    expect(b.label).toBe('Pendiente')
    expect(b.cls).toBe('bg-coral/10 text-coral')
  })

  it('partial → "Parcial" en dorado', () => {
    const b = paymentStateBadge('partial')
    expect(b.label).toBe('Parcial')
    expect(b.cls).toBe('bg-gold/10 text-gold')
  })

  it('paid → "Pagada" en teal', () => {
    const b = paymentStateBadge('paid')
    expect(b.label).toBe('Pagada')
    expect(b.cls).toBe('bg-teal/10 text-teal')
  })

  it('desconocido/vacío → "—" en gris (respuestas sin paymentState no inventan estado)', () => {
    for (const s of ['otro', '', null, undefined]) {
      const b = paymentStateBadge(s)
      expect(b.label).toBe('—')
      expect(b.cls).toBe('bg-gray-100 text-gray-500')
    }
  })
})

describe('reservationPaymentBadge — reserva cancelada', () => {
  it('reserva viva: mismo badge que paymentState', () => {
    expect(reservationPaymentBadge({ status: 'confirmed', paymentState: 'pending' }).label).toBe('Pendiente')
    expect(reservationPaymentBadge({ status: 'checked_in', paymentState: 'paid' }).label).toBe('Pagada')
  })

  it('cancelada sin cobro ni penalidad: "Sin saldo", nunca "Pendiente" (caso real de prod)', () => {
    const b = reservationPaymentBadge({ status: 'cancelled', paymentState: 'pending', cancellationFee: 0, refundAmount: 0, refundStatus: 'none' })
    expect(b.label).toBe('Sin saldo')
    expect(b.cls).toBe('bg-gray-100 text-gray-500')
  })

  it('cancelada con dinero por devolver: "A devolver"', () => {
    expect(reservationPaymentBadge({ status: 'cancelled', paymentState: 'paid', refundAmount: 200, refundStatus: 'none' }).label).toBe('A devolver')
    expect(reservationPaymentBadge({ status: 'cancelled', paymentState: 'paid', refundAmount: 200, refundStatus: 'failed' }).label).toBe('A devolver')
  })

  it('cancelada ya devuelta: "Devuelto" (la reserva de prueba de prod: 50 cobrados y 50 devueltos)', () => {
    expect(reservationPaymentBadge({ status: 'cancelled', paymentState: 'pending', cancellationFee: 0, refundAmount: 50, refundStatus: 'done' }).label).toBe('Devuelto')
  })

  it('cancelada que debe la penalidad sin pagar: "Penalidad pendiente"', () => {
    expect(reservationPaymentBadge({ status: 'cancelled', paymentState: 'pending', cancellationFee: 100, refundAmount: 0 }).label).toBe('Penalidad pendiente')
  })

  it('cancelada con penalidad ya cubierta por lo cobrado: "Sin saldo"', () => {
    expect(reservationPaymentBadge({ status: 'cancelled', paymentState: 'paid', cancellationFee: 100, refundAmount: 0 }).label).toBe('Sin saldo')
  })
})
