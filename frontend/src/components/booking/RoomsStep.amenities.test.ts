// RoomsStep.amenities.test.ts — #341: el checklist "Amenidades de la habitación" del widget
// público renderiza TODO el catálogo del tipo (cama extra, cuna, vista al mar…) tal cual lo
// publica el hotel (`store.roomAmenitiesFor(rt.id)`), sin filtrar la cuna ni gatearla por bebé.
//
// Qué se protege acá:
//   1. Con Cama + Cuna + Vista al mar se renderizan 3 checkboxes, cada uno con su precio y
//      "Gratis" para el de precio 0.
//   2. Un tipo SIN amenidades no muestra la sección (ni el título ni checkboxes).
//   3. Dos tipos con catálogos distintos: cada tarjeta muestra SÓLO el suyo.
//   4. Tildar cuna + cama suma 300 al "+ $X" de la tarjeta; al agregar al carrito la línea lleva
//      `roomAmenities` con las 2 y `needsCrib:true`; destildar la cuna deja 200 y `needsCrib:false`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn().mockResolvedValue([]), getMealPlans: vi.fn().mockResolvedValue([]) },
}))

import RoomsStep from './RoomsStep.vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import type { PublicRatesResponse, RoomOccupancyRate, RoomTypeRate } from '@/types/booking'

const CAMA = { key: 'custom:cama-extra', name: 'Cama extra', price: 200 }
const CUNA = { key: 'custom:cuna', name: 'Cuna', price: 100 }
const VISTA = { key: 'custom:vista-al-mar', name: 'Vista al mar', price: 0 }

function occupancies(): RoomOccupancyRate[] {
  const tax = (total: number) => [{ name: 'ITBIS', rate: 18, amount: Math.round(total * 0.18 * 100) / 100 }]
  return [
    { occupancy: 1, price: 210, pricePerNight: 70, available: true, unavailableReason: null, taxBreakdown: tax(210) },
    { occupancy: 2, price: 300, pricePerNight: 100, available: true, unavailableReason: null, taxBreakdown: tax(300) },
  ]
}

function roomType(id: string): RoomTypeRate {
  return {
    id,
    name: id,
    fromPrice: 210,
    availableCount: 5,
    capacity: 2,
    surfaceArea: 32,
    taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 37.8 }],
    photoUrl: null,
    occupancies: occupancies(),
  }
}

function ratesResponse(ids: string[]): PublicRatesResponse {
  return {
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 3,
    checkIn: '2026-08-18',
    checkOut: '2026-08-21',
    taxes: [{ name: 'ITBIS', rate: 18 }],
    cancellationPolicy: null,
    cancellationSummary: null,
    roomTypes: ids.map(roomType),
  }
}

/** Monta el step con los tipos `ids` y el catálogo de amenidades por tipo ya cargado en el store. */
async function render(ids: string[], roomAmenities: Record<string, Array<{ key: string; name: string; price: number }>>): Promise<VueWrapper> {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = ratesResponse(ids)
  store.roomAmenities = roomAmenities
  useBookingI18nStore().setLocale('es')
  const w = mount(RoomsStep)
  await flushPromises()
  return w
}

function amenitySections(w: VueWrapper) {
  return w.findAll('[data-testid="room-amenities"]')
}

function optionTexts(section: { findAll: VueWrapper['findAll'] }): string[] {
  return section.findAll('[data-testid="room-amenity-option"]').map((o) => o.text().replace(/\s+/g, ' ').trim())
}

async function clickAddRoom(w: VueWrapper): Promise<void> {
  await w.findAll('button').find((b) => b.text().includes('Agregar esta habitación'))!.trigger('click')
  await flushPromises()
}

describe('RoomsStep — #341 el checklist de amenidades renderiza TODO el catálogo del tipo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('(a) Cama US$200 + Cuna US$100 + Vista al mar US$0 → 3 checkboxes con su precio y "Gratis" para el de 0', async () => {
    const w = await render(['familiar'], { familiar: [CAMA, CUNA, VISTA] })

    expect(w.find('[data-testid="baby-extras"]').exists()).toBe(false)
    expect(amenitySections(w)).toHaveLength(1)
    expect(w.text()).toContain('Amenidades de la habitación')

    const checkboxes = w.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(3)
    expect(checkboxes.map((c) => c.attributes('value'))).toEqual([CAMA.key, CUNA.key, VISTA.key])
    // Cada checkbox con su id/label asociado (a11y) y sin tildar de entrada.
    for (const c of checkboxes) {
      expect(c.attributes('id')).toBe(`room-amenity-familiar-${c.attributes('value')}`)
      expect((c.element as HTMLInputElement).checked).toBe(false)
    }

    const options = optionTexts(w)
    expect(options).toHaveLength(3)
    expect(options[0]).toContain('Cama extra')
    expect(options[0]).toContain('200,00')
    expect(options[1]).toContain('Cuna')
    expect(options[1]).toContain('100,00')
    expect(options[2]).toContain('Vista al mar')
    expect(options[2]).toContain('Gratis')
    // Sin nada tildado no hay "+ $X".
    expect(w.find('[data-testid="room-amenities-total"]').exists()).toBe(false)
    w.unmount()
  })

  it('(b) tipo SIN amenidades → la sección no existe en el DOM', async () => {
    const w = await render(['familiar'], {})

    expect(amenitySections(w)).toHaveLength(0)
    expect(w.find('[data-testid="room-amenity-option"]').exists()).toBe(false)
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(w.text()).not.toContain('Amenidades de la habitación')
    w.unmount()

    // Catálogo vacío explícito: mismo resultado que sin entrada.
    const w2 = await render(['familiar'], { familiar: [] })
    expect(amenitySections(w2)).toHaveLength(0)
    w2.unmount()
  })

  it('(c) dos tipos con catálogos distintos → cada tarjeta muestra sólo el suyo', async () => {
    const w = await render(['familiar', 'suite'], { familiar: [CAMA, CUNA], suite: [VISTA] })

    const sections = amenitySections(w)
    expect(sections).toHaveLength(2)

    const familiar = optionTexts(sections[0]!)
    expect(familiar).toHaveLength(2)
    expect(familiar[0]).toContain('Cama extra')
    expect(familiar[1]).toContain('Cuna')
    expect(familiar.join(' ')).not.toContain('Vista al mar')

    const suite = optionTexts(sections[1]!)
    expect(suite).toHaveLength(1)
    expect(suite[0]).toContain('Vista al mar')
    expect(suite[0]).toContain('Gratis')
    expect(suite.join(' ')).not.toContain('Cuna')

    // Los ids de los inputs llevan el tipo: los dos catálogos no se pisan.
    expect(w.find(`[id="room-amenity-familiar-${CUNA.key}"]`).exists()).toBe(true)
    expect(w.find(`[id="room-amenity-suite-${CUNA.key}"]`).exists()).toBe(false)
    expect(w.find(`[id="room-amenity-suite-${VISTA.key}"]`).exists()).toBe(true)
    w.unmount()
  })

  it('(d) tildar cuna + cama suma 300 al "+ $X"; la línea lleva las 2 y needsCrib:true; destildar la cuna deja 200 y needsCrib:false', async () => {
    const w = await render(['familiar'], { familiar: [CAMA, CUNA, VISTA] })
    const store = useBookingStore()

    await w.get(`input[value="${CUNA.key}"]`).setValue(true)
    expect(w.get('[data-testid="room-amenities-total"]').text().replace(/\s+/g, ' ')).toContain('100,00')
    await w.get(`input[value="${CAMA.key}"]`).setValue(true)
    expect(w.get('[data-testid="room-amenities-total"]').text().replace(/\s+/g, ' ')).toContain('300,00')

    await clickAddRoom(w)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[0]!.cribCount).toBe(1)
    expect(store.cart[0]!.roomAmenities).toEqual([CAMA, CUNA])
    // El resumen de la línea nombra la cuna UNA sola vez (como amenidad, no duplicada aparte).
    const line = w.get('[data-testid="cart-line"]').text()
    expect(line).toContain('Cama extra')
    expect(line.match(/Cuna/g)).toHaveLength(1)

    // Tarjeta nueva (el composer se resetea al agregar): cama + cuna → destildar la cuna deja 200.
    expect(w.find('[data-testid="room-amenities-total"]').exists()).toBe(false)
    await w.get(`input[value="${CAMA.key}"]`).setValue(true)
    await w.get(`input[value="${CUNA.key}"]`).setValue(true)
    expect(w.get('[data-testid="room-amenities-total"]').text().replace(/\s+/g, ' ')).toContain('300,00')
    await w.get(`input[value="${CUNA.key}"]`).setValue(false)
    expect(w.get('[data-testid="room-amenities-total"]').text().replace(/\s+/g, ' ')).toContain('200,00')
    expect(w.get('[data-testid="room-amenities-total"]').text()).not.toContain('300,00')

    await clickAddRoom(w)
    expect(store.cart).toHaveLength(2)
    // Sin cuna la línea no lleva `needsCrib` (el store sólo lo escribe cuando es true).
    expect(store.cart[1]!.needsCrib).toBeFalsy()
    expect(store.cart[1]!.cribCount ?? 0).toBe(0)
    expect(store.cart[1]!.roomAmenities).toEqual([CAMA])
    w.unmount()
  })
})
