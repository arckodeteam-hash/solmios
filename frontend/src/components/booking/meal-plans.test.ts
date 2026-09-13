// meal-plans.test.ts — MR-03 (#268) + catálogo abierto (#361): los regímenes RESERVABLES desde la
// web salen SOLO del catálogo público (`GET /meal-plans`: filas visibles, con nombre, ordenadas),
// cobrados por persona y noche. Cubre de punta a punta el lado del cliente:
//   (i)   composer: UNA opción por fila del catálogo, tal cual viene (nombre + importe para la
//         composición actual); elegir + agregar → snapshot (con `name`) en la línea del carrito y
//         `store.subtotal` lo incluye.
//   (ii)  `included` → total 0, código persistido en la línea.
//   (iii) catálogo vacío → sin opciones, línea sin `mealPlan`, nada viaja al backend.
//   (iv)  payload: single manda `mealPlan`, grupo lo manda POR LÍNEA (incluido `room_only` cuando
//         es una fila del catálogo).
//   (v)   RoomsStep: radio por tarjeta con las filas del catálogo y nada más (sin "Solo
//         alojamiento" implícito, sin códigos fijos deshabilitados); con catálogo vacío NO se
//         renderiza nada de "Régimen".
//   (vi)  PriceBreakdownLines: fila "Régimen: <name> · 2 pers × 3 noches" con su importe.
// Misma forma de setup que useGuestComposer.child-amenities.test.ts y useBooking.pay.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: {
    getRates: vi.fn(),
    getCalendar: vi.fn(),
    getUpsells: vi.fn().mockResolvedValue([]),
    getMealPlans: vi.fn().mockResolvedValue([]),
    createBooking: vi.fn(),
    createBookingGroup: vi.fn(),
  },
}))

import RoomsStep from './RoomsStep.vue'
import PriceBreakdownLines from './PriceBreakdownLines.vue'
import { useGuestComposer } from '@/composables/useGuestComposer'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import { BookingService } from '@/services/Booking.service'
import type { PublicMealPlan, PublicRatesResponse, RoomTypeRate } from '@/types/booking'

const POLICY = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3, maxBabyAge: 1, childrenDiscountEnabled: false, childrenRatePercent: 50, cribAvailable: false }

function localDate(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function roomType(id = 'double'): RoomTypeRate {
  return {
    id, name: id, fromPrice: 300, availableCount: 5, capacity: 4, maxAdults: null, maxChildren: null,
    surfaceArea: 0, taxBreakdown: [], photoUrl: null,
    occupancies: [
      { occupancy: 1, price: 210, pricePerNight: 70, available: true, unavailableReason: null, taxBreakdown: [] },
      { occupancy: 2, price: 300, pricePerNight: 100, available: true, unavailableReason: null, taxBreakdown: [] },
      { occupancy: 3, price: 390, pricePerNight: 130, available: true, unavailableReason: null, taxBreakdown: [] },
    ],
  } as RoomTypeRate
}

/** 3 noches, 1 tipo con matriz. */
function ratesResponse(): PublicRatesResponse {
  return {
    currency: 'USD', chargeCurrency: 'USD', nights: 3, checkIn: localDate(1), checkOut: localDate(4),
    taxes: [], cancellationPolicy: null, cancellationSummary: null,
    roomTypes: [roomType()],
  }
}

const ROOM_ONLY: PublicMealPlan = { code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', price: 0 }
const BREAKFAST_PAID: PublicMealPlan = { code: 'breakfast', name: 'Desayuno incluido', priceMode: 'per_person_per_night', price: 10 }
const BREAKFAST_INCLUDED: PublicMealPlan = { code: 'breakfast', name: 'Desayuno incluido', priceMode: 'included', price: 0 }
/** #361 — una fila del catálogo abierto con código libre y descripción. */
const GOURMET: PublicMealPlan = { code: 'x_gourmet', name: 'Pensión gourmet', description: 'Cena de 5 pasos', priceMode: 'per_person_per_night', price: 40 }

function seedStore(mealPlans: PublicMealPlan[]) {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.childPolicy = { ...POLICY }
  store.ratesResponse = ratesResponse()
  store.checkIn = localDate(1)
  store.checkOut = localDate(4)
  store.mealPlans = mealPlans.map((m) => ({ ...m }))
  return store
}

beforeEach(() => {
  setActivePinia(createPinia())
  useBookingI18nStore().setLocale('es')
  vi.mocked(BookingService.createBooking).mockReset()
  vi.mocked(BookingService.createBookingGroup).mockReset()
})

describe('useGuestComposer — régimen por tarjeta (MR-03 #268)', () => {
  it('(i) catálogo [room_only, breakfast 10/pp/noche]: 2 opciones tal cual vienen (nombre, orden), 2 adultos × 3 noches → 60; default = primera fila gratis', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { mealPlanOptions, mealPlanCode, setMealPlan, setAdults, addComposedRoom, composedMealPlanTotal } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)

    const options = mealPlanOptions(rt)
    // Exactamente las filas del catálogo, en su orden, sin ninguna extra ni deshabilitada.
    expect(options.map((o) => o.code)).toEqual(['room_only', 'breakfast'])
    expect(options.map((o) => o.name)).toEqual(['Solo alojamiento', 'Desayuno incluido'])
    expect(options.every((o) => o.available)).toBe(true)
    expect(options[0]).toMatchObject({ code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', unitPrice: 0, total: 0 })
    expect(options[1]).toMatchObject({ code: 'breakfast', name: 'Desayuno incluido', priceMode: 'per_person_per_night', unitPrice: 10, total: 60 })

    // Sin elegir nada, la tarjeta arranca en la PRIMERA fila SIN costo del catálogo.
    expect(mealPlanCode(rt)).toBe('room_only')
    expect(composedMealPlanTotal(rt)).toBe(0)
    setMealPlan(rt, 'breakfast')
    expect(mealPlanCode(rt)).toBe('breakfast')
    expect(composedMealPlanTotal(rt)).toBe(60)

    await addComposedRoom(rt)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.mealPlan).toEqual({ code: 'breakfast', name: 'Desayuno incluido', priceMode: 'per_person_per_night', unitPrice: 10, persons: 2, total: 60 })
    expect(store.mealPlansTotal).toBe(60)
    expect(store.roomsSubtotal).toBe(300)
    expect(store.subtotal).toBe(360)
    expect(store.mealPlanLines).toEqual([
      { lineKey: store.cart[0]!.key, roomName: 'double', code: 'breakfast', name: 'Desayuno incluido', priceMode: 'per_person_per_night', persons: 2, nights: 3, quantity: 1, unitPrice: 10, total: 60 },
    ])
    // #343 — el composer NO se reinicia tras agregar: la tarjeta sigue mostrando el régimen agregado.
    expect(mealPlanCode(rt)).toBe('breakfast')
  })

  it('(c) cambiar la selección en la tarjeta REEMPLAZA composedMealPlanTotal (nunca se acumulan dos regímenes)', () => {
    seedStore([ROOM_ONLY, BREAKFAST_PAID, GOURMET])
    const { setMealPlan, setAdults, composedMealPlanTotal } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    setMealPlan(rt, 'breakfast')
    expect(composedMealPlanTotal(rt)).toBe(60)
    setMealPlan(rt, 'x_gourmet')
    expect(composedMealPlanTotal(rt)).toBe(240) // 40 × 2 × 3, no 60 + 240
    setMealPlan(rt, 'room_only')
    expect(composedMealPlanTotal(rt)).toBe(0)
  })

  it('(c) elegir breakfast + agregar, cambiar a room_only + agregar → mealPlansTotal es SOLO lo que hay en el carrito; líneas con distinto régimen no se fusionan', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, setAdults, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)
    expect(store.mealPlansTotal).toBe(60)

    setMealPlan(rt, 'room_only')
    await addComposedRoom(rt)
    expect(store.cart).toHaveLength(2)
    expect(store.cart.map((l) => l.quantity)).toEqual([1, 1])
    expect(store.cart[0]!.key).not.toBe(store.cart[1]!.key)
    expect(store.cart[1]!.mealPlan).toEqual({ code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', unitPrice: 0, persons: 2, total: 0 })
    // El total sigue siendo el del carrito (60 de la primera línea + 0 de la segunda), no 60 + 60.
    expect(store.mealPlansTotal).toBe(60)
    expect(store.subtotal).toBe(660)
    expect(store.mealPlanLines.map((l) => [l.code, l.total])).toEqual([['breakfast', 60], ['room_only', 0]])

    // Quitar la línea con desayuno: el total del régimen cae a 0 (nada queda "pegado").
    store.removeCartLine(store.cart[0]!.key)
    expect(store.mealPlansTotal).toBe(0)
  })

  it('#361 — un código libre del catálogo abierto es reservable como cualquier otro; con UNA sola fila PAGA no hay preselección (nada se cobra sin elegir)', async () => {
    const store = seedStore([GOURMET])
    const { mealPlanOptions, mealPlanCode, composedMealPlanTotal, setMealPlan, setAdults, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    expect(mealPlanOptions(rt)).toEqual([{ code: 'x_gourmet', name: 'Pensión gourmet', priceMode: 'per_person_per_night', unitPrice: 40, total: 240, available: true }])
    // Ninguna opción gratis → sin preselección: código null, importe 0.
    expect(mealPlanCode(rt)).toBeNull()
    expect(composedMealPlanTotal(rt)).toBe(0)
    // Agregar sin elegir → la línea NO lleva régimen y el total no lo incluye.
    await addComposedRoom(rt)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.mealPlan).toBeUndefined()
    expect(store.mealPlansTotal).toBe(0)
    expect(store.subtotal).toBe(300)
    // Elección explícita → viaja con su importe.
    setMealPlan(rt, 'x_gourmet')
    expect(mealPlanCode(rt)).toBe('x_gourmet')
    expect(composedMealPlanTotal(rt)).toBe(240)
    await addComposedRoom(rt)
    expect(store.cart).toHaveLength(2)
    expect(store.cart[1]!.mealPlan).toMatchObject({ code: 'x_gourmet', name: 'Pensión gourmet', total: 240 })
    expect(store.mealPlansTotal).toBe(240)
    expect(store.subtotal).toBe(840)
  })

  it('preselección = la PRIMERA opción SIN costo en el orden del catálogo, aunque no sea la primera fila: [breakfast pago, room_only gratis] → room_only', async () => {
    const store = seedStore([BREAKFAST_PAID, ROOM_ONLY])
    const { mealPlanOptions, mealPlanCode, composedMealPlanTotal, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    expect(mealPlanOptions(rt).map((o) => [o.code, o.total])).toEqual([['breakfast', 30], ['room_only', 0]])
    expect(mealPlanCode(rt)).toBe('room_only')
    expect(composedMealPlanTotal(rt)).toBe(0)
    await addComposedRoom(rt)
    expect(store.cart[0]!.mealPlan).toMatchObject({ code: 'room_only', total: 0 })
    expect(store.mealPlansTotal).toBe(0)
  })

  it('preselección: [room_only gratis, breakfast pago] → room_only (primera gratis); [breakfast incluido, room_only] → breakfast (primera gratis, aunque sea "included")', () => {
    seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { mealPlanCode, composedMealPlanTotal } = useGuestComposer()
    const rt = roomType()
    expect(mealPlanCode(rt)).toBe('room_only')
    expect(composedMealPlanTotal(rt)).toBe(0)

    useBookingStore().mealPlans = [{ ...BREAKFAST_INCLUDED }, { ...ROOM_ONLY }]
    expect(mealPlanCode(rt)).toBe('breakfast')
    expect(composedMealPlanTotal(rt)).toBe(0)
  })

  it('sin opción gratis, un código elegido que desaparece del catálogo vuelve a "sin preselección" (no cae a otra fila paga)', () => {
    seedStore([BREAKFAST_PAID, GOURMET])
    const { setMealPlan, mealPlanCode, composedMealPlanTotal } = useGuestComposer()
    const rt = roomType()
    expect(mealPlanCode(rt)).toBeNull()
    setMealPlan(rt, 'breakfast')
    expect(mealPlanCode(rt)).toBe('breakfast')
    useBookingStore().mealPlans = [{ ...GOURMET }]
    expect(mealPlanCode(rt)).toBeNull()
    expect(composedMealPlanTotal(rt)).toBe(0)
  })

  it('un niño con plaza paga régimen; un niño libre no (mismo criterio que el backend)', () => {
    seedStore([BREAKFAST_PAID])
    const { mealPlanOptions, setAdults, setChildrenCount, setChildAge } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    setChildrenCount(rt, 1)
    setChildAge(rt, 0, 2) // ≤ maxFreeAge=3 → libre
    expect(mealPlanOptions(rt).find((o) => o.code === 'breakfast')!.total).toBe(60)
    setChildAge(rt, 0, 8) // con plaza
    expect(mealPlanOptions(rt).find((o) => o.code === 'breakfast')!.total).toBe(90)
  })

  it('elegir un código que no está en el catálogo se ignora: la tarjeta sigue en la primera fila gratis', () => {
    seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, mealPlanCode } = useGuestComposer()
    const rt = roomType()
    setMealPlan(rt, 'half_board')
    expect(mealPlanCode(rt)).toBe('room_only')
    // Un código elegido que después desaparece del catálogo cae a la primera fila gratis (no queda colgado).
    setMealPlan(rt, 'breakfast')
    expect(mealPlanCode(rt)).toBe('breakfast')
    useBookingStore().mealPlans = [{ ...ROOM_ONLY }]
    expect(mealPlanCode(rt)).toBe('room_only')
  })

  it('el régimen elegido se conserva al cambiar adultos: solo cambia el importe', () => {
    seedStore([BREAKFAST_PAID])
    const { setMealPlan, mealPlanCode, setAdults, composedMealPlanTotal } = useGuestComposer()
    const rt = roomType()
    setMealPlan(rt, 'breakfast')
    expect(composedMealPlanTotal(rt)).toBe(30) // 1 adulto × 3 noches
    setAdults(rt, 3)
    expect(mealPlanCode(rt)).toBe('breakfast')
    expect(composedMealPlanTotal(rt)).toBe(90)
  })

  it('(ii) included → total 0 y el código queda persistido en la línea (sin sumar al subtotal)', async () => {
    const store = seedStore([BREAKFAST_INCLUDED])
    const { mealPlanOptions, setMealPlan, setAdults, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    expect(mealPlanOptions(rt).find((o) => o.code === 'breakfast')).toMatchObject({ available: true, priceMode: 'included', total: 0 })
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)

    expect(store.cart[0]!.mealPlan).toEqual({ code: 'breakfast', name: 'Desayuno incluido', priceMode: 'included', unitPrice: 0, persons: 2, total: 0 })
    expect(store.mealPlansTotal).toBe(0)
    expect(store.subtotal).toBe(300)
    expect(store.mealPlanLines).toHaveLength(1)
    expect(store.mealPlanLines[0]).toMatchObject({ code: 'breakfast', name: 'Desayuno incluido', priceMode: 'included', total: 0 })
  })

  it('(iii) catálogo vacío (switch apagado / sin activos) → sin opciones, código null, línea sin mealPlan y total 0', async () => {
    const store = seedStore([])
    const { mealPlanOptions, mealPlanCode, composedMealPlanTotal, setMealPlan, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    expect(mealPlanOptions(rt)).toEqual([])
    expect(mealPlanCode(rt)).toBeNull()
    expect(composedMealPlanTotal(rt)).toBe(0)
    setMealPlan(rt, 'breakfast') // no hay catálogo: se ignora
    expect(mealPlanCode(rt)).toBeNull()
    await addComposedRoom(rt)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.mealPlan).toBeUndefined()
    expect(store.mealPlansTotal).toBe(0)
    expect(store.mealPlanLines).toEqual([])
    expect(store.subtotal).toBe(210)
  })

  it('misma composición con distinto régimen = líneas DISTINTAS del carrito (no se funden en ×2)', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    await addComposedRoom(rt) // primera fila: room_only
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)
    expect(store.cart).toHaveLength(2)
    expect(store.cart.map((l) => l.quantity)).toEqual([1, 1])
    expect(store.cart[0]!.key).not.toBe(store.cart[1]!.key)
    // Misma composición + mismo régimen sí se agrupa.
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)
    expect(store.cart).toHaveLength(2)
    expect(store.cart[1]!.quantity).toBe(2)
    expect(store.mealPlansTotal).toBe(60) // 30 × 2 unidades (1 adulto × 3 noches × 10)
  })

  it('Editar una línea con régimen lo devuelve al composer (no vuelve a "Solo alojamiento" en silencio)', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, addComposedRoom, editCartLine, mealPlanCode } = useGuestComposer()
    const rt = roomType()
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)
    expect(mealPlanCode(rt)).toBe('breakfast') // #343: el composer conserva lo agregado
    // El huésped cambia la tarjeta antes de editar, para probar que Editar RESTAURA lo guardado.
    setMealPlan(rt, 'room_only')
    expect(mealPlanCode(rt)).toBe('room_only')
    expect(editCartLine(store.cart[0]!)).toBe(true)
    expect(mealPlanCode(rt)).toBe('breakfast')
    await addComposedRoom(rt)
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.mealPlan?.code).toBe('breakfast')
    expect(store.mealPlansTotal).toBe(30)
  })
})

describe('useBooking — payload con régimen (MR-03 #268)', () => {
  const RESPONSE = {
    reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
    totalBreakdown: { subtotal: 360, promoDiscount: 0, upsellsTotal: 0, mealPlanTotal: 60, taxes: 0, taxBreakdown: [], total: 360 },
  }

  it('(iv-a) 1 habitación: POST /booking lleva mealPlan:"breakfast"', async () => {
    const store = seedStore([BREAKFAST_PAID])
    const { setMealPlan, setAdults, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    vi.mocked(BookingService.createBooking).mockResolvedValue(RESPONSE)

    await store.pay()

    expect(BookingService.createBooking).toHaveBeenCalledTimes(1)
    const body = vi.mocked(BookingService.createBooking).mock.calls[0]![0]
    expect(body.mealPlan).toBe('breakfast')
    expect(body.adults).toBe(2)
    expect(BookingService.createBookingGroup).not.toHaveBeenCalled()
  })

  it('(iv-b) catálogo vacío: el body NO lleva la clave mealPlan', async () => {
    const store = seedStore([])
    const { addComposedRoom } = useGuestComposer()
    await addComposedRoom(roomType())
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    vi.mocked(BookingService.createBooking).mockResolvedValue(RESPONSE)

    await store.pay()

    const body = vi.mocked(BookingService.createBooking).mock.calls[0]![0]
    expect('mealPlan' in body).toBe(false)
  })

  it('(iv-b\') room_only elegido como fila del catálogo SÍ viaja (#361: es un régimen real, puede tener precio)', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { addComposedRoom } = useGuestComposer()
    await addComposedRoom(roomType()) // primera fila: room_only
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    vi.mocked(BookingService.createBooking).mockResolvedValue(RESPONSE)

    await store.pay()

    const body = vi.mocked(BookingService.createBooking).mock.calls[0]![0]
    expect(body.mealPlan).toBe('room_only')
  })

  it('(iv-c) grupo: POST /booking/group lleva mealPlan POR LÍNEA (una con desayuno, otra con room_only)', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, setAdults, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)
    // #343 — la tarjeta conserva lo agregado: la segunda habitación se compone explícitamente.
    setAdults(rt, 1)
    setMealPlan(rt, 'room_only')
    await addComposedRoom(rt) // 1 adulto, solo alojamiento (fila del catálogo)
    expect(store.cart).toHaveLength(2)
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    vi.mocked(BookingService.createBookingGroup).mockResolvedValue(RESPONSE)

    await store.pay()

    expect(BookingService.createBookingGroup).toHaveBeenCalledTimes(1)
    const body = vi.mocked(BookingService.createBookingGroup).mock.calls[0]![0]
    expect(body.rooms).toHaveLength(2)
    expect(body.rooms[0]).toMatchObject({ roomType: 'double', adults: 2, quantity: 1, mealPlan: 'breakfast' })
    expect(body.rooms[1]).toMatchObject({ roomType: 'double', adults: 1, quantity: 1, mealPlan: 'room_only' })
    expect(BookingService.createBooking).not.toHaveBeenCalled()
  })

  it('reset() limpia el régimen junto con el carrito', async () => {
    const store = seedStore([BREAKFAST_PAID])
    const { setMealPlan, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)
    expect(store.mealPlansTotal).toBeGreaterThan(0)
    store.reset()
    expect(store.cart).toEqual([])
    expect(store.mealPlansTotal).toBe(0)
    expect(store.mealPlanLines).toEqual([])
  })
})

describe('RoomsStep — radio de régimen por tarjeta (MR-03 #268, catálogo abierto #361)', () => {
  it('(a) catálogo vacío → no existe [data-testid=meal-plan-options] ni el texto "Régimen" (ni título, ni radios, ni espacio)', () => {
    seedStore([])
    const w = mount(RoomsStep)
    expect(w.find('[data-testid="meal-plan-options"]').exists()).toBe(false)
    expect(w.find('[data-testid="meal-plan-section"]').exists()).toBe(false)
    expect(w.find('[role="radiogroup"]').exists()).toBe(false)
    expect(w.find('[data-testid="meal-plan-hint"]').exists()).toBe(false)
    expect(w.find('[data-testid="meal-plan-total"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Régimen')
    expect(w.text()).not.toContain('Solo alojamiento')
    w.unmount()
  })

  it('(b) catálogo [room_only "Solo alojamiento" incluido, breakfast "Desayuno incluido" 10/pp/noche] → exactamente 2 radios con esos nombres, ninguno deshabilitado, sin opción extra', () => {
    seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const w = mount(RoomsStep)

    const group = w.get('[data-testid="meal-plan-options"]')
    const radios = group.findAll('input[type="radio"]')
    expect(radios).toHaveLength(2)
    expect(radios.map((r) => r.attributes('value'))).toEqual(['room_only', 'breakfast'])
    expect(radios.every((r) => r.attributes('disabled') === undefined)).toBe(true)
    // Todos comparten el name de SU tarjeta (un radio por habitación).
    expect(new Set(radios.map((r) => r.attributes('name'))).size).toBe(1)

    const labels = w.findAll('[data-testid="meal-plan-option"]')
    expect(labels).toHaveLength(2)
    expect(labels[0]!.text()).toContain('Solo alojamiento')
    expect(labels[0]!.text()).toContain('Incluido')
    expect(labels[1]!.text()).toContain('Desayuno incluido')
    // 1 adulto × 3 noches × 10 = 30, en la moneda de cobro.
    expect(labels[1]!.get('[data-testid="meal-plan-price"]').text()).toContain('30')

    // Nada fijo/hardcodeado: ni los códigos históricos que el hotel no ofrece, ni "no disponible".
    const text = w.text()
    expect(text).not.toContain('Desayuno y cena')
    expect(text).not.toContain('Todo incluido')
    expect(text).not.toContain('Este hotel no ofrece este régimen')
    expect(text).not.toContain('Próximamente')
    expect(w.find('[title="Este hotel no ofrece este régimen"]').exists()).toBe(false)

    // La primera fila GRATIS del catálogo arranca marcada.
    expect((group.get('input[value="room_only"]').element as HTMLInputElement).checked).toBe(true)
    expect((group.get('input[value="breakfast"]').element as HTMLInputElement).checked).toBe(false)
    w.unmount()
  })

  it('#361 — una fila con código libre se pinta con su nombre y su descripción (title + texto secundario); sola y PAGA, arranca SIN marcar y no se cobra hasta elegirla', async () => {
    const store = seedStore([GOURMET])
    const w = mount(RoomsStep)
    const labels = w.findAll('[data-testid="meal-plan-option"]')
    expect(labels).toHaveLength(1)
    expect(labels[0]!.text()).toContain('Pensión gourmet')
    expect(labels[0]!.text()).not.toContain('x_gourmet')
    expect(labels[0]!.attributes('title')).toBe('Cena de 5 pasos')
    // Ningún radio marcado: no hay opción gratis → sin preselección (ni descripción de "elegida").
    const radio = w.get('input[value="x_gourmet"]').element as HTMLInputElement
    expect(radio.checked).toBe(false)
    expect(w.find('[data-testid="meal-plan-description"]').exists()).toBe(false)
    expect(w.find('[data-testid="meal-plan-total"]').exists()).toBe(false)
    expect(w.find('[data-testid="meal-plan-hint"]').exists()).toBe(false)

    await w.findAll('button').find((b) => b.text().includes('Agregar esta habitación'))!.trigger('click')
    await flushPromises()
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.mealPlan).toBeUndefined()
    expect(store.mealPlansTotal).toBe(0)

    // Elección explícita → se marca, aparece la descripción y el importe (1 adulto × 3 noches × 40).
    await w.get('input[value="x_gourmet"]').setValue(true)
    expect((w.get('input[value="x_gourmet"]').element as HTMLInputElement).checked).toBe(true)
    expect(w.get('[data-testid="meal-plan-description"]').text()).toBe('Cena de 5 pasos')
    expect(w.get('[data-testid="meal-plan-total"]').text()).toContain('120')
    await w.findAll('button').find((b) => b.text().includes('Agregar esta habitación'))!.trigger('click')
    await flushPromises()
    expect(store.cart).toHaveLength(2)
    expect(store.cart[1]!.mealPlan).toMatchObject({ code: 'x_gourmet', total: 120 })
    expect(store.mealPlansTotal).toBe(120)
    w.unmount()
  })

  it('elegir desayuno muestra "+ importe · nombre" en la tarjeta, la ayuda por persona y noche, y agrega la línea con régimen', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const w = mount(RoomsStep)
    expect(w.find('[data-testid="meal-plan-total"]').exists()).toBe(false)

    await w.get('input[value="breakfast"]').setValue(true)
    expect(w.get('[data-testid="meal-plan-total"]').text()).toContain('30')
    expect(w.get('[data-testid="meal-plan-total"]').text()).toContain('Desayuno incluido')
    expect(w.get('[data-testid="meal-plan-hint"]').text()).toContain('por persona y noche')

    await w.findAll('button').find((b) => b.text().includes('Agregar esta habitación'))!.trigger('click')
    await flushPromises()
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.mealPlan).toMatchObject({ code: 'breakfast', name: 'Desayuno incluido', total: 30 })
    // #343 — tras agregar, el radio sigue en desayuno: la tarjeta muestra exactamente lo agregado.
    expect((w.get('input[value="breakfast"]').element as HTMLInputElement).checked).toBe(true)
    expect(w.get('[data-testid="meal-plan-total"]').text()).toContain('30')
    // La línea del carrito usa el NOMBRE del snapshot.
    expect(w.text()).toContain('Desayuno incluido')

    // (c) Cambiar a room_only en la tarjeta REEMPLAZA el "+ importe" (desaparece) y no toca el carrito.
    await w.get('input[value="room_only"]').setValue(true)
    expect(w.find('[data-testid="meal-plan-total"]').exists()).toBe(false)
    expect(store.mealPlansTotal).toBe(30)
    w.unmount()
  })

  it('régimen incluido en la tarifa: radio habilitado con la etiqueta "Incluido" y sin importe', () => {
    seedStore([BREAKFAST_INCLUDED])
    const w = mount(RoomsStep)
    const breakfast = w.get('input[value="breakfast"]')
    expect(breakfast.attributes('disabled')).toBeUndefined()
    const label = w.findAll('[data-testid="meal-plan-option"]').find((l) => l.text().includes('Desayuno incluido'))!
    expect(label.text()).toContain('Incluido')
    expect(w.find('[data-testid="meal-plan-price"]').exists()).toBe(false)
    w.unmount()
  })

  it('el importe del régimen usa chargeCurrency, NUNCA displayCurrency (D10)', () => {
    const store = seedStore([BREAKFAST_PAID])
    store.ratesResponse = { ...ratesResponse(), currency: 'EUR', chargeCurrency: 'USD' }
    const w = mount(RoomsStep)
    const price = w.get('[data-testid="meal-plan-price"]').text()
    expect(price).toContain('US$')
    expect(price).not.toContain('€')
    w.unmount()
  })
})

describe('PriceBreakdownLines — fila de régimen (MR-03 #268)', () => {
  const fmt = (n: unknown) => `${Number(n).toFixed(2)} USD`

  it('(vi) con una línea de régimen muestra "Desayuno incluido · 2 pers × 3 noches" y 60; el alojamiento descuenta el régimen', () => {
    const w = mount(PriceBreakdownLines, { props: {
      breakdown: { subtotal: 360, promoDiscount: 0, upsellsTotal: 0, mealPlanTotal: 60, taxes: 0, taxBreakdown: [], total: 360 },
      total: 360, format: fmt,
      mealPlanLines: [{ lineKey: 'k1', roomName: 'double', code: 'breakfast', name: 'Desayuno incluido', priceMode: 'per_person_per_night', persons: 2, nights: 3, quantity: 1, unitPrice: 10, total: 60 }],
    } })
    const text = w.text().replace(/\s+/g, ' ')
    expect(w.findAll('[data-testid="meal-plan-line"]')).toHaveLength(1)
    expect(text).toContain('Régimen: Desayuno incluido · 2 pers × 3 noches')
    expect(w.get('[data-testid="meal-plan-line"]').text()).toContain('60.00 USD')
    expect(text).toContain('300.00 USD') // alojamiento = subtotal − régimen
    expect(w.get('[data-testid="final-total"]').text()).toBe('360.00 USD')
  })

  it('régimen incluido: etiqueta + "incluido", sin importe', () => {
    const w = mount(PriceBreakdownLines, { props: {
      breakdown: { subtotal: 300, promoDiscount: 0, upsellsTotal: 0, mealPlanTotal: 0, taxes: 0, taxBreakdown: [], total: 300 },
      total: 300, format: fmt,
      mealPlanLines: [{ lineKey: 'k1', roomName: 'double', code: 'breakfast', name: 'Desayuno incluido', priceMode: 'included', persons: 2, nights: 3, quantity: 1, unitPrice: 0, total: 0 }],
    } })
    const line = w.get('[data-testid="meal-plan-line"]')
    expect(line.text()).toContain('Desayuno incluido')
    expect(line.text()).toContain('incluido')
    expect(line.text()).not.toContain('0.00 USD')
  })

  it('#361 — la etiqueta es el `name` del snapshot (código libre), no un mapa fijo; sin nombre cae al i18n legacy', () => {
    const w = mount(PriceBreakdownLines, { props: {
      breakdown: { subtotal: 540, promoDiscount: 0, upsellsTotal: 0, mealPlanTotal: 240, taxes: 0, taxBreakdown: [], total: 540 },
      total: 540, format: fmt,
      mealPlanLines: [
        { lineKey: 'k1', roomName: 'double', code: 'x_gourmet', name: 'Pensión gourmet', priceMode: 'per_person_per_night', persons: 2, nights: 3, quantity: 1, unitPrice: 40, total: 240 },
        { lineKey: 'k2', roomName: 'double', code: 'half_board', name: '', priceMode: 'included', persons: 2, nights: 3, quantity: 1, unitPrice: 0, total: 0 },
      ],
    } })
    const lines = w.findAll('[data-testid="meal-plan-line"]')
    expect(lines).toHaveLength(2)
    expect(lines[0]!.text()).toContain('Pensión gourmet')
    expect(lines[0]!.text()).not.toContain('x_gourmet')
    expect(lines[1]!.text()).toContain('Desayuno y cena')
  })

  it('sin detalle del carrito (post-redirect) usa la fila agregada del desglose persistido', () => {
    const w = mount(PriceBreakdownLines, { props: {
      breakdown: { subtotal: 360, promoDiscount: 0, upsellsTotal: 0, mealPlanTotal: 60, taxes: 0, taxBreakdown: [], total: 360 },
      total: 360, format: fmt,
    } })
    const line = w.get('[data-testid="meal-plan-line"]')
    expect(line.text()).toContain('Régimen')
    expect(line.text()).toContain('60.00 USD')
    expect(w.text().replace(/\s+/g, ' ')).toContain('300.00 USD')
  })

  it('reserva anterior a la feature (sin mealPlanTotal): no hay fila de régimen', () => {
    const w = mount(PriceBreakdownLines, { props: {
      breakdown: { subtotal: 300, promoDiscount: 0, upsellsTotal: 0, taxes: 0, taxBreakdown: [], total: 300 },
      total: 300, format: fmt,
    } })
    expect(w.find('[data-testid="meal-plan-line"]').exists()).toBe(false)
  })
})
