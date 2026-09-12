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
import { DEFAULT_CHILD_POLICY } from '@/utils/child-composition'
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
    expect(composer(rt('double'))).toEqual({ adults: 1, ages: [], needsCrib: false })
    expect(composer(rt('suite'))).toEqual({ adults: 1, ages: [], needsCrib: false })
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
    useBookingStore().childPolicy = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 5, maxFreeAge: 0, maxBabyAge: 0, childrenDiscountEnabled: false, childrenRatePercent: 50 }
    expect(maxChildAgeOptions.value).toBe(6)
  })

  it('maxChildAge=0 (caso borde válido): ofrece UNA sola opción (0 años)', () => {
    const { maxChildAgeOptions } = useGuestComposer()
    useBookingStore().childPolicy = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 0, maxFreeAge: 0, maxBabyAge: 0, childrenDiscountEnabled: false, childrenRatePercent: 50 }
    expect(maxChildAgeOptions.value).toBe(1)
  })
})

// ─── Tarea 22 (Cuna, 2026-09-08), simplificada 2026-09-09 a Sí/No; #292 cuna por habitación ────
// La cuna se ofrece si el TIPO publica la amenidad `custom:cuna` (`store.roomAmenitiesFor`) —
// ya no hay interruptor global en la política. El detalle (precio, key en roomAmenityKeys,
// checklist genérico sin la cuna) vive en useGuestComposer.crib.test.ts; acá queda el Sí/No y el
// gateo al agregar.
describe('useGuestComposer — cuna (Sí/No, gateada por custom:cuna del tipo)', () => {
  const CRIB_POLICY = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50 }
  const CRIB_CATALOG = { double: [{ key: 'custom:cuna', name: 'Cuna', price: 15 }] }
  function withBaby() {
    // maxBabyAge=1: edad 0-1 es bebé. El tipo `double` publica `custom:cuna` — ofrece cuna.
    useBookingStore().childPolicy = { ...CRIB_POLICY }
    useBookingStore().roomAmenities = { ...CRIB_CATALOG }
    const { setChildrenCount, setChildAge, ...rest } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 1)
    setChildAge(room, 0, 0) // edad 0 → bebé
    return { room, setChildrenCount, setChildAge, ...rest }
  }

  it('babiesCount refleja la composición en vivo', () => {
    const { room, babiesCount } = withBaby()
    expect(babiesCount(room)).toBe(1)
  })

  it('shouldOfferCrib: false sin bebé, false si el tipo no publica custom:cuna, true solo con AMBOS', () => {
    useBookingStore().childPolicy = { ...CRIB_POLICY }
    const { setChildrenCount, setChildAge, shouldOfferCrib } = useGuestComposer()
    const room = rt()
    expect(shouldOfferCrib(room)).toBe(false) // sin bebé todavía
    setChildrenCount(room, 1)
    setChildAge(room, 0, 0) // bebé, pero el tipo sigue sin custom:cuna
    expect(shouldOfferCrib(room)).toBe(false)
    useBookingStore().roomAmenities = { ...CRIB_CATALOG }
    expect(shouldOfferCrib(room)).toBe(true)
  })

  it('setNeedsCrib(true)/(false) — Sí/No puro, sin cantidad en el estado', () => {
    const { room, setNeedsCrib, composer } = withBaby()
    setNeedsCrib(room, true)
    expect(composer(room).needsCrib).toBe(true)
    setNeedsCrib(room, false)
    expect(composer(room).needsCrib).toBe(false)
  })

  it('bajar la edad del único bebé por debajo del umbral limpia la cuna (defensa en profundidad)', () => {
    const { room, setNeedsCrib, setChildAge, composer } = withBaby()
    setNeedsCrib(room, true)
    expect(composer(room).needsCrib).toBe(true)
    setChildAge(room, 0, 8) // 8 > maxFreeAge=3 → deja de ser bebé (y de ser libre)
    expect(composer(room).needsCrib).toBe(false)
  })

  it('bajar la CANTIDAD de niños a 0 (se va el único bebé) también limpia la cuna', () => {
    const { room, setNeedsCrib, setChildrenCount, composer } = withBaby()
    setNeedsCrib(room, true)
    setChildrenCount(room, 0)
    expect(composer(room).needsCrib).toBe(false)
  })

  it('varios bebés: sigue siendo Sí/No — no hay cantidad que escale con la cantidad de bebés', () => {
    useBookingStore().childPolicy = { ...CRIB_POLICY }
    const { setChildrenCount, setChildAge, setNeedsCrib, composer, babiesCount } = useGuestComposer()
    const room = rt()
    setChildrenCount(room, 2)
    setChildAge(room, 0, 0)
    setChildAge(room, 1, 1)
    expect(babiesCount(room)).toBe(2)
    setNeedsCrib(room, true)
    expect(composer(room).needsCrib).toBe(true)
  })

  it('addComposedRoom: CON bebé y el tipo publicando custom:cuna, manda needsCrib/cribCount:1 al carrito (y la key con su precio)', async () => {
    const store = useBookingStore()
    store.ratesResponse = {
      currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
      taxes: [], cancellationPolicy: null, cancellationSummary: null,
      roomTypes: [{ id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null }],
    }
    const { room, setNeedsCrib, addComposedRoom } = withBaby()
    setNeedsCrib(room, true)
    await addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[0]!.cribCount).toBe(1)
    // #292 — la cuna se cobra como amenidad de habitación: la línea trae el snapshot de custom:cuna.
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cuna', name: 'Cuna', price: 15 }])
    expect(store.roomAmenitiesTotal).toBe(15)
  })

  it('addComposedRoom: tipo SIN custom:cuna, needsCrib NUNCA llega al carrito aunque el huésped haya tildado "Sí"', async () => {
    const store = useBookingStore()
    store.childPolicy = { ...CRIB_POLICY }
    store.roomAmenities = {}
    store.ratesResponse = {
      currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
      taxes: [], cancellationPolicy: null, cancellationSummary: null,
      roomTypes: [{ id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null }],
    }
    const { setChildrenCount, setChildAge, setNeedsCrib, addComposedRoom } = useGuestComposer()
    const room = rt('double')
    setChildrenCount(room, 1)
    setChildAge(room, 0, 0) // bebé
    setNeedsCrib(room, true) // el composer interno lo tiene en true...
    await addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.needsCrib).toBeUndefined() // ...pero el tipo no ofrece cuna, no se manda
    expect(store.cart[0]!.roomAmenities).toBeUndefined()
  })

  it('addComposedRoom: SIN bebé, needsCrib NUNCA llega al carrito aunque el estado interno lo tenga', async () => {
    const store = useBookingStore()
    store.childPolicy = { ...CRIB_POLICY }
    store.roomAmenities = { ...CRIB_CATALOG }
    store.ratesResponse = {
      currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
      taxes: [], cancellationPolicy: null, cancellationSummary: null,
      roomTypes: [{ id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null }],
    }
    const { setAdults, addComposedRoom } = useGuestComposer()
    const room = rt('double')
    setAdults(room, 2) // sin niños → sin bebé
    await addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.needsCrib).toBeUndefined()
  })

  it('dos habitaciones con la MISMA composición pero DISTINTA cuna quedan en líneas separadas del carrito', async () => {
    const store = useBookingStore()
    store.ratesResponse = {
      currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
      taxes: [], cancellationPolicy: null, cancellationSummary: null,
      roomTypes: [{ id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null }],
    }
    store.childPolicy = { ...CRIB_POLICY }
    store.roomAmenities = { ...CRIB_CATALOG }
    const { setChildrenCount, setChildAge, setNeedsCrib, addComposedRoom } = useGuestComposer()
    const room = rt('double')

    // 1ª habitación: 1 adulto + bebé (edad 0), CON cuna.
    setChildrenCount(room, 1)
    setChildAge(room, 0, 0)
    setNeedsCrib(room, true)
    await addComposedRoom(room)

    // 2ª habitación: MISMA composición (adultos default 1, bebé edad 0), SIN cuna.
    setChildrenCount(room, 1)
    setChildAge(room, 0, 0)
    await addComposedRoom(room)

    expect(store.cart).toHaveLength(2) // no se mezclaron en una sola línea "×2"
    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[1]!.needsCrib).toBeUndefined()
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
    expect(composer(room)).toEqual({ adults: 1, ages: [], needsCrib: false })
  })
})

// ─── Tarea "Cobro % niños" (2026-09-09, generalizada desde "Cobro 50% niños") ───────────────────
describe('useGuestComposer — composedPrice con el descuento infantil porcentual', () => {
  // Espejo de la grilla usada en los tests del backend (public-booking-composition.test.ts):
  // occupancy 1 = $100, occupancy 2 = $200.
  function rtWithMatrix(): RoomTypeRate {
    return {
      ...rt('double'),
      occupancies: [
        { occupancy: 1, price: 100, pricePerNight: 100, available: true, unavailableReason: null, taxBreakdown: [] },
        { occupancy: 2, price: 200, pricePerNight: 200, available: true, unavailableReason: null, taxBreakdown: [] },
      ],
    } as RoomTypeRate
  }
  // maxFreeAge=3, maxBabyAge=1: edad 0-1 bebé, 2-3 libre, 4-12 con plaza.
  const BASE_POLICY = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1 }

  it('regla deshabilitada: composedPrice usa la fila plana de siempre (chargeableOccupancy)', () => {
    useBookingStore().childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: false, childrenRatePercent: 50 }
    const { setAdults, setChildrenCount, setChildAge, composedPrice } = useGuestComposer()
    const room = rtWithMatrix()
    setAdults(room, 1)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 8) // con plaza
    expect(composedPrice(room)).toBe(200) // fila de ocupación=2 tal cual
  })

  it.each([1, 50, 100])('regla habilitada al %i%%: 1 adulto ($100) + 1 niño con plaza', (pct) => {
    useBookingStore().childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: pct }
    const { setAdults, setChildrenCount, setChildAge, composedPrice } = useGuestComposer()
    const room = rtWithMatrix()
    setAdults(room, 1)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 8)
    // adultsRow=100, perAdult=100, niño = pct% de 100 = pct → total 100+pct.
    expect(composedPrice(room)).toBe(100 + pct)
  })

  it('2 adultos ($200) + 1 niño con plaza al 50% → "valor de un adulto" = 200/2 = 100, niño $50, total $250', () => {
    useBookingStore().childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 50 }
    const { setAdults, setChildrenCount, setChildAge, composedPrice } = useGuestComposer()
    const room = rtWithMatrix()
    setAdults(room, 2)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 8)
    expect(composedPrice(room)).toBe(250)
  })

  it('bebé (edad 1): NO recibe la regla — composedPrice ignora el descuento cuando no hay niños con plaza', () => {
    useBookingStore().childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 50 }
    const { setAdults, setChildrenCount, setChildAge, composedPrice } = useGuestComposer()
    const room = rtWithMatrix()
    setAdults(room, 1)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 1) // bebé
    expect(composedPrice(room)).toBe(100) // solo el adulto, occupancy=1
  })

  it('composedPricePerNight refleja el mismo total con descuento, dividido en las noches de la búsqueda', () => {
    useBookingStore().childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 50 }
    const store = useBookingStore()
    store.ratesResponse = {
      currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
      taxes: [], cancellationPolicy: null, cancellationSummary: null, roomTypes: [],
    }
    const { setAdults, setChildrenCount, setChildAge, composedPrice, composedPricePerNight } = useGuestComposer()
    const room = rtWithMatrix()
    setAdults(room, 1)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 8)
    expect(composedPrice(room)).toBe(150)
    expect(composedPricePerNight(room)).toBe(75) // 150 / 2 noches
  })

  it('el precio calculado con descuento es el MISMO que quedaría cobrado al agregar la habitación (AC: se conserva)', async () => {
    useBookingStore().childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 60 }
    const store = useBookingStore()
    store.ratesResponse = {
      currency: 'USD', chargeCurrency: 'USD', nights: 1, checkIn: '2026-09-10', checkOut: '2026-09-11',
      taxes: [], cancellationPolicy: null, cancellationSummary: null, roomTypes: [rtWithMatrix()],
    }
    const { setAdults, setChildrenCount, setChildAge, composedPrice, addComposedRoom } = useGuestComposer()
    const room = rtWithMatrix()
    setAdults(room, 1)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 8)
    const shownPrice = composedPrice(room) // 160 (100 + 60% de 100)
    expect(shownPrice).toBe(160)

    await addComposedRoom(room)
    // `addToCart` (useBooking.ts) aplica la MISMA fórmula al empujar la línea — si no lo hiciera,
    // `store.cart[0].unitPrice` sería 200 (la fila plana de ocupación=2), no 160: el huésped vería
    // un número al elegir la habitación y otro distinto en el resumen/pago.
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.adults).toBe(1)
    expect(store.cart[0]!.childrenAges).toEqual([8])
    expect(store.cart[0]!.unitPrice).toBe(160)
  })
})

// ─── REQ-02 (#234) — Editar una habitación agregada recupera los mismos datos ───────────────────
describe('useGuestComposer — editCartLine devuelve UNA unidad de la línea al composer de su tarjeta', () => {
  // maxFreeAge=3, maxBabyAge=1, hotel acepta niños. La cuna (#292) la publica el tipo `suite`
  // vía `custom:cuna`; `double` ofrece una cama extra.
  const EDIT_POLICY = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50 }
  const ROOM_TYPES = [
    { id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null },
    { id: 'suite', name: 'suite', fromPrice: 300, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null },
  ]
  function setupStore() {
    const store = useBookingStore()
    store.childPolicy = { ...EDIT_POLICY }
    store.ratesResponse = {
      currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
      taxes: [], cancellationPolicy: null, cancellationSummary: null, roomTypes: ROOM_TYPES,
    }
    store.roomAmenities = {
      double: [{ key: 'custom:cama-extra', name: 'Cama extra', price: 20 }],
      suite: [{ key: 'custom:cuna', name: 'Cuna', price: 15 }],
    }
    return store
  }

  it('recupera adults/ages/needsCrib (con la key custom:cuna) en composer(rt) y quita la línea (quantity 1)', async () => {
    const store = setupStore()
    const { setAdults, setChildrenCount, setChildAge, setNeedsCrib, addComposedRoom, composer, editCartLine } = useGuestComposer()
    const room = rt('suite')
    setAdults(room, 2)
    setChildrenCount(room, 2)
    setChildAge(room, 0, 0) // bebé
    setChildAge(room, 1, 7) // con plaza
    setNeedsCrib(room, true)
    await addComposedRoom(room)
    expect(store.cart).toHaveLength(1)
    // Tras agregar la tarjeta quedó limpia — el dato solo vive en la línea del carrito.
    expect(composer(room)).toEqual({ adults: 1, ages: [], needsCrib: false })

    expect(editCartLine(store.cart[0]!)).toBe(true)

    expect(composer(room)).toEqual({ adults: 2, ages: [0, 7], needsCrib: true, roomAmenityKeys: ['custom:cuna'] })
    expect(store.cart).toHaveLength(0) // era la última unidad: la línea se fue entera
  })

  it('recupera roomAmenityKeys (#290: cama extra de la habitación) — se perdían al editar', async () => {
    const store = setupStore()
    const { setAdults, toggleRoomAmenity, addComposedRoom, composer, editCartLine } = useGuestComposer()
    const room = rt('double')
    setAdults(room, 2)
    toggleRoomAmenity(room, 'custom:cama-extra')
    await addComposedRoom(room)
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cama-extra', name: 'Cama extra', price: 20 }])
    expect(composer(room)).toEqual({ adults: 1, ages: [], needsCrib: false })

    expect(editCartLine(store.cart[0]!)).toBe(true)

    expect(composer(room)).toEqual({ adults: 2, ages: [], needsCrib: false, roomAmenityKeys: ['custom:cama-extra'] })
    expect(store.cart).toHaveLength(0)
  })

  it('con quantity 2 descuenta UNA unidad (queda 1 en el carrito) y precarga el composer', async () => {
    const store = setupStore()
    const { setAdults, setChildrenCount, setChildAge, addComposedRoom, composer, editCartLine } = useGuestComposer()
    const room = rt('double')
    // Dos habitaciones con la MISMA composición → una línea ×2.
    setAdults(room, 2)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 5)
    await addComposedRoom(room)
    setAdults(room, 2)
    setChildrenCount(room, 1)
    setChildAge(room, 0, 5)
    await addComposedRoom(room)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.quantity).toBe(2)
    const key = store.cart[0]!.key

    expect(editCartLine(store.cart[0]!)).toBe(true)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.key).toBe(key)
    expect(store.cart[0]!.quantity).toBe(1)
    expect(store.cart[0]!.childrenAges).toEqual([5]) // la línea que queda no cambió
    expect(composer(room)).toEqual({ adults: 2, ages: [5], needsCrib: false })
    // El composer NO comparte el array de edades con la línea que sigue en el carrito.
    composer(room).ages[0] = 9
    expect(store.cart[0]!.childrenAges).toEqual([5])
  })

  it('con dos líneas de tipos distintos, editar una NO cambia la otra ni el composer de la otra tarjeta', async () => {
    const store = setupStore()
    const { setAdults, setChildrenCount, setChildAge, setNeedsCrib, addComposedRoom, composer, editCartLine } = useGuestComposer()
    const double = rt('double')
    const suite = rt('suite')
    // double: 2 adultos + niño de 8.
    setAdults(double, 2)
    setChildrenCount(double, 1)
    setChildAge(double, 0, 8)
    await addComposedRoom(double)
    // suite: 1 adulto + bebé con cuna.
    setChildrenCount(suite, 1)
    setChildAge(suite, 0, 1)
    setNeedsCrib(suite, true)
    await addComposedRoom(suite)
    expect(store.cart).toHaveLength(2)
    const suiteLine = store.cart.find((l) => l.roomType === 'suite')!
    const suiteBefore = JSON.parse(JSON.stringify(suiteLine))
    // La tarjeta de la suite tiene algo a medio componer que NO debe pisarse.
    setAdults(suite, 3)

    expect(editCartLine(store.cart.find((l) => l.roomType === 'double')!)).toBe(true)

    expect(composer(double)).toEqual({ adults: 2, ages: [8], needsCrib: false })
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]).toEqual(suiteBefore) // la línea de la suite quedó intacta
    expect(composer(suite)).toEqual({ adults: 3, ages: [], needsCrib: false }) // la otra tarjeta tampoco se tocó
  })

  it('roomType desconocido (ya no está en ratesResponse) devuelve false y el carrito queda igual', async () => {
    const store = setupStore()
    const { setAdults, addComposedRoom, composer, editCartLine } = useGuestComposer()
    const room = rt('double')
    setAdults(room, 2)
    await addComposedRoom(room)
    expect(store.cart).toHaveLength(1)
    const before = JSON.parse(JSON.stringify(store.cart))

    expect(editCartLine({ ...store.cart[0]!, roomType: 'ghost' })).toBe(false)

    expect(store.cart).toEqual(before)
    expect(composer(room)).toEqual({ adults: 1, ages: [], needsCrib: false })
    expect(composer(rt('ghost'))).toEqual({ adults: 1, ages: [], needsCrib: false })
  })

  it('línea legacy de ocupación plana (sin adults/childrenAges) devuelve false y no toca nada', () => {
    const store = setupStore()
    const { composer, editCartLine } = useGuestComposer()
    store.cart = [{
      key: 'double:2', roomType: 'double', roomName: 'double', occupancy: 2, quantity: 1,
      unitPrice: 100, unitTaxBreakdown: [], maxAvailable: 5, photoUrl: null,
    }]
    expect(editCartLine(store.cart[0]!)).toBe(false)
    expect(store.cart).toHaveLength(1)
    expect(composer(rt('double'))).toEqual({ adults: 1, ages: [], needsCrib: false })
  })
})
