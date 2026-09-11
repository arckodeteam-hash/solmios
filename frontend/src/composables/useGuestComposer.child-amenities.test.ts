// useGuestComposer.child-amenities.test.ts — REQ-01 (#233): amenidades para niños y bebés,
// seleccionables POR HABITACIÓN en el composer compartido por RoomsStep.vue y BookingModal.vue,
// con snapshot por línea del carrito y suma al total. Misma forma de setup que
// useGuestComposer.test.ts (pinia + store), sin DOM.
//
// El catálogo (nombres y precios) SIEMPRE viene del store (`store.childAmenities`, cargado desde
// `GET /public/hotels/:slug/child-amenities`) — acá se siembra a mano; en código de producción no
// existe ninguna lista.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGuestComposer } from './useGuestComposer'
import { useBookingStore } from './useBooking'
import type { PublicChildAmenity, RoomTypeRate } from '@/types/booking'

// `addComposedRoom` dispara `addToCart`, que carga upsells la primera vez.
vi.mock('@/services/Booking.service', () => ({
  BookingService: { getUpsells: vi.fn().mockResolvedValue([]) },
}))

function rt(id = 'double'): RoomTypeRate {
  return {
    id, name: id, fromPrice: 100, availableCount: 5, capacity: 6,
    maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null,
  } as RoomTypeRate
}

const CATALOG: PublicChildAmenity[] = [
  { id: 'crib-bedding', name: 'Ropa de cuna', price: 10, sortOrder: 1 },
  { id: 'high-chair', name: 'Silla alta', price: 0, sortOrder: 2 },
  { id: 'kids-kit', name: 'Kit de bienvenida', price: 15.5, sortOrder: 3 },
]

const POLICY = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50, cribAvailable: false }

function seedStore() {
  const store = useBookingStore()
  store.childPolicy = { ...POLICY }
  store.childAmenities = CATALOG.map((a) => ({ ...a }))
  store.ratesResponse = {
    currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
    taxes: [], cancellationPolicy: null, cancellationSummary: null,
    roomTypes: [{ id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null }],
  }
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useGuestComposer — amenidades infantiles: cuándo se ofrecen', () => {
  it('(a) sin niños en la composición NO se ofrecen aunque el hotel tenga catálogo', () => {
    seedStore()
    const { shouldOfferChildAmenities, setAdults } = useGuestComposer()
    const room = rt()
    expect(shouldOfferChildAmenities(room)).toBe(false)
    setAdults(room, 3) // más adultos no cambia nada: hace falta un menor
    expect(shouldOfferChildAmenities(room)).toBe(false)
  })

  it('(b) con un niño y catálogo se ofrecen; sin catálogo o con el hotel sin aceptar niños, no', () => {
    const store = seedStore()
    const { shouldOfferChildAmenities, setChildrenCount } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 1)
    expect(shouldOfferChildAmenities(room)).toBe(true)
    store.childAmenities = []
    expect(shouldOfferChildAmenities(room)).toBe(false)
    store.childAmenities = CATALOG.map((a) => ({ ...a }))
    store.childPolicy = { ...POLICY, acceptChildren: false }
    expect(shouldOfferChildAmenities(room)).toBe(false)
  })
})

describe('useGuestComposer — amenidades infantiles: toggle y total en vivo', () => {
  it('(b) toggle selecciona/deselecciona y composedChildAmenitiesTotal suma los precios (incluida una de $0)', () => {
    seedStore()
    const { setChildrenCount, toggleChildAmenity, isChildAmenitySelected, composedChildAmenitiesTotal, childAmenityIds } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 1)
    expect(childAmenityIds(room)).toEqual([])
    expect(composedChildAmenitiesTotal(room)).toBe(0)

    toggleChildAmenity(room, 'crib-bedding')
    expect(isChildAmenitySelected(room, 'crib-bedding')).toBe(true)
    expect(composedChildAmenitiesTotal(room)).toBe(10)

    toggleChildAmenity(room, 'high-chair') // precio 0: se puede elegir, no cambia el total
    expect(isChildAmenitySelected(room, 'high-chair')).toBe(true)
    expect(composedChildAmenitiesTotal(room)).toBe(10)

    toggleChildAmenity(room, 'kids-kit')
    expect(composedChildAmenitiesTotal(room)).toBe(25.5)

    toggleChildAmenity(room, 'crib-bedding') // destildar
    expect(isChildAmenitySelected(room, 'crib-bedding')).toBe(false)
    expect(composedChildAmenitiesTotal(room)).toBe(15.5)
    expect(childAmenityIds(room)).toEqual(['high-chair', 'kids-kit'])
  })

  it('toggle de un id que no está en el catálogo se ignora', () => {
    seedStore()
    const { setChildrenCount, toggleChildAmenity, childAmenityIds } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 1)
    toggleChildAmenity(room, 'no-existe')
    expect(childAmenityIds(room)).toEqual([])
  })

  it('la selección es POR TARJETA: tildar en una no afecta a la otra', () => {
    seedStore()
    const { setChildrenCount, toggleChildAmenity, isChildAmenitySelected } = useGuestComposer()
    setChildrenCount(rt('double'), 1)
    setChildrenCount(rt('suite'), 1)
    toggleChildAmenity(rt('double'), 'kids-kit')
    expect(isChildAmenitySelected(rt('double'), 'kids-kit')).toBe(true)
    expect(isChildAmenitySelected(rt('suite'), 'kids-kit')).toBe(false)
  })

  it('(c) al bajar los niños a 0 la selección se limpia sola (defensa en profundidad, como la cuna)', () => {
    seedStore()
    const { setChildrenCount, toggleChildAmenity, childAmenityIds, composedChildAmenitiesTotal, shouldOfferChildAmenities } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 2)
    toggleChildAmenity(room, 'crib-bedding')
    toggleChildAmenity(room, 'kids-kit')
    setChildrenCount(room, 1) // sigue habiendo un menor: se conserva
    expect(childAmenityIds(room)).toEqual(['crib-bedding', 'kids-kit'])
    setChildrenCount(room, 0)
    expect(childAmenityIds(room)).toEqual([])
    expect(composedChildAmenitiesTotal(room)).toBe(0)
    expect(shouldOfferChildAmenities(room)).toBe(false)
  })
})

describe('useGuestComposer — amenidades infantiles: carrito, snapshot y totales', () => {
  it('(d) addComposedRoom crea la línea con snapshot {id,name,price} y store.childAmenitiesTotal = suma', async () => {
    const store = seedStore()
    const { setChildrenCount, setChildAge, toggleChildAmenity, addComposedRoom, composer } = useGuestComposer()
    const room = rt('double')
    setChildrenCount(room, 1)
    setChildAge(room, 0, 5)
    toggleChildAmenity(room, 'kids-kit')
    toggleChildAmenity(room, 'crib-bedding') // tildado después, pero el snapshot sigue el orden del catálogo
    await addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.childAmenities).toEqual([
      { id: 'crib-bedding', name: 'Ropa de cuna', price: 10 },
      { id: 'kids-kit', name: 'Kit de bienvenida', price: 15.5 },
    ])
    expect(store.childAmenitiesTotal).toBe(25.5)
    expect(store.childAmenityLines).toEqual([
      { lineKey: store.cart[0]!.key, roomName: 'double', id: 'crib-bedding', name: 'Ropa de cuna', unitPrice: 10, quantity: 1, total: 10 },
      { lineKey: store.cart[0]!.key, roomName: 'double', id: 'kids-kit', name: 'Kit de bienvenida', unitPrice: 15.5, quantity: 1, total: 15.5 },
    ])
    // La tarjeta se reseteó: la próxima habitación arranca sin amenidades tildadas.
    expect(composer(room).childAmenityIds).toBeUndefined()
  })

  it('(d) el snapshot queda fijo en la línea aunque el catálogo cambie después', async () => {
    const store = seedStore()
    const { setChildrenCount, toggleChildAmenity, addComposedRoom } = useGuestComposer()
    const room = rt('double')
    setChildrenCount(room, 1)
    toggleChildAmenity(room, 'kids-kit')
    await addComposedRoom(room)
    store.childAmenities = [{ id: 'kids-kit', name: 'Kit', price: 99, sortOrder: 1 }]
    expect(store.cart[0]!.childAmenities).toEqual([{ id: 'kids-kit', name: 'Kit de bienvenida', price: 15.5 }])
    expect(store.childAmenitiesTotal).toBe(15.5)
  })

  it('(d) la misma composición SIN amenidades es OTRA línea (key distinta); quitarla deja el total en 0', async () => {
    const store = seedStore()
    const { setChildrenCount, setChildAge, toggleChildAmenity, addComposedRoom } = useGuestComposer()
    const room = rt('double')

    // 1ª habitación: 1 adulto + niño de 5, CON amenidad.
    setChildrenCount(room, 1)
    setChildAge(room, 0, 5)
    toggleChildAmenity(room, 'crib-bedding')
    await addComposedRoom(room)

    // 2ª habitación: MISMA composición, SIN amenidades.
    setChildrenCount(room, 1)
    setChildAge(room, 0, 5)
    await addComposedRoom(room)

    expect(store.cart).toHaveLength(2) // no se mezclaron en una sola línea "×2"
    expect(store.cart[0]!.key).not.toBe(store.cart[1]!.key)
    expect(store.cart[0]!.childAmenities).toHaveLength(1)
    expect(store.cart[1]!.childAmenities).toBeUndefined()
    expect(store.childAmenitiesTotal).toBe(10)

    // 3ª: misma composición y MISMA amenidad que la 1ª → se agrupa (quantity 2) y el total escala.
    setChildrenCount(room, 1)
    setChildAge(room, 0, 5)
    toggleChildAmenity(room, 'crib-bedding')
    await addComposedRoom(room)
    expect(store.cart).toHaveLength(2)
    expect(store.cart[0]!.quantity).toBe(2)
    expect(store.childAmenitiesTotal).toBe(20)
    expect(store.childAmenityLines[0]).toMatchObject({ quantity: 2, total: 20 })

    store.removeCartLine(store.cart[0]!.key)
    expect(store.childAmenitiesTotal).toBe(0)
    expect(store.childAmenityLines).toEqual([])
  })

  it('(e) subtotal = alojamiento + upsells + amenidades infantiles', async () => {
    const store = seedStore()
    const { setChildrenCount, toggleChildAmenity, addComposedRoom } = useGuestComposer()
    const room = rt('double') // fromPrice 100
    setChildrenCount(room, 1)
    toggleChildAmenity(room, 'kids-kit') // 15.5
    await addComposedRoom(room)
    expect(store.roomsSubtotal).toBe(100)
    expect(store.childAmenitiesTotal).toBe(15.5)
    expect(store.subtotal).toBe(115.5)
    expect(store.estimatedTotal).toBe(115.5) // sin impuestos ni promo en esta búsqueda
  })

  it('(f) ids desconocidos no entran al snapshot (ni cambian la key ni el total)', async () => {
    const store = seedStore()
    const room = rt('double')
    await store.addToCart(room, { adults: 1, childrenAges: [4], childAmenityIds: ['fantasma', 'high-chair', 'otro'] })
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.childAmenities).toEqual([{ id: 'high-chair', name: 'Silla alta', price: 0 }])
    expect(store.childAmenitiesTotal).toBe(0)
    // Solo desconocidos → la línea queda SIN amenidades (undefined, no `[]`)...
    await store.addToCart(room, { adults: 2, childrenAges: [4], childAmenityIds: ['fantasma'] })
    expect(store.cart).toHaveLength(2)
    expect(store.cart[1]!.childAmenities).toBeUndefined()
    // ...y su key es la misma que sin pedir nada: se agrupa, no se duplica.
    await store.addToCart(room, { adults: 2, childrenAges: [4] })
    expect(store.cart).toHaveLength(2)
    expect(store.cart[1]!.quantity).toBe(2)
  })

  it('sin menores en la composición, addToCart ignora las amenidades aunque vengan ids válidos', async () => {
    const store = seedStore()
    await store.addToCart(rt('double'), { adults: 2, childrenAges: [], childAmenityIds: ['kids-kit'] })
    expect(store.cart[0]!.childAmenities).toBeUndefined()
    expect(store.childAmenitiesTotal).toBe(0)
  })

  it('addComposedRoom NO manda amenidades si el hotel dejó de aceptar niños, aunque quedaran tildadas', async () => {
    const store = seedStore()
    const { setChildrenCount, toggleChildAmenity, addComposedRoom } = useGuestComposer()
    const room = rt('double')
    setChildrenCount(room, 1)
    toggleChildAmenity(room, 'kids-kit')
    store.childPolicy = { ...POLICY, acceptChildren: false }
    await addComposedRoom(room)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.childAmenities).toBeUndefined()
    expect(store.childAmenitiesTotal).toBe(0)
  })
})
