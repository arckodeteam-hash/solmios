// BookingModal.test.ts — El motor de reserva dentro de la landing.
//
// Qué se protege acá (todo son bugs que ya costaron plata o fricción en este repo):
//   1. Abrir desde el hero NO puede volver a preguntar lo que el huésped ya eligió: entra
//      directo al paso de habitaciones con UNA sola consulta de tarifas.
//   2. Una card de habitación abre el modal con ESA habitación seleccionada.
//   3. `children` viaja de punta a punta: suma a la ocupación FÍSICA para pedir tarifas
//      (el backend filtra por `rooms.capacity`) y va APARTE de `adults` al crear la reserva.
//      Antes el calendario del hero consultaba con adultos+niños y el motor con adultos solos
//      → con niños el precio se movía entre una pantalla y la otra.
//   4. Escape cierra el modal.
//   5. Un fallo de la API NO deja el modal en blanco (regla del proyecto: el estado vacío cubre
//      lista vacía Y error).
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
vi.mock('@/services/PublicHotel.service', () => ({
  PublicHotelService: { getRoomTypes: vi.fn() },
}))

import BookingModal from './BookingModal.vue'
import { BookingService } from '@/services/Booking.service'
import { PublicHotelService } from '@/services/PublicHotel.service'
import { useBookingStore } from '@/composables/useBooking'
import type { PublicHotelInfo, PublicRatesResponse, OpenBookingOptions } from '@/types'

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

function ratesResponse(): PublicRatesResponse {
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
        id: 'double', name: 'double', fromPrice: 300, availableCount: 5, capacity: 2,
        surfaceArea: 24, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 54 }], photoUrl: null,
      },
      {
        id: 'suite', name: 'suite', fromPrice: 600, availableCount: 2, capacity: 4,
        surfaceArea: 48, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 108 }], photoUrl: null,
      },
    ],
  }
}

/** El panel vive teletransportado en <body> (AppModal), no dentro del wrapper. */
function modalText(): string {
  return document.body.textContent ?? ''
}

let wrapper: VueWrapper | null = null

async function open(options: OpenBookingOptions) {
  wrapper = mount(BookingModal, {
    props: { hotel: HOTEL, options },
    global: { stubs: { RouterLink: true } },
  })
  await flushPromises()
  return wrapper
}

/** Contexto típico del buscador del hero: fechas + ocupación ya elegidas. */
const FROM_HERO: OpenBookingOptions = {
  checkIn: '2026-08-18',
  checkOut: '2026-08-21',
  adults: 2,
  children: 0,
  rooms: 1,
  skipToRooms: true,
}

describe('BookingModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0, 0))
    vi.mocked(BookingService.getRates).mockReset().mockResolvedValue(ratesResponse())
    vi.mocked(BookingService.getCalendar).mockReset().mockResolvedValue({
      currency: 'USD', chargeCurrency: 'USD', from: '2026-08-15', to: '2026-08-31', guests: 2, days: [],
    })
    vi.mocked(BookingService.getUpsells).mockReset().mockResolvedValue([])
    vi.mocked(BookingService.createBooking).mockReset()
    vi.mocked(PublicHotelService.getRoomTypes).mockReset().mockResolvedValue({ roomTypes: [] })
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('abre desde el hero en el paso de habitaciones, sin volver a pedir "Ver disponibilidad"', async () => {
    await open(FROM_HERO)

    // Una sola consulta de tarifas, con el contexto del hero: no hay segundo click intermedio.
    expect(BookingService.getRates).toHaveBeenCalledTimes(1)
    expect(vi.mocked(BookingService.getRates).mock.calls[0]![1]).toMatchObject({
      checkIn: '2026-08-18', checkOut: '2026-08-21', rooms: 1, guests: 2,
    })

    const store = useBookingStore()
    expect(store.status).toBe('selecting')
    expect(modalText()).toContain('Elegí tu habitación')
    // El paso de fechas quedó atrás: su CTA ya no está a la vista.
    expect(modalText()).not.toContain('Ver disponibilidad')
  })

  // `fromPrice` viene PRE-impuestos y el `taxBreakdown` llega aparte: el huésped paga la suma.
  // Rotularlo "Incluye 18% ITBIS" (como decía antes) anunciaba un precio final que no era el
  // final — se detectó recorriendo el flujo real, donde el paso de pago cobraba 240 + 43.
  it('anuncia los impuestos como un agregado, no como incluidos en el precio', async () => {
    await open(FROM_HERO)

    const txt = modalText()
    expect(txt).toContain('18% ITBIS')
    expect(txt).not.toContain('Incluye')
  })

  it('preselecciona la habitación con la que se abrió desde una card', async () => {
    await open({ ...FROM_HERO, roomTypeId: 'suite' })

    const store = useBookingStore()
    expect(store.cart[0]?.roomType).toBe('suite')
    // Y el botón de continuar queda habilitado: no hay que re-elegir lo que ya se clickeó.
    expect(store.roomsValid).toBe(true)
  })

  it('ignora una preselección que no está disponible en esas fechas (sin romper el paso)', async () => {
    await open({ ...FROM_HERO, roomTypeId: 'villa-inexistente' })

    const store = useBookingStore()
    expect(store.cart).toHaveLength(0)
    expect(store.status).toBe('selecting')
    expect(modalText()).toContain('Elegí tu habitación')
  })

  it('propaga children: ocupación FÍSICA al pedir tarifas y campo aparte al reservar', async () => {
    await open({ ...FROM_HERO, adults: 2, children: 2 })

    const store = useBookingStore()
    expect(store.guests).toBe(2)     // adultos
    expect(store.children).toBe(2)   // niños
    expect(store.physicalGuests).toBe(4)
    // El endpoint filtra por rooms.capacity: un niño ocupa plaza igual que un adulto. Es el
    // MISMO criterio con el que el calendario del hero pidió los precios.
    expect(vi.mocked(BookingService.getRates).mock.calls[0]![1]).toMatchObject({ guests: 4 })

    vi.mocked(BookingService.createBooking).mockResolvedValue({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 300, promoDiscount: 0, upsellsTotal: 0, taxes: 54, total: 354 },
      paymentError: 'stripe no configurado',
    })
    await store.addToCart(ratesResponse().roomTypes[0]!)
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    await store.pay()

    // `adults` NO absorbe a los niños (se grabarían como adultos y la ocupación real se pierde).
    expect(vi.mocked(BookingService.createBooking).mock.calls[0]![0]).toMatchObject({
      adults: 2, children: 2, roomType: 'double',
    })
  })

  it('no manda children cuando no hay niños (payload idéntico al de siempre)', async () => {
    await open({ ...FROM_HERO, adults: 2, children: 0 })

    const store = useBookingStore()
    vi.mocked(BookingService.createBooking).mockResolvedValue({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 300, promoDiscount: 0, upsellsTotal: 0, taxes: 54, total: 354 },
    })
    await store.addToCart(ratesResponse().roomTypes[0]!)
    store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
    await store.pay()

    expect(vi.mocked(BookingService.createBooking).mock.calls[0]![0]).not.toHaveProperty('children')
    expect(vi.mocked(BookingService.getRates).mock.calls[0]![1]).toMatchObject({ guests: 2 })
  })

  it('cierra con Escape', async () => {
    const w = await open(FROM_HERO)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(w.emitted('close')).toBeTruthy()
  })

  it('un fallo de la API no deja el modal en blanco: avisa y ofrece reintentar', async () => {
    vi.mocked(BookingService.getRates).mockRejectedValue(new Error('backend caído'))

    await open(FROM_HERO)

    const store = useBookingStore()
    expect(store.ratesError).toBeTruthy()
    const text = modalText()
    expect(text).toContain('backend caído')
    expect(text).toContain('Reintentar')
    // Y sigue habiendo un paso usable (fechas), no una pantalla vacía.
    expect(text).toContain('¿Cuándo venís?')

    // El reintento vuelve a consultar tarifas y entra a habitaciones.
    vi.mocked(BookingService.getRates).mockResolvedValue(ratesResponse())
    const retry = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === 'Reintentar')
    expect(retry).toBeTruthy()
    retry!.click()
    await flushPromises()

    expect(store.status).toBe('selecting')
    expect(modalText()).toContain('Elegí tu habitación')
  })

  it('sin habitaciones disponibles muestra el estado vacío con salida, no una lista pelada', async () => {
    vi.mocked(BookingService.getRates).mockResolvedValue({ ...ratesResponse(), roomTypes: [] })

    await open(FROM_HERO)

    const text = modalText()
    expect(text).toContain('Sin habitaciones para esas fechas')
    expect(text).toContain('Cambiar fechas')
  })

  // Decisión de producto 2026-08-20: un tipo sin disponibilidad continua para las fechas
  // buscadas (excluido de /rates) NO se oculta — aparece deshabilitado con el motivo. La fuente
  // es el catálogo (`GET /room-types`, mismo endpoint de la vitrina de la landing).
  it('un tipo sin disponibilidad para las fechas aparece DESHABILITADO con el motivo, no oculto', async () => {
    vi.mocked(PublicHotelService.getRoomTypes).mockResolvedValue({
      roomTypes: [
        // "double" y "suite" ya están en /rates (disponibles) — no deben duplicarse acá.
        { id: 'double', name: 'double', capacity: 2, surfaceArea: 24, basePrice: 100, photoUrl: null },
        { id: 'suite', name: 'suite', capacity: 4, surfaceArea: 48, basePrice: 200, photoUrl: null },
        // "family" NO está en /rates (0 unidades libres esas fechas) — es el caso del hallazgo.
        { id: 'family', name: 'family', capacity: 6, surfaceArea: 60, basePrice: 300, photoUrl: null },
      ],
    })

    await open(FROM_HERO)
    await flushPromises()

    const text = modalText()
    // Sigue eligiéndose con normalidad (nombre prettificado por el componente: 'double' → 'Double').
    expect(text).toContain('Double')
    expect(text).toContain('Suite')
    // Y el tipo sin disponibilidad aparece, con el motivo — NO desaparece de la pantalla.
    expect(text).toContain('Family')
    expect(text).toContain('No disponible para estas fechas')

    // No es clickeable como reserva: sin botón "Elegir"/"Elegida" para ese tipo.
    const familyCard = Array.from(document.querySelectorAll<HTMLElement>('article'))
      .find((el) => el.textContent?.includes('Family'))!
    expect(familyCard.querySelector('button')).toBeNull()
  })

  it('si el catálogo falla, el paso de habitaciones sigue funcionando (solo con lo que /rates trajo)', async () => {
    vi.mocked(PublicHotelService.getRoomTypes).mockRejectedValue(new Error('caído'))

    await open(FROM_HERO)
    await flushPromises()

    const text = modalText()
    expect(text).toContain('Double')
    expect(text).toContain('Suite')
    expect(text).not.toContain('No disponible para estas fechas')
  })
})
