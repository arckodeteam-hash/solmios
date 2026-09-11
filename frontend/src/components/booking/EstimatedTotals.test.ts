// EstimatedTotals.test.ts — Issue #220: el huésped veía "Tu selección" en 130 y el paso de pago en
// 153.40 sin ninguna línea que explicara el salto (ITBIS 18%). Este componente muestra el desglose
// estimado ANTES de crear la reserva, leyendo los computeds del store (misma cuenta que el backend,
// ver useBooking.taxes.test.ts). Acá se protege que lo que se RENDERIZA sea esa cuenta.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn(), createBooking: vi.fn(), validatePromo: vi.fn() },
}))

import EstimatedTotals from './EstimatedTotals.vue'
import { useBookingStore, type CartLine } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'

const format = (n: unknown) => Number(n).toFixed(2)

function line(key: string, unitPrice: number, quantity = 1): CartLine {
  return { key, roomType: key, roomName: key, occupancy: 2, quantity, unitPrice, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null } as CartLine
}

function seed(taxes: Array<{ name: string; rate: number }>, unitPrice = 130) {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = { currency: 'USD', chargeCurrency: 'USD', nights: 1, taxes, roomTypes: [] } as any
  store.cart = [line('std', unitPrice)]
  return store
}

describe('EstimatedTotals — desglose estimado antes de pagar (#220)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useBookingI18nStore().setLocale('es')
  })

  it('con una habitación de 130 y ITBIS 18% muestra subtotal 130.00, "ITBIS (18%)" 23.40 y total 153.40', () => {
    seed([{ name: 'ITBIS', rate: 18 }])
    const w = mount(EstimatedTotals, { props: { format } })

    expect(w.get('[data-testid="cart-subtotal"]').text()).toBe('130.00')
    const taxLines = w.findAll('[data-testid="tax-line"]')
    expect(taxLines).toHaveLength(1)
    expect(taxLines[0]!.text()).toContain('ITBIS (18%)')
    expect(taxLines[0]!.text()).toContain('23.40')
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('153.40')
    expect(w.find('[data-testid="no-taxes"]').exists()).toBe(false)
    // Labels por defecto salen del i18n del widget (ES).
    expect(w.text()).toContain('Subtotal')
    expect(w.text()).toContain('sin impuestos')
    expect(w.text()).toContain('Total estimado')
    w.unmount()
  })

  it('al agregar otra línea al carrito o cambiar la cantidad recalcula impuesto y total', async () => {
    const store = seed([{ name: 'ITBIS', rate: 18 }])
    const w = mount(EstimatedTotals, { props: { format } })
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('153.40')

    store.cart = [...store.cart, line('suite', 70)]
    await w.vm.$nextTick()
    // base 200 → ITBIS 36.00 → total 236.00
    expect(w.get('[data-testid="cart-subtotal"]').text()).toBe('200.00')
    expect(w.get('[data-testid="tax-line"]').text()).toContain('36.00')
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('236.00')

    store.cart[0]!.quantity = 2
    await w.vm.$nextTick()
    // base 330 → ITBIS 59.40 → total 389.40
    expect(w.get('[data-testid="cart-subtotal"]').text()).toBe('330.00')
    expect(w.get('[data-testid="tax-line"]').text()).toContain('59.40')
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('389.40')
    w.unmount()
  })

  it('muestra una línea por extra y el descuento de la promo cuando existen', async () => {
    const store = seed([{ name: 'ITBIS', rate: 18 }], 200)
    const w = mount(EstimatedTotals, { props: { format } })
    expect(w.findAll('[data-testid="upsell-line"]')).toHaveLength(0)
    expect(w.find('[data-testid="promo-discount-line"]').exists()).toBe(false)

    store.upsells = [{ id: 'u1', name: 'Spa', description: null, price: 50, kind: 'per_stay', sortOrder: 1 }] as any
    store.selectedUpsells = [{ id: 'u1', quantity: 1 }]
    store.promoResult = { valid: true, code: 'X', discount: 25 } as any
    await w.vm.$nextTick()

    const upsell = w.get('[data-testid="upsell-line"]')
    expect(upsell.text()).toContain('Spa')
    expect(upsell.text()).toContain('50.00')
    expect(w.get('[data-testid="promo-discount-line"]').text()).toContain('25.00')
    // base = 200 + 50 − 25 = 225 → ITBIS 40.50 → total 265.50
    expect(w.get('[data-testid="tax-line"]').text()).toContain('40.50')
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('265.50')
    w.unmount()
  })

  it('sin tasas configuradas no hay tax-line, aparece el aviso y el total es el subtotal', () => {
    seed([])
    const w = mount(EstimatedTotals, { props: { format } })
    expect(w.findAll('[data-testid="tax-line"]')).toHaveLength(0)
    expect(w.get('[data-testid="no-taxes"]').text()).toBe('Este hotel no aplica impuestos sobre la reserva.')
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('130.00')
    w.unmount()
  })

  it('con `labels` usa esas strings en lugar de las de i18n (BookingModal de la landing)', () => {
    seed([])
    const w = mount(EstimatedTotals, {
      props: {
        format,
        labels: { subtotal: 'Subtotal habitaciones', total: 'Total a pagar (est.)', beforeTaxes: 'antes de ITBIS', noTaxes: 'Sin impuestos en este hotel' },
      },
    })
    const text = w.text()
    expect(text).toContain('Subtotal habitaciones')
    expect(text).toContain('Total a pagar (est.)')
    expect(text).toContain('antes de ITBIS')
    expect(w.get('[data-testid="no-taxes"]').text()).toBe('Sin impuestos en este hotel')
    expect(text).not.toContain('Total estimado')
    expect(text).not.toContain('sin impuestos')
    w.unmount()
  })
})
