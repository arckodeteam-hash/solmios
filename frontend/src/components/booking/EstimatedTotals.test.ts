// EstimatedTotals.test.ts — Issue #220: el huésped veía "Tu selección" en 130 y el paso de pago en
// 153.40 sin ninguna línea que explicara el salto (ITBIS 18%). Este componente muestra el desglose
// estimado ANTES de crear la reserva, leyendo los computeds del store (misma cuenta que el backend,
// ver useBooking.taxes.test.ts). Acá se protege que lo que se RENDERIZA sea esa cuenta.
//
// Issue #343: las amenidades de habitación y el régimen entraban en la base imponible y en el
// total pero no tenían fila propia (390 + Cama 200 → "Subtotal 390 · ITBIS 106.20 · Total 696.20"
// sin explicación). Los tests del final aseguran que cada extra tenga su línea y que
// subtotal + Σ extras + Σ impuestos == total.
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

  // ─── Issue #343: amenidades de habitación y régimen como líneas propias ───────────────────

  it('#343: habitación de 390 + amenidad "Cama" 200 → fila room-amenity-line y subtotal + extras + tax == total', () => {
    const store = seed([{ name: 'ITBIS', rate: 18 }], 390)
    store.cart = [{ ...line('std', 390), roomName: 'Estándar', roomAmenities: [{ key: 'custom:cama', name: 'Cama', price: 200 }] }]
    const w = mount(EstimatedTotals, { props: { format } })

    const amenity = w.findAll('[data-testid="room-amenity-line"]')
    expect(amenity).toHaveLength(1)
    expect(amenity[0]!.text()).toContain('Estándar · Cama')
    expect(amenity[0]!.text()).toContain('200.00')
    expect(amenity[0]!.text()).not.toContain('×')
    expect(w.get('[data-testid="cart-subtotal"]').text()).toBe('390.00')
    // base 590 → ITBIS 106.20 → total 696.20 (lo que el bug mostraba SIN la fila de la Cama)
    expect(w.get('[data-testid="tax-line"]').text()).toContain('106.20')
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('696.20')

    // Invariante del issue: alojamiento + amenidades/extras + impuestos = total, con lo RENDERIZADO.
    const num = (sel: string) => Number(w.get(sel).text())
    const sum = (sel: string) => w.findAll(sel).reduce((acc, el) => acc + Number(el.text().match(/[\d.]+$/)![0]), 0)
    const rendered = num('[data-testid="cart-subtotal"]')
      + sum('[data-testid="upsell-line"]')
      + sum('[data-testid="room-amenity-line"]')
      + sum('[data-testid="meal-plan-line"]')
      + sum('[data-testid="tax-line"]')
    expect(rendered.toFixed(2)).toBe(num('[data-testid="estimated-total"]').toFixed(2))
    w.unmount()
  })

  it('#343: con quantity 2 la fila de la amenidad muestra "× 2" y el importe multiplicado', () => {
    const store = seed([{ name: 'ITBIS', rate: 18 }], 390)
    store.cart = [{ ...line('std', 390, 2), roomAmenities: [{ key: 'custom:cama', name: 'Cama', price: 200 }] }]
    const w = mount(EstimatedTotals, { props: { format } })
    const amenity = w.get('[data-testid="room-amenity-line"]')
    expect(amenity.text()).toContain('× 2')
    expect(amenity.text()).toContain('400.00')
    // base 780 + 400 = 1180 → ITBIS 212.40 → total 1392.40
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('1392.40')
    w.unmount()
  })

  it('#343: el régimen (mealPlan) tiene su meal-plan-line con el importe; el incluido dice "incluido"', async () => {
    const store = seed([{ name: 'ITBIS', rate: 18 }], 390)
    store.cart = [{
      ...line('std', 390),
      roomName: 'Doble',
      mealPlan: { code: 'breakfast', priceMode: 'per_person_per_night', unitPrice: 10, persons: 2, total: 20 },
    }]
    const w = mount(EstimatedTotals, { props: { format } })

    const mp = w.findAll('[data-testid="meal-plan-line"]')
    expect(mp).toHaveLength(1)
    expect(mp[0]!.text()).toContain('Régimen')
    expect(mp[0]!.text()).toContain('Doble')
    expect(mp[0]!.text()).toContain('Desayuno incluido')
    expect(mp[0]!.text()).toContain('20.00')
    // base 410 → ITBIS 73.80 → total 483.80
    expect(w.get('[data-testid="cart-subtotal"]').text()).toBe('390.00')
    expect(w.get('[data-testid="tax-line"]').text()).toContain('73.80')
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('483.80')

    store.cart = [{ ...line('std', 390), mealPlan: { code: 'all_inclusive', priceMode: 'included', unitPrice: 0, persons: 2, total: 0 } }]
    await w.vm.$nextTick()
    const included = w.get('[data-testid="meal-plan-line"]')
    expect(included.text()).toContain('Todo incluido')
    expect(included.text()).toContain('incluido')
    expect(included.text()).not.toContain('0.00')
    expect(w.get('[data-testid="estimated-total"]').text()).toBe('460.20')
    w.unmount()
  })

  it('#343: `labels.mealPlan` / `mealPlanIncluded` / `mealPlanNames` reemplazan al i18n (landing)', () => {
    const store = seed([], 100)
    store.cart = [{ ...line('std', 100), mealPlan: { code: 'half_board', priceMode: 'included', unitPrice: 0, persons: 2, total: 0 } }]
    const w = mount(EstimatedTotals, {
      props: { format, labels: { mealPlan: 'Plan de comidas', mealPlanIncluded: 'va en la tarifa', mealPlanNames: { half_board: 'Media pensión' } } },
    })
    const mp = w.get('[data-testid="meal-plan-line"]').text()
    expect(mp).toContain('Plan de comidas')
    expect(mp).toContain('Media pensión')
    expect(mp).toContain('va en la tarifa')
    expect(mp).not.toContain('Régimen')
    w.unmount()
  })
})
