// RateCalendar.test.ts — Comportamiento del calendario de rango.
// Lo que se cubre acá (lo que no se ve en `utils/rate-calendar.test.ts`): que el componente
// pida el mes visible, NO pinte precio por día (distintos tipos de habitación cotizan
// distinto), bloquee el día sin lugar, cuente bien las noches al seleccionar, y — sobre todo —
// que SIGA sirviendo para elegir fechas si el endpoint falla.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

vi.mock('@/services/Booking.service', () => ({
  BookingService: { getCalendar: vi.fn() },
}))

import RateCalendar from './RateCalendar.vue'
import { BookingService } from '@/services/Booking.service'
import type { CalendarDay, PublicCalendarResponse } from '@/types/booking'

// Fecha fija: 15 de agosto de 2026 (sábado). Solo se fake-ea Date — los microtasks de Vue
// tienen que seguir corriendo de verdad.
const TODAY = new Date(2026, 7, 15, 10, 0, 0)

function response(days: CalendarDay[]): PublicCalendarResponse {
  return { currency: 'USD', chargeCurrency: 'USD', from: '2026-08-15', to: '2026-08-31', guests: 2, days }
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

function panel(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!el) throw new Error('El panel del calendario no está abierto')
  return el
}

/** Celdas de día: son las únicas con `aria-pressed` (los ‹ › y Listo no lo tienen). */
function cells(): HTMLButtonElement[] {
  return Array.from(panel().querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
}

function cell(dayNumber: number): HTMLButtonElement {
  const found = cells().find((c) => c.querySelector('span')?.textContent?.trim() === String(dayNumber))
  if (!found) throw new Error(`No existe la celda del día ${dayNumber}`)
  return found
}

let wrapper: VueWrapper | null = null

async function render(props: Partial<{ checkIn: string; checkOut: string; guests: number }> = {}) {
  wrapper = mount(RateCalendar, {
    props: { hotelSlug: 'hotel-demo', checkIn: '', checkOut: '', guests: 2, ...props },
  })
  await flushPromises()
  await wrapper.get('button').trigger('click')
  await flushPromises()
  return wrapper
}

describe('RateCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(TODAY)
    document.body.innerHTML = ''
    vi.mocked(BookingService.getCalendar).mockReset()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('pide SOLO el mes visible, recortado a partir de hoy (no 90 días de una)', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    await render()

    expect(BookingService.getCalendar).toHaveBeenCalledTimes(1)
    expect(BookingService.getCalendar).toHaveBeenCalledWith('hotel-demo', {
      from: '2026-08-15', to: '2026-08-31', guests: 2, currency: undefined,
    })
  })

  it('NO muestra precio por día: distintos tipos de habitación cotizan distinto', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({ '2026-08-20': { fromPrice: 175 } })),
    )
    await render()

    expect(cell(20).textContent).toContain('20')
    expect(cell(20).textContent).not.toMatch(/175/)
  })

  it('un día closed / available 0 NO es seleccionable y se lee como "sin lugar"', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({
        '2026-08-20': { closed: true, available: 0 },
        '2026-08-21': { available: 0 },
      })),
    )
    await render()

    expect(cell(20).disabled).toBe(true)
    expect(cell(21).disabled).toBe(true)
    // No es un gris de "deshabilitado por error": fondo sólido + "Lleno" + aria-label explícito.
    expect(cell(20).textContent).toContain('Lleno')
    expect(cell(20).className).toContain('bg-slate-200')
    expect(cell(20).getAttribute('aria-label')).toContain('sin disponibilidad')
    // Y un día con lugar sigue habilitado.
    expect(cell(22).disabled).toBe(false)
  })

  it('los días pasados no se pueden elegir', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    await render()

    expect(cell(10).disabled).toBe(true)
    expect(cell(15).disabled).toBe(false) // hoy sí
  })

  it('seleccionar 18 → 21 emite checkIn/checkOut y cuenta 3 noches', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    const w = await render()

    cell(18).click()
    await flushPromises()
    expect(w.emitted('update:checkIn')!.at(-1)).toEqual(['2026-08-18'])
    expect(w.emitted('update:checkOut')!.at(-1)).toEqual([''])

    cell(21).click()
    await flushPromises()
    expect(w.emitted('update:checkIn')!.at(-1)).toEqual(['2026-08-18'])
    expect(w.emitted('update:checkOut')!.at(-1)).toEqual(['2026-08-21'])

    // El resumen refleja las noches PAGADAS (18, 19 y 20), no las 4 celdas tocadas.
    await w.setProps({ checkIn: '2026-08-18', checkOut: '2026-08-21' })
    await flushPromises()
    expect(panel().textContent).toContain('3 noches')
    expect(panel().textContent).toMatch(/desde\s*\$?\s*300/)
  })

  it('no deja armar un rango por arriba de una noche llena y lo explica', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({ '2026-08-19': { available: 0, closed: true } })),
    )
    const w = await render()

    cell(18).click()
    await flushPromises()
    cell(21).click()
    await flushPromises()

    // No se confirmó la salida y el mensaje nombra la noche que falla.
    expect(w.emitted('update:checkOut')!.at(-1)).toEqual([''])
    expect(panel().textContent).toContain('No hay disponibilidad la noche del')
  })

  it('avisa la estadía mínima del día de entrada en vez de dejar reservar 1 noche', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto({ '2026-08-18': { minStay: 3 } })),
    )
    const w = await render({ checkIn: '2026-08-18', checkOut: '2026-08-19' })

    expect(panel().textContent).toContain('Estadía mínima de 3 noches')
    // Y el padre se entera para poder frenar el submit.
    expect(w.emitted('validity')!.at(-1)![0]).toMatchObject({ ok: false })
  })

  it('DEGRADACIÓN: si el endpoint falla se puede elegir fechas igual, sin pantalla en blanco', async () => {
    vi.mocked(BookingService.getCalendar).mockRejectedValue(new Error('500'))
    const w = await render()

    // La grilla existe y los días futuros siguen habilitados.
    expect(cells().length).toBe(31)
    expect(cell(20).disabled).toBe(false)
    expect(cell(10).disabled).toBe(true) // el pasado sigue bloqueado
    // Se avisa, pero no se bloquea nada.
    expect(panel().textContent).toContain('No pudimos cargar las tarifas')

    cell(20).click()
    await flushPromises()
    cell(23).click()
    await flushPromises()
    expect(w.emitted('update:checkIn')!.at(-1)).toEqual(['2026-08-20'])
    expect(w.emitted('update:checkOut')!.at(-1)).toEqual(['2026-08-23'])
  })

  it('hotel sin tarifas cargadas (todo en 0): avisa pero deja elegir', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(
      response(agosto().map((d) => ({ ...d, fromPrice: 0 }))),
    )
    await render()

    expect(panel().textContent).toContain('No pudimos cargar las tarifas')
    expect(cell(20).disabled).toBe(false)
    expect(cell(20).textContent).not.toMatch(/\$\s*0/)
  })

  it('cambiar la ocupación invalida los precios cacheados y vuelve a pedir', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    const w = await render()
    expect(BookingService.getCalendar).toHaveBeenCalledTimes(1)

    await w.setProps({ guests: 4 })
    await flushPromises()

    expect(BookingService.getCalendar).toHaveBeenCalledTimes(2)
    expect(vi.mocked(BookingService.getCalendar).mock.calls[1]![1]).toMatchObject({ guests: 4 })
  })

  it('al navegar de mes pide lo que falta, y no re-pide lo ya cargado', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    await render()
    expect(BookingService.getCalendar).toHaveBeenCalledTimes(1)

    const next = panel().querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!
    next.click()
    await flushPromises()
    expect(BookingService.getCalendar).toHaveBeenCalledTimes(2)
    expect(vi.mocked(BookingService.getCalendar).mock.calls[1]![1]).toMatchObject({
      from: '2026-09-01', to: '2026-09-30',
    })

    // Volver a agosto no dispara una request nueva (ya está cacheado).
    panel().querySelector<HTMLButtonElement>('button[aria-label="Mes anterior"]')!.click()
    await flushPromises()
    expect(BookingService.getCalendar).toHaveBeenCalledTimes(2)
  })

  it('el aviso de "sin tarifas" es POR MES: volver a un mes que sí cargó lo saca', async () => {
    vi.mocked(BookingService.getCalendar)
      .mockResolvedValueOnce(response(agosto()))          // agosto: con precios
      .mockRejectedValueOnce(new Error('500'))            // septiembre: falla
    await render()
    expect(panel().textContent).not.toContain('No pudimos cargar las tarifas')

    panel().querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!.click()
    await flushPromises()
    expect(panel().textContent).toContain('No pudimos cargar las tarifas')

    panel().querySelector<HTMLButtonElement>('button[aria-label="Mes anterior"]')!.click()
    await flushPromises()
    expect(panel().textContent).not.toContain('No pudimos cargar las tarifas')
  })

  it('no deja navegar a un mes ya pasado', async () => {
    vi.mocked(BookingService.getCalendar).mockResolvedValue(response(agosto()))
    await render()
    const prev = panel().querySelector<HTMLButtonElement>('button[aria-label="Mes anterior"]')!
    expect(prev.disabled).toBe(true)
  })
})
