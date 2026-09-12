// useBooking.room-amenities.test.ts — REQ-01 (#290): amenidades DE la habitación (cama extra…
// configuradas por el hotel en cada habitación con nombre/precio/estado), vendidas en el motor
// público POR TIPO y elegidas POR LÍNEA del carrito, SIN gateo por niños: aplica a cualquier
// composición. Misma forma de setup (pinia + store), sin DOM. La cuna (`custom:cuna`, #292/#341)
// es una amenidad más de este mismo mecanismo — ver useGuestComposer.crib.test.ts.
//
// El catálogo (nombres y precios) SIEMPRE viene del store (`store.roomAmenities`, cargado desde
// `GET /public/hotels/:slug/room-amenities` → `byRoomType`) — acá se siembra a mano; en código de
// producción no existe ninguna lista.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGuestComposer } from './useGuestComposer'
import { useBookingStore } from './useBooking'
import { DEFAULT_CHILD_POLICY } from '@/utils/child-composition'
import { BookingService } from '@/services/Booking.service'
import type { PublicRoomAmenity, RoomTypeRate } from '@/types/booking'

vi.mock('@/services/Booking.service', () => ({
  BookingService: {
    getRates: vi.fn(),
    getUpsells: vi.fn().mockResolvedValue([]),
    getMealPlans: vi.fn().mockResolvedValue([]),
    getRoomAmenities: vi.fn().mockResolvedValue({}),
    createBooking: vi.fn(),
    createBookingGroup: vi.fn(),
  },
}))

function localDate(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function rt(id = 'double'): RoomTypeRate {
  return {
    id, name: id, fromPrice: 100, availableCount: 5, capacity: 6,
    maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null,
  } as RoomTypeRate
}

const CATALOG: Record<string, PublicRoomAmenity[]> = {
  double: [{ key: 'custom:cama-extra', name: 'Cama extra', price: 15 }],
}

const POLICY = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50 }

function seedStore() {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.childPolicy = { ...POLICY }
  store.roomAmenities = { double: CATALOG.double!.map((a) => ({ ...a })) }
  store.checkIn = localDate(1)
  store.checkOut = localDate(3)
  store.ratesResponse = {
    currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: localDate(1), checkOut: localDate(3),
    taxes: [], cancellationPolicy: null, cancellationSummary: null,
    roomTypes: [
      { id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null },
      { id: 'suite', name: 'suite', fromPrice: 300, availableCount: 2, capacity: 4, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null },
    ],
  }
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('useBooking — amenidades de la habitación: catálogo por tipo', () => {
  it('(a) roomAmenitiesFor lista el catálogo del tipo y shouldOfferRoomAmenities es true; tipo sin catálogo → false', () => {
    const store = seedStore()
    const { shouldOfferRoomAmenities } = useGuestComposer()
    expect(store.roomAmenitiesFor('double')).toEqual([{ key: 'custom:cama-extra', name: 'Cama extra', price: 15 }])
    expect(shouldOfferRoomAmenities(rt('double'))).toBe(true)
    expect(store.roomAmenitiesFor('suite')).toEqual([])
    expect(shouldOfferRoomAmenities(rt('suite'))).toBe(false)
  })

  it('(a) se ofrece SIN niños en la composición (no depende de la política infantil)', () => {
    const store = seedStore()
    store.childPolicy = { ...POLICY, acceptChildren: false }
    const { shouldOfferRoomAmenities, composer } = useGuestComposer()
    const room = rt('double')
    expect(composer(room).ages).toEqual([])
    expect(shouldOfferRoomAmenities(room)).toBe(true)
  })

  it('(a) search() carga el catálogo en paralelo con rates y un fallo lo deja en {} sin romper la búsqueda', async () => {
    const store = useBookingStore()
    store.init('hotel-demo')
    store.checkIn = localDate(1)
    store.checkOut = localDate(3)
    vi.mocked(BookingService.getRates).mockResolvedValue({
      currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: localDate(1), checkOut: localDate(3),
      taxes: [], cancellationPolicy: null, cancellationSummary: null, roomTypes: [],
    } as never)
    vi.mocked(BookingService.getRoomAmenities).mockResolvedValueOnce({ double: [{ key: 'custom:cama-extra', name: 'Cama extra', price: 15 }] })
    await store.search()
    expect(BookingService.getRoomAmenities).toHaveBeenCalledWith('hotel-demo')
    expect(store.roomAmenitiesFor('double')).toHaveLength(1)

    store.reset()
    expect(store.roomAmenities).toEqual({})
    store.init('hotel-demo')
    store.checkIn = localDate(1)
    store.checkOut = localDate(3)
    vi.mocked(BookingService.getRoomAmenities).mockRejectedValueOnce(new Error('boom'))
    await store.search()
    expect(store.status).toBe('selecting')
    expect(store.roomAmenities).toEqual({})
  })
})

describe('useBooking — amenidades de la habitación: composer, toggle y total en vivo', () => {
  it('toggle selecciona/deselecciona y composedRoomAmenitiesTotal suma; key desconocida se ignora', () => {
    seedStore()
    const { toggleRoomAmenity, isRoomAmenitySelected, composedRoomAmenitiesTotal, roomAmenityKeys } = useGuestComposer()
    const room = rt('double')
    expect(roomAmenityKeys(room)).toEqual([])
    expect(composedRoomAmenitiesTotal(room)).toBe(0)
    toggleRoomAmenity(room, 'custom:cama-extra')
    expect(isRoomAmenitySelected(room, 'custom:cama-extra')).toBe(true)
    expect(composedRoomAmenitiesTotal(room)).toBe(15)
    toggleRoomAmenity(room, 'custom:no-existe')
    expect(roomAmenityKeys(room)).toEqual(['custom:cama-extra'])
    toggleRoomAmenity(room, 'custom:cama-extra')
    expect(isRoomAmenitySelected(room, 'custom:cama-extra')).toBe(false)
    expect(composedRoomAmenitiesTotal(room)).toBe(0)
  })

  it('la selección NO se limpia al cambiar niños/edades (no depende de la composición)', () => {
    seedStore()
    const { toggleRoomAmenity, setChildrenCount, setChildAge, roomAmenityKeys } = useGuestComposer()
    const room = rt('double')
    toggleRoomAmenity(room, 'custom:cama-extra')
    setChildrenCount(room, 1)
    setChildAge(room, 0, 2)
    setChildrenCount(room, 0)
    expect(roomAmenityKeys(room)).toEqual(['custom:cama-extra'])
  })

  it('la selección es POR TARJETA y un tipo sin catálogo no acepta el toggle', () => {
    seedStore()
    const { toggleRoomAmenity, isRoomAmenitySelected } = useGuestComposer()
    toggleRoomAmenity(rt('double'), 'custom:cama-extra')
    toggleRoomAmenity(rt('suite'), 'custom:cama-extra')
    expect(isRoomAmenitySelected(rt('double'), 'custom:cama-extra')).toBe(true)
    expect(isRoomAmenitySelected(rt('suite'), 'custom:cama-extra')).toBe(false)
  })
})

describe('useBooking — amenidades de la habitación: carrito, snapshot y totales', () => {
  it('(b) agregar línea double con custom:cama-extra → roomAmenitiesTotal 15, subtotal sube 15 y roomAmenityLines la lista', async () => {
    const store = seedStore()
    const room = rt('double') // fromPrice 100
    await store.addToCart(room, { adults: 2, childrenAges: [] })
    const baseSubtotal = store.subtotal
    expect(baseSubtotal).toBe(100)
    expect(store.roomAmenitiesTotal).toBe(0)
    store.clearCart()

    await store.addToCart(room, { adults: 2, childrenAges: [], roomAmenityKeys: ['custom:cama-extra'] })
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cama-extra', name: 'Cama extra', price: 15 }])
    expect(store.roomAmenitiesTotal).toBe(15)
    expect(store.subtotal).toBe(baseSubtotal + 15)
    expect(store.estimatedTotal).toBe(115) // sin impuestos ni promo
    expect(store.roomAmenityLines).toEqual([
      { lineKey: store.cart[0]!.key, roomName: 'double', key: 'custom:cama-extra', name: 'Cama extra', price: 15, quantity: 1, total: 15 },
    ])
  })

  it('(b) addComposedRoom (composer) arma la línea con el snapshot y resetea la tarjeta', async () => {
    const store = seedStore()
    const { toggleRoomAmenity, addComposedRoom, composer } = useGuestComposer()
    const room = rt('double')
    toggleRoomAmenity(room, 'custom:cama-extra')
    await addComposedRoom(room)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cama-extra', name: 'Cama extra', price: 15 }])
    expect(store.roomAmenitiesTotal).toBe(15)
    expect(composer(room).roomAmenityKeys).toBeUndefined()
    // El snapshot queda fijo aunque el catálogo cambie después.
    store.roomAmenities = { double: [{ key: 'custom:cama-extra', name: 'Cama extra premium', price: 99 }] }
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cama-extra', name: 'Cama extra', price: 15 }])
    expect(store.roomAmenitiesTotal).toBe(15)
  })

  it('(c) misma composición SIN amenidad es OTRA línea (key distinta); quitar la línea con amenidad vuelve el total a 0', async () => {
    const store = seedStore()
    const room = rt('double')
    await store.addToCart(room, { adults: 2, childrenAges: [], roomAmenityKeys: ['custom:cama-extra'] })
    await store.addToCart(room, { adults: 2, childrenAges: [] })
    expect(store.cart).toHaveLength(2) // no se fusionaron en "×2"
    expect(store.cart[0]!.key).not.toBe(store.cart[1]!.key)
    expect(store.cart[1]!.roomAmenities).toBeUndefined()
    expect(store.roomAmenitiesTotal).toBe(15)
    expect(store.subtotal).toBe(215)

    // Misma composición y MISMA amenidad → se agrupa (quantity 2) y el total escala.
    await store.addToCart(room, { adults: 2, childrenAges: [], roomAmenityKeys: ['custom:cama-extra'] })
    expect(store.cart).toHaveLength(2)
    expect(store.cart[0]!.quantity).toBe(2)
    expect(store.roomAmenitiesTotal).toBe(30)
    expect(store.roomAmenityLines[0]).toMatchObject({ quantity: 2, total: 30 })

    store.removeCartLine(store.cart[0]!.key)
    expect(store.roomAmenitiesTotal).toBe(0)
    expect(store.roomAmenityLines).toEqual([])
    expect(store.subtotal).toBe(100)
  })

  it('(e) keys desconocidas se ignoran: solo desconocidas → línea SIN roomAmenities y misma key que sin pedir nada', async () => {
    const store = seedStore()
    const room = rt('double')
    await store.addToCart(room, { adults: 1, childrenAges: [], roomAmenityKeys: ['custom:fantasma', 'custom:cama-extra'] })
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cama-extra', name: 'Cama extra', price: 15 }])
    expect(store.roomAmenitiesTotal).toBe(15)

    await store.addToCart(room, { adults: 2, childrenAges: [], roomAmenityKeys: ['custom:fantasma'] })
    expect(store.cart).toHaveLength(2)
    expect(store.cart[1]!.roomAmenities).toBeUndefined()
    await store.addToCart(room, { adults: 2, childrenAges: [] })
    expect(store.cart).toHaveLength(2)
    expect(store.cart[1]!.quantity).toBe(2)
    expect(store.roomAmenitiesTotal).toBe(15)

    // Un tipo sin catálogo ignora cualquier key, aunque exista en otro tipo.
    await store.addToCart(rt('suite'), { adults: 2, childrenAges: [], roomAmenityKeys: ['custom:cama-extra'] })
    expect(store.cart[2]!.roomAmenities).toBeUndefined()
  })

  it('la cuna (custom:cuna, #292) y la cama extra conviven en la misma línea y ambas suman al subtotal', async () => {
    const store = seedStore()
    store.roomAmenities = { double: [...CATALOG.double!, { key: 'custom:cuna', name: 'Cuna', price: 10 }] }
    const room = rt('double')
    await store.addToCart(room, { adults: 1, childrenAges: [0], needsCrib: true, roomAmenityKeys: ['custom:cama-extra', 'custom:cuna'] })
    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[0]!.roomAmenities).toHaveLength(2)
    expect(store.roomAmenitiesTotal).toBe(25)
    expect(store.subtotal).toBe(125)
  })
})

describe('useBooking — amenidades de la habitación: payload de creación', () => {
  const RESPONSE = {
    reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
    totalBreakdown: { subtotal: 115, promoDiscount: 0, upsellsTotal: 0, roomAmenitiesTotal: 15, taxes: 0, taxBreakdown: [], total: 115 },
  }

  it('(d) 1 habitación: POST /public/booking lleva roomAmenities:[{key}] (solo la key, sin precio)', async () => {
    const store = seedStore()
    await store.addToCart(rt('double'), { adults: 2, childrenAges: [], roomAmenityKeys: ['custom:cama-extra'] })
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    vi.mocked(BookingService.createBooking).mockResolvedValueOnce(RESPONSE)
    await store.pay()
    expect(BookingService.createBooking).toHaveBeenCalledTimes(1)
    const dto = vi.mocked(BookingService.createBooking).mock.calls[0]![0]
    expect(dto.roomAmenities).toEqual([{ key: 'custom:cama-extra' }])
    // El desglose del server (con `roomAmenitiesTotal`) queda en el store tal cual llegó.
    expect(store.totalBreakdown?.roomAmenitiesTotal).toBe(15)
  })

  it('(d) 1 habitación SIN amenidades: la clave roomAmenities no viaja', async () => {
    const store = seedStore()
    await store.addToCart(rt('double'), { adults: 2, childrenAges: [] })
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    vi.mocked(BookingService.createBooking).mockResolvedValueOnce(RESPONSE)
    await store.pay()
    const dto = vi.mocked(BookingService.createBooking).mock.calls[0]![0]
    expect(dto).not.toHaveProperty('roomAmenities')
  })

  it('(d) grupo de 2: roomAmenities viaja SOLO en la línea que las eligió', async () => {
    const store = seedStore()
    await store.addToCart(rt('double'), { adults: 2, childrenAges: [], roomAmenityKeys: ['custom:cama-extra'] })
    await store.addToCart(rt('suite'), { adults: 2, childrenAges: [] })
    expect(store.cart).toHaveLength(2)
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    vi.mocked(BookingService.createBookingGroup).mockResolvedValueOnce(RESPONSE)
    await store.pay()
    expect(BookingService.createBooking).not.toHaveBeenCalled()
    expect(BookingService.createBookingGroup).toHaveBeenCalledTimes(1)
    const dto = vi.mocked(BookingService.createBookingGroup).mock.calls[0]![0]
    expect(dto.rooms).toHaveLength(2)
    expect(dto.rooms[0]).toMatchObject({ roomType: 'double', roomAmenities: [{ key: 'custom:cama-extra' }] })
    expect(dto.rooms[1]!.roomType).toBe('suite')
    expect(dto.rooms[1]).not.toHaveProperty('roomAmenities')
  })
})
