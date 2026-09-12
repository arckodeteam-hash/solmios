// useBooking.child-rate.test.ts — Tarea "Cobro % niños" (2026-09-09).
//
// `addToCart` es el punto donde el precio que YA se mostró al componer la habitación
// (`useGuestComposer.composedPrice`, misma fórmula) queda GRABADO en la línea del carrito. Sin
// aplicar acá el mismo descuento, `roomsSubtotal`/el resumen/el pago seguían leyendo la fila
// plana de `chargeableOccupancy` — el huésped vería un precio al elegir y otro en el pago. Este
// archivo cubre esa línea puntual, separado de `useGuestComposer.test.ts` (que cubre el precio
// EN VIVO mientras se compone) para dejar claro qué se rompe si alguno de los dos se desincroniza.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBookingStore } from './useBooking'
import type { RoomTypeRate } from '@/types/booking'
import { DEFAULT_CHILD_POLICY } from '@/utils/child-composition'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getUpsells: vi.fn().mockResolvedValue([]) },
}))

// Espejo de la grilla de los tests de composer/backend: occupancy 1 = $100, occupancy 2 = $200,
// impuesto del 18% ya calculado por fila (mismo shape que manda `/rates`).
function rtWithMatrix(): RoomTypeRate {
  return {
    id: 'double', name: 'double', fromPrice: 100, availableCount: 5, capacity: 6,
    maxAdults: null, maxChildren: null, surfaceArea: 0, photoUrl: null,
    taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 18 }],
    occupancies: [
      { occupancy: 1, price: 100, pricePerNight: 100, available: true, unavailableReason: null, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 18 }] },
      { occupancy: 2, price: 200, pricePerNight: 200, available: true, unavailableReason: null, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 36 }] },
    ],
  } as RoomTypeRate
}

const BASE_POLICY = { ...DEFAULT_CHILD_POLICY, acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1 }

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useBooking.addToCart — precio con el descuento infantil porcentual', () => {
  it('regla deshabilitada: unitPrice usa la fila plana de siempre — CERO regresión', async () => {
    const store = useBookingStore()
    store.childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: false, childrenRatePercent: 50 } 
    await store.addToCart(rtWithMatrix(), { adults: 1, childrenAges: [8] }) // 1 adulto + 1 niño con plaza
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.unitPrice).toBe(200) // fila de ocupación=2 tal cual
    expect(store.cart[0]!.unitTaxBreakdown[0]!.amount).toBe(36)
  })

  it('1 adulto ($100) + 1 niño con plaza al 60% → unitPrice $160, impuesto reescalado proporcional (18 × 160/100)', async () => {
    const store = useBookingStore()
    store.childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 60 } 
    await store.addToCart(rtWithMatrix(), { adults: 1, childrenAges: [8] })
    expect(store.cart[0]!.unitPrice).toBe(160)
    // La fila de ocupación=1 (adultsRow) trae impuesto $18 sobre $100 → reescalado a 160: 18×(160/100)=28.8.
    expect(store.cart[0]!.unitTaxBreakdown[0]!.amount).toBe(28.8)
  })

  it('2 adultos ($200) + 1 niño con plaza al 50% → unitPrice $250 (200 + 50% de 100)', async () => {
    const store = useBookingStore()
    store.childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 50 } 
    await store.addToCart(rtWithMatrix(), { adults: 2, childrenAges: [8] })
    expect(store.cart[0]!.unitPrice).toBe(250)
  })

  it('bebé (edad 1): NO recibe la regla — unitPrice queda en la fila de solo-adulto, sin descuento aplicado (nada que descontar)', async () => {
    const store = useBookingStore()
    store.childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 50 } 
    await store.addToCart(rtWithMatrix(), { adults: 1, childrenAges: [1] }) // bebé, no paga
    expect(store.cart[0]!.unitPrice).toBe(100) // fila de ocupación=1 (bebé no suma a chargeableOccupancy)
  })

  it('roomsSubtotal (resumen) usa el unitPrice YA descontado — el número que se mostró al componer es el que se cobra', async () => {
    const store = useBookingStore()
    store.childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 60 } 
    await store.addToCart(rtWithMatrix(), { adults: 1, childrenAges: [8] })
    expect(store.roomsSubtotal).toBe(160)
  })

  it('sin fila de solo-adulto en la matriz (defensivo): no rompe, cae al precio plano sin descuento', async () => {
    const store = useBookingStore()
    store.childPolicy = { ...BASE_POLICY, childrenDiscountEnabled: true, childrenRatePercent: 50 } 
    const room = rtWithMatrix()
    room.occupancies = [room.occupancies![1]!] // solo queda la fila de ocupación=2, sin la de 1
    await store.addToCart(room, { adults: 1, childrenAges: [8] })
    expect(store.cart[0]!.unitPrice).toBe(200) // fallback: fila plana de chargeableOccupancy
  })
})
