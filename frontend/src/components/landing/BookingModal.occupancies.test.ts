// BookingModal.occupancies.test.ts — La matriz de ocupaciones DENTRO de la landing pública.
//
// Misma regla que en el widget embebible (RoomsStep.occupancies.test.ts), verificada en la otra
// superficie porque son dos UIs distintas sobre el mismo store: la landing NO reusa los
// componentes del widget (i18n propio, layout de columna angosta) y arreglar una sola dejaba el
// bug vivo para la mitad de los huéspedes.
//
//   1. Una fila por ocupación ("para 1", "para 2"…), incluidas las que el hotel no puede vender.
//   2. La no vendible aparece DESHABILITADA Y CON EL MOTIVO en español, nunca oculta.
//   3. Elegir una fila propaga esa ocupación y ese precio hasta el payload de la reserva.
//   4. Sin `occupancies` (backend viejo / respuesta cacheada) el paso sigue funcionando igual
//      que antes, con el precio único del tipo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: {
    getRates: vi.fn(),
    getCalendar: vi.fn(),
    getUpsells: vi.fn(),
    validatePromo: vi.fn(),
    createBooking: vi.fn(),
  },
}))
// El paso de habitaciones también pide el catálogo (`GET /room-types`) para mostrar deshabilitados
// los tipos sin disponibilidad — mockeado vacío acá para no pegarle a la red real ni interferir
// con estos tests, que son sobre la matriz de ocupaciones de los tipos QUE SÍ trae /rates.
vi.mock('@/services/PublicHotel.service', () => ({
  PublicHotelService: { getRoomTypes: vi.fn().mockResolvedValue({ roomTypes: [] }) },
}))

import BookingModal from './BookingModal.vue'
import { BookingService } from '@/services/Booking.service'
import { useBookingStore } from '@/composables/useBooking'
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
        capacity: 4,
        surfaceArea: 32,
        taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 37.8 }],
        photoUrl: null,
        ...(withMatrix ? { occupancies: occupancies() } : {}),
      },
    ],
  }
}

/** El panel vive teletransportado en <body> (AppModal), no dentro del wrapper. */
function row(occupancy: number): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(`button[data-occupancy="${occupancy}"]`)
}

function rows(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button[data-occupancy]'))
}

let wrapper: VueWrapper | null = null

/** Contexto típico del buscador del hero: fechas + ocupación ya elegidas. */
const FROM_HERO: OpenBookingOptions = {
  checkIn: '2026-08-18',
  checkOut: '2026-08-21',
  adults: 2,
  children: 0,
  rooms: 1,
  skipToRooms: true,
}

async function open(options: OpenBookingOptions = FROM_HERO) {
  wrapper = mount(BookingModal, {
    props: { hotel: HOTEL, options },
    global: { stubs: { RouterLink: true } },
  })
  await flushPromises()
  return wrapper
}

describe('BookingModal — matriz de ocupaciones', () => {
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
    vi.mocked(BookingService.createBooking).mockReset()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('despliega una fila por ocupación, incluidas las NO vendibles', async () => {
    await open()

    expect(rows().map((r) => r.dataset.occupancy)).toEqual(['1', '2', '3', '4', '5', '6'])
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(row(n)!.textContent).toContain(`para ${n}`)
    }
  })

  it('la fila vendible muestra su precio total y el precio por noche', async () => {
    await open()

    const txt = row(4)!.textContent ?? ''
    expect(txt).toContain('480')
    expect(txt).toContain('160')
    expect(txt).toContain('/noche')
  })

  // Un caso por motivo: el backend tiene CUATRO y traducir tres deja al huésped mirando una fila
  // muda (o un código en inglés) justo en el caso que falte.
  const reasons: Array<{ occupancy: number; texto: string }> = [
    { occupancy: 3, texto: 'Sin tarifa para esta ocupación' },
    { occupancy: 5, texto: 'Cerrada a la venta' },
    { occupancy: 6, texto: 'Supera la capacidad de la habitación' },
  ]

  for (const r of reasons) {
    it(`la ocupación no vendible (${r.texto}) aparece DESHABILITADA y con el motivo`, async () => {
      await open()
      const store = useBookingStore()

      const el = row(r.occupancy)
      expect(el).toBeTruthy()                       // aparece, no se oculta
      expect(el!.disabled).toBe(true)               // pero no se puede elegir
      expect(el!.textContent).toContain(r.texto)    // y dice POR QUÉ, en español
      expect(el!.textContent).not.toMatch(/no_rate|no_availability|stop_sell|over_capacity/)

      el!.click()
      await flushPromises()
      expect(store.selectedRoom).toBeNull()
      expect(store.selectedOccupancy).toBeNull()
    })
  }

  it('cubre también no_availability (la 4ª razón) con su texto propio', async () => {
    // Se arma aparte para no perder la fila `available` de ocupación 4 del resto de los casos.
    const res = ratesResponse(true)
    res.roomTypes[0]!.occupancies![3] = {
      occupancy: 4, price: 480, pricePerNight: 160,
      available: false, unavailableReason: 'no_availability', taxBreakdown: [],
    }
    vi.mocked(BookingService.getRates).mockResolvedValue(res)

    await open()

    expect(row(4)!.disabled).toBe(true)
    expect(row(4)!.textContent).toContain('Sin disponibilidad en estas fechas')
  })

  it('elegir una fila propaga ESA ocupación y ESE precio hasta el payload de la reserva', async () => {
    await open({ ...FROM_HERO, adults: 2, children: 0 })
    const store = useBookingStore()

    row(4)!.click()
    await flushPromises()

    expect(store.selectedOccupancy).toBe(4)
    // El precio del flujo es el de la fila (480), NO el `fromPrice` del tipo (210).
    expect(store.selectedRoomPrice).toBe(480)
    expect(store.subtotal).toBe(480)
    expect(store.estimatedTaxes).toBe(86.4)
    expect(store.estimatedTotal).toBe(566.4)

    // Avanzamos hasta el paso de pago: el resumen tiene que decir para cuántos se cotizó, o el
    // huésped no puede verificar que está pagando la fila que eligió.
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    store.next() // → extras
    store.next() // → datos
    store.next() // → pago
    await flushPromises()
    expect(store.status).toBe('paying')
    expect(document.body.textContent).toContain('Familiar · para 4')

    vi.mocked(BookingService.createBooking).mockResolvedValue({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 480, promoDiscount: 0, upsellsTotal: 0, taxes: 86.4, total: 566.4 },
    })
    await store.pay()

    // La reserva sale con la ocupación cotizada (4), no con la del buscador (2): si no, el
    // hotel recibe 4 huéspedes con una reserva que dice 2.
    expect(vi.mocked(BookingService.createBooking).mock.calls[0]![0]).toMatchObject({
      adults: 4, roomType: 'familiar',
    })
  })

  it('con niños, la ocupación elegida se reparte: adults = ocupación − children', async () => {
    await open({ ...FROM_HERO, adults: 2, children: 2 })
    const store = useBookingStore()

    row(4)!.click()
    await flushPromises()

    vi.mocked(BookingService.createBooking).mockResolvedValue({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 480, promoDiscount: 0, upsellsTotal: 0, taxes: 86.4, total: 566.4 },
    })
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    await store.pay()

    // 4 plazas = 2 adultos + 2 niños. Los niños NO se graban como adultos (bug ya cerrado).
    expect(vi.mocked(BookingService.createBooking).mock.calls[0]![0]).toMatchObject({
      adults: 2, children: 2,
    })
  })

  it('muestra el régimen con "Sólo alojamiento" activo y las pensiones deshabilitadas', async () => {
    // Placeholder consciente: el backend no modela pensiones. Se ven para que el huésped sepa
    // que el eje existe; ninguna es clickeable.
    await open()

    const text = document.body.textContent ?? ''
    expect(text).toContain('Sólo alojamiento')
    expect(text).toContain('Desayuno')
    expect(text).toContain('Media pensión')
    expect(text).toContain('Pensión completa')

    const boardButtons = Array.from(document.body.querySelectorAll('button'))
      .filter((b) => /Desayuno|Media pensión|Pensión completa/.test(b.textContent ?? ''))
    expect(boardButtons).toHaveLength(0)
  })

  it('sin `occupancies` degrada al precio único de siempre (backend viejo / caché)', async () => {
    vi.mocked(BookingService.getRates).mockResolvedValue(ratesResponse(false))

    await open()
    const store = useBookingStore()

    expect(rows()).toHaveLength(0)
    const choose = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === 'Elegir')
    expect(choose).toBeTruthy()

    choose!.click()
    await flushPromises()

    expect(store.selectedRoom?.id).toBe('familiar')
    expect(store.selectedOccupancy).toBeNull()
    expect(store.selectedRoomPrice).toBe(210) // fromPrice, exactamente como antes
    expect(store.roomsValid).toBe(true)
  })
})
