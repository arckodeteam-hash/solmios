// useBooking.taxes.test.ts — Tarea 24 (#88): la estimación del widget usa la MISMA cuenta que el
// backend (`bookingengine/usecases/hotel-taxes.ts:taxLinesOn`): cada impuesto = round2(base × rate
// / 100) sobre la base imponible (subtotal + extras − promo), y `taxes` = suma de las líneas. Si
// esto se rompe, el huésped ve un total antes de pagar y otro en la pasarela (criterio 197).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBookingStore } from './useBooking'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn(), createBooking: vi.fn(), validatePromo: vi.fn() },
}))

function seed(taxes: Array<{ name: string; rate: number }>, unitPrice: number) {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = { currency: 'USD', chargeCurrency: 'USD', nights: 1, taxes, roomTypes: [] } as any
  store.cart = [{ key: 'std|2', roomType: 'std', roomName: 'std', occupancy: 2, quantity: 1, unitPrice, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null }]
  return store
}

describe('useBooking — desglose estimado de impuestos (#88)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('una línea por impuesto, cada una redondeada aparte, y taxes = Σ líneas (misma cuenta que el backend)', () => {
    const store = seed([{ name: 'ITBIS', rate: 18 }, { name: 'Propina', rate: 10 }], 333.33)
    expect(store.estimatedTaxBreakdown).toEqual([
      { name: 'ITBIS', rate: 18, amount: 60 },       // 59.9994 → 60.00
      { name: 'Propina', rate: 10, amount: 33.33 },  // 33.333 → 33.33
    ])
    expect(store.estimatedTaxes).toBe(93.33)
    expect(store.estimatedTotal).toBe(426.66)
  })

  it('los impuestos caen sobre subtotal + extras − promo, no sobre el precio de etiqueta', () => {
    const store = seed([{ name: 'ITBIS', rate: 18 }], 200)
    store.upsells = [{ id: 'u1', name: 'Spa', description: null, price: 50, kind: 'per_stay', sortOrder: 1 }] as any
    store.selectedUpsells = [{ id: 'u1', quantity: 1 }]
    store.promoResult = { valid: true, code: 'X', discount: 25 } as any
    // base = 200 + 50 − 25 = 225 → 40.50
    expect(store.taxableBase).toBe(225)
    expect(store.estimatedTaxBreakdown).toEqual([{ name: 'ITBIS', rate: 18, amount: 40.5 }])
    expect(store.estimatedTotal).toBe(265.5)
  })

  it('sin `taxes` en /rates (backend viejo) deduce nombre y % de las líneas del carrito', () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.ratesResponse = { currency: 'USD', chargeCurrency: 'USD', nights: 1, roomTypes: [] } as any
    store.cart = [{ key: 'std|2', roomType: 'std', roomName: 'std', occupancy: 2, quantity: 2, unitPrice: 100, unitTaxBreakdown: [{ name: 'IVA', rate: 21, amount: 21 }], maxAvailable: 3, photoUrl: null }]
    expect(store.taxRates.map((t) => [t.name, t.rate])).toEqual([['IVA', 21]])
    expect(store.estimatedTaxBreakdown).toEqual([{ name: 'IVA', rate: 21, amount: 42 }])
  })

  it('cambiar habitación, extras o promo recalcula el desglose (criterio 196)', () => {
    const store = seed([{ name: 'ITBIS', rate: 18 }], 100)
    expect(store.estimatedTotal).toBe(118)
    store.cart[0]!.quantity = 2
    expect(store.estimatedTotal).toBe(236)
    store.upsells = [{ id: 'u1', name: 'Spa', description: null, price: 100, kind: 'per_stay', sortOrder: 1 }] as any
    store.selectedUpsells = [{ id: 'u1', quantity: 1 }]
    expect(store.estimatedTotal).toBe(354)
    expect(store.upsellLines).toEqual([{ id: 'u1', name: 'Spa', kind: 'per_stay', quantity: 1, unitPrice: 100, nights: 1, total: 100 }])
  })
})
