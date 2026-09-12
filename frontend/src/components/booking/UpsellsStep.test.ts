// UpsellsStep.test.ts — Cantidad por defecto de un extra al tildarlo (Requerimiento 7, 2026-09-03).
//
// Bug encontrado en la auditoría: `toggle()` usaba `store.rooms`/`store.guests` — los campos de
// BÚSQUEDA (default 1 desde la decisión 2026-08-20 de no pedir ocupación por adelantado), no lo
// que el huésped realmente agregó al carrito. Con 2 habitaciones y 4 huéspedes reales, "Desayuno
// por persona" arrancaba en cantidad 1 en vez de 4 — el huésped tenía que darse cuenta y
// corregirlo a mano antes de pagar. Cero test cubría esto antes de este archivo.
//
// Regla de negocio (deliberada, no un bug): "por persona" cuenta la ocupación FÍSICA —
// `cartTotalGuests` (ocupación chargeable: adultos + niños CON plaza) + `cartTotalFreeChildren`
// (SOLO los niños libres, que `cartTotalGuests` deja afuera pero igual desayunan). Sumar
// `cartTotalChildren` (TODOS los niños) en vez de `cartTotalFreeChildren` duplicaría a los niños
// con plaza — bug real que esta misma auditoría encontró en el propio fix (ver useBooking.ts).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn() },
}))

import UpsellsStep from './UpsellsStep.vue'
import { useBookingStore, type CartLine } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import type { Upsell } from '@/types/booking'

function cartLine(over: Partial<CartLine> = {}): CartLine {
  return {
    key: over.key ?? 'double|a2|c', roomType: 'double', roomName: 'double',
    occupancy: 2, quantity: 1, unitPrice: 100, unitTaxBreakdown: [], maxAvailable: 5, photoUrl: null,
    ...over,
  }
}

function upsell(over: Partial<Upsell> = {}): Upsell {
  return { id: 'breakfast', name: 'Desayuno', description: null, price: 10, kind: 'per_person', sortOrder: 0, ...over }
}

beforeEach(() => {
  setActivePinia(createPinia())
  useBookingI18nStore().setLocale('es')
})

describe('UpsellsStep — cantidad por defecto de "por persona"', () => {
  it('sin niños: usa la ocupación chargeable del carrito, no un default de 1', async () => {
    const store = useBookingStore()
    store.upsells = [upsell()]
    store.cart = [cartLine({ occupancy: 2, adults: 2, childrenAges: [] })]
    const w = mount(UpsellsStep)

    await w.find('input[type="checkbox"]').setValue(true)

    expect(store.selectedUpsells).toEqual([{ id: 'breakfast', quantity: 2 }])
    w.unmount()
  })

  it('niño CON plaza: cuenta como un huésped más (ya está en cartTotalGuests)', async () => {
    const store = useBookingStore()
    store.upsells = [upsell()]
    // occupancy=3 = 2 adultos + 1 niño con plaza (chargeable, ya calculado por el composer).
    store.cart = [cartLine({ occupancy: 3, adults: 2, childrenAges: [8] })]
    const w = mount(UpsellsStep)

    await w.find('input[type="checkbox"]').setValue(true)

    expect(store.selectedUpsells).toEqual([{ id: 'breakfast', quantity: 3 }])
    w.unmount()
  })

  it('niño LIBRE (no consume plaza): NO cuenta en cartTotalGuests, pero SÍ desayuna — se suma aparte', async () => {
    const store = useBookingStore()
    store.childPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 0, childrenDiscountEnabled: false, childrenRatePercent: 50, cribAvailable: false }  // 2 años → libre
    store.upsells = [upsell()]
    // occupancy=2 (el niño libre no sube la ocupación chargeable) + 1 niño en childrenAges.
    store.cart = [cartLine({ occupancy: 2, adults: 2, childrenAges: [2] })]
    const w = mount(UpsellsStep)

    await w.find('input[type="checkbox"]').setValue(true)

    // 2 (cartTotalGuests, adultos) + 1 (cartTotalFreeChildren, el niño libre) = 3, NO 2.
    expect(store.selectedUpsells).toEqual([{ id: 'breakfast', quantity: 3 }])
    w.unmount()
  })

  it('niño con plaza NO se duplica: ya está en cartTotalGuests, cartTotalFreeChildren no lo vuelve a sumar', async () => {
    const store = useBookingStore()
    store.childPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 0, childrenDiscountEnabled: false, childrenRatePercent: 50, cribAvailable: false } 
    store.upsells = [upsell()]
    // occupancy=3 = 2 adultos + 1 niño de 8 (>maxFreeAge=3 → con plaza, YA incluido en occupancy).
    store.cart = [cartLine({ occupancy: 3, adults: 2, childrenAges: [8] })]
    const w = mount(UpsellsStep)

    await w.find('input[type="checkbox"]').setValue(true)

    // 3 (cartTotalGuests, ya incluye al niño con plaza) + 0 (cartTotalFreeChildren) = 3, NO 4.
    expect(store.selectedUpsells).toEqual([{ id: 'breakfast', quantity: 3 }])
    w.unmount()
  })

  it('varias habitaciones: suma la ocupación de TODO el carrito, no de una sola línea', async () => {
    const store = useBookingStore()
    store.childPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 0, childrenDiscountEnabled: false, childrenRatePercent: 50, cribAvailable: false } 
    store.upsells = [upsell()]
    store.cart = [
      cartLine({ key: 'a', occupancy: 2, adults: 2, childrenAges: [] }),
      cartLine({ key: 'b', occupancy: 1, adults: 1, childrenAges: [2] }), // 1 adulto + 1 niño libre
    ]
    const w = mount(UpsellsStep)

    await w.find('input[type="checkbox"]').setValue(true)

    // cartTotalGuests = 2+1 = 3, cartTotalFreeChildren = 0+1 = 1 → 4.
    expect(store.selectedUpsells).toEqual([{ id: 'breakfast', quantity: 4 }])
    w.unmount()
  })

  it('el huésped puede AJUSTAR la cantidad después del default (no es de solo lectura)', async () => {
    const store = useBookingStore()
    store.upsells = [upsell()]
    store.cart = [cartLine({ occupancy: 2, adults: 2, childrenAges: [] })]
    const w = mount(UpsellsStep)
    await w.find('input[type="checkbox"]').setValue(true)
    expect(store.selectedUpsells[0]!.quantity).toBe(2)

    // MR-10 (#275): el default ya es el tope (2 personas), así que sólo se puede BAJAR.
    const minus = w.findAll('button').filter((b) => b.text() === '−')
    await minus[0]!.trigger('click')

    expect(store.selectedUpsells[0]!.quantity).toBe(1)
    w.unmount()
  })

  // MR-10 (#275) — tope por kind: per_person ≤ personas del carrito SIN bebés (espejo de
  // `upsellMaxQuantity` del backend, que responde 400 upsell_quantity_out_of_range por encima).
  it('per_person: el tope es la cantidad de huéspedes sin bebés y el Stepper no deja pasar de ahí', async () => {
    const store = useBookingStore()
    // maxBabyAge=1 → el de 1 año es bebé (no desayuna); el de 8 tiene plaza (ya en occupancy=3).
    store.childPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50, cribAvailable: false }
    store.upsells = [upsell()]
    store.cart = [cartLine({ occupancy: 3, adults: 2, childrenAges: [8, 1] })]
    const w = mount(UpsellsStep)

    await w.find('input[type="checkbox"]').setValue(true)

    // 2 adultos + niño con plaza = 3; el bebé no cuenta → default 3 = tope 3.
    expect(store.upsellMaxQty('per_person')).toBe(3)
    expect(store.selectedUpsells).toEqual([{ id: 'breakfast', quantity: 3 }])
    const plus = w.findAll('button').filter((b) => b.text() === '+')[0]!
    expect(plus.attributes('disabled')).toBeDefined()
    await plus.trigger('click')
    expect(store.selectedUpsells).toEqual([{ id: 'breakfast', quantity: 3 }])
    // Nada de "20" hardcodeado: el Stepper recibe el tope del store.
    expect(w.findComponent({ name: 'Stepper' }).props('max')).toBe(3)
    w.unmount()
  })

  it('kindLabel: los kinds nuevos por noche tienen etiqueta propia', () => {
    const store = useBookingStore()
    store.upsells = [
      upsell({ id: 'parking-night', name: 'Parking', kind: 'per_night', price: 15 }),
      upsell({ id: 'breakfast', name: 'Desayuno', kind: 'per_person_per_night', price: 10 }),
    ]
    store.cart = [cartLine({ occupancy: 2, adults: 2, childrenAges: [] })]
    const w = mount(UpsellsStep)
    const text = w.text()
    expect(text).toContain('Por noche')
    expect(text).toContain('Por persona y noche')
    w.unmount()
  })
})

describe('UpsellsStep — kinds por noche (MR-10 #275)', () => {
  function withNights(store: ReturnType<typeof useBookingStore>, nights: number) {
    // `store.nights` sale de la respuesta de /rates; sólo importa `nights` para estas pruebas.
    store.ratesResponse = { nights, roomTypes: [] } as never
  }

  it('per_person_per_night: sin stepper, muestra price × personas × noches como precio de la estadía', async () => {
    const store = useBookingStore()
    store.upsells = [upsell({ id: 'breakfast', kind: 'per_person_per_night', price: 10 })]
    store.cart = [cartLine({ occupancy: 2, adults: 2, childrenAges: [] })]
    withNights(store, 3)
    const w = mount(UpsellsStep)

    // 10 × 2 personas × 3 noches = 60 en la tarjeta, ANTES de tildar; el unitario queda chico.
    expect(w.find('[data-testid="upsell-stay-price"]').text()).toContain('60')
    expect(w.find('[data-testid="upsell-unit-price"]').text()).toContain('10')
    expect(w.find('[data-testid="upsell-unit-price"]').text()).toContain('Por persona y noche')

    await w.find('input[type="checkbox"]').setValue(true)

    expect(store.selectedUpsells).toEqual([{ id: 'breakfast', quantity: 1 }])
    expect(w.findAll('button').filter((b) => b.text() === '+')).toHaveLength(0)
    expect(store.upsellsTotal).toBe(60)
    w.unmount()
  })

  it('per_night: sin stepper, muestra price × noches', async () => {
    const store = useBookingStore()
    store.upsells = [upsell({ id: 'parking', kind: 'per_night', price: 15 })]
    store.cart = [cartLine({ occupancy: 4, adults: 4, childrenAges: [] })]
    withNights(store, 3)
    const w = mount(UpsellsStep)

    // 15 × 3 noches = 45 (las 4 personas NO multiplican).
    expect(w.find('[data-testid="upsell-stay-price"]').text()).toContain('45')
    expect(w.find('[data-testid="upsell-unit-price"]').text()).toContain('Por noche')

    await w.find('input[type="checkbox"]').setValue(true)

    expect(store.selectedUpsells).toEqual([{ id: 'parking', quantity: 1 }])
    expect(w.findAll('button').filter((b) => b.text() === '+')).toHaveLength(0)
    expect(store.upsellsTotal).toBe(45)
    w.unmount()
  })

  it('per_person / per_stay: la tarjeta muestra el precio unitario, sin línea de unitario aparte', () => {
    const store = useBookingStore()
    store.upsells = [upsell({ id: 'late', kind: 'per_stay', price: 25 })]
    store.cart = [cartLine({ occupancy: 2, adults: 2, childrenAges: [] })]
    withNights(store, 3)
    const w = mount(UpsellsStep)
    expect(w.find('[data-testid="upsell-stay-price"]').text()).toContain('25')
    expect(w.find('[data-testid="upsell-unit-price"]').exists()).toBe(false)
    w.unmount()
  })
})

describe('UpsellsStep — cantidad por defecto de "por habitación"', () => {
  it('usa la cantidad de habitaciones REALES del carrito, no el default de búsqueda (1)', async () => {
    const store = useBookingStore()
    store.upsells = [upsell({ id: 'parking', kind: 'per_room' })]
    store.cart = [
      cartLine({ key: 'a', occupancy: 2, quantity: 2 }), // 2 unidades de esta línea
      cartLine({ key: 'b', occupancy: 1, quantity: 1 }),
    ]
    const w = mount(UpsellsStep)

    await w.find('input[type="checkbox"]').setValue(true)

    expect(store.selectedUpsells).toEqual([{ id: 'parking', quantity: 3 }])
    w.unmount()
  })
})

describe('UpsellsStep — "por estadía" no tiene stepper', () => {
  it('kind per_stay siempre agrega cantidad 1, sin control de cantidad visible', async () => {
    const store = useBookingStore()
    store.upsells = [upsell({ id: 'late-checkout', kind: 'per_stay' })]
    store.cart = [cartLine({ occupancy: 4, adults: 4, childrenAges: [] })]
    const w = mount(UpsellsStep)

    await w.find('input[type="checkbox"]').setValue(true)

    expect(store.selectedUpsells).toEqual([{ id: 'late-checkout', quantity: 1 }])
    expect(w.findAll('button').filter((b) => b.text() === '+')).toHaveLength(0)
    w.unmount()
  })
})
