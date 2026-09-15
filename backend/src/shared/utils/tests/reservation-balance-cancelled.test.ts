// Saldo de una reserva CANCELADA: lo único cobrable es la penalidad.
// Caso real del panel (2026-09-15): 400 cobrados, cancelada con 50%, devueltos 200 → mostraba
// "Pendiente de cobro 200", "Parcial" y dejaba registrar otro cobro.
import { describe, it, expect } from 'bun:test'
import { chargeableTotal, pendingBalance, creditBalance, paymentState } from '../reservation-balance'

const cancelled = { totalAmount: 400, otherCharges: 30, status: 'cancelled', cancellationFee: 200 }
const extras = [{ kind: 'service', amount: 50, quantity: 1 }] as any[]

describe('reservation-balance — reserva cancelada', () => {
  it('lo cobrable es la penalidad (ni estadía, ni otros cobros, ni extras)', () => {
    expect(chargeableTotal(cancelled, extras)).toBe(200)
  })

  it('antes de devolver (cobrado 400): saldo 0, a favor 200, pagada', () => {
    expect(pendingBalance(cancelled, extras, 400)).toBe(0)
    expect(creditBalance(cancelled, extras, 400)).toBe(200)
    expect(paymentState(cancelled, extras, 400)).toBe('paid')
  })

  it('después de devolver (cobrado neto 200): saldo 0, nada a favor, no queda "Parcial"', () => {
    expect(pendingBalance(cancelled, extras, 200)).toBe(0)
    expect(creditBalance(cancelled, extras, 200)).toBe(0)
    expect(paymentState(cancelled, extras, 200)).toBe('paid')
  })

  it('cancelada sin penalidad y sin cobro: nada pendiente', () => {
    expect(pendingBalance({ totalAmount: 400, status: 'cancelled', cancellationFee: 0 }, [], 0)).toBe(0)
  })

  it('reserva viva: sin cambios (estadía + otros + extras)', () => {
    expect(chargeableTotal({ totalAmount: 400, otherCharges: 30, status: 'confirmed' }, extras)).toBe(480)
    expect(pendingBalance({ totalAmount: 400, otherCharges: 30, status: 'confirmed' }, extras, 200)).toBe(280)
  })
})
