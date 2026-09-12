// useGuestComposer.crib.test.ts — #292 / #341: la cuna de una habitación ES su amenidad
// personalizada `custom:cuna` (`CRIB_AMENITY_KEY`), publicada POR TIPO en `store.roomAmenitiesFor`
// con el precio "desde" del tipo. Desde #341 es UNA AMENIDAD MÁS del checklist genérico: ya no
// existe la pregunta "¿Necesita cuna?" ni el gate por bebé (ni `shouldOfferCrib`/`setNeedsCrib`/
// `cribPrice`). Misma forma de setup que useBooking.room-amenities.test.ts /
// useGuestComposer.test.ts (pinia + store), sin DOM.
//
// Qué se protege acá:
//   - `offeredRoomAmenities` lista la cuna junto a las demás, SIN bebé en la tarjeta.
//   - `toggleRoomAmenity('custom:cuna')` la tilda/destilda, suma/resta su precio en
//     `composedRoomAmenitiesTotal` y mantiene `needsCrib` como espejo de la key.
//   - Cuna a precio 0 se lista y suma 0.
//   - Bajar los bebés a 0 NO limpia la cuna (no hay flujo especial por bebé).
//   - `addComposedRoom` lleva `needsCrib:true`/`cribCount:1` y el snapshot de la key; `editCartLine`
//     la devuelve a la tarjeta.
//   - Un tipo sin cuna en el catálogo ignora `toggleRoomAmenity('custom:cuna')`.
//   - Dos tarjetas de tipos distintos listan cada una sólo su catálogo.
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

// Precios del issue #341: Cama $200 + Cuna $100.
const CRIB: PublicRoomAmenity = { key: CRIB_AMENITY_KEY, name: 'Cuna', price: 100 }
const EXTRA_BED: PublicRoomAmenity = { key: 'custom:cama', name: 'Cama', price: 200 }
const MINIBAR: PublicRoomAmenity = { key: 'custom:minibar', name: 'Minibar', price: 30 }

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

describe('useGuestComposer — cuna como amenidad normal (#341): qué se lista', () => {
  it('CRIB_AMENITY_KEY es custom:cuna (espejo del backend)', () => {
    expect(CRIB_AMENITY_KEY).toBe('custom:cuna')
  })

  it('tipo con Cama ($200) + Cuna ($100), SIN bebé → offeredRoomAmenities lista las DOS y shouldOfferRoomAmenities true', () => {
    seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    expect(c.babiesCount(room)).toBe(0) // 1 adulto, sin niños
    expect(c.offeredRoomAmenities(room)).toEqual([EXTRA_BED, CRIB])
    expect(c.shouldOfferRoomAmenities(room)).toBe(true)
  })

  it('con SOLO la cuna en el catálogo el checklist se muestra igual (la cuna cuenta como amenidad)', () => {
    seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    expect(c.offeredRoomAmenities(rt('double'))).toEqual([CRIB])
    expect(c.shouldOfferRoomAmenities(rt('double'))).toBe(true)
  })

  it('con 3 amenidades (Cama, Cuna, Minibar) se listan las 3, en el orden del catálogo', () => {
    seedStore({ double: [EXTRA_BED, CRIB, MINIBAR] })
    const c = useGuestComposer()
    expect(c.offeredRoomAmenities(rt('double')).map((a) => a.key)).toEqual(['custom:cama', CRIB_AMENITY_KEY, 'custom:minibar'])
  })

  it('tipo sin catálogo → nada que listar, checklist oculto', () => {
    seedStore({})
    const c = useGuestComposer()
    expect(c.offeredRoomAmenities(rt('double'))).toEqual([])
    expect(c.shouldOfferRoomAmenities(rt('double'))).toBe(false)
  })

  it('la cuna se lista aunque haya bebé, niño libre o niño con plaza: la composición no la gatea', () => {
    seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    expect(c.offeredRoomAmenities(room)).toEqual([CRIB])
    c.setChildrenCount(room, 2)
    c.setChildAge(room, 0, 2) // libre
    c.setChildAge(room, 1, 8) // con plaza
    expect(c.babiesCount(room)).toBe(0)
    expect(c.offeredRoomAmenities(room)).toEqual([CRIB])
  })
})

describe('useGuestComposer — cuna como amenidad normal (#341): toggleRoomAmenity', () => {
  it("toggleRoomAmenity('custom:cuna') la tilda (+100, needsCrib true) y destildarla resta (needsCrib false)", () => {
    seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)
    expect(c.composer(room).needsCrib).toBe(false)

    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    expect(c.roomAmenityKeys(room)).toEqual([CRIB_AMENITY_KEY])
    expect(c.isRoomAmenitySelected(room, CRIB_AMENITY_KEY)).toBe(true)
    expect(c.composedRoomAmenitiesTotal(room)).toBe(100)
    expect(c.composer(room).needsCrib).toBe(true)

    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.isRoomAmenitySelected(room, CRIB_AMENITY_KEY)).toBe(false)
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)
    expect(c.composer(room).needsCrib).toBe(false)
    // El estado vuelve a ser exactamente el fresco (sin `roomAmenityKeys: []` colgando).
    expect(c.composer(room)).toEqual({ adults: 1, ages: [], needsCrib: false })
  })

  it('Cama + Cuna tildadas suman 300; quitar la cuna deja la cama (200) y needsCrib false', () => {
    seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, 'custom:cama')
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cama', CRIB_AMENITY_KEY])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(300)
    expect(c.composer(room).needsCrib).toBe(true)

    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cama'])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(200)
    expect(c.composer(room).needsCrib).toBe(false)
  })

  it('tildar sólo la cama NO enciende needsCrib', () => {
    seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, 'custom:cama')
    expect(c.composer(room).needsCrib).toBe(false)
    expect(c.composedRoomAmenitiesTotal(room)).toBe(200)
  })

  it('cuna sin cargo (price 0): se lista, se tilda y suma 0 (needsCrib true igual)', () => {
    seedStore({ double: [{ ...CRIB, price: 0 }] })
    const c = useGuestComposer()
    const room = rt('double')
    expect(c.offeredRoomAmenities(room)).toEqual([{ ...CRIB, price: 0 }])
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    expect(c.roomAmenityKeys(room)).toEqual([CRIB_AMENITY_KEY])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)
    expect(c.composer(room).needsCrib).toBe(true)
  })

  it("tipo sin cuna en el catálogo → toggleRoomAmenity('custom:cuna') se ignora (key no ofrecida)", () => {
    seedStore({ double: [EXTRA_BED] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)
    expect(c.composer(room)).toEqual({ adults: 1, ages: [], needsCrib: false })
  })

  it('bajar los bebés a 0 NO quita la cuna tildada (por edad ni por cantidad): sin flujo especial por bebé', () => {
    seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.toggleRoomAmenity(room, 'custom:cama')
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)

    c.setChildAge(room, 0, 8) // deja de ser bebé
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cama', CRIB_AMENITY_KEY])
    expect(c.composer(room).needsCrib).toBe(true)
    expect(c.composedRoomAmenitiesTotal(room)).toBe(300)

    c.setChildrenCount(room, 0) // se va el único niño
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cama', CRIB_AMENITY_KEY])
    expect(c.composer(room).needsCrib).toBe(true)
    expect(c.composedRoomAmenitiesTotal(room)).toBe(300)
  })
})

describe('useGuestComposer — cuna como amenidad normal (#341): tarjetas independientes y carrito', () => {
  it('dos tarjetas de tipos distintos: cada una lista sólo SU catálogo y tilda sólo lo suyo', () => {
    seedStore({ double: [EXTRA_BED], suite: [{ ...CRIB, price: 25 }] })
    const c = useGuestComposer()
    const double = rt('double')
    const suite = rt('suite')
    expect(c.offeredRoomAmenities(double)).toEqual([EXTRA_BED])
    expect(c.offeredRoomAmenities(suite)).toEqual([{ ...CRIB, price: 25 }])

    c.toggleRoomAmenity(suite, CRIB_AMENITY_KEY)
    c.toggleRoomAmenity(double, CRIB_AMENITY_KEY) // double no la ofrece: se ignora
    expect(c.roomAmenityKeys(suite)).toEqual([CRIB_AMENITY_KEY])
    expect(c.roomAmenityKeys(double)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(suite)).toBe(25)
    expect(c.composedRoomAmenitiesTotal(double)).toBe(0)
    expect(c.composer(suite).needsCrib).toBe(true)
    expect(c.composer(double).needsCrib).toBe(false)
  })

  it('addComposedRoom SIN bebé con cuna tildada → línea needsCrib:true/cribCount:1 y snapshot custom:cuna a 100', async () => {
    const store = seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    await c.addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[0]!.cribCount).toBe(1)
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: CRIB_AMENITY_KEY, name: 'Cuna', price: 100 }])
    expect(store.roomAmenitiesTotal).toBe(100)
    expect(store.subtotal).toBe(200)
    expect(store.roomAmenityLines).toEqual([
      { lineKey: store.cart[0]!.key, roomName: 'double', key: CRIB_AMENITY_KEY, name: 'Cuna', price: 100, quantity: 1, total: 100 },
    ])
    // La tarjeta quedó limpia para la próxima habitación.
    expect(c.composer(room)).toEqual({ adults: 1, ages: [], needsCrib: false })
  })

  it('addComposedRoom con Cama + Cuna: las dos viajan en el snapshot (300) y needsCrib true', async () => {
    const store = seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, 'custom:cama')
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    await c.addComposedRoom(room)

    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[0]!.cribCount).toBe(1)
    expect(store.cart[0]!.roomAmenities).toEqual([
      { key: 'custom:cama', name: 'Cama', price: 200 },
      { key: CRIB_AMENITY_KEY, name: 'Cuna', price: 100 },
    ])
    expect(store.roomAmenitiesTotal).toBe(300)
    expect(store.subtotal).toBe(400)
  })

  it('addComposedRoom sin cuna tildada (sólo cama) → needsCrib no viaja', async () => {
    const store = seedStore({ double: [EXTRA_BED, CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, 'custom:cama')
    await c.addComposedRoom(room)

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.needsCrib).toBeUndefined()
    expect(store.cart[0]!.cribCount).toBeUndefined()
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cama', name: 'Cama', price: 200 }])
  })

  it('addComposedRoom: si la cuna quedó tildada pero el tipo dejó de ofrecerla, no viaja ni needsCrib ni la key', async () => {
    const store = seedStore({ double: [CRIB] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
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
    c.toggleRoomAmenity(room, CRIB_AMENITY_KEY)
    await c.addComposedRoom(room)

    expect(c.editCartLine(store.cart[0]!)).toBe(true)
    expect(c.composer(room)).toEqual({ adults: 1, ages: [0], needsCrib: true, roomAmenityKeys: [CRIB_AMENITY_KEY] })
    expect(c.isRoomAmenitySelected(room, CRIB_AMENITY_KEY)).toBe(true)
    expect(c.composedRoomAmenitiesTotal(room)).toBe(100)
    expect(store.cart).toHaveLength(0)
  })
})
