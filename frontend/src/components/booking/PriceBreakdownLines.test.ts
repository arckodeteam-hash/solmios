// PriceBreakdownLines.test.ts — Tarea 24 (#88): la confirmación repite el desglose que el huésped
// aceptó al pagar; sin desglose (reserva vieja o del panel) muestra solo el total, nunca inventa.
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PriceBreakdownLines from './PriceBreakdownLines.vue'
import { useBookingI18nStore } from '@/composables/useBookingI18n'

const fmt = (n: unknown) => `${Number(n).toFixed(2)} USD`

describe('PriceBreakdownLines (#88)', () => {
  beforeEach(() => { setActivePinia(createPinia()); useBookingI18nStore().setLocale('es') })

  it('muestra alojamiento, extras, descuento, cada impuesto y el total del desglose persistido', () => {
    const w = mount(PriceBreakdownLines, { props: {
      breakdown: { subtotal: 270, promoDiscount: 20, upsellsTotal: 70, taxes: 45, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 45 }], total: 295 },
      total: 295, format: fmt,
    } })
    const text = w.text().replace(/\s+/g, ' ')
    expect(text).toContain('Alojamiento')
    expect(text).toContain('200.00 USD')   // subtotal − extras
    expect(text).toContain('Extras')
    expect(text).toContain('70.00 USD')
    expect(text).toContain('−20.00 USD')
    expect(w.findAll('[data-testid="tax-line"]')).toHaveLength(1)
    expect(text).toContain('ITBIS (18%)')
    expect(text).toContain('45.00 USD')
    expect(w.find('[data-testid="final-total"]').text()).toBe('295.00 USD')
  })

  it('sin desglose (reserva anterior a la feature) muestra solo el total', () => {
    const w = mount(PriceBreakdownLines, { props: { breakdown: null, total: 150, format: fmt } })
    expect(w.findAll('[data-testid="tax-line"]')).toHaveLength(0)
    expect(w.text()).not.toContain('Alojamiento')
    expect(w.find('[data-testid="final-total"]').text()).toBe('150.00 USD')
  })
})
