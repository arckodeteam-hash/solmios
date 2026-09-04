// components/booking-wizard-landing-parity.test.ts — Requerimiento 15 (Unificación de las dos
// entradas públicas de reserva, 2026-09-04).
//
// RoomsStep.vue (widget, /book/:slug) y BookingModal.vue (landing, /h/:slug) delegan el 100% de
// la lógica de composición/capacidad/ocupación a `composables/useGuestComposer.ts` — auditado sin
// reimplementación local en NINGUNO de los dos archivos. Pero hasta este test, la prueba de esa
// paridad era INDIRECTA: dos suites "espejo" (RoomsStep.occupancies.test.ts /
// BookingModal.occupancies.test.ts) con títulos calcados a mano, cada una con SU PROPIO fixture.
// Nada impedía que un fixture se editara en un archivo y no en el otro sin que ningún test fallara.
//
// Este archivo monta AMBOS componentes con el MISMO fixture (`booking-parity-fixtures.ts`),
// ejecuta la MISMA secuencia de interacción ("ejemplo del pedido": Habitación 1 = 2 adultos + niño
// de 2 años libre; Habitación 2 = 1 adulto + niños de 6 y 10 con plaza) y compara `store.cart`
// BYTE A BYTE al final — si algún día una de las dos superficies reimplementa algo por su cuenta y
// diverge, ESTE test (no dos suites separadas que hay que leer con atención) lo detecta solo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: {
    getRates: vi.fn(),
    getCalendar: vi.fn().mockResolvedValue({ currency: 'USD', chargeCurrency: 'USD', from: '2026-08-15', to: '2026-08-31', guests: 2, days: [] }),
    getUpsells: vi.fn().mockResolvedValue([]),
    getMealPlans: vi.fn().mockResolvedValue([]),
    validatePromo: vi.fn(),
    createBooking: vi.fn(),
  },
}))
vi.mock('@/services/PublicHotel.service', () => ({
  PublicHotelService: { getRoomTypes: vi.fn().mockResolvedValue({ roomTypes: [] }) },
}))

import RoomsStep from './booking/RoomsStep.vue'
import BookingModal from './landing/BookingModal.vue'
import { BookingService } from '@/services/Booking.service'
import { useBookingStore, type CartLine } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import type { OpenBookingOptions, PublicHotelInfo } from '@/types'
import { PARITY_CHILD_POLICY, PARITY_CHECK_IN, PARITY_CHECK_OUT, parityRatesResponse } from './booking-parity-fixtures'

const HOTEL = {
  id: 'h1', slug: 'hotel-demo', name: 'Hotel Demo', title: 'Hotel Demo', description: '',
  accommodationType: 'hotel', starRating: 4, amenities: [], latitude: 0, longitude: 0, currency: 'USD',
  childPolicy: PARITY_CHILD_POLICY,
} as unknown as PublicHotelInfo

/** `key` se incluye a propósito en la comparación: `cartLineKeyForComposition` es determinístico
 *  (roomType + adults + edades ordenadas), así que también debe coincidir entre las dos entradas. */
function snapshot(cart: CartLine[]): unknown {
  return JSON.parse(JSON.stringify(cart))
}

interface BuiltCart {
  cart: CartLine[]
  roomsSubtotal: number
}

async function buildCartViaRoomsStep(): Promise<BuiltCart> {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = parityRatesResponse()
  store.childPolicy = PARITY_CHILD_POLICY
  useBookingI18nStore().setLocale('es')
  const w = mount(RoomsStep)
  await flushPromises()

  const plusButtons = () => w.findAll('button').filter((b) => b.text() === '+')
  const addRoomButton = () => w.findAll('button').find((b) => b.text().includes('Agregar esta habitación'))!

  // Habitación 1: 2 adultos + niño de 2 (libre).
  await plusButtons()[0]!.trigger('click') // adultos 1→2
  await plusButtons()[1]!.trigger('click') // +1 niño
  await w.get('select').setValue('2')
  await addRoomButton().trigger('click')
  await flushPromises()

  // Habitación 2: 1 adulto (default tras el reset) + niños de 6 y 10 (con plaza).
  await plusButtons()[1]!.trigger('click')
  await plusButtons()[1]!.trigger('click')
  const selects = w.findAll('select')
  await selects[0]!.setValue('6')
  await selects[1]!.setValue('10')
  await addRoomButton().trigger('click')
  await flushPromises()

  const built: BuiltCart = { cart: snapshot(store.cart) as CartLine[], roomsSubtotal: store.roomsSubtotal }
  w.unmount()
  return built
}

// BookingModal.vue resetea el store global al desmontarse (`onBeforeUnmount` → `store.reset()`,
// salvo reserva en curso) — hay que leer `store.cart`/`roomsSubtotal` ANTES de `w.unmount()`,
// nunca después, o el snapshot sale vacío.
async function buildCartViaBookingModal(): Promise<BuiltCart> {
  vi.mocked(BookingService.getRates).mockReset().mockResolvedValue(parityRatesResponse())
  const options: OpenBookingOptions = { checkIn: PARITY_CHECK_IN, checkOut: PARITY_CHECK_OUT, rooms: 1, skipToRooms: true }
  const w = mount(BookingModal, { props: { hotel: HOTEL, options }, global: { stubs: { RouterLink: true } } })
  await flushPromises()
  useBookingStore().childPolicy = PARITY_CHILD_POLICY
  await flushPromises()

  const store = useBookingStore()
  const plusButtons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.trim() === '+')
  const addRoomButton = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Agregar esta habitación'))!
  const setSelect = (el: HTMLSelectElement, value: string) => { el.value = value; el.dispatchEvent(new Event('change')) }

  // Habitación 1: 2 adultos + niño de 2 (libre) — MISMA secuencia que RoomsStep.
  plusButtons()[0]!.click(); await flushPromises()
  plusButtons()[1]!.click(); await flushPromises()
  setSelect(document.body.querySelector<HTMLSelectElement>('select')!, '2')
  await flushPromises()
  addRoomButton().click(); await flushPromises()

  // Habitación 2: 1 adulto + niños de 6 y 10 (con plaza).
  plusButtons()[1]!.click(); await flushPromises()
  plusButtons()[1]!.click(); await flushPromises()
  const selects = document.body.querySelectorAll<HTMLSelectElement>('select')
  setSelect(selects[0]!, '6')
  setSelect(selects[1]!, '10')
  await flushPromises()
  addRoomButton().click(); await flushPromises()

  const built: BuiltCart = { cart: snapshot(store.cart) as CartLine[], roomsSubtotal: store.roomsSubtotal }
  w.unmount()
  document.body.innerHTML = ''
  return built
}

describe('Requerimiento 15 — paridad wizard (RoomsStep) vs landing (BookingModal), mismo fixture', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    // `store.searchValid` (useBooking.ts) rechaza un checkIn en el pasado — la ruta de BookingModal
    // pasa por `store.search()` (a diferencia de RoomsStep acá arriba, que setea `ratesResponse`
    // directo), así que necesita el reloj fijo ANTES de `PARITY_CHECK_IN` (mismo patrón que
    // BookingModal.occupancies.test.ts).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 15, 10, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('la MISMA composición multi-habitación produce el MISMO store.cart en las dos entradas públicas', async () => {
    const wizard = await buildCartViaRoomsStep()

    setActivePinia(createPinia()) // reserva nueva pinia — ninguna de las dos corridas comparte estado
    const landing = await buildCartViaBookingModal()

    expect(wizard.cart).toHaveLength(2)
    expect(landing.cart).toHaveLength(2)
    // Comparación estricta: mismo roomType, adults, childrenAges, occupancy, unitPrice, quantity y
    // `key` (determinístico) en las DOS líneas, en el MISMO orden — no solo "ambas tienen 2 líneas".
    expect(landing.cart).toEqual(wizard.cart)
  })

  it('el precio total de la habitación (roomsSubtotal) coincide entre las dos entradas para la MISMA composición', async () => {
    const wizard = await buildCartViaRoomsStep()

    setActivePinia(createPinia())
    const landing = await buildCartViaBookingModal()

    expect(landing.roomsSubtotal).toBe(wizard.roomsSubtotal)
    expect(wizard.roomsSubtotal).toBe(300 + 400) // "para 2" (niño libre) + "para 3" (niños con plaza)
  })
})
