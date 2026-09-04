// useGuestComposer.test.ts — Unidad aislada del composer compartido por RoomsStep.vue y
// BookingModal.vue (Requerimiento 3/4, 2026-09-03). Antes solo se ejercitaba indirecto vía tests
// de componente (a través del Stepper); esto prueba la lógica de estado directo, sin DOM.
//
// Foco del Requerimiento 4: que cambiar la cantidad de niños mantenga el array de edades
// consistente — agregar un niño agrega una edad (default 0), reducir la cantidad elimina las
// edades sobrantes SIN dejar datos huérfanos (ninguna edad vieja resucita si se vuelve a subir
// la cantidad).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGuestComposer } from './useGuestComposer'
import { useBookingStore } from './useBooking'
import type { RoomTypeRate } from '@/types/booking'

// `addComposedRoom` dispara `addToCart`, que carga upsells la primera vez (petición real sin
// mockear = ruido de ECONNREFUSED en la consola, atrapado igual por el try/catch de `addToCart`).
vi.mock('@/services/Booking.service', () => ({
  BookingService: { getUpsells: vi.fn().mockResolvedValue([]) },
}))

function rt(id = 'double'): RoomTypeRate {
  return {
    id, name: id, fromPrice: 100, availableCount: 5, capacity: 6,
    maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null,
  } as RoomTypeRate
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useGuestComposer — estado por tarjeta', () => {
  it('arranca en 1 adulto / 0 niños para cada tipo, independiente entre tarjetas', () => {
    const { composer } = useGuestComposer()
    expect(composer(rt('double'))).toEqual({ adults: 1, ages: [] })
    expect(composer(rt('suite'))).toEqual({ adults: 1, ages: [] })
    // Mutar una no afecta a la otra: son entradas distintas del mismo Record.
    composer(rt('double')).adults = 3
    expect(composer(rt('suite')).adults).toBe(1)
  })

  it('setAdults nunca baja de 1 ni acepta fracciones', () => {
    const { setAdults, composer } = useGuestComposer()
    const room = rt()
    setAdults(room, 0)
    expect(composer(room).adults).toBe(1)
    setAdults(room, -5)
    expect(composer(room).adults).toBe(1)
    setAdults(room, 2.9)
    expect(composer(room).adults).toBe(2)
  })
})

describe('useGuestComposer — setChildrenCount mantiene el array de edades sin datos huérfanos', () => {
  it('agregar niños agrega una edad por niño (default 0)', () => {
    const { setChildrenCount, composer } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 2)
    expect(composer(room).ages).toEqual([0, 0])
    setChildrenCount(room, 3)
    expect(composer(room).ages).toEqual([0, 0, 0])
  })

  it('las edades ya seteadas por el huésped NO se pisan al agregar un niño más', () => {
    const { setChildrenCount, setChildAge, composer } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 2)
    setChildAge(room, 0, 4)
    setChildAge(room, 1, 9)
    setChildrenCount(room, 3) // agrega un tercero
    expect(composer(room).ages).toEqual([4, 9, 0])
  })

  it('reducir la cantidad elimina las edades SOBRANTES desde el final, sin dejar huecos', () => {
    const { setChildrenCount, setChildAge, composer } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 3)
    setChildAge(room, 0, 4)
    setChildAge(room, 1, 9)
    setChildAge(room, 2, 15)
    setChildrenCount(room, 1)
    expect(composer(room).ages).toEqual([4]) // el 1º sobrevive, 9 y 15 se descartan
  })

  it('bajar a 0 vacía el array por completo (no queda `undefined` ni longitud fantasma)', () => {
    const { setChildrenCount, setChildAge, composer } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 2)
    setChildAge(room, 0, 4)
    setChildrenCount(room, 0)
    expect(composer(room).ages).toEqual([])
    expect(composer(room).ages.length).toBe(0)
  })

  it('sin datos huérfanos: subir de nuevo después de bajar NO resucita la edad vieja', () => {
    const { setChildrenCount, setChildAge, composer } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 2)
    setChildAge(room, 0, 12)
    setChildAge(room, 1, 15)
    setChildrenCount(room, 0) // trunca las dos
    setChildrenCount(room, 1) // vuelve a agregar UNA
    // La nueva edad es el default (0), NUNCA 12 ni 15 — confirmaría un dato huérfano resucitado.
    expect(composer(room).ages).toEqual([0])
  })

  it('setChildAge ignora un índice fuera de rango (no crea huecos ni revienta)', () => {
    const { setChildrenCount, setChildAge, composer } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 1)
    setChildAge(room, 5, 10) // índice inexistente
    expect(composer(room).ages).toEqual([0]) // sin cambios
  })

  it('cantidad negativa se trata como 0 (nunca un array de longitud negativa)', () => {
    const { setChildrenCount, composer } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 2)
    setChildrenCount(room, -3)
    expect(composer(room).ages).toEqual([])
  })
})

describe('useGuestComposer — maxChildAgeOptions (Requerimiento 4)', () => {
  it('con la política default (maxChildAge=17) ofrece 18 opciones (0..17)', () => {
    const { maxChildAgeOptions } = useGuestComposer()
    expect(maxChildAgeOptions.value).toBe(18)
  })

  it('sigue la política del hotel en vivo: maxChildAge=5 → 6 opciones (0..5)', () => {
    const { maxChildAgeOptions } = useGuestComposer()
    useBookingStore().childPolicy = { acceptChildren: true, maxChildAge: 5, maxFreeAge: 0 }
    expect(maxChildAgeOptions.value).toBe(6)
  })

  it('maxChildAge=0 (caso borde válido): ofrece UNA sola opción (0 años)', () => {
    const { maxChildAgeOptions } = useGuestComposer()
    useBookingStore().childPolicy = { acceptChildren: true, maxChildAge: 0, maxFreeAge: 0 }
    expect(maxChildAgeOptions.value).toBe(1)
  })
})

describe('useGuestComposer — addComposedRoom resetea la tarjeta tras agregar', () => {
  it('después de agregar, la tarjeta vuelve a 1 adulto / 0 niños (la próxima habitación arranca limpia)', async () => {
    const store = useBookingStore()
    store.ratesResponse = {
      currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
      taxes: [], cancellationPolicy: null, cancellationSummary: null,
      roomTypes: [{ id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null }],
    }
    const { setAdults, setChildrenCount, setChildAge, addComposedRoom, composer } = useGuestComposer()
    const room = rt('double')
    setAdults(room, 2)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 7)

    await addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.adults).toBe(2)
    expect(store.cart[0]!.childrenAges).toEqual([7])
    // El composer de la tarjeta se reseteó — no arrastra la composición anterior.
    expect(composer(room)).toEqual({ adults: 1, ages: [] })
  })
})
