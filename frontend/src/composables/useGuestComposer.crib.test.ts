// useGuestComposer.crib.test.ts — #292: la cuna de una habitación ES su amenidad personalizada
// `custom:cuna` (`CRIB_AMENITY_KEY`), publicada POR TIPO en `store.roomAmenitiesFor` con el
// precio "desde" del tipo. Ya no existe un interruptor global en la política de niños ni un
// catálogo global de amenidades infantiles. Misma forma de setup que
// useBooking.room-amenities.test.ts / useGuestComposer.test.ts (pinia + store), sin DOM.
//
// Qué se protege acá:
//   - "¿Necesita cuna?" se ofrece SOLO con un bebé en la tarjeta Y el tipo publicando `custom:cuna`.
//   - `cribPrice` es el precio de esa fila (0 si no está).
//   - "Sí" agrega la key a `roomAmenityKeys` (suma al "+ $X" vía `composedRoomAmenitiesTotal`);
//     "No" la quita. Bajar los bebés a 0 limpia `needsCrib` y la key.
//   - El checklist genérico de amenidades de habitación NO lista `custom:cuna` y
//     `toggleRoomAmenity('custom:cuna')` no la tilda: sólo entra por `setNeedsCrib`.
//   - Dos tarjetas de tipos distintos se evalúan independientes.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGuestComposer } from './useGuestComposer'
import { useBookingStore } from './useBooking'
import { DEFAULT_CHILD_POLICY } from '@/utils/child-composition'
import { CRIB_AMENITY_KEY, type PublicRoomAmenity, type RoomTypeRate } from '@/types/booking'

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

// maxBabyAge=1: edad 0-1 es bebé; maxFreeAge=3: 2-3 libre; 4-12 con plaza.
const POLICY = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50 }

const CRIB: PublicRoomAmenity = { key: CRIB_AMENITY_KEY, name: 'Cuna', price: 15 }
const EXTRA_BED: PublicRoomAmenity = { key: 'custom:cama-extra', name: 'Cama extra', price: 20 }

function seedStore(catalog: Record<string, PublicRoomAmenity[]>) {
  const store = useBookingStore()
  store.childPolicy = { ...POLICY }
  store.roomAmenities = Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, v.map((a) => ({ ...a }))]))
  store.ratesResponse = {
    currency: 'USD', chargeCurrency: 'USD', nights: 2, checkIn: '2026-09-10', checkOut: '2026-09-12',
    taxes: [], cancellationPolicy: null, cancellationSummary: null,
    roomTypes: [
      { id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null },
      { id: 'suite', name: 'suite', fromPrice: 300, availableCount: 2, capacity: 4, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null },
    ],
  }
  return store
}

/** 1 adulto + 1 bebé (edad 0) en la tarjeta `room`. */
function withBaby(composer: ReturnType<typeof useGuestComposer>, room: RoomTypeRate) {
  composer.setChildrenCount(room, 1)
  composer.setChildAge(room, 0, 0)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useGuestComposer — cuna por habitación (#292): cuándo se ofrece', () => {
  it('CRIB_AMENITY_KEY es custom:cuna (espejo del backend)', () => {
    expect(CRIB_AMENITY_KEY).toBe('custom:cuna')
  })

  it('tipo SIN custom:cuna + bebé → shouldOfferCrib false y cribPrice 0', () => {
    seedStore({ double: [EXTRA_BED] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    expect(c.babiesCount(room)).toBe(1)
    expect(c.shouldOfferCrib(room)).toBe(false)
    expect(c.cribPrice(room)).toBe(0)
  })

  it('tipo sin catálogo + bebé → false (no hay de dónde sacar la cuna)', () => {
    seedStore({})
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    expect(c.shouldOfferCrib(room)).toBe(false)
  })

  it('tipo CON custom:cuna ($15) + bebé → true y cribPrice 15', () => {
    seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    expect(c.shouldOfferCrib(room)).toBe(true)
    expect(c.cribPrice(room)).toBe(15)
  })

  it('SIN bebé → false aunque el tipo publique la cuna (niño libre de 2 o con plaza de 8 no cuentan)', () => {
    seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    expect(c.shouldOfferCrib(room)).toBe(false) // 1 adulto, sin niños
    c.setChildrenCount(room, 2)
    c.setChildAge(room, 0, 2) // libre, no bebé
    c.setChildAge(room, 1, 8) // con plaza
    expect(c.babiesCount(room)).toBe(0)
    expect(c.shouldOfferCrib(room)).toBe(false)
    expect(c.cribPrice(room)).toBe(15) // el precio existe igual: es del tipo, no de la composición
  })

  it('cuna sin cargo (price 0): se ofrece, cribPrice 0', () => {
    seedStore({ double: [{ ...CRIB, price: 0 }] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    expect(c.shouldOfferCrib(room)).toBe(true)
    expect(c.cribPrice(room)).toBe(0)
  })
})

describe('useGuestComposer — cuna por habitación (#292): setNeedsCrib mueve la key custom:cuna', () => {
  it('setNeedsCrib(true) agrega la key y composedRoomAmenitiesTotal suma 15; (false) la quita y vuelve a 0', () => {
    seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)

    c.setNeedsCrib(room, true)
    expect(c.composer(room).needsCrib).toBe(true)
    expect(c.roomAmenityKeys(room)).toEqual([CRIB_AMENITY_KEY])
    expect(c.isRoomAmenitySelected(room, CRIB_AMENITY_KEY)).toBe(true)
    expect(c.composedRoomAmenitiesTotal(room)).toBe(15)

    // Idempotente: repetir "Sí" no duplica la key.
    c.setNeedsCrib(room, true)
    expect(c.roomAmenityKeys(room)).toEqual([CRIB_AMENITY_KEY])

    c.setNeedsCrib(room, false)
    expect(c.composer(room).needsCrib).toBe(false)
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)
    // El estado vuelve a ser exactamente el fresco (sin `roomAmenityKeys: []` colgando).
    expect(c.composer(room)).toEqual({ adults: 1, ages: [0], needsCrib: false })
  })

  it('la cuna convive con una cama extra tildada: quitar la cuna no toca la cama extra', () => {
    seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.toggleRoomAmenity(room, 'custom:cama-extra')
    c.setNeedsCrib(room, true)
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cama-extra', CRIB_AMENITY_KEY])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(35)
    c.setNeedsCrib(room, false)
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cama-extra'])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(20)
  })

  it('bajar los bebés a 0 limpia needsCrib Y la key (por cantidad o por edad)', () => {
    seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.setNeedsCrib(room, true)
    expect(c.roomAmenityKeys(room)).toEqual([CRIB_AMENITY_KEY])

    c.setChildAge(room, 0, 8) // deja de ser bebé
    expect(c.composer(room).needsCrib).toBe(false)
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)

    c.setChildAge(room, 0, 1) // vuelve a ser bebé: la pregunta reaparece, pero NO se autotilda
    expect(c.shouldOfferCrib(room)).toBe(true)
    expect(c.composer(room).needsCrib).toBe(false)
    c.setNeedsCrib(room, true)
    c.setChildrenCount(room, 0) // se va el único bebé
    expect(c.composer(room).needsCrib).toBe(false)
    expect(c.roomAmenityKeys(room)).toEqual([])
  })

  it('bajar los bebés a 0 NO limpia una cama extra tildada (esa no depende de la composición)', () => {
    seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.toggleRoomAmenity(room, 'custom:cama-extra')
    c.setNeedsCrib(room, true)
    c.setChildrenCount(room, 0)
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cama-extra'])
    expect(c.composer(room).needsCrib).toBe(false)
  })
})

describe('useGuestComposer — cuna por habitación (#292): el checklist genérico la excluye', () => {
  it('offeredRoomAmenities no lista custom:cuna; con SOLO cuna en el catálogo shouldOfferRoomAmenities es false', () => {
    seedStore({ double: [EXTRA_BED, CRIB], suite: [CRIB] })
    const c = useGuestComposer()
    expect(c.offeredRoomAmenities(rt('double'))).toEqual([EXTRA_BED])
    expect(c.shouldOfferRoomAmenities(rt('double'))).toBe(true)
    expect(c.offeredRoomAmenities(rt('suite'))).toEqual([])
    expect(c.shouldOfferRoomAmenities(rt('suite'))).toBe(false)
  })

  it("toggleRoomAmenity('custom:cuna') no la tilda ni la destilda: sólo entra por setNeedsCrib", () => {
    seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)

    c.setNeedsCrib(room, true)
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY) // tampoco la saca
    expect(c.roomAmenityKeys(room)).toEqual([CRIB_AMENITY_KEY])
    expect(c.composer(room).needsCrib).toBe(true)
  })
})

describe('useGuestComposer — cuna por habitación (#292): tarjetas independientes y carrito', () => {
  it('dos tarjetas de tipos distintos: sólo la del tipo con custom:cuna ofrece la cuna, cada una con su precio', () => {
    seedStore({ double: [EXTRA_BED], suite: [{ ...CRIB, price: 25 }] })
    const c = useGuestComposer()
    const double = rt('double')
    const suite = rt('suite')
    withBaby(c, double)
    withBaby(c, suite)
    expect(c.shouldOfferCrib(double)).toBe(false)
    expect(c.cribPrice(double)).toBe(0)
    expect(c.shouldOfferCrib(suite)).toBe(true)
    expect(c.cribPrice(suite)).toBe(25)

    c.setNeedsCrib(suite, true)
    expect(c.roomAmenityKeys(suite)).toEqual([CRIB_AMENITY_KEY])
    expect(c.roomAmenityKeys(double)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(suite)).toBe(25)
    expect(c.composedRoomAmenitiesTotal(double)).toBe(0)
  })

  it('addComposedRoom: con cuna pedida la línea lleva needsCrib/cribCount:1 y el snapshot custom:cuna (precio real por room amenities)', async () => {
    const store = seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.setNeedsCrib(room, true)
    await c.addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[0]!.cribCount).toBe(1)
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: CRIB_AMENITY_KEY, name: 'Cuna', price: 15 }])
    expect(store.roomAmenitiesTotal).toBe(15)
    expect(store.subtotal).toBe(115)
    expect(store.roomAmenityLines).toEqual([
      { lineKey: store.cart[0]!.key, roomName: 'double', key: CRIB_AMENITY_KEY, name: 'Cuna', price: 15, quantity: 1, total: 15 },
    ])
    // La tarjeta quedó limpia para la próxima habitación.
    expect(c.composer(room)).toEqual({ adults: 1, ages: [], needsCrib: false })
  })

  it('addComposedRoom: si la cuna quedó en el estado pero el tipo dejó de ofrecerla, no viaja ni needsCrib ni la key', async () => {
    const store = seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.setNeedsCrib(room, true)
    store.roomAmenities = {} // el catálogo cambió entre medio (cotización vieja)
    await c.addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.needsCrib).toBeUndefined()
    expect(store.cart[0]!.roomAmenities).toBeUndefined()
    expect(store.roomAmenitiesTotal).toBe(0)
  })

  it('editCartLine devuelve la cuna a la tarjeta: needsCrib true + key custom:cuna', async () => {
    const store = seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.setNeedsCrib(room, true)
    await c.addComposedRoom(room)

    expect(c.editCartLine(store.cart[0]!)).toBe(true)
    expect(c.composer(room)).toEqual({ adults: 1, ages: [0], needsCrib: true, roomAmenityKeys: [CRIB_AMENITY_KEY] })
    expect(c.composedRoomAmenitiesTotal(room)).toBe(15)
    expect(store.cart).toHaveLength(0)
  })
})
