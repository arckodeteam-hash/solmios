// useGuestComposer.crib-alias.test.ts — #292 (revisión del PR #329): la cuna se reconocía SOLO por
// el literal `custom:cuna`. El slug lo deriva el backend del NOMBRE que cargó el hotel, así que un
// tipo que publica "Cuna para bebé" (`custom:cuna_para_bebe`), "Crib" (`custom:crib`) o "Berço"
// (`custom:berco`) no ofrecía "¿Necesita cuna?" y esa fila caía al checklist genérico. Ahora
// `isCribAmenityKey` (utils/crib-amenity.ts) decide, y la key que viaja es la REAL del catálogo.
// Mismo setup que useGuestComposer.crib.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGuestComposer } from './useGuestComposer'
import { useBookingStore } from './useBooking'
import { DEFAULT_CHILD_POLICY } from '@/utils/child-composition'
import type { PublicRoomAmenity, RoomTypeRate } from '@/types/booking'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getUpsells: vi.fn().mockResolvedValue([]) },
}))

function rt(id = 'double'): RoomTypeRate {
  return { id, name: id, fromPrice: 100, availableCount: 5, capacity: 6, maxAdults: null, maxChildren: null, surfaceArea: 0, taxBreakdown: [], photoUrl: null } as RoomTypeRate
}
const POLICY = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50 }
const CRIB_ALIAS: PublicRoomAmenity = { key: 'custom:cuna_para_bebe', name: 'Cuna para bebé', price: 12 }
const CRIB_EN: PublicRoomAmenity = { key: 'custom:crib', name: 'Crib', price: 8 }
const EXTRA_BED: PublicRoomAmenity = { key: 'custom:cama_extra', name: 'Cama extra', price: 20 }

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
function withBaby(composer: ReturnType<typeof useGuestComposer>, room: RoomTypeRate) {
  composer.setChildrenCount(room, 1)
  composer.setChildAge(room, 0, 0)
}

beforeEach(() => { setActivePinia(createPinia()) })

describe('useGuestComposer — la cuna por alias de nombre/slug (#292, revisión)', () => {
  it('"Cuna para bebé" ($12) + bebé → se ofrece con SU precio y no aparece en el checklist genérico', () => {
    seedStore({ double: [CRIB_ALIAS, EXTRA_BED] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    expect(c.shouldOfferCrib(room)).toBe(true)
    expect(c.cribPrice(room)).toBe(12)
    expect(c.offeredRoomAmenities(room).map((a) => a.key)).toEqual(['custom:cama_extra'])
    // El toggle genérico no la tilda: sólo entra por setNeedsCrib.
    c.toggleRoomAmenity(room, 'custom:cuna_para_bebe')
    expect(c.roomAmenityKeys(room)).toEqual([])
  })

  it('setNeedsCrib(true) agrega la key REAL del catálogo (custom:crib) y la suma; (false) la quita', () => {
    seedStore({ double: [CRIB_EN] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.setNeedsCrib(room, true)
    expect(c.roomAmenityKeys(room)).toEqual(['custom:crib'])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(8)
    c.setNeedsCrib(room, false)
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)
  })

  it('addComposedRoom: la línea lleva needsCrib y el snapshot con la key real "Cuna para bebé" a 12', async () => {
    const store = seedStore({ double: [CRIB_ALIAS] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    c.setNeedsCrib(room, true)
    await c.addComposedRoom(room)
    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cuna_para_bebe', name: 'Cuna para bebé', price: 12 }])
    expect(store.roomAmenitiesTotal).toBe(12)
    expect(store.subtotal).toBe(112)
    // editCartLine la devuelve a la tarjeta con la misma key real.
    expect(c.editCartLine(store.cart[0]!)).toBe(true)
    expect(c.composer(room)).toEqual({ adults: 1, ages: [0], needsCrib: true, roomAmenityKeys: ['custom:cuna_para_bebe'] })
  })

  it('un tipo sin ninguna amenidad cuna (sólo "Cunas" o "Cama extra") no la ofrece', () => {
    seedStore({ double: [{ key: 'custom:cunas', name: 'Cunas', price: 1 }, EXTRA_BED] })
    const c = useGuestComposer()
    const room = rt('double')
    withBaby(c, room)
    expect(c.shouldOfferCrib(room)).toBe(false)
    expect(c.offeredRoomAmenities(room)).toHaveLength(2)
  })
})
