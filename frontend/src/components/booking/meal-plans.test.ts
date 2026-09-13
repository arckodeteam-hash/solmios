// meal-plans.test.ts — MR-03 (#268): regímenes RESERVABLES desde la web, cobrados por persona y
// noche. #360: catálogo ABIERTO — las opciones son las filas activas que manda el backend, con el
// `name` que escribió el hotel (códigos custom incluidos); "Solo alojamiento" es una fila más y
// sin filas no hay bloque de régimen. Cubre de punta a punta el lado del cliente:
//   (i)   composer: opciones = catálogo tal cual (orden, name); elegir + agregar → snapshot con
//         `name` en la línea del carrito y `store.subtotal` lo incluye.
//   (ii)  `included` → total 0, código + name persistidos en la línea.
//   (iii) catálogo vacío → línea sin `mealPlan`; `room_only` como fila real → snapshot included 0.
//   (iv)  payload: single manda `mealPlan`, grupo lo manda POR LÍNEA; sin catálogo no viaja.
//   (v)   RoomsStep: radio por tarjeta con el `name` del catálogo (custom incluido), primera opción
//         marcada por defecto, sin bloque con catálogo vacío, sin "Próximamente".
//   (vi)  PriceBreakdownLines: fila "Régimen: Desayuno · 2 pers × 3 noches" con su importe.
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

/** #360 — "Solo alojamiento" es una fila normal del catálogo (included, 0), con su name. */
const ROOM_ONLY: PublicMealPlan = { code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', price: 0 }
const BREAKFAST_PAID: PublicMealPlan = { code: 'breakfast', name: 'Desayuno incluido', priceMode: 'per_person_per_night', price: 10 }
const BREAKFAST_INCLUDED: PublicMealPlan = { code: 'breakfast', name: 'Desayuno incluido', priceMode: 'included', price: 0 }
/** #360 — código CUSTOM creado por el hotel (slug del nombre): sin key i18n, se muestra su name. */
const BRUNCH_PREMIUM: PublicMealPlan = { code: 'brunch_premium', name: 'Brunch premium', description: 'Brunch de 10 a 13', priceMode: 'per_person_per_night', price: 25 }

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
  it('(i) opciones = catálogo activo tal cual (orden y name, custom incluido); breakfast 10/persona/noche, 2 adultos, 3 noches → total 60', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID, BRUNCH_PREMIUM])
    const { mealPlanOptions, mealPlanCode, setMealPlan, setAdults, addComposedRoom, composedMealPlanTotal } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)

    const options = mealPlanOptions(rt)
    // #360 — ni se antepone "Solo alojamiento" ni se pintan códigos que el hotel no ofrece
    // (half_board / all_inclusive no están en el catálogo → no aparecen); todas `available`.
    expect(options.map((o) => o.code)).toEqual(['room_only', 'breakfast', 'brunch_premium'])
    expect(options.every((o) => o.available)).toBe(true)
    expect(options[0]).toMatchObject({ code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', unitPrice: 0, total: 0 })
    expect(options[1]).toMatchObject({ code: 'breakfast', name: 'Desayuno incluido', priceMode: 'per_person_per_night', unitPrice: 10, total: 60 })
    expect(options[2]).toMatchObject({ code: 'brunch_premium', name: 'Brunch premium', priceMode: 'per_person_per_night', unitPrice: 25, total: 150 })

    // Default = la primera opción del catálogo.
    expect(mealPlanCode(rt)).toBe('room_only')
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

  it('#360 código custom: se elige, se snapshotea con su name y viaja al carrito con su importe', async () => {
    const store = seedStore([ROOM_ONLY, BRUNCH_PREMIUM])
    const { setMealPlan, setAdults, addComposedRoom, composedMealPlanTotal } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    setMealPlan(rt, 'brunch_premium')
    expect(composedMealPlanTotal(rt)).toBe(150)
    await addComposedRoom(rt)
    expect(store.cart[0]!.mealPlan).toEqual({ code: 'brunch_premium', name: 'Brunch premium', priceMode: 'per_person_per_night', unitPrice: 25, persons: 2, total: 150 })
    expect(store.mealPlanLines[0]).toMatchObject({ code: 'brunch_premium', name: 'Brunch premium', total: 150 })
    expect(store.subtotal).toBe(450)
  })

  it('#360 sin room_only en el catálogo: la primera opción queda elegida por defecto (nunca un código que el hotel no tiene)', async () => {
    const store = seedStore([BREAKFAST_PAID, BRUNCH_PREMIUM])
    const { mealPlanCode, mealPlanOptions, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    expect(mealPlanOptions(rt).map((o) => o.code)).toEqual(['breakfast', 'brunch_premium'])
    expect(mealPlanCode(rt)).toBe('breakfast')
    await addComposedRoom(rt)
    expect(store.cart[0]!.mealPlan).toMatchObject({ code: 'breakfast', name: 'Desayuno incluido', total: 30 })
  })

  it('#360 catálogo vacío (sin activos o showMealPlans apagado): sin opciones, mealPlanCode = room_only y la línea va sin régimen', async () => {
    const store = seedStore([])
    const { mealPlanCode, mealPlanOptions, composedMealPlanTotal, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    expect(mealPlanOptions(rt)).toEqual([])
    expect(mealPlanCode(rt)).toBe('room_only')
    expect(composedMealPlanTotal(rt)).toBe(0)
    await addComposedRoom(rt)
    expect(store.cart[0]!.mealPlan).toBeUndefined()
    expect(store.mealPlanLines).toEqual([])
  })

  it('un niño con plaza paga régimen; un niño libre no (mismo criterio que el backend)', () => {
    seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { mealPlanOptions, setAdults, setChildrenCount, setChildAge } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    setChildrenCount(rt, 1)
    setChildAge(rt, 0, 2) // ≤ maxFreeAge=3 → libre
    expect(mealPlanOptions(rt).find((o) => o.code === 'breakfast')!.total).toBe(60)
    setChildAge(rt, 0, 8) // con plaza
    expect(mealPlanOptions(rt).find((o) => o.code === 'breakfast')!.total).toBe(90)
  })

  it('elegir un código que el hotel no ofrece se ignora (la UI no lo muestra)', () => {
    seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, mealPlanCode } = useGuestComposer()
    const rt = roomType()
    setMealPlan(rt, 'half_board')
    expect(mealPlanCode(rt)).toBe('room_only')
  })

  it('#360 la elección guardada deja de estar en el catálogo (cambió entre medio) → cae a la primera opción', () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, mealPlanCode } = useGuestComposer()
    const rt = roomType()
    setMealPlan(rt, 'breakfast')
    expect(mealPlanCode(rt)).toBe('breakfast')
    store.mealPlans = [{ ...ROOM_ONLY }]
    expect(mealPlanCode(rt)).toBe('room_only')
  })

  it('el régimen elegido se conserva al cambiar adultos: solo cambia el importe', () => {
    seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, mealPlanCode, setAdults, composedMealPlanTotal } = useGuestComposer()
    const rt = roomType()
    setMealPlan(rt, 'breakfast')
    expect(composedMealPlanTotal(rt)).toBe(30) // 1 adulto × 3 noches
    setAdults(rt, 3)
    expect(mealPlanCode(rt)).toBe('breakfast')
    expect(composedMealPlanTotal(rt)).toBe(90)
  })

  it('(ii) included → total 0 y el código + name quedan persistidos en la línea (sin sumar al subtotal)', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_INCLUDED])
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

  it('(iii) sin elegir nada con "Solo alojamiento" como fila real → snapshot room_only included 0, sin fila en el desglose', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { addComposedRoom } = useGuestComposer()
    await addComposedRoom(roomType())
    expect(store.cart).toHaveLength(1)
    // #360 — es una fila del catálogo: se snapshotea con su name (el backend la resuelve igual,
    // total 0) pero NO es un cargo → no aparece en `mealPlanLines`.
    expect(store.cart[0]!.mealPlan).toEqual({ code: 'room_only', name: 'Solo alojamiento', priceMode: 'included', unitPrice: 0, persons: 1, total: 0 })
    expect(store.mealPlansTotal).toBe(0)
    expect(store.mealPlanLines).toEqual([])
    expect(store.subtotal).toBe(210)
  })

  it('misma composición con distinto régimen = líneas DISTINTAS del carrito (no se funden en ×2)', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    await addComposedRoom(rt)
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
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
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

  it('(iv-b2) #360 "Solo alojamiento" como fila real elegida: el body lleva mealPlan:"room_only" (el backend lo resuelve como fila, total 0)', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { addComposedRoom } = useGuestComposer()
    await addComposedRoom(roomType())
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    vi.mocked(BookingService.createBooking).mockResolvedValue(RESPONSE)

    await store.pay()

    const body = vi.mocked(BookingService.createBooking).mock.calls[0]![0]
    expect(body.mealPlan).toBe('room_only')
  })

  it('(iv-c) grupo: POST /booking/group lleva mealPlan POR LÍNEA (una con desayuno, otra con solo alojamiento)', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const { setMealPlan, setAdults, addComposedRoom } = useGuestComposer()
    const rt = roomType()
    setAdults(rt, 2)
    setMealPlan(rt, 'breakfast')
    await addComposedRoom(rt)
    // #343 — la tarjeta conserva lo agregado: la segunda habitación se compone explícitamente.
    setAdults(rt, 1)
    setMealPlan(rt, 'room_only')
    await addComposedRoom(rt) // 1 adulto, solo alojamiento
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
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
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

describe('RoomsStep — radio de régimen por tarjeta (MR-03 #268, catálogo abierto #360)', () => {
  it('(v) el radio lista SOLO el catálogo activo, con el name de cada fila (custom incluido) y la primera marcada; sin "Próximamente"', async () => {
    seedStore([ROOM_ONLY, BREAKFAST_PAID, BRUNCH_PREMIUM])
    const w = mount(RoomsStep)

    const group = w.get('[data-testid="meal-plan-options"]')
    const radios = group.findAll('input[type="radio"]')
    expect(radios.map((r) => r.attributes('value'))).toEqual(['room_only', 'breakfast', 'brunch_premium'])
    // Todos comparten el name de SU tarjeta (un radio por habitación); ninguno deshabilitado.
    expect(new Set(radios.map((r) => r.attributes('name'))).size).toBe(1)
    for (const r of radios) expect(r.attributes('disabled')).toBeUndefined()

    const roomOnly = group.get('input[value="room_only"]')
    expect((roomOnly.element as HTMLInputElement).checked).toBe(true)
    expect((group.get('input[value="breakfast"]').element as HTMLInputElement).checked).toBe(false)

    // Etiquetas = `name` del catálogo; el código custom se ve con su texto, nunca el código crudo.
    const labels = w.findAll('[data-testid="meal-plan-option"]').map((l) => l.text())
    expect(labels[0]).toContain('Solo alojamiento')
    expect(labels[1]).toContain('Desayuno incluido')
    expect(labels[2]).toContain('Brunch premium')
    const text = w.text()
    expect(text).not.toContain('brunch_premium')
    // Lo que el hotel no tiene en el catálogo no se pinta (ni deshabilitado).
    expect(text).not.toContain('Desayuno y cena')
    expect(text).not.toContain('Todo incluido')
    expect(w.find('input[value="half_board"]').exists()).toBe(false)
    expect(text).not.toContain('Próximamente')
    expect(text).not.toContain('Coming soon')
    // 1 adulto × 3 noches × 10 = 30 y × 25 = 75, en la moneda de cobro.
    const prices = w.findAll('[data-testid="meal-plan-price"]').map((p) => p.text())
    expect(prices[0]).toContain('30')
    expect(prices[1]).toContain('75')
    w.unmount()
  })

  it('#360 catálogo vacío: no existe el bloque de régimen en la tarjeta', () => {
    seedStore([])
    const w = mount(RoomsStep)
    expect(w.find('[data-testid="meal-plan-options"]').exists()).toBe(false)
    expect(w.find('[data-testid="meal-plan-option"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Solo alojamiento')
    w.unmount()
  })

  it('#360 sin room_only en el catálogo: la primera fila queda marcada por defecto', () => {
    seedStore([BRUNCH_PREMIUM, BREAKFAST_PAID])
    const w = mount(RoomsStep)
    const radios = w.get('[data-testid="meal-plan-options"]').findAll('input[type="radio"]')
    expect(radios.map((r) => r.attributes('value'))).toEqual(['brunch_premium', 'breakfast'])
    expect((radios[0]!.element as HTMLInputElement).checked).toBe(true)
    expect((radios[1]!.element as HTMLInputElement).checked).toBe(false)
    expect(w.find('input[value="room_only"]').exists()).toBe(false)
    w.unmount()
  })

  it('#360 fila legacy sin name (catálogo viejo): cae a la etiqueta i18n del código', () => {
    seedStore([{ code: 'half_board', priceMode: 'included', price: 0 } as PublicMealPlan])
    const w = mount(RoomsStep)
    expect(w.get('[data-testid="meal-plan-option"]').text()).toContain('Desayuno y cena')
    w.unmount()
  })

  it('elegir desayuno muestra "+ importe" en la tarjeta, la ayuda por persona y noche, y agrega la línea con régimen', async () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
    const w = mount(RoomsStep)
    expect(w.find('[data-testid="meal-plan-total"]').exists()).toBe(false)

    await w.get('input[value="breakfast"]').setValue(true)
    expect(w.get('[data-testid="meal-plan-total"]').text()).toContain('30')
    expect(w.get('[data-testid="meal-plan-hint"]').text()).toContain('por persona y noche')

    await w.findAll('button').find((b) => b.text().includes('Agregar esta habitación'))!.trigger('click')
    await flushPromises()
    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.mealPlan).toMatchObject({ code: 'breakfast', name: 'Desayuno incluido', total: 30 })
    expect(w.get('[data-testid="meal-plan-total"]').text()).toContain('Desayuno incluido')
    // #343 — tras agregar, el radio sigue en desayuno: la tarjeta muestra exactamente lo agregado.
    expect((w.get('input[value="breakfast"]').element as HTMLInputElement).checked).toBe(true)
    expect(w.get('[data-testid="meal-plan-total"]').text()).toContain('30')
    w.unmount()
  })

  it('régimen incluido en la tarifa: radio habilitado con la etiqueta "Incluido" y sin importe', () => {
    seedStore([ROOM_ONLY, BREAKFAST_INCLUDED])
    const w = mount(RoomsStep)
    const breakfast = w.get('input[value="breakfast"]')
    expect(breakfast.attributes('disabled')).toBeUndefined()
    const label = w.findAll('[data-testid="meal-plan-option"]').find((l) => l.text().includes('Desayuno incluido'))!
    expect(label.text()).toContain('Incluido')
    expect(w.find('[data-testid="meal-plan-price"]').exists()).toBe(false)
    w.unmount()
  })

  it('el importe del régimen usa chargeCurrency, NUNCA displayCurrency (D10)', () => {
    const store = seedStore([ROOM_ONLY, BREAKFAST_PAID])
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
