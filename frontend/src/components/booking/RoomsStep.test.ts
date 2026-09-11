// RoomsStep.test.ts — La leyenda de impuestos del widget embebible.
//
// Bug que se protege: `fromPrice` viene PRE-impuestos (public-rates.ts devuelve el `taxBreakdown`
// aparte) y la tarjeta decía "Incluye 18% ITBIS" en los tres idiomas. Era una leyenda falsa — el
// huésped paga fromPrice + esos impuestos — y encima contradecía a la landing, que ya anuncia el
// impuesto como agregado. Una diferencia de precio descubierta en el paso de pago es la causa
// clásica de abandono del carrito.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn().mockResolvedValue([]) },
}))

import RoomsStep from './RoomsStep.vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore, type BookingLocale } from '@/composables/useBookingI18n'
import type { PublicRatesResponse } from '@/types/booking'

function ratesResponse(): PublicRatesResponse {
  return {
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 3,
    checkIn: '2026-08-18',
    checkOut: '2026-08-21',
    taxes: [{ name: 'ITBIS', rate: 18 }],
    cancellationPolicy: null,
    cancellationSummary: null,
    roomTypes: [
      {
        id: 'double',
        name: 'double',
        fromPrice: 300,
        availableCount: 5,
        capacity: 2,
        surfaceArea: 24,
        taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 54 }],
        photoUrl: null,
      },
    ],
  } as unknown as PublicRatesResponse
}

function render(locale: BookingLocale): VueWrapper {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = ratesResponse()
  useBookingI18nStore().setLocale(locale)
  return mount(RoomsStep)
}

describe('RoomsStep — leyenda de impuestos', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // Un caso por idioma: el texto viejo mentía en los TRES, así que arreglar solo el español
  // dejaba el bug vivo para la mitad de los huéspedes del widget.
  const cases: Array<{ locale: BookingLocale; mentira: RegExp; verdad: RegExp }> = [
    { locale: 'es', mentira: /Incluye/i, verdad: /\+\s*impuestos/i },
    { locale: 'en', mentira: /Includes/i, verdad: /\+\s*taxes/i },
    { locale: 'pt', mentira: /Inclui/i, verdad: /\+\s*impostos/i },
  ]

  for (const c of cases) {
    it(`[${c.locale}] anuncia el impuesto como AGREGADO, nunca como incluido`, () => {
      const w = render(c.locale)
      const text = w.text()

      expect(text).not.toMatch(c.mentira)
      expect(text).toMatch(c.verdad)
      // Y sigue detallando qué impuesto es y a qué tasa.
      expect(text).toContain('18% ITBIS')
      w.unmount()
    })
  }

  it('sin impuestos configurados no muestra ninguna leyenda', () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    const res = ratesResponse()
    res.roomTypes[0].taxBreakdown = []
    store.ratesResponse = res
    useBookingI18nStore().setLocale('es')

    const w = mount(RoomsStep)
    expect(w.text()).not.toMatch(/\+\s*impuestos/i)
    w.unmount()
  })
})

// Issue #220 — el cart "Tu selección" mostraba SOLO el subtotal pre-impuestos: el huésped elegía
// 300 y recién en el paso de pago veía 354, sin saber de dónde salía la diferencia. Ahora el cart
// incluye <EstimatedTotals>: subtotal · una línea por impuesto · total estimado.
describe('RoomsStep — desglose de impuestos en "Tu selección" (#220)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('al agregar una habitación, el cart muestra subtotal, la línea ITBIS (18%) y el total estimado', async () => {
    const w = render('es')
    const store = useBookingStore()
    const { formatPrice } = useBookingI18nStore()

    // Sin líneas no hay cart (y por lo tanto tampoco desglose).
    expect(w.find('[data-testid=cart-subtotal]').exists()).toBe(false)

    // fromPrice (300) es el precio de la ESTADÍA (3 noches) → 1 unidad = 300 de subtotal.
    await store.addToCart(store.ratesResponse!.roomTypes[0]!)
    await w.vm.$nextTick()

    expect(store.roomsSubtotal).toBe(300)
    expect(store.estimatedTotal).toBe(354) // 300 × 1.18

    expect(w.find('[data-testid=cart-subtotal]').text()).toBe(formatPrice(300, 'USD'))

    const taxLines = w.findAll('[data-testid=tax-line]')
    expect(taxLines).toHaveLength(1)
    expect(taxLines[0]!.text()).toContain('ITBIS (18%)')
    expect(taxLines[0]!.text()).toContain(formatPrice(54, 'USD'))

    expect(w.find('[data-testid=estimated-total]').text()).toBe(formatPrice(354, 'USD'))
    // El resumen habitaciones · huéspedes · noches sigue ahí.
    expect(w.find('[data-testid=cart-summary]').exists()).toBe(true)

    // Una segunda unidad recalcula todo: 600 → ITBIS 108 → 708.
    await store.addToCart(store.ratesResponse!.roomTypes[0]!)
    await w.vm.$nextTick()
    expect(w.find('[data-testid=cart-subtotal]').text()).toBe(formatPrice(600, 'USD'))
    expect(w.find('[data-testid=tax-line]').text()).toContain(formatPrice(108, 'USD'))
    expect(w.find('[data-testid=estimated-total]').text()).toBe(formatPrice(708, 'USD'))
    w.unmount()
  })
})
