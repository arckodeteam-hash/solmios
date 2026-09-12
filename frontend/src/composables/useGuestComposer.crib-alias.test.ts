// useGuestComposer.crib-alias.test.ts — #292 (revisión del PR #329) / #341: la cuna se reconocía
// SOLO por el literal `custom:cuna`. El slug lo deriva el backend del NOMBRE que cargó el hotel,
// así que un tipo que publica "Cuna para bebé" (`custom:cuna_para_bebe`), "Crib" (`custom:crib`)
// o "Berço" (`custom:berco`) tiene que reconocerse igual (`isCribAmenityKey`, utils/crib-amenity.ts)
// para que `needsCrib` sea espejo de esa key. Desde #341 la cuna entra por el checklist genérico
// como cualquier otra amenidad y la key que viaja es la REAL del catálogo.
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

beforeEach(() => { setActivePinia(createPinia()) })

describe('useGuestComposer — la cuna por alias de nombre/slug (#292 revisión, #341 checklist)', () => {
  it('"Cuna para bebé" ($12) SIN bebé → se lista en el checklist con la cama extra y se tilda con su key real', () => {
    seedStore({ double: [CRIB_ALIAS, EXTRA_BED] })
    const c = useGuestComposer()
    const room = rt('double')
    expect(c.offeredRoomAmenities(room).map((a) => a.key)).toEqual(['custom:cuna_para_bebe', 'custom:cama_extra'])
    c.toggleRoomAmenity(room, 'custom:cuna_para_bebe')
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cuna_para_bebe'])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(12)
    expect(c.composer(room).needsCrib).toBe(true) // reconocida como cuna por el nombre/slug
  })

  it("toggleRoomAmenity('custom:crib') tilda la key REAL del catálogo y la suma; destildar la quita y needsCrib vuelve a false", () => {
    seedStore({ double: [CRIB_EN] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, 'custom:crib')
    expect(c.roomAmenityKeys(room)).toEqual(['custom:crib'])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(8)
    expect(c.composer(room).needsCrib).toBe(true)
    c.toggleRoomAmenity(room, 'custom:crib')
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(0)
    expect(c.composer(room).needsCrib).toBe(false)
  })

  it("el literal 'custom:cuna' NO sirve para tildar un alias: la key tiene que ser la del catálogo", () => {
    seedStore({ double: [CRIB_ALIAS] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, 'custom:cuna')
    expect(c.roomAmenityKeys(room)).toEqual([])
    expect(c.composer(room).needsCrib).toBe(false)
  })

  it('addComposedRoom: la línea lleva needsCrib/cribCount:1 y el snapshot con la key real "Cuna para bebé" a 12', async () => {
    const store = seedStore({ double: [CRIB_ALIAS] })
    const c = useGuestComposer()
    const room = rt('double')
    c.toggleRoomAmenity(room, 'custom:cuna_para_bebe')
    await c.addComposedRoom(room)
    expect(store.cart[0]!.needsCrib).toBe(true)
    expect(store.cart[0]!.cribCount).toBe(1)
    expect(store.cart[0]!.roomAmenities).toEqual([{ key: 'custom:cuna_para_bebe', name: 'Cuna para bebé', price: 12 }])
    expect(store.roomAmenitiesTotal).toBe(12)
    expect(store.subtotal).toBe(112)
    // editCartLine la devuelve a la tarjeta con la misma key real.
    expect(c.editCartLine(store.cart[0]!)).toBe(true)
    expect(c.composer(room)).toEqual({ adults: 1, ages: [], needsCrib: true, roomAmenityKeys: ['custom:cuna_para_bebe'] })
  })

  it('un tipo sin ninguna amenidad cuna (sólo "Cunas" o "Cama extra") las lista igual pero tildarlas no enciende needsCrib', () => {
    seedStore({ double: [{ key: 'custom:cunas', name: 'Cunas', price: 1 }, EXTRA_BED] })
    const c = useGuestComposer()
    const room = rt('double')
    expect(c.offeredRoomAmenities(room)).toHaveLength(2)
    c.toggleRoomAmenity(room, 'custom:cunas')
    c.toggleRoomAmenity(room, 'custom:cama_extra')
    expect(c.roomAmenityKeys(room)).toEqual(['custom:cunas', 'custom:cama_extra'])
    expect(c.composedRoomAmenitiesTotal(room)).toBe(21)
    expect(c.composer(room).needsCrib).toBe(false)
  })
})
