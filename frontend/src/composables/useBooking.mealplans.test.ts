// useBooking.mealplans.test.ts — Los regímenes se piden EN PARALELO con las tarifas, no
// secuencial después.
//
// Bug evitado: si `getMealPlans` se pidiera DESPUÉS de que `status` pasa a 'selecting', RoomsStep
// (que reacciona a `status`) montaría con `store.mealPlans` todavía vacío — el eje completo de
// régimen parpadearía como "no disponible" un instante antes de asentarse en el estado real.
// Pidiéndolos en paralelo (Promise.all), `search()` no resuelve — y por lo tanto `status` no pasa
// a 'selecting' — hasta que AMBAS respuestas están listas, sin importar cuál tarde más.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useBookingStore } from './useBooking'
import { BookingService } from '@/services/Booking.service'
import type { PublicRatesResponse, PublicMealPlan } from '@/types'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getUpsells: vi.fn().mockResolvedValue([]), getMealPlans: vi.fn() },
}))

function localDate(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
const tomorrow = () => localDate(1)
const inDays = (n: number) => localDate(n)

function rates(): PublicRatesResponse {
  return {
    roomTypes: [{
      id: 'double', name: 'double', fromPrice: 240, availableCount: 3, capacity: 2,
      surfaceArea: 20, taxBreakdown: [], photoUrl: null,
    }],
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 3,
    taxes: [],
    checkIn: tomorrow(),
    checkOut: inDays(3),
  } as unknown as PublicRatesResponse
}

describe('useBooking — regímenes cargados junto con la búsqueda', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('search() no resuelve hasta que getMealPlans también resolvió, aunque tarde más que getRates', async () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.checkIn = tomorrow()
    store.checkOut = inDays(3)

    vi.mocked(BookingService.getRates).mockResolvedValue(rates())
    let resolveMealPlans!: (v: PublicMealPlan[]) => void
    vi.mocked(BookingService.getMealPlans).mockReturnValue(
      new Promise((resolve) => { resolveMealPlans = resolve }),
    )

    const searchPromise = store.search()
    // getRates ya resolvió (microtask), getMealPlans todavía no — `search()` no debe haber
    // terminado ni haber pasado status a 'selecting' todavía.
    await Promise.resolve()
    await Promise.resolve()
    expect(store.status).not.toBe('selecting')
    expect(store.mealPlans).toEqual([])

    resolveMealPlans([{ code: 'breakfast', priceMode: 'included', price: 0 }])
    await searchPromise

    expect(store.status).toBe('selecting')
    expect(store.mealPlans).toEqual([{ code: 'breakfast', priceMode: 'included', price: 0 }])
  })

  it('si getMealPlans falla, degrada a array vacío sin romper la búsqueda de tarifas', async () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.checkIn = tomorrow()
    store.checkOut = inDays(3)

    vi.mocked(BookingService.getRates).mockResolvedValue(rates())
    vi.mocked(BookingService.getMealPlans).mockRejectedValue(new Error('502'))

    await store.search()

    expect(store.status).toBe('selecting')
    expect(store.ratesResponse).not.toBeNull()
    expect(store.mealPlans).toEqual([])
  })
})
