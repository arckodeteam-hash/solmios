// useBooking.mealplans.test.ts — Los regímenes se piden EN PARALELO con las tarifas, no
// secuencial después.
//
// Bug evitado: si `getMealPlans` se pidiera DESPUÉS de que `status` pasa a 'selecting', RoomsStep
// (que reacciona a `status`) montaría con `store.mealPlans` todavía vacío — el eje completo de
// régimen parpadearía como "no disponible" un instante antes de asentarse en el estado real.
// Pidiéndolos en paralelo (Promise.all), `search()` no resuelve — y por lo tanto `status` no pasa
// a 'selecting' — hasta que AMBAS respuestas están listas, sin importar cuál tarde más.
//
// #360 — catálogo abierto: cada fila trae `name` (y opcionalmente `description`); el snapshot de
// la línea del carrito (`CartLine.mealPlan`) copia el `name` para que resumen/pago lo muestren
// aunque el hotel lo renombre después.
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

    resolveMealPlans([{ code: 'breakfast', name: 'Desayuno incluido', description: '', priceMode: 'included', price: 0 }])
    await searchPromise

    expect(store.status).toBe('selecting')
    expect(store.mealPlans).toEqual([{ code: 'breakfast', name: 'Desayuno incluido', description: '', priceMode: 'included', price: 0 }])
  })

  it('#360 addToCart copia el name del catálogo al snapshot de la línea (custom y room_only como fila real)', async () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.checkIn = tomorrow()
    store.checkOut = inDays(3)
    store.ratesResponse = rates()
    store.mealPlans = [
      { code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', price: 0 },
      { code: 'brunch_premium', name: 'Brunch premium', description: 'Brunch de 10 a 13', priceMode: 'per_person_per_night', price: 25 },
    ]
    const rt = store.ratesResponse!.roomTypes[0]!

    await store.addToCart(rt, { adults: 2, childrenAges: [], mealPlan: 'brunch_premium' })
    expect(store.cart[0]!.mealPlan).toEqual({ code: 'brunch_premium', name: 'Brunch premium', priceMode: 'per_person_per_night', unitPrice: 25, persons: 2, total: 150 })
    expect(store.mealPlanLines[0]).toMatchObject({ code: 'brunch_premium', name: 'Brunch premium', total: 150 })

    // `room_only` como fila real del catálogo: snapshot con su name, included, total 0 — y NO
    // entra en el desglose (no es un cargo).
    await store.addToCart(rt, { adults: 2, childrenAges: [], mealPlan: 'room_only' })
    expect(store.cart).toHaveLength(2)
    expect(store.cart[1]!.mealPlan).toEqual({ code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', unitPrice: 0, persons: 2, total: 0 })
    expect(store.mealPlanLines).toHaveLength(1)

    // Código que el hotel no tiene activo → sin snapshot (se degrada a sin régimen).
    await store.addToCart(rt, { adults: 1, childrenAges: [], mealPlan: 'half_board' })
    expect(store.cart[2]!.mealPlan).toBeUndefined()
  })

  it('#360 room_only SIN fila en el catálogo sigue siendo "sin régimen" (compat): línea sin snapshot', async () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.checkIn = tomorrow()
    store.checkOut = inDays(3)
    store.ratesResponse = rates()
    store.mealPlans = [{ code: 'breakfast', name: 'Desayuno incluido', priceMode: 'included', price: 0 }]
    const rt = store.ratesResponse!.roomTypes[0]!
    await store.addToCart(rt, { adults: 2, childrenAges: [], mealPlan: 'room_only' })
    expect(store.cart[0]!.mealPlan).toBeUndefined()
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
