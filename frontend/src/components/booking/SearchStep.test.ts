// SearchStep.test.ts — Buscador del widget embebible SIN selector de huéspedes.
//
// Decisión de producto (2026-08-20): la ocupación ya no se pide en el buscador — cada tipo de
// habitación tiene su propio límite de capacidad, y se elige la ocupación exacta ("para N") recién
// al ver los tipos disponibles (matriz de ocupaciones de RoomsStep.vue), no de antemano acá. Este
// archivo reemplaza los tests viejos (que afirmaban lo contrario: 3 steppers de adultos/niños/
// habitaciones) por su contraparte — guarda de regresión de que la sección NO reaparece.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn().mockRejectedValue(new Error('sin red')) },
}))

import SearchStep from './SearchStep.vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'

describe('SearchStep — sin selector de huéspedes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useBookingI18nStore().setLocale('es')
  })

  it('no renderiza ningún stepper de ocupación (adultos/niños/habitaciones)', async () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    const w = mount(SearchStep)
    await flushPromises()

    expect(w.text()).not.toContain('Adultos')
    expect(w.text()).not.toContain('Niños')
    expect(w.text()).not.toContain('Habitaciones')
    expect(w.element.querySelectorAll('button[aria-label^="+ "]').length).toBe(0)
    w.unmount()
  })

  it('el store abre con la ocupación mínima por default (1 adulto, 0 niños, 1 habitación)', () => {
    const store = useBookingStore()
    store.init('hotel-demo')

    expect(store.guests).toBe(1)
    expect(store.children).toBe(0)
    expect(store.rooms).toBe(1)
    expect(store.physicalGuests).toBe(1)
  })

  it('un deep-link ?guests= sigue pudiendo overridear el default (compat integradores externos)', () => {
    const store = useBookingStore()
    store.init('hotel-demo', { guests: 4, children: 1 })

    expect(store.guests).toBe(4)
    expect(store.children).toBe(1)
    expect(store.physicalGuests).toBe(5)
  })
})
