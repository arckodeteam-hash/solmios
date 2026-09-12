// useBooking.upsells.test.ts — MR-10 (#275): la matemática de los extras por `kind` en el store
// es la MISMA que `resolveUpsellLines` del backend (`bookingengine/usecases/upsell-pricing.ts`):
// per_night = price × noches, per_person_per_night = price × personas × noches (qty forzada a 1
// en ambos), per_room/per_person = price × qty acotada al tope (habitaciones / personas sin
// bebés), per_stay = price × 1. Si esto se desincroniza, el huésped ve un total en el resumen y
// el POST devuelve otro (o un 400 `upsell_quantity_out_of_range` que el stepper nunca debió permitir).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBookingStore } from './useBooking'
import type { Upsell } from '@/types/booking'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn(), createBooking: vi.fn(), validatePromo: vi.fn() },
}))

const POLICY = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 0, cribAvailable: false }

function upsell(patch: Partial<Upsell>): Upsell {
  return { id: 'u', name: 'Extra', description: null, price: 10, kind: 'per_stay', sortOrder: 0, ...patch }
}

/** Store con `/rates` de `nights` noches y un carrito de 1 habitación doble (2 adultos). */
function seed(nights: number) {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.childPolicy = { ...POLICY }
  store.ratesResponse = { currency: 'USD', chargeCurrency: 'USD', nights, taxes: [], roomTypes: [] } as any
  store.cart = [{ key: 'std|2', roomType: 'std', roomName: 'std', occupancy: 2, quantity: 1, unitPrice: 100, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null, adults: 2, childrenAges: [] }]
  return store
}

describe('useBooking — extras por kind (MR-10 #275)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('per_person_per_night: 10 × 2 adultos × 3 noches = 60, la quantity pedida (4) se ignora', () => {
    const store = seed(3)
    store.upsells = [upsell({ id: 'bfast', name: 'Desayuno', price: 10, kind: 'per_person_per_night' })]
    store.selectedUpsells = [{ id: 'bfast', quantity: 4 }]
    expect(store.upsellsTotal).toBe(60)
    expect(store.upsellLines).toEqual([
      { id: 'bfast', name: 'Desayuno', kind: 'per_person_per_night', quantity: 1, unitPrice: 10, nights: 3, persons: 2, total: 60 },
    ])
  })

  it('per_night: 15 × 3 noches = 45, la quantity pedida (7) se ignora', () => {
    const store = seed(3)
    store.upsells = [upsell({ id: 'parking', name: 'Parking', price: 15, kind: 'per_night' })]
    store.selectedUpsells = [{ id: 'parking', quantity: 7 }]
    expect(store.upsellsTotal).toBe(45)
    expect(store.upsellLines).toEqual([
      { id: 'parking', name: 'Parking', kind: 'per_night', quantity: 1, unitPrice: 15, nights: 3, total: 45 },
    ])
  })

  it('per_stay: precio × 1, la quantity pedida (3) se acota a 1', () => {
    const store = seed(3)
    store.upsells = [upsell({ id: 'late', name: 'Late checkout', price: 30, kind: 'per_stay' })]
    store.selectedUpsells = [{ id: 'late', quantity: 3 }]
    expect(store.upsellsTotal).toBe(30)
    expect(store.upsellLines[0]).toMatchObject({ kind: 'per_stay', quantity: 1, nights: 1, total: 30 })
  })

  it('per_person / per_room: price × qty, acotada al tope del kind', () => {
    const store = seed(2)
    store.cart = [
      { key: 'std|2', roomType: 'std', roomName: 'std', occupancy: 2, quantity: 2, unitPrice: 100, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null, adults: 2, childrenAges: [] },
    ]
    store.upsells = [
      upsell({ id: 'transfer', name: 'Transfer', price: 20, kind: 'per_person' }),
      upsell({ id: 'minibar', name: 'Minibar', price: 5, kind: 'per_room' }),
    ]
    // 4 personas → qty 9 se acota a 4; 2 habitaciones → qty 5 se acota a 2.
    store.selectedUpsells = [{ id: 'transfer', quantity: 9 }, { id: 'minibar', quantity: 5 }]
    expect(store.upsellLines).toEqual([
      { id: 'transfer', name: 'Transfer', kind: 'per_person', quantity: 4, unitPrice: 20, nights: 1, total: 80 },
      { id: 'minibar', name: 'Minibar', kind: 'per_room', quantity: 2, unitPrice: 5, nights: 1, total: 10 },
    ])
    expect(store.upsellsTotal).toBe(90)
    // Dentro del tope la quantity se respeta tal cual.
    store.selectedUpsells = [{ id: 'transfer', quantity: 3 }, { id: 'minibar', quantity: 1 }]
    expect(store.upsellsTotal).toBe(65)
  })

  it('upsellMaxQty(per_person) = huéspedes SIN bebés: 2 adultos + 1 niño con plaza + 1 bebé → 3', () => {
    const store = seed(2)
    store.cart = [
      { key: 'fam|3', roomType: 'fam', roomName: 'fam', occupancy: 3, quantity: 1, unitPrice: 300, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null, adults: 2, childrenAges: [8, 1] },
    ]
    expect(store.upsellPersons).toBe(3)
    expect(store.upsellMaxQty('per_person')).toBe(3)
  })

  it('upsellMaxQty(per_person) cuenta a los niños libres (no bebés) — desayunan aunque no paguen plaza', () => {
    const store = seed(2)
    store.cart = [
      { key: 'fam|2', roomType: 'fam', roomName: 'fam', occupancy: 2, quantity: 1, unitPrice: 200, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null, adults: 2, childrenAges: [2] },
    ]
    expect(store.cartTotalGuests).toBe(2)
    expect(store.cartTotalFreeChildren).toBe(1)
    expect(store.cartTotalBabies).toBe(0)
    expect(store.upsellMaxQty('per_person')).toBe(3)
  })

  it('un id repetido se consolida (Σ) y recién ahí se acota: 2 + 2 per_person con 2 huéspedes → UNA línea de 2, total 40, y el POST manda una sola entrada', () => {
    const store = seed(3)
    store.upsells = [upsell({ id: 'transfer', name: 'Transfer', price: 20, kind: 'per_person' })]
    store.selectedUpsells = [{ id: 'transfer', quantity: 2 }, { id: 'transfer', quantity: 2 }]
    expect(store.upsellLines).toHaveLength(1)
    expect(store.upsellLines[0]).toMatchObject({ id: 'transfer', quantity: 2, total: 40 })
    expect(store.upsellsTotal).toBe(40)
    // El setter también consolida, así que el estado nunca guarda duplicados.
    store.setSelectedUpsells([{ id: 'transfer', quantity: 1 }, { id: 'transfer', quantity: 1 }])
    expect(store.selectedUpsells).toEqual([{ id: 'transfer', quantity: 2 }])
    expect(store.upsellLines[0]!.quantity).toBe(2)
  })

  it('upsellMaxQty(per_room) = habitaciones del carrito; per_stay/per_night/ppn = 1', () => {
    const store = seed(2)
    store.cart = [
      { key: 'std|2', roomType: 'std', roomName: 'std', occupancy: 2, quantity: 2, unitPrice: 100, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null, adults: 2, childrenAges: [] },
      { key: 'sui|2', roomType: 'sui', roomName: 'sui', occupancy: 2, quantity: 1, unitPrice: 250, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null, adults: 2, childrenAges: [] },
    ]
    expect(store.upsellMaxQty('per_room')).toBe(3)
    expect(store.upsellMaxQty('per_stay')).toBe(1)
    expect(store.upsellMaxQty('per_night')).toBe(1)
    expect(store.upsellMaxQty('per_person_per_night')).toBe(1)
  })

  it('upsellMaxQty nunca baja de 1 (carrito vacío: el stepper no queda clavado en 0)', () => {
    const store = seed(2)
    store.cart = []
    expect(store.upsellMaxQty('per_room')).toBe(1)
    expect(store.upsellMaxQty('per_person')).toBe(1)
  })

  it('upsellStayPrice: ppn = price × personas × noches; per_night = price × noches; resto = price', () => {
    const store = seed(3)
    expect(store.upsellStayPrice(upsell({ price: 10, kind: 'per_person_per_night' }))).toBe(60)
    expect(store.upsellStayPrice(upsell({ price: 15, kind: 'per_night' }))).toBe(45)
    expect(store.upsellStayPrice(upsell({ price: 20, kind: 'per_person' }))).toBe(20)
    expect(store.upsellStayPrice(upsell({ price: 5, kind: 'per_room' }))).toBe(5)
    expect(store.upsellStayPrice(upsell({ price: 30, kind: 'per_stay' }))).toBe(30)
  })

  it('sin `/rates` todavía (nights 0) los extras por noche cotizan con 1 noche', () => {
    const store = seed(0)
    store.upsells = [upsell({ id: 'parking', price: 15, kind: 'per_night' })]
    store.selectedUpsells = [{ id: 'parking', quantity: 1 }]
    expect(store.upsellsTotal).toBe(15)
    expect(store.upsellLines[0]!.nights).toBe(1)
  })
})
