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
    store.childPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } // 2 años → libre
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
    store.childPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }
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
    store.childPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }
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

    const buttons = w.findAll('button').filter((b) => b.text() === '+')
    await buttons[0]!.trigger('click')

    expect(store.selectedUpsells[0]!.quantity).toBe(3)
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
