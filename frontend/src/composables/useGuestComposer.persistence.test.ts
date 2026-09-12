// useGuestComposer.persistence.test.ts — #343: "Se pierde la selección de huéspedes y amenidades,
// pero el total continúa acumulándose". Test de regresión del flujo EXACTO del issue, sin red y
// sin montar componentes (pinia + store, misma forma de setup que useGuestComposer.test.ts,
// useGuestComposer.crib.test.ts y useBooking.room-amenities.test.ts).
//
// Qué se protege acá:
//   (A) Ida: 1 → 2 adultos, 2 niños (5 = con plaza, 1 = bebé), Cama ($200), "Agregar esta
//       habitación": la tarjeta SIGUE mostrando lo que acaba de entrar al carrito (no vuelve a
//       1 adulto / 0 niños / sin Cama), y subtotal + Cama + ITBIS = total, centavo por centavo.
//       "Editar" devuelve la línea al composer con los mismos datos y vacía el carrito.
//   (B) Remount: una SEGUNDA instancia de `useGuestComposer()` (el widget desmonta RoomsStep al
//       cambiar de paso) lee la MISMA composición del store; otra tarjeta arranca fresca.
//   (C) Vuelta: quitar un niño, bajar a 1 adulto, destildar la Cama → "+ $X" a 0, precio de
//       1 adulto, y tras Editar + re-agregar NADA de la Cama queda en el total.
//   (D) `store.reset()` limpia `composerState`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGuestComposer } from './useGuestComposer'
import { useBookingStore } from './useBooking'
import { DEFAULT_CHILD_POLICY } from '@/utils/child-composition'
import { BookingService } from '@/services/Booking.service'
import { round2 } from '@/utils/cash-arqueo'
import type { PublicRoomAmenity, PublicRatesResponse, RoomTypeRate } from '@/types/booking'

// `addComposedRoom` dispara `addToCart`, que carga upsells la primera vez.
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

// maxBabyAge=1: edad 0-1 bebé (sin plaza); maxFreeAge=3: 2-3 libre; 4-12 con plaza. Descuento
// infantil apagado: el precio sale de la fila plana de la matriz (chargeableOccupancy).
const POLICY = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50 }

const CAMA: PublicRoomAmenity = { key: 'custom:cama', name: 'Cama', price: 200 }
const ITBIS = { name: 'ITBIS', rate: 18 }

// Matriz de 2 noches: ocupación 1 = $150, 2 = $260, 3 = $390.
const MATRIX = [
  { occupancy: 1, price: 150, pricePerNight: 75, available: true, unavailableReason: null, taxBreakdown: [] },
  { occupancy: 2, price: 260, pricePerNight: 130, available: true, unavailableReason: null, taxBreakdown: [] },
  { occupancy: 3, price: 390, pricePerNight: 195, available: true, unavailableReason: null, taxBreakdown: [] },
]

function roomType(id: string, fromPrice: number): RoomTypeRate {
  return {
    id, name: id, fromPrice, availableCount: 5, capacity: 6,
    maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null,
    occupancies: MATRIX.map((o) => ({ ...o })),
  } as RoomTypeRate
}

function seedStore() {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.childPolicy = { ...POLICY }
  store.roomAmenities = { double: [{ ...CAMA }] }
  store.checkIn = '2026-09-10'
  store.checkOut = '2026-09-12'
  store.ratesResponse = {
    currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
    taxes: [{ ...ITBIS }], cancellationPolicy: null, cancellationSummary: null,
    roomTypes: [roomType('double', 150), roomType('suite', 300)],
  } as PublicRatesResponse
  return store
}

/** El tipo tal como lo lee la tarjeta: la MISMA referencia que está en `ratesResponse`. */
function rtFromStore(store: ReturnType<typeof useBookingStore>, id: string): RoomTypeRate {
  return store.ratesResponse!.roomTypes.find((r) => r.id === id)!
}

/** Ida del issue: 1 → 2 adultos, 2 niños (5 y 1), Cama tildada. */
function composeIssue(c: ReturnType<typeof useGuestComposer>, rt: RoomTypeRate) {
  expect(c.composer(rt)).toEqual({ adults: 1, ages: [], needsCrib: false })
  c.setAdults(rt, 2)
  c.setChildrenCount(rt, 2)
  c.setChildAge(rt, 0, 5)
  c.setChildAge(rt, 1, 1)
  c.toggleRoomAmenity(rt, 'custom:cama')
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('useGuestComposer — #343 (A) ida: la tarjeta conserva la selección tras agregar y los totales cierran', () => {
  it('2 adultos + niños [5,1] + Cama → agregar → composer intacto, 1 línea, subtotal+Cama+ITBIS = total → editar → composer intacto y carrito vacío', async () => {
    const store = seedStore()
    const c = useGuestComposer()
    const rt = rtFromStore(store, 'double')

    composeIssue(c, rt)

    // Clasificación en vivo: 5 = niño con plaza, 1 = bebé (sin plaza) → ocupación chargeable 3.
    expect(c.childAgeClassification(rt, 0)).toBe('paying')
    expect(c.childAgeClassification(rt, 1)).toBe('baby')
    expect(c.composition(rt)).toMatchObject({ effectiveAdults: 2, payingChildren: 1, babies: 1, chargeableOccupancy: 3 })
    expect(c.composedRoomAmenitiesTotal(rt)).toBe(200)
    expect(c.composedPrice(rt)).toBe(390) // fila ocupación=3 de la matriz
    expect(c.canAddComposition(rt)).toBe(true)

    await c.addComposedRoom(rt)

    // La tarjeta SIGUE mostrando exactamente lo que entró al carrito (antes volvía a 1/0/sin Cama).
    expect(c.composer(rt)).toEqual({ adults: 2, ages: [5, 1], needsCrib: false, roomAmenityKeys: ['custom:cama'] })
    expect(c.isRoomAmenitySelected(rt, 'custom:cama')).toBe(true)
    expect(c.composedRoomAmenitiesTotal(rt)).toBe(200)

    expect(store.cart).toHaveLength(1)
    const line = store.cart[0]!
    expect(line).toMatchObject({
      roomType: 'double', quantity: 1, adults: 2, childrenAges: [5, 1], unitPrice: 390,
      roomAmenities: [{ key: 'custom:cama', name: 'Cama', price: 200 }],
    })
    expect(line.needsCrib).toBeUndefined()

    // Totales: alojamiento 390 + Cama 200 = 590; ITBIS 18% = 106.20; total 696.20.
    expect(store.roomsSubtotal).toBe(390)
    expect(store.roomAmenitiesTotal).toBe(200)
    expect(store.subtotal).toBe(590)
    expect(store.estimatedTaxBreakdown).toHaveLength(1)
    expect(store.estimatedTaxBreakdown[0]).toEqual({ name: 'ITBIS', rate: 18, amount: round2((390 + 200) * 18 / 100) })
    expect(store.estimatedTaxBreakdown[0]!.amount).toBe(106.2)
    expect(store.estimatedTotal).toBe(round2(store.roomsSubtotal + store.roomAmenitiesTotal + store.estimatedTaxBreakdown[0]!.amount))
    expect(store.estimatedTotal).toBe(696.2)

    // "Editar" devuelve la unidad al composer con los MISMOS datos y vacía el carrito.
    expect(c.editCartLine(line)).toBe(true)
    expect(c.composer(rt)).toEqual({ adults: 2, ages: [5, 1], needsCrib: false, roomAmenityKeys: ['custom:cama'] })
    expect(store.cart).toEqual([])
    expect(store.roomsSubtotal).toBe(0)
    expect(store.roomAmenitiesTotal).toBe(0)
    expect(store.estimatedTaxBreakdown).toEqual([])
    expect(store.estimatedTotal).toBe(0)
  })

  it('un segundo "Agregar" con la tarjeta intacta suma otra unidad a la MISMA línea (el total acumula lo que se ve)', async () => {
    const store = seedStore()
    const c = useGuestComposer()
    const rt = rtFromStore(store, 'double')
    composeIssue(c, rt)
    await c.addComposedRoom(rt)
    await c.addComposedRoom(rt)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.quantity).toBe(2)
    expect(store.roomsSubtotal).toBe(780)
    expect(store.roomAmenitiesTotal).toBe(400)
    expect(store.estimatedTotal).toBe(round2(1180 * 1.18))
    expect(c.composer(rt)).toEqual({ adults: 2, ages: [5, 1], needsCrib: false, roomAmenityKeys: ['custom:cama'] })
  })
})

describe('useGuestComposer — #343 (B) remount: una segunda instancia lee la misma composición del store', () => {
  it('la segunda instancia ve {2 adultos, [5,1], Cama} y otra tarjeta arranca fresca e independiente', async () => {
    const store = seedStore()
    const first = useGuestComposer()
    const rt = rtFromStore(store, 'double')
    composeIssue(first, rt)
    await first.addComposedRoom(rt)

    // El widget desmonta RoomsStep al cambiar de paso: nueva instancia del composable, misma pinia.
    const second = useGuestComposer()
    expect(second.composer(rt)).toEqual({ adults: 2, ages: [5, 1], needsCrib: false, roomAmenityKeys: ['custom:cama'] })
    expect(second.composer(rt)).toBe(store.composerState['double'])
    expect(second.isRoomAmenitySelected(rt, 'custom:cama')).toBe(true)
    expect(second.composedRoomAmenitiesTotal(rt)).toBe(200)
    expect(second.composedPrice(rt)).toBe(390)
    expect(second.childAgeClassification(rt, 1)).toBe('baby')

    // Estado independiente por habitación: la suite no hereda nada de la double.
    const rt2 = rtFromStore(store, 'suite')
    expect(second.composer(rt2)).toEqual({ adults: 1, ages: [], needsCrib: false })
    expect(second.composedRoomAmenitiesTotal(rt2)).toBe(0)
    expect(second.composedPrice(rt2)).toBe(150) // fila ocupación=1
    // Y tocar la suite no toca la double (ni en la primera instancia ni en la segunda).
    second.setAdults(rt2, 3)
    expect(first.composer(rt)).toEqual({ adults: 2, ages: [5, 1], needsCrib: false, roomAmenityKeys: ['custom:cama'] })
    expect(second.composer(rt)).toEqual({ adults: 2, ages: [5, 1], needsCrib: false, roomAmenityKeys: ['custom:cama'] })
    expect(store.composerState['suite']).toEqual({ adults: 3, ages: [], needsCrib: false })

    // Lo que hace la segunda instancia lo ve la primera (es el mismo estado, no una copia).
    second.setChildAge(rt, 0, 7)
    expect(first.composer(rt).ages).toEqual([7, 1])
  })

  it('sin haber agregado nada al carrito, la composición a medio armar también sobrevive al remount', () => {
    const store = seedStore()
    const rt = rtFromStore(store, 'double')
    const first = useGuestComposer()
    first.setAdults(rt, 2)
    first.setChildrenCount(rt, 1)
    first.setChildAge(rt, 0, 5)
    expect(store.cart).toEqual([])
    const second = useGuestComposer()
    expect(second.composer(rt)).toEqual({ adults: 2, ages: [5], needsCrib: false })
  })
})

describe('useGuestComposer — #343 (C) vuelta: quitar niño, bajar adultos, destildar Cama → nada de la Cama queda en el total', () => {
  it('desde la composición agregada: 1 niño, 1 adulto, sin Cama → "+ $0", precio de 1 adulto; Editar + re-agregar → ITBIS sólo sobre el alojamiento', async () => {
    const store = seedStore()
    const c = useGuestComposer()
    const rt = rtFromStore(store, 'double')
    composeIssue(c, rt)
    await c.addComposedRoom(rt)
    const oldLine = store.cart[0]!
    expect(store.roomAmenitiesTotal).toBe(200)
    expect(store.estimatedTotal).toBe(696.2)

    // Vuelta atrás en la tarjeta (el carrito todavía tiene la línea vieja).
    c.setChildrenCount(rt, 1) // queda el de 5 años (con plaza)
    c.setAdults(rt, 1)
    c.toggleRoomAmenity(rt, 'custom:cama') // destildar
    // (destildar deja `roomAmenityKeys: []` en el estado — lo que importa es que no hay ninguna key)
    expect(c.composer(rt)).toMatchObject({ adults: 1, ages: [5], needsCrib: false })
    expect(c.roomAmenityKeys(rt)).toEqual([])
    expect(c.isRoomAmenitySelected(rt, 'custom:cama')).toBe(false)
    expect(c.composedRoomAmenitiesTotal(rt)).toBe(0)
    expect(c.composition(rt).chargeableOccupancy).toBe(2) // 1 adulto + 1 niño con plaza
    expect(c.composedPrice(rt)).toBe(260)
    c.setChildrenCount(rt, 0)
    expect(c.composer(rt)).toMatchObject({ adults: 1, ages: [], needsCrib: false })
    expect(c.composedPrice(rt)).toBe(150) // precio de 1 adulto: la fila de ocupación=1
    expect(c.composedRoomAmenitiesTotal(rt)).toBe(0)

    // Editar la línea vieja: el composer vuelve a la composición vieja (con Cama) y el carrito
    // se vacía; después el huésped la corrige y re-agrega la nueva.
    expect(c.editCartLine(oldLine)).toBe(true)
    expect(store.cart).toEqual([])
    expect(c.composer(rt)).toEqual({ adults: 2, ages: [5, 1], needsCrib: false, roomAmenityKeys: ['custom:cama'] })
    c.setChildrenCount(rt, 0)
    c.setAdults(rt, 1)
    c.toggleRoomAmenity(rt, 'custom:cama')
    expect(c.composer(rt)).toMatchObject({ adults: 1, ages: [], needsCrib: false })
    expect(c.roomAmenityKeys(rt)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(rt)).toBe(0)
    expect(c.composedPrice(rt)).toBe(150)

    await c.addComposedRoom(rt)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]).toMatchObject({ roomType: 'double', quantity: 1, adults: 1, childrenAges: [], unitPrice: 150 })
    expect(store.cart[0]!.roomAmenities).toBeUndefined()
    expect(store.cart[0]!.key).not.toBe(oldLine.key)
    expect(store.roomAmenityLines).toEqual([])
    expect(store.roomsSubtotal).toBe(150)
    expect(store.roomAmenitiesTotal).toBe(0)
    expect(store.subtotal).toBe(150)
    expect(store.estimatedTaxBreakdown).toEqual([{ name: 'ITBIS', rate: 18, amount: 27 }])
    expect(store.estimatedTotal).toBe(round2(150 * 1.18))
    expect(store.estimatedTotal).toBe(177)
    // La tarjeta sigue mostrando la composición nueva (1 adulto, sin niños, sin Cama).
    expect(c.composer(rt)).toMatchObject({ adults: 1, ages: [], needsCrib: false })
    expect(c.roomAmenityKeys(rt)).toEqual([])
  })
})

describe('useGuestComposer — #343 (D) store.reset() limpia composerState', () => {
  it('tras componer y agregar, reset() deja composerState vacío y la tarjeta vuelve a arrancar fresca', async () => {
    const store = seedStore()
    const c = useGuestComposer()
    const rt = rtFromStore(store, 'double')
    composeIssue(c, rt)
    await c.addComposedRoom(rt)
    expect(Object.keys(store.composerState)).toEqual(['double'])

    store.reset()
    expect(Object.keys(store.composerState).length).toBe(0)
    expect(store.cart).toEqual([])

    // Una instancia vieja del composable no se queda apuntando al estado muerto: lee el nuevo.
    const fresh = roomType('double', 150)
    expect(c.composer(fresh)).toEqual({ adults: 1, ages: [], needsCrib: false })
    expect(store.composerState['double']).toBe(c.composer(fresh))
  })
  it('una búsqueda nueva (otras fechas) vacía el carrito Y las tarjetas: no arrastra la composición anterior', async () => {
    const store = seedStore()
    const c = useGuestComposer()
    const rt = rtFromStore(store, 'double')
    composeIssue(c, rt)
    await c.addComposedRoom(rt)
    expect(store.cart).toHaveLength(1)

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 10, 0, 0))
    try {
      vi.mocked(BookingService.getRates).mockResolvedValue({ ...store.ratesResponse!, checkIn: '2026-09-20', checkOut: '2026-09-22' })
      store.checkIn = '2026-09-20'
      store.checkOut = '2026-09-22'
      await store.search()
    } finally {
      vi.useRealTimers()
    }
    expect(store.ratesResponse?.checkIn).toBe('2026-09-20') // la búsqueda corrió de verdad
    expect(store.cart).toEqual([])
    expect(Object.keys(store.composerState).length).toBe(0)
    expect(c.composer(rtFromStore(store, 'double'))).toEqual({ adults: 1, ages: [], needsCrib: false })
  })
})
