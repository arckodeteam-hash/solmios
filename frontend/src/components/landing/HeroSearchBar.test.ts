// HeroSearchBar.test.ts — El contrato de URL del buscador.
// `booking-widget.vue` lee `?checkIn&checkOut` para inicializar el wizard: si esta query cambia
// de forma, el deep-link desde la landing se rompe en silencio. Por eso se testea el submit
// end-to-end (calendario real), no los refs internos.
//
// Decisión de producto (2026-08-20): el buscador YA NO pide huéspedes (`OccupancySelector` se
// quitó de este componente) — cada tipo de habitación tiene su propio límite de capacidad, y la
// ocupación exacta se elige recién al ver los tipos disponibles. El submit solo manda fechas.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/services/Booking.service', () => ({ BookingService: { getCalendar: vi.fn() } }))

import HeroSearchBar from './HeroSearchBar.vue'
import { BookingService } from '@/services/Booking.service'
import { LANDING_BOOKING_KEY } from '@/composables/useLandingBooking'
import type { CalendarDay } from '@/types/booking'

const TODAY = new Date(2026, 7, 15, 10, 0, 0)

function agosto(): CalendarDay[] {
  const out: CalendarDay[] = []
  for (let d = 15; d <= 31; d++) {
    out.push({ date: `2026-08-${d}`, fromPrice: 100, available: 4, closed: false })
  }
  return out
}

function dialog(label: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${label}"]`)
  if (!el) throw new Error(`El panel "${label}" no está abierto`)
  return el
}

function dayCell(root: HTMLElement, day: number): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
    .find((c) => c.querySelector('span')?.textContent?.trim() === String(day))
  if (!found) throw new Error(`No existe la celda del día ${day}`)
  return found
}

let wrapper: VueWrapper | null = null

/** `openBooking` presente = el buscador vive DENTRO de la landing (provideLandingBooking). */
async function render(openBooking?: ReturnType<typeof vi.fn>) {
  wrapper = mount(HeroSearchBar, {
    props: { hotelSlug: 'hotel-demo', ctaText: 'Ver disponibilidad' },
    ...(openBooking ? { global: { provide: { [LANDING_BOOKING_KEY as symbol]: openBooking } } } : {}),
  })
  await flushPromises()
  return wrapper
}

/** Abre el calendario y elige un rango. Devuelve el wrapper para encadenar. */
async function pickDates(w: VueWrapper, from: number, to: number) {
  await w.findAllComponents({ name: 'RateCalendar' })[0]!.get('button').trigger('click')
  await flushPromises()
  const cal = dialog('Elegir fechas de la estadía')
  dayCell(cal, from).click()
  await flushPromises()
  dayCell(cal, to).click()
  await flushPromises()
}

describe('HeroSearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    document.body.innerHTML = ''
    push.mockReset()
    vi.mocked(BookingService.getCalendar).mockReset()
    vi.mocked(BookingService.getCalendar).mockResolvedValue({
      currency: 'USD', chargeCurrency: 'USD', from: '2026-08-15', to: '2026-08-31', guests: 2, days: agosto(),
    })
  })
  afterEach(() => { wrapper?.unmount(); wrapper = null; vi.useRealTimers() })

  it('preserva el contrato ?checkIn&checkOut que lee el widget (sin huéspedes)', async () => {
    const w = await render()
    await pickDates(w, 18, 21)

    await w.get('form').trigger('submit')
    expect(push).toHaveBeenCalledWith('/book/hotel-demo?checkIn=2026-08-18&checkOut=2026-08-21')
  })

  it('no renderiza ningún selector de huéspedes', async () => {
    const w = await render()
    expect(w.findAllComponents({ name: 'OccupancySelector' }).length).toBe(0)
    expect(w.text()).not.toContain('Huéspedes')
  })

  it('el calendario consulta con la ocupación mínima (1), no filtra tipos por capacidad', async () => {
    await render()
    const last = vi.mocked(BookingService.getCalendar).mock.calls.at(-1)!
    expect(last[1]).toMatchObject({ guests: 1 })
  })

  it('dentro de la landing abre el modal con el contexto ya cargado, sin navegar', async () => {
    // El huésped NO debe abandonar `/h/:slug` para reservar: el submit abre BookingModal encima
    // de la landing y `skipToRooms` evita que el motor le vuelva a pedir "Ver disponibilidad".
    // Sin adults/children/rooms: el store abre con su propio default (2026-08-20).
    const openBooking = vi.fn()
    const w = await render(openBooking)
    await pickDates(w, 18, 21)

    await w.get('form').trigger('submit')

    expect(push).not.toHaveBeenCalled()
    expect(openBooking).toHaveBeenCalledWith({
      checkIn: '2026-08-18',
      checkOut: '2026-08-21',
      skipToRooms: true,
    })
  })

  it('no navega sin fechas y lo dice', async () => {
    const w = await render()
    await w.get('form').trigger('submit')

    expect(push).not.toHaveBeenCalled()
    expect(w.text()).toContain('Elegí las fechas de llegada y salida.')
  })

  it('frena el submit si el rango viola la estadía mínima del día de entrada', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue({
      currency: 'USD', chargeCurrency: 'USD', from: '2026-08-15', to: '2026-08-31', guests: 2,
      days: agosto().map((d) => (d.date === '2026-08-18' ? { ...d, minStay: 3 } : d)),
    })
    const w = await render()
    await pickDates(w, 18, 19)

    await w.get('form').trigger('submit')
    expect(push).not.toHaveBeenCalled()
    expect(w.text()).toContain('Estadía mínima de 3 noches')
  })
})
