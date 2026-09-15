import { describe, it, expect } from 'vitest'
import src from './index.vue?raw'

// El listado arma sus filas copiando campos a mano: un campo que no se copia se pierde sin error.
// En prod (2026-09-15) el badge de pago de las canceladas decía "Sin saldo" también en una reserva
// con 50 ya devueltos, porque la fila no traía refundAmount/refundStatus.
describe('listado de reservas — badge de pago de canceladas', () => {
  it('la fila copia los campos que necesita reservationPaymentBadge', () => {
    expect(src).toContain('cancellationFee: r.cancellationFee ?? 0')
    expect(src).toContain('refundAmount: r.refundAmount ?? 0')
    expect(src).toContain('refundStatus: r.refundStatus ?? null')
  })

  it('el badge y el CSV usan reservationPaymentBadge, no paymentState a secas', () => {
    expect(src).toContain('reservationPaymentBadge(r)')
    expect(src).not.toContain('paymentStateBadge(r.paymentState)')
  })
})
