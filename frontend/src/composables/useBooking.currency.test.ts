// useBooking.currency.test.ts — La moneda que se MUESTRA es la que el backend efectivamente
// devolvió, no la que el usuario pidió.
//
// El backend convierte con `configuration('currency_rates')` y, cuando no tiene tasa para la
// moneda pedida, degrada: cotiza en su moneda base y lo declara en `currency`. Antes el store
// hacía `currencyPreference || ratesResponse.currency`, así que la preferencia pisaba esa
// respuesta: se pedía EUR, el backend contestaba precios en USD, y el widget los rotulaba
// "€80.00". El huésped veía un precio en una moneda que nadie convirtió y Stripe le cobraba en
// `chargeCurrency`. Reproducido en local contra la API real con ?currency=EUR y ?currency=DOP.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useBookingStore } from './useBooking'
import { BookingService } from '@/services/Booking.service'
import type { PublicRatesResponse } from '@/types'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getUpsells: vi.fn().mockResolvedValue([]) },
}))

/** El backend NO pudo convertir: devuelve su moneda base aunque se le haya pedido otra. */
function ratesIn(currency: string): PublicRatesResponse {
  return {
    roomTypes: [{
      id: 'double', name: 'double', fromPrice: 240, availableCount: 3, capacity: 2,
      surfaceArea: 20, taxBreakdown: [], photoUrl: null,
    }],
    currency,
    chargeCurrency: 'USD',
    nights: 3,
    taxes: [],
    checkIn: tomorrow(),
    checkOut: inDays(3),
  } as unknown as PublicRatesResponse
}

/**
 * Fechas RELATIVAS en formato 'YYYY-MM-DD' LOCAL — el mismo que produce el calendario
 * y con el que `searchValid` compara como strings (ver el fix de timezones ahí).
 *
 * El fixture tenía fechas fijas de agosto 2026: pasaron de largo, `searchValid` empezó a
 * rechazarlas como "pasado" y `search()` retornaba temprano sin popular `ratesResponse` —
 * los dos tests fallaban sin que el composable estuviera roto. Bomba de tiempo, no bug.
 */
function localDate(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
const tomorrow = () => localDate(1)
const inDays = (n: number) => localDate(n)

describe('useBooking — moneda de display', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('si el backend no convirtió, muestra SU moneda, no la elegida', async () => {
    vi.mocked(BookingService.getRates).mockResolvedValue(ratesIn('USD'))
    const store = useBookingStore()
    store.currencyPreference = 'EUR'
    store.init('demo', { checkIn: tomorrow(), checkOut: inDays(3) })
    await store.search()

    expect(store.displayCurrency).toBe('USD')
    expect(store.currencyUnavailable).toBe(true)
  })

  it('si el backend sí convirtió, muestra la moneda elegida y no avisa nada', async () => {
    vi.mocked(BookingService.getRates).mockResolvedValue(ratesIn('EUR'))
    const store = useBookingStore()
    store.currencyPreference = 'EUR'
    store.init('demo', { checkIn: tomorrow(), checkOut: inDays(3) })
    await store.search()

    expect(store.displayCurrency).toBe('EUR')
    expect(store.currencyUnavailable).toBe(false)
  })

  it('sin preferencia (auto) nunca avisa, aunque haya respuesta', async () => {
    vi.mocked(BookingService.getRates).mockResolvedValue(ratesIn('USD'))
    const store = useBookingStore()
    store.init('demo', { checkIn: tomorrow(), checkOut: inDays(3) })
    await store.search()

    expect(store.displayCurrency).toBe('USD')
    expect(store.currencyUnavailable).toBe(false)
  })
})
