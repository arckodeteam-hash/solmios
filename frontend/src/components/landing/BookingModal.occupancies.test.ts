// BookingModal.occupancies.test.ts — El composer de huéspedes DENTRO de la landing pública.
//
// Requerimiento 3 (Selección de huéspedes, 2026-09-03): reemplaza la matriz "para 1/para 2" por
// el composer de adultos+niños+edades, misma lógica que el widget embebible
// (RoomsStep.occupancies.test.ts) vía composables/useGuestComposer.ts — verificada en ESTA
// superficie porque BookingModal.vue NO reusa la presentación del widget (i18n propio, layout
// ancho): un fix en una no se propaga sola a la otra.
//
//   1. El composer arma UNA composición por tarjeta y cotiza contra `roomType.occupancies`.
//   2. La composición no vendible aparece DESHABILITADA Y CON EL MOTIVO, nunca oculta.
//   3. `acceptChildren:false` oculta el stepper de niños.
//   4. Agregar propaga adultos+edades hasta el payload de la reserva (createBooking).
//   5. Sin `occupancies` (backend viejo / respuesta cacheada) el composer sigue funcionando con
//      el precio único del tipo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: {
    getRates: vi.fn(),
    getCalendar: vi.fn(),
    getUpsells: vi.fn(),
    getMealPlans: vi.fn(),
    validatePromo: vi.fn(),
    createBooking: vi.fn(),
  },
}))
// El paso de habitaciones también pide el catálogo (`GET /room-types`) para mostrar deshabilitados
// los tipos sin disponibilidad — mockeado vacío acá para no pegarle a la red real ni interferir
// con estos tests, que son sobre el composer de los tipos QUE SÍ trae /rates.
vi.mock('@/services/PublicHotel.service', () => ({
  PublicHotelService: { getRoomTypes: vi.fn().mockResolvedValue({ roomTypes: [] }) },
}))

import BookingModal from './BookingModal.vue'
import { BookingService } from '@/services/Booking.service'
import { useBookingStore } from '@/composables/useBooking'
import type { ChildPolicy } from '@/utils/child-composition'
import type {
  OpenBookingOptions,
  PublicHotelInfo,
  PublicRatesResponse,
  RoomOccupancyRate,
} from '@/types'

const HOTEL = {
  id: 'h1',
  slug: 'hotel-demo',
  name: 'Hotel Demo',
  title: 'Hotel Demo',
  description: '',
  accommodationType: 'hotel',
  starRating: 4,
  amenities: [],
  latitude: 0,
  longitude: 0,
  currency: 'USD',
} as unknown as PublicHotelInfo

/** Las 6 filas cubren las vendibles y LOS CUATRO motivos de no-disponibilidad. */
function occupancies(): RoomOccupancyRate[] {
  const tax = (total: number) => [{ name: 'ITBIS', rate: 18, amount: Math.round(total * 0.18 * 100) / 100 }]
  return [
    { occupancy: 1, price: 210, pricePerNight: 70, available: true, unavailableReason: null, taxBreakdown: tax(210) },
    { occupancy: 2, price: 300, pricePerNight: 100, available: true, unavailableReason: null, taxBreakdown: tax(300) },
    { occupancy: 3, price: 0, pricePerNight: 0, available: false, unavailableReason: 'no_rate', taxBreakdown: [] },
    { occupancy: 4, price: 480, pricePerNight: 160, available: true, unavailableReason: null, taxBreakdown: tax(480) },
    { occupancy: 5, price: 550, pricePerNight: 183.33, available: false, unavailableReason: 'stop_sell', taxBreakdown: tax(550) },
    { occupancy: 6, price: 0, pricePerNight: 0, available: false, unavailableReason: 'over_capacity', taxBreakdown: [] },
  ]
}

function ratesResponse(withMatrix: boolean): PublicRatesResponse {
  return {
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 3,
    checkIn: '2026-08-18',
    checkOut: '2026-08-21',
    taxes: [{ name: 'ITBIS', rate: 18 }],
    cancellationPolicy: null,
    cancellationSummary: null,
    roomTypes: [
      {
        id: 'familiar',
        name: 'familiar',
        fromPrice: 210,
        availableCount: 5,
        capacity: 6,
        maxAdults: null,
        maxChildren: null,
        surfaceArea: 32,
        taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 37.8 }],
        photoUrl: null,
        ...(withMatrix ? { occupancies: occupancies() } : {}),
      },
    ],
  }
}

let wrapper: VueWrapper | null = null

/** Contexto típico del buscador del hero: fechas ya elegidas (ocupación NO se pide de antemano
 *  desde 2026-08-20 — se arma en el composer de la tarjeta). */
const FROM_HERO: OpenBookingOptions = {
  checkIn: '2026-08-18',
  checkOut: '2026-08-21',
  rooms: 1,
  skipToRooms: true,
}

async function open(options: OpenBookingOptions = FROM_HERO, childPolicy?: ChildPolicy) {
  wrapper = mount(BookingModal, {
    props: { hotel: childPolicy ? { ...HOTEL, childPolicy } : HOTEL, options },
    global: { stubs: { RouterLink: true } },
  })
  await flushPromises()
  if (childPolicy) {
    // El composer lee `store.childPolicy` reactivamente — no hace falta re-montar.
    useBookingStore().childPolicy = childPolicy
    await flushPromises()
  }
  return wrapper
}

/** Todos los "+" del paso de habitaciones, en orden: Adultos primero, Niños (si `acceptChildren`)
 *  segundo — el glifo del botón no se traduce ni depende de layout, a diferencia del aria-label. */
function plusButtons(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.trim() === '+')
}
async function bumpAdults(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) { plusButtons()[0]!.click(); await flushPromises() }
}
async function bumpChildren(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) { plusButtons()[1]!.click(); await flushPromises() }
}

function addRoomButton(): HTMLButtonElement {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Agregar esta habitación'))!
}
async function clickAddRoom(): Promise<void> {
  addRoomButton().click()
  await flushPromises()
}

function occupancyEl(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[data-occupancy]')
}

describe('BookingModal — composer de huéspedes (adultos+niños+edades)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0, 0))
    vi.mocked(BookingService.getRates).mockReset().mockResolvedValue(ratesResponse(true))
    vi.mocked(BookingService.getCalendar).mockReset().mockResolvedValue({
      currency: 'USD', chargeCurrency: 'USD', from: '2026-08-15', to: '2026-08-31', guests: 2, days: [],
    })
    vi.mocked(BookingService.getUpsells).mockReset().mockResolvedValue([])
    vi.mocked(BookingService.getMealPlans).mockReset().mockResolvedValue([])
    vi.mocked(BookingService.createBooking).mockReset()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('arranca en 1 adulto y cotiza "para 1"', async () => {
    await open()
    expect(occupancyEl()!.dataset.occupancy).toBe('1')
    expect(occupancyEl()!.textContent).toContain('210')
  })

  it('subir adultos recalcula la ocupación y el precio en vivo', async () => {
    await open()
    await bumpAdults(1) // 1 → 2

    expect(occupancyEl()!.dataset.occupancy).toBe('2')
    expect(occupancyEl()!.textContent).toContain('300')
  })

  // Un caso por motivo: el backend tiene CUATRO y traducir tres deja al huésped mirando una fila
  // muda (o un código en inglés) justo en el caso que falte.
  const reasons: Array<{ adults: number; texto: string }> = [
    { adults: 3, texto: 'Sin tarifa para esta ocupación' },
    { adults: 5, texto: 'Cerrada a la venta' },
    { adults: 6, texto: 'Supera la capacidad de la habitación' },
  ]

  for (const r of reasons) {
    it(`composición no vendible (${r.texto}): DESHABILITADA y con el motivo, "Agregar" apagado`, async () => {
      await open()
      const store = useBookingStore()
      await bumpAdults(r.adults - 1)

      expect(occupancyEl()!.textContent).toContain(r.texto)
      expect(occupancyEl()!.textContent).not.toMatch(/no_rate|no_availability|stop_sell|over_capacity/)
      expect(addRoomButton().disabled).toBe(true)
      expect(store.cart).toHaveLength(0)
    })
  }

  it('cubre también no_availability (la 4ª razón) con su texto propio', async () => {
    const res = ratesResponse(true)
    res.roomTypes[0]!.occupancies![3] = {
      occupancy: 4, price: 480, pricePerNight: 160,
      available: false, unavailableReason: 'no_availability', taxBreakdown: [],
    }
    vi.mocked(BookingService.getRates).mockResolvedValue(res)

    await open()
    await bumpAdults(3) // 1 → 4

    expect(addRoomButton().disabled).toBe(true)
    expect(occupancyEl()!.textContent).toContain('Sin disponibilidad en estas fechas')
  })

  it('agregar una composición propaga ESA ocupación y ESE precio hasta el payload de la reserva', async () => {
    await open()
    const store = useBookingStore()
    await bumpAdults(3) // 1 → 4 adultos → "para 4" → $480

    await clickAddRoom()

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.occupancy).toBe(4)
    expect(store.cart[0]!.adults).toBe(4)
    expect(store.cart[0]!.childrenAges).toEqual([])
    // El precio del flujo es el de la fila (480), NO el `fromPrice` del tipo (210).
    expect(store.roomsSubtotal).toBe(480)
    expect(store.subtotal).toBe(480)
    expect(store.estimatedTaxes).toBe(86.4)
    expect(store.estimatedTotal).toBe(566.4)

    // Avanzamos hasta el paso de pago: el resumen tiene que decir para cuántos se cotizó.
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    store.next() // → extras
    store.next() // → datos
    store.next() // → pago
    await flushPromises()
    expect(store.status).toBe('paying')
    expect(document.body.textContent).toContain('Familiar · 4 adultos')

    vi.mocked(BookingService.createBooking).mockResolvedValue({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 480, promoDiscount: 0, upsellsTotal: 0, taxes: 86.4, total: 566.4 },
    })
    await store.pay()

    // La reserva sale con la composición cotizada (4 adultos), no un default: si no, el hotel
    // recibe 4 huéspedes con una reserva que dice otra cosa.
    expect(vi.mocked(BookingService.createBooking).mock.calls[0]![0]).toMatchObject({
      adults: 4, roomType: 'familiar',
    })
  })

  it('con niños: agrega las edades exactas al payload, niño libre no sube el precio', async () => {
    const policy: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }
    await open(FROM_HERO, policy)
    const store = useBookingStore()

    await bumpAdults(1) // 2 adultos
    await bumpChildren(1) // 1 niño, edad default 0 → libre (≤3)
    await clickAddRoom()

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.occupancy).toBe(2) // niño libre: no sube la ocupación chargeable
    expect(store.cart[0]!.adults).toBe(2)
    expect(store.cart[0]!.childrenAges).toEqual([0])

    vi.mocked(BookingService.createBooking).mockResolvedValue({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 300, promoDiscount: 0, upsellsTotal: 0, taxes: 54, total: 354 },
    })
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    await store.pay()

    // Los niños NO se graban como adultos (bug ya cerrado) — y ahora con su edad real, no un
    // conteo plano.
    expect(vi.mocked(BookingService.createBooking).mock.calls[0]![0]).toMatchObject({
      adults: 2, childrenAges: [0],
    })
  })

  it('acceptChildren:false → no ofrece agregar niños en el composer', async () => {
    await open(FROM_HERO, { acceptChildren: false, maxChildAge: 12, maxFreeAge: 3 })
    expect(document.body.textContent).not.toContain('Niños')
    expect(plusButtons()).toHaveLength(1) // solo el "+" de Adultos
  })

  // ── Requerimiento 4 (Edad de los niños, 2026-09-03) ──────────────────────────────────────
  it('el desplegable de edad respeta maxChildAge del hotel: NO ofrece 0-17 fijo', async () => {
    await open(FROM_HERO, { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 })
    await bumpChildren(1)

    const select = document.body.querySelector<HTMLSelectElement>('select')!
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'))
    expect(options).toEqual(Array.from({ length: 13 }, (_, i) => String(i))) // 0..12
    expect(options).not.toContain('17')
  })

  it('maxChildAge=0 (caso borde): el desplegable ofrece una sola opción, "0"', async () => {
    await open(FROM_HERO, { acceptChildren: true, maxChildAge: 0, maxFreeAge: 0 })
    await bumpChildren(1)

    const select = document.body.querySelector<HTMLSelectElement>('select')!
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'))
    expect(options).toEqual(['0'])
  })

  it('dos habitaciones con niños de EDADES DISTINTAS: cada línea del carrito conserva las suyas', async () => {
    const policy: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }
    await open(FROM_HERO, policy)
    const store = useBookingStore()

    // Habitación 1: 1 adulto + 1 niño de 8 (con plaza) → chargeable 1+1=2 (available, $300).
    await bumpChildren(1)
    document.body.querySelector<HTMLSelectElement>('select')!.value = '8'
    document.body.querySelector<HTMLSelectElement>('select')!.dispatchEvent(new Event('change'))
    await flushPromises()
    await clickAddRoom()

    // El composer se resetea tras agregar — arma la segunda composición desde cero.
    // Habitación 2: 3 adultos + 1 niño de 9 (con plaza) → chargeable 3+1=4 (available, $480).
    await bumpAdults(2)
    await bumpChildren(1)
    document.body.querySelector<HTMLSelectElement>('select')!.value = '9'
    document.body.querySelector<HTMLSelectElement>('select')!.dispatchEvent(new Event('change'))
    await flushPromises()
    await clickAddRoom()

    expect(store.cart).toHaveLength(2)
    expect(store.cart[0]!.adults).toBe(1)
    expect(store.cart[0]!.childrenAges).toEqual([8])
    expect(store.cart[1]!.adults).toBe(3)
    expect(store.cart[1]!.childrenAges).toEqual([9])
    // Ninguna línea heredó la edad de la otra (dato huérfano entre habitaciones).
    expect(store.cart[0]!.childrenAges).not.toEqual(store.cart[1]!.childrenAges)
  })

  // ── Requerimiento 6 (Validación de capacidad, 2026-09-03) ───────────────────────────────
  // Mismo hallazgo que en RoomsStep.occupancies.test.ts: la matriz de ocupaciones no sabe de
  // maxAdults/maxChildren — sin `capacityBlockReason`, el botón quedaba apagado con un precio
  // arriba y sin decir por qué.
  it('excede maxAdults en una ocupación que la matriz SÍ marca disponible: motivo, no precio', async () => {
    await open() // fixture: occupancy=2 disponible, $300
    const store = useBookingStore()
    store.ratesResponse!.roomTypes[0]!.maxAdults = 1
    await bumpAdults(1) // 1 → 2 adultos, dentro de la matriz pero excede maxAdults=1

    expect(document.body.textContent).toContain('Supera el máximo de adultos de esta habitación')
    expect(document.body.textContent).not.toContain('300')
    expect(addRoomButton().disabled).toBe(true)
  })

  it('excede maxChildren en una ocupación que la matriz SÍ marca disponible: motivo, no precio', async () => {
    await open(FROM_HERO, { acceptChildren: true, maxChildAge: 12, maxFreeAge: 0 })
    const store = useBookingStore()
    store.ratesResponse!.roomTypes[0]!.maxChildren = 0
    await bumpChildren(1)
    document.body.querySelector<HTMLSelectElement>('select')!.value = '5' // > maxFreeAge=0 → con plaza
    document.body.querySelector<HTMLSelectElement>('select')!.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(document.body.textContent).toContain('Supera el máximo de niños de esta habitación')
    expect(addRoomButton().disabled).toBe(true)
  })

  // ── Requerimiento 9 (Cantidad de habitaciones, 2026-09-03) — misma paridad que RoomsStep ──
  describe('huéspedes ≠ habitaciones', () => {
    it('subir adultos y niños NO agrega nada al carrito por sí solo', async () => {
      await open()
      const store = useBookingStore()

      await bumpAdults(2)
      await bumpChildren(1)

      expect(store.cart).toHaveLength(0)
    })

    it('agregar la MISMA composición dos veces suma cantidad a UNA sola línea', async () => {
      await open()
      const store = useBookingStore()

      await clickAddRoom()
      await clickAddRoom()

      expect(store.cart).toHaveLength(1)
      expect(store.cart[0]!.quantity).toBe(2)
      expect(store.roomsSubtotal).toBe(420) // 210 × 2
    })

    it('eliminar una línea NO afecta a las demás', async () => {
      await open()
      const store = useBookingStore()

      await clickAddRoom() // línea A: 1 adulto
      await bumpAdults(1)
      await clickAddRoom() // línea B: 2 adultos
      expect(store.cart).toHaveLength(2)
      const [lineA, lineB] = store.cart

      store.removeCartLine(lineA!.key)

      expect(store.cart).toHaveLength(1)
      expect(store.cart[0]!.key).toBe(lineB!.key)
    })

    it('cartTotalRooms suma cantidad por línea, no solo cuenta líneas', async () => {
      await open()
      const store = useBookingStore()

      await clickAddRoom() // línea A → quantity 1
      await clickAddRoom() // misma composición → línea A pasa a quantity 2
      await bumpAdults(1)
      await clickAddRoom() // línea B → quantity 1

      expect(store.cart).toHaveLength(2)
      expect(store.cartTotalRooms).toBe(3)
    })
  })

  // ── Requerimiento 10 (Varias habitaciones, 2026-09-03) — misma paridad que RoomsStep ────────
  describe('varias habitaciones — composición independiente por línea', () => {
    it('ejemplo del pedido: Habitación 1 (2 adultos + niño de 2) y Habitación 2 (1 adulto + niños de 6 y 10) mantienen edades separadas', async () => {
      const policy: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }
      await open(FROM_HERO, policy)
      const store = useBookingStore()
      // Habitación 2 cotiza "para 3" — se habilita para poder agregarla en este fixture.
      store.ratesResponse!.roomTypes[0]!.occupancies![2] = {
        occupancy: 3, price: 400, pricePerNight: 133.33, available: true, unavailableReason: null, taxBreakdown: [],
      }

      // Habitación 1: 2 adultos + niño de 2 (libre).
      await bumpAdults(1)
      await bumpChildren(1)
      document.body.querySelector<HTMLSelectElement>('select')!.value = '2'
      document.body.querySelector<HTMLSelectElement>('select')!.dispatchEvent(new Event('change'))
      await flushPromises()
      await clickAddRoom()

      // Habitación 2: 1 adulto (default tras reset) + niños de 6 y 10 (con plaza).
      await bumpChildren(2)
      const selects = document.body.querySelectorAll<HTMLSelectElement>('select')
      selects[0]!.value = '6'
      selects[0]!.dispatchEvent(new Event('change'))
      selects[1]!.value = '10'
      selects[1]!.dispatchEvent(new Event('change'))
      await flushPromises()
      await clickAddRoom()

      expect(store.cart).toHaveLength(2)
      const [room1, room2] = store.cart
      expect(room1!.adults).toBe(2)
      expect(room1!.childrenAges).toEqual([2])
      expect(room2!.adults).toBe(1)
      expect(room2!.childrenAges).toEqual([6, 10])
      expect(room1!.childrenAges!.some((a) => room2!.childrenAges!.includes(a))).toBe(false)
    })

    it('mismos adultos, EDADES distintas: no se agrupan en una sola línea con quantity', async () => {
      const policy: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 0 }
      await open(FROM_HERO, policy)
      const store = useBookingStore()

      await bumpChildren(1) // 1 adulto (default) + 1 niño
      document.body.querySelector<HTMLSelectElement>('select')!.value = '5'
      document.body.querySelector<HTMLSelectElement>('select')!.dispatchEvent(new Event('change'))
      await flushPromises()
      await clickAddRoom()

      await bumpChildren(1) // otra vez 1 adulto + 1 niño, edad DISTINTA
      document.body.querySelector<HTMLSelectElement>('select')!.value = '9'
      document.body.querySelector<HTMLSelectElement>('select')!.dispatchEvent(new Event('change'))
      await flushPromises()
      await clickAddRoom()

      expect(store.cart).toHaveLength(2)
      expect(store.cart[0]!.quantity).toBe(1)
      expect(store.cart[1]!.quantity).toBe(1)
      expect(store.cart.map((l) => l.childrenAges).sort()).toEqual([[5], [9]])
    })
  })

  it('sin regímenes configurados: "Sólo alojamiento" activo y los 3 códigos deshabilitados', async () => {
    // getMealPlans devuelve [] (ningún régimen activo en este hotel) — se ve el eje completo,
    // nada más es seleccionable.
    await open()

    const text = document.body.textContent ?? ''
    expect(text).toContain('Sólo alojamiento')
    expect(text).toContain('Desayuno incluido')
    expect(text).toContain('Desayuno y cena')
    expect(text).toContain('Todo incluido')

    const boardButtons = Array.from(document.body.querySelectorAll('button'))
      .filter((b) => /Desayuno incluido|Desayuno y cena|Todo incluido/.test(b.textContent ?? ''))
    expect(boardButtons).toHaveLength(0)
  })

  it('régimen incluido en la tarifa: se muestra activo (mismo estilo que "Sólo alojamiento")', async () => {
    vi.mocked(BookingService.getMealPlans).mockResolvedValue([
      { code: 'breakfast', priceMode: 'included', price: 0 },
    ])
    await open()

    const pill = Array.from(document.body.querySelectorAll('span'))
      .find((s) => s.textContent?.includes('Desayuno incluido'))
    expect(pill).toBeTruthy()
    expect(pill!.className).toContain('bg-navy')
  })

  it('régimen con costo aparte: se muestra informativo con el precio, marcado "Próximamente"', async () => {
    vi.mocked(BookingService.getMealPlans).mockResolvedValue([
      { code: 'all_inclusive', priceMode: 'per_person_per_night', price: 45 },
    ])
    await open()

    const pill = Array.from(document.body.querySelectorAll('span'))
      .find((s) => s.textContent?.includes('Todo incluido'))
    expect(pill).toBeTruthy()
    expect(pill!.textContent).toContain('Próximamente')
    expect(pill!.getAttribute('title')).toContain('45')
    const boardButtons = Array.from(document.body.querySelectorAll('button'))
      .filter((b) => (b.textContent ?? '').includes('Todo incluido'))
    expect(boardButtons).toHaveLength(0)
  })

  it('el precio del régimen con costo usa chargeCurrency, NUNCA displayCurrency (D10)', async () => {
    // Mismo criterio que en el widget embebible: el precio del régimen no se convierte
    // server-side, viaja siempre en la moneda de cobro del hotel — mostrarlo en la moneda de
    // display inventaría una conversión que Stripe nunca hace.
    const res = ratesResponse(true)
    res.currency = 'EUR'
    res.chargeCurrency = 'USD'
    vi.mocked(BookingService.getRates).mockResolvedValue(res)
    vi.mocked(BookingService.getMealPlans).mockResolvedValue([
      { code: 'all_inclusive', priceMode: 'per_person_per_night', price: 45 },
    ])
    await open()

    const pill = Array.from(document.body.querySelectorAll('span'))
      .find((s) => s.textContent?.includes('Todo incluido'))
    expect(pill!.getAttribute('title')).toContain('US$')
    expect(pill!.getAttribute('title')).not.toContain('€')
  })

  it('sin `occupancies` degrada al precio único de siempre (backend viejo / caché)', async () => {
    vi.mocked(BookingService.getRates).mockResolvedValue(ratesResponse(false))

    await open()
    const store = useBookingStore()

    expect(document.body.textContent).toContain('Familiar')
    expect(occupancyEl()!.textContent).toContain('210')

    await clickAddRoom()

    expect(store.cart).toHaveLength(1)
    expect(store.cart[0]!.roomType).toBe('familiar')
    expect(store.cart[0]!.occupancy).toBe(1)
    expect(store.roomsSubtotal).toBe(210) // fromPrice, exactamente como antes
    expect(store.roomsValid).toBe(true)
  })
})
