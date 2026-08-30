import { describe, it, expect } from 'bun:test'
import { paymentStatusOf, paymentAmountsOf } from '../payment-status'

// `reservations` no tiene columna `paymentStatus`: el endpoint público la leía igual y devolvía
// SIEMPRE 'unpaid', incluso con la reserva cobrada al 100% (reporte de cliente 2026-08-30).

describe('paymentStatusOf', () => {
  it('pagado completo', () => expect(paymentStatusOf(613.6, 613.6)).toBe('paid'))
  it('pagado de más (propina/redondeo) sigue siendo pagado', () => expect(paymentStatusOf(100, 120)).toBe('paid'))
  it('pago parcial', () => expect(paymentStatusOf(613.6, 200)).toBe('partial'))
  it('sin pagar', () => expect(paymentStatusOf(613.6, 0)).toBe('unpaid'))

  it('el centavo de redondeo NO deja una reserva cobrada como parcial', () => {
    expect(paymentStatusOf(613.6, 613.59)).toBe('paid')
    expect(paymentStatusOf(100.02, 100.01)).toBe('paid')
  })

  it('una diferencia real sí es parcial', () => {
    expect(paymentStatusOf(613.6, 613.0)).toBe('partial')
  })

  it('total 0 sin pagos es unpaid, NO paid — no se anuncia cobrada la que nunca se cobró', () => {
    expect(paymentStatusOf(0, 0)).toBe('unpaid')
  })

  it('total 0 ya saldado (cortesía) es paid', () => {
    expect(paymentStatusOf(0, 50)).toBe('paid')
  })

  it('valores basura no rompen ni inventan un pago', () => {
    expect(paymentStatusOf(null, undefined)).toBe('unpaid')
    expect(paymentStatusOf('x', 'y')).toBe('unpaid')
    expect(paymentStatusOf(100, -5)).toBe('unpaid')
    expect(paymentStatusOf(100, NaN)).toBe('unpaid')
  })
})

describe('paymentAmountsOf', () => {
  it('devuelve pagado y saldo redondeados', () => {
    expect(paymentAmountsOf(613.6, 613.6)).toEqual({ status: 'paid', paid: 613.6, pending: 0 })
  })
  it('el saldo nunca es negativo aunque se haya pagado de más', () => {
    expect(paymentAmountsOf(100, 150).pending).toBe(0)
  })
  it('pago parcial informa el saldo exacto', () => {
    const r = paymentAmountsOf(613.6, 200)
    expect(r.status).toBe('partial')
    expect(r.pending).toBe(413.6)
  })
})
