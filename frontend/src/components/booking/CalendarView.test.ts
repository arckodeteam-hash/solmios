// CalendarView.test.ts — El calendario del widget embebible (`/book/:slug`).
//
// Qué se protege acá (lo que NO cubre `utils/rate-calendar.test.ts`, que es lógica pura):
//   1. NINGÚN día muestra precio — se mostraba antes un "desde" agregado (el más barato entre
//      TODOS los tipos), y el huésped lo leía como el precio del tipo que terminaba eligiendo en
//      RoomsStep, que cotiza distinto por tipo. El precio real se ve recién ahí, por tipo.
//   2. Un día sin lugar no se puede elegir y se lee como "no hay lugar", no como "se rompió".
//   3. El switcher de MONEDA del widget (que la landing no tiene) re-pide los precios: mostrar
//      tarifas en EUR con números convertidos a USD sería peor que no mostrarlas.
//   4. La ocupación física (adultos + niños) es la que se consulta.
//   5. Si el endpoint falla, el calendario SIGUE sirviendo para elegir fechas (regla del
//      proyecto: el estado vacío cubre lista vacía Y error).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getCalendar: vi.fn(), getRates: vi.fn() },
}))

import CalendarView from './CalendarView.vue'
import { BookingService } from '@/services/Booking.service'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import type { CalendarDay, PublicCalendarResponse } from '@/types/booking'

// Fecha fija: 15 de agosto de 2026. Solo se fake-ea Date — los microtasks de Vue tienen que
// seguir corriendo de verdad.
const TODAY = new Date(2026, 7, 15, 10, 0, 0)

function response(days: CalendarDay[], currency = 'USD'): PublicCalendarResponse {
  return { currency, chargeCurrency: 'USD', from: '2026-08-15', to: '2026-08-31', guests: 2, days }
}

/** Agosto 2026 del 15 al 31, todo disponible a 100, salvo los overrides pasados. */
function agosto(overrides: Record<string, Partial<CalendarDay>> = {}): CalendarDay[] {
  const out: CalendarDay[] = []
  for (let d = 15; d <= 31; d++) {
    const date = `2026-08-${d}`
    out.push({ date, fromPrice: 100, available: 4, closed: false, ...(overrides[date] ?? {}) })
  }
  return out
}

let wrapper: VueWrapper | null = null

/** Celdas de día: son las únicas con `aria-pressed` (los ‹ › no lo tienen). */
function cells(): HTMLButtonElement[] {
  return Array.from(wrapper!.element.querySelectorAll('button[aria-pressed]')) as HTMLButtonElement[]
}

function monthNavButton(ariaLabel: string): HTMLButtonElement {
  const found = wrapper!.element.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!found) throw new Error(`No existe el botón "${ariaLabel}"`)
  return found as HTMLButtonElement
}

function cell(dayNumber: number): HTMLButtonElement {
  const found = cells().find((c) => c.querySelector('span')?.textContent?.trim() === String(dayNumber))
  if (!found) throw new Error(`No existe la celda del día ${dayNumber}`)
  return found
}

async function render(opts: { children?: number; guests?: number } = {}) {
  const store = useBookingStore()
  store.init('hotel-demo', { guests: opts.guests ?? 2, children: opts.children ?? 0 })
  useBookingI18nStore().setLocale('es')
  wrapper = mount(CalendarView)
  await flushPromises()
  return { store, wrapper: wrapper! }
}

describe('CalendarView (widget)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    vi.mocked(BookingService.getCalendar).mockReset()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('pide SOLO el mes visible recortado a partir de hoy, con la ocupación FÍSICA (adultos + niños)', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    await render({ guests: 2, children: 2 })

    expect(BookingService.getCalendar).toHaveBeenCalledTimes(1)
    expect(BookingService.getCalendar).toHaveBeenCalledWith('hotel-demo', {
      from: '2026-08-15', to: '2026-08-31', guests: 4, currency: undefined,
    })
  })

  it('NO muestra precio por día: distintos tipos de habitación cotizan distinto', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({ '2026-08-20': { fromPrice: 175 } })),
    )
    await render()

    expect(cell(20).textContent).toContain('20')
    expect(cell(20).textContent).not.toMatch(/175/)
    expect(cell(21).textContent).not.toMatch(/100/)
  })

  it('un día closed / available 0 NO es seleccionable y se lee como "sin lugar"', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({
        '2026-08-20': { closed: true, available: 0 },
        '2026-08-21': { available: 0 },
      })),
    )
    const { store } = await render()

    expect(cell(20).disabled).toBe(true)
    expect(cell(21).disabled).toBe(true)
    expect(cell(20).textContent).toContain('Lleno')
    expect(cell(20).className).toContain('bg-slate-200')
    // Un día lleno tampoco muestra precio (se leería como "hay algo a ese precio y está roto").
    expect(cell(20).textContent).not.toMatch(/100/)
    expect(cell(22).disabled).toBe(false)

    // Y clickearlo no ensucia el store.
    cell(20).click()
    await flushPromises()
    expect(store.checkIn).toBe('')
  })

  it('cambiar la moneda re-pide los precios en la moneda elegida', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    const { store } = await render()
    expect(BookingService.getCalendar).toHaveBeenCalledTimes(1)
    expect(vi.mocked(BookingService.getCalendar).mock.calls[0]![1]).toMatchObject({ currency: undefined })

    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({ '2026-08-20': { fromPrice: 92 } }), 'EUR'),
    )
    await store.setCurrency('EUR')
    await flushPromises()

    expect(BookingService.getCalendar).toHaveBeenCalledTimes(2)
    expect(vi.mocked(BookingService.getCalendar).mock.calls[1]![1]).toMatchObject({ currency: 'EUR' })
  })

  it('cambiar la ocupación invalida lo cacheado y vuelve a pedir', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    const { store } = await render()
    expect(BookingService.getCalendar).toHaveBeenCalledTimes(1)

    store.children = 1
    await flushPromises()

    expect(BookingService.getCalendar).toHaveBeenCalledTimes(2)
    expect(vi.mocked(BookingService.getCalendar).mock.calls[1]![1]).toMatchObject({ guests: 3 })
  })

  it('seleccionar 18 → 21 escribe el store y cuenta 3 noches (no 4)', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    const { store } = await render()

    cell(18).click()
    await flushPromises()
    expect(store.checkIn).toBe('2026-08-18')
    expect(store.checkOut).toBe('')

    cell(21).click()
    await flushPromises()
    expect(store.checkIn).toBe('2026-08-18')
    expect(store.checkOut).toBe('2026-08-21')
    expect(wrapper!.text()).toContain('3 noches')
    // Total "desde" de la estadía: 3 noches × 100.
    expect(wrapper!.text()).toMatch(/desde\s*\$?\s*300/)
  })

  it('no deja armar un rango por arriba de una noche llena y lo explica', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({ '2026-08-19': { available: 0, closed: true } })),
    )
    const { store } = await render()

    cell(18).click()
    await flushPromises()
    cell(21).click()
    await flushPromises()

    expect(store.checkOut).toBe('')
    expect(wrapper!.text()).toContain('No hay disponibilidad la noche del')
  })

  it('DEGRADACIÓN: si el endpoint falla se puede elegir fechas igual, sin pantalla en blanco', async () => {
    vi.mocked(BookingService.getCalendar).mockRejectedValue(new Error('500'))
    const { store } = await render()

    expect(cells().length).toBe(31)
    expect(cell(20).disabled).toBe(false)
    expect(cell(10).disabled).toBe(true) // el pasado sigue bloqueado
    expect(wrapper!.text()).toContain('No pudimos cargar las tarifas')

    cell(20).click()
    await flushPromises()
    cell(23).click()
    await flushPromises()
    expect(store.checkIn).toBe('2026-08-20')
    expect(store.checkOut).toBe('2026-08-23')
  })

  it('sigue mostrando UN solo mes con navegación (#629: cabe en el iframe embebido)', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    await render()

    // 31 celdas = agosto entero, ni un día de septiembre.
    expect(cells().length).toBe(31)
    expect(wrapper!.text()).toContain('Agosto 2026')

    monthNavButton('Mes siguiente').click()
    await flushPromises()
    expect(wrapper!.text()).toContain('Septiembre 2026')
    expect(vi.mocked(BookingService.getCalendar).mock.calls[1]![1]).toMatchObject({
      from: '2026-09-01', to: '2026-09-30',
    })

    // Volver a agosto no dispara request nueva (ya está cacheado) y no deja ir al mes pasado.
    monthNavButton('Mes anterior').click()
    await flushPromises()
    expect(BookingService.getCalendar).toHaveBeenCalledTimes(2)
    expect(monthNavButton('Mes anterior').disabled).toBe(true)
  })

  it('deep-link con fechas de otro mes: abre en el mes de la llegada, no en el actual', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response([]))
    const { store } = await render()
    expect(wrapper!.text()).toContain('Agosto 2026')

    // El wrapper inicializa el store DESPUÉS de montar este hijo (deep-link `?checkIn=`).
    store.checkIn = '2026-10-05'
    store.checkOut = '2026-10-08'
    await flushPromises()

    expect(wrapper!.text()).toContain('Octubre 2026')
    expect(vi.mocked(BookingService.getCalendar).mock.calls.at(-1)![1]).toMatchObject({
      from: '2026-10-01', to: '2026-10-31',
    })
  })

  it('los textos salen del i18n del widget (es/en/pt), no hardcodeados', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({ '2026-08-20': { available: 0, closed: true } })),
    )
    await render()
    expect(cell(20).textContent).toContain('Lleno')

    useBookingI18nStore().setLocale('en')
    await flushPromises()
    expect(wrapper!.text()).toContain('August 2026')
    expect(cell(20).textContent).toContain('Sold out')

    useBookingI18nStore().setLocale('pt')
    await flushPromises()
    expect(wrapper!.text()).toContain('Agosto 2026')
    expect(cell(20).textContent).toContain('Lotado')
  })
})
