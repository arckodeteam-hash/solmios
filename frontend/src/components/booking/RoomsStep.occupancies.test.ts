// RoomsStep.occupancies.test.ts — La matriz de ocupaciones del widget embebible.
//
// Qué se protege acá:
//   1. Cada tipo despliega UNA FILA POR OCUPACIÓN ("para 1", "para 2"…), como el motor de la
//      competencia. Una sola tarjeta con el precio más barato esconde que la habitación para 4
//      cuesta otra cosa — y el huésped descubre la diferencia recién en el paso de pago.
//   2. La ocupación que el hotel NO puede vender aparece DESHABILITADA Y CON EL MOTIVO, nunca
//      oculta. Regla explícita del dueño: "la que no esté, entonces debe aparecer pero
//      desactivada". Ocultarla es indistinguible de "este hotel no ofrece habitaciones para 4".
//   3. Elegir una fila propaga ESA ocupación y ESE precio al resto del flujo. Sin esto, elegir
//      "para 4" cobraría la tarifa de 1 persona.
//   4. Sin `occupancies` (backend viejo o respuesta cacheada en CDN) el paso sigue funcionando
//      con el precio único de antes. El campo es opcional a propósito.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn(), getUpsells: vi.fn().mockResolvedValue([]) },
}))

import RoomsStep from './RoomsStep.vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore, type BookingLocale } from '@/composables/useBookingI18n'
import type { PublicRatesResponse, RoomOccupancyRate } from '@/types/booking'

/** Las 6 filas cubren las 2 vendibles y LOS CUATRO motivos de no-disponibilidad. */
function occupancies(): RoomOccupancyRate[] {
  const tax = (total: number) => [{ name: 'ITBIS', rate: 18, amount: Math.round(total * 0.18 * 100) / 100 }]
  return [
    { occupancy: 1, price: 210, pricePerNight: 70, available: true, unavailableReason: null, taxBreakdown: tax(210) },
    { occupancy: 2, price: 300, pricePerNight: 100, available: true, unavailableReason: null, taxBreakdown: tax(300) },
    { occupancy: 3, price: 0, pricePerNight: 0, available: false, unavailableReason: 'no_rate', taxBreakdown: [] },
    { occupancy: 4, price: 480, pricePerNight: 160, available: false, unavailableReason: 'no_availability', taxBreakdown: tax(480) },
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

function render(withMatrix = true, locale: BookingLocale = 'es'): VueWrapper {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = ratesResponse(withMatrix)
  useBookingI18nStore().setLocale(locale)
  return mount(RoomsStep)
}

describe('RoomsStep — matriz de ocupaciones', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('despliega una fila por ocupación, incluidas las NO vendibles', () => {
    const w = render()

    const rows = w.findAll('button[data-occupancy]')
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.attributes('data-occupancy'))).toEqual(['1', '2', '3', '4', '5', '6'])

    // Y cada una rotulada "para N", como la competencia.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(w.get(`button[data-occupancy="${n}"]`).text()).toContain(`para ${n}`)
    }
    w.unmount()
  })

  it('la fila vendible muestra su precio total y el precio por noche', () => {
    const w = render()

    const row = w.get('button[data-occupancy="2"]')
    expect(row.text()).toContain('300')
    expect(row.text()).toContain('100')
    expect(row.text()).toContain('noche')
    w.unmount()
  })

  // Un caso por motivo: el backend tiene CUATRO y traducir tres deja al huésped mirando una fila
  // muda (o peor, un código en inglés) en el caso que falte.
  const reasons: Array<{ occupancy: number; texto: string }> = [
    { occupancy: 3, texto: 'Sin tarifa para esta ocupación' },
    { occupancy: 4, texto: 'Sin disponibilidad en estas fechas' },
    { occupancy: 5, texto: 'Cerrada a la venta' },
    { occupancy: 6, texto: 'Supera la capacidad de la habitación' },
  ]

  for (const r of reasons) {
    it(`la ocupación no vendible (${r.texto}) aparece DESHABILITADA y con el motivo`, async () => {
      const w = render()
      const store = useBookingStore()

      // Aparece (no se oculta): `find` devuelve el wrapper vacío si la fila no se renderizó.
      const row = w.find(`button[data-occupancy="${r.occupancy}"]`)
      expect(row.exists()).toBe(true)
      // … deshabilitada …
      expect(row.attributes('disabled')).toBeDefined()
      // … y con el motivo traducido, no un código crudo.
      expect(row.text()).toContain(r.texto)
      expect(row.text()).not.toMatch(/no_rate|no_availability|stop_sell|over_capacity/)

      // Clickearla no selecciona nada ni avanza de paso.
      await row.trigger('click')
      expect(store.selectedRoom).toBeNull()
      expect(store.selectedOccupancy).toBeNull()
      w.unmount()
    })
  }

  it('elegir una fila propaga ESA ocupación y ESE precio al resto del flujo', async () => {
    const w = render()
    const store = useBookingStore()

    await w.get('button[data-occupancy="2"]').trigger('click')

    expect(store.selectedRoom?.id).toBe('familiar')
    expect(store.selectedOccupancy).toBe(2)
    // El precio del flujo es el de la fila, NO el `fromPrice` (210) del tipo.
    expect(store.selectedRoomPrice).toBe(300)
    expect(store.subtotal).toBe(300)
    // Y la reserva se grabaría con la ocupación elegida, no con la del buscador.
    expect(store.bookingAdults).toBe(2)
    // Impuestos de la fila elegida (18% de 300), no los del tipo (37.8 sobre fromPrice).
    expect(store.estimatedTaxes).toBe(54)
    expect(store.estimatedTotal).toBe(354)
    expect(store.roomsValid).toBe(true)
    w.unmount()
  })

  it('elegir "para 4" cuesta distinto que "para 1" (el precio sigue a la fila)', async () => {
    const w = render()
    const store = useBookingStore()

    await w.get('button[data-occupancy="1"]').trigger('click')
    expect(store.selectedRoomPrice).toBe(210)

    await w.get('button[data-occupancy="2"]').trigger('click')
    expect(store.selectedRoomPrice).toBe(300)
    w.unmount()
  })

  it('muestra el régimen con "Sólo alojamiento" activo y las pensiones deshabilitadas', () => {
    // Placeholder consciente: el backend no modela pensiones. Las opciones se ven para que el
    // huésped sepa que el eje existe; ninguna es clickeable.
    const w = render()
    const text = w.text()

    expect(text).toContain('Sólo alojamiento')
    expect(text).toContain('Desayuno')
    expect(text).toContain('Media pensión')
    expect(text).toContain('Pensión completa')
    // Ninguna pensión es un control interactivo: no hay forma de seleccionarlas por accidente.
    const boardButtons = w.findAll('button').filter((b) => /Desayuno|Media pensión|Pensión completa/.test(b.text()))
    expect(boardButtons).toHaveLength(0)
    w.unmount()
  })

  it('[en] traduce los motivos de no-disponibilidad', () => {
    const w = render(true, 'en')
    expect(w.get('button[data-occupancy="3"]').text()).toContain('No rate for this occupancy')
    expect(w.get('button[data-occupancy="5"]').text()).toContain('Closed for sale')
    w.unmount()
  })

  it('[pt] traduce los motivos de no-disponibilidad', () => {
    const w = render(true, 'pt')
    expect(w.get('button[data-occupancy="3"]').text()).toContain('Sem tarifa para esta ocupação')
    expect(w.get('button[data-occupancy="5"]').text()).toContain('Fechada para venda')
    w.unmount()
  })

  it('sin `occupancies` degrada al precio único de siempre (backend viejo / caché)', async () => {
    const w = render(false)
    const store = useBookingStore()

    // Sin matriz no hay filas, pero la habitación se sigue pudiendo elegir.
    expect(w.findAll('button[data-occupancy]')).toHaveLength(0)
    expect(w.text()).toContain('Familiar')

    const choose = w.findAll('button').find((b) => b.text().trim() === 'Elegir')
    expect(choose).toBeTruthy()
    await choose!.trigger('click')

    expect(store.selectedRoom?.id).toBe('familiar')
    expect(store.selectedOccupancy).toBeNull()
    expect(store.selectedRoomPrice).toBe(210) // fromPrice, exactamente como antes
    expect(store.roomsValid).toBe(true)
    w.unmount()
  })

  // ─── Ocupaciones de IGUAL precio: el grupo (bug del dueño 2026-08-17) ─────────────────────
  // El hotel cargó UNA tarifa por tipo: "para 1 $390 · para 2 $390 · para 3 $390" leía como
  // bug. La corrida de iguales se colapsa: el número se pinta UNA vez y las opciones siguen
  // siendo clickeables — la ELECCIÓN nunca se deduplica, solo el precio repetido.
  function equalOccupancies(): RoomOccupancyRate[] {
    const tax = (total: number) => [{ name: 'ITBIS', rate: 18, amount: Math.round(total * 0.18 * 100) / 100 }]
    return [1, 2, 3].map((n) => ({
      occupancy: n, price: 390, pricePerNight: 130, available: true, unavailableReason: null, taxBreakdown: tax(390),
    }))
  }

  function renderEqual(): VueWrapper {
    const store = useBookingStore()
    store.init('hotel-demo')
    const base = ratesResponse(true)
    store.ratesResponse = {
      ...base,
      roomTypes: base.roomTypes.map((rt) => ({ ...rt, occupancies: equalOccupancies() })),
    } as PublicRatesResponse
    useBookingI18nStore().setLocale('es')
    return mount(RoomsStep)
  }

  it('corrida de igual precio: el precio se pinta UNA vez pero las 3 opciones existen', () => {
    const w = renderEqual()

    // Las tres ocupaciones siguen siendo elegibles.
    const pills = w.findAll('button[data-occupancy]')
    expect(pills.map((p) => p.attributes('data-occupancy'))).toEqual(['1', '2', '3'])

    // El total repetido era el bug: "390" debe aparecer UNA sola vez en el paso.
    expect((w.text().match(/390/g) ?? []).length).toBe(1)
    expect((w.text().match(/130(?!\d)/g) ?? []).length).toBe(1)
    w.unmount()
  })

  it('elegir una opción del grupo propaga SU ocupación y el precio del grupo', async () => {
    const w = renderEqual()
    const store = useBookingStore()

    await w.get('button[data-occupancy="2"]').trigger('click')

    expect(store.selectedRoom?.id).toBe('familiar')
    expect(store.selectedOccupancy).toBe(2)
    expect(store.selectedRoomPrice).toBe(390)
    expect(store.bookingAdults).toBe(2)
    expect(store.roomsValid).toBe(true)
    w.unmount()
  })
})
