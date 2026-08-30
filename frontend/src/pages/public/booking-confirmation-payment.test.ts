import { describe, it, expect } from 'vitest'
import src from './booking-confirmation.vue?raw'
import i18nSrc from '@/composables/useBookingI18n.ts?raw'

// La confirmación mostraba "Total 613.6" y nada más: el huésped que acababa de pagar no tenía
// forma de saber si el pago entró (reporte de cliente 2026-08-30). El backend además mandaba
// `paymentStatus` leyendo una columna inexistente, así que decía 'unpaid' siempre.

describe('confirmación pública: el pago se ve', () => {
  it('muestra lo pagado y el saldo', () => {
    expect(src).toContain('data-testid="confirm-paid"')
    expect(src).toContain('data-testid="confirm-pending"')
    expect(src).toContain('amountPaid')
    expect(src).toContain('pendingAmount')
  })

  it('dice el estado en palabras, no solo números', () => {
    expect(src).toContain('data-testid="confirm-payment-state"')
    expect(src).toContain("confirm.paidInFull")
    expect(src).toContain("confirm.partiallyPaid")
    expect(src).toContain("confirm.notPaid")
  })

  it('los importes salen con su moneda, no pelados', () => {
    expect(src).toContain('function fmtMoney')
    expect(src).toContain("fmtMoney(reservation.reservation.totalAmount)")
    // El total ya no se interpola crudo.
    expect(src).not.toMatch(/>\{\{ reservation\.reservation\.totalAmount \}\}</)
  })
})

// `messages` no se exporta del composable, así que se verifica sobre el fuente: cada clave del
// pago tiene que estar las 3 veces (es/en/pt). Una traducción faltante deja el texto en blanco.
describe('textos del pago en los 3 idiomas', () => {
  const KEYS = ['confirm.paid', 'confirm.pendingAmount', 'confirm.paidInFull', 'confirm.partiallyPaid', 'confirm.notPaid']

  it.each(KEYS)('%s está en los 3 idiomas', (key) => {
    const occurrences = i18nSrc.split(`'${key}':`).length - 1
    expect(occurrences).toBe(3)
  })
})
