// booking-widget.test.ts — Deep-link de la landing hacia el widget embebible.
//
// Bug que se protege: el buscador de la landing genera `/book/:slug?checkIn&checkOut&guests&rooms
// &children` (HeroSearchBar.vue), pero `readInitParams` NO leía `children`. El huésped declaraba
// niños en la landing, tocaba "Ver disponibilidad" y llegaba al motor con 0 niños: la ocupación
// física quedaba por debajo de la real y el precio se movía entre una pantalla y la otra.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// Ruta mutable: cada test escribe su query antes de montar.
const route: { params: Record<string, string>; query: Record<string, string> } = {
  params: { slug: 'hotel-demo' },
  query: {},
}

vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/services/PublicHotel.service', () => ({
  PublicHotelService: { getBySlug: vi.fn().mockResolvedValue({ id: 'h1', name: 'Hotel Demo', logo: null }) },
}))
vi.mock('@/composables/useTracking', () => ({
  useTracking: () => ({ track: vi.fn() }),
  initTracking: vi.fn(),
}))
// El step 0 real monta el calendario y sale a la red: acá solo importa el parseo de la URL.
vi.mock('@/components/booking/SearchStep.vue', () => ({
  default: { name: 'SearchStep', template: '<div data-test="search-step" />' },
}))
vi.mock('@/services/Booking.service', () => ({
  BookingService: { getRates: vi.fn(), getCalendar: vi.fn() },
}))

import BookingWidget from './booking-widget.vue'
import { useBookingStore } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import { PublicHotelService } from '@/services/PublicHotel.service'

let wrapper: VueWrapper | null = null

async function render(query: Record<string, string>) {
  route.query = query
  wrapper = mount(BookingWidget)
  await flushPromises()
  return useBookingStore()
}

describe('booking-widget — parámetros del deep-link', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // El probe de geo-IP (Cloudflare Trace) no existe en tests: que falle es el camino normal
    // en dev y no debe romper el montaje.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin cloudflare')))
    wrapper?.unmount()
    wrapper = null
  })

  it('lee `?children` de la URL y lo suma a la ocupación física, sin tocar los adultos', async () => {
    const store = await render({
      checkIn: '2026-08-18', checkOut: '2026-08-21', guests: '2', children: '3', rooms: '1',
    })

    expect(store.checkIn).toBe('2026-08-18')
    expect(store.checkOut).toBe('2026-08-21')
    expect(store.guests).toBe(2) // adultos
    expect(store.children).toBe(3)
    expect(store.physicalGuests).toBe(5)
    expect(store.rooms).toBe(1)
  })

  it('sin `?children` en la URL el default sigue siendo 0 (link viejo intacto)', async () => {
    const store = await render({ checkIn: '2026-08-18', checkOut: '2026-08-21', guests: '2' })

    expect(store.children).toBe(0)
    expect(store.physicalGuests).toBe(2)
  })

  it('un `?children` basura no rompe el widget', async () => {
    const store = await render({ guests: '2', children: 'muchos' })

    expect(store.children).toBe(0)
    expect(store.physicalGuests).toBe(2)
  })
})

// Tarea 3.4 (corrección 2026-08-25) — defaults de `booking_config` (Idioma/Moneda de
// "Configuración del Widget"). El hallazgo real que motivó esta tarea: estos 2 campos se
// guardaban en el panel pero nada los leía. Acá se prueba que SÍ se aplican, y que NUNCA
// pisan una elección que el huésped ya hizo (sessionStorage / currencyPreference).
describe('booking-widget — defaults de booking_config (Tarea 3.4)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin cloudflare')))
    try { sessionStorage.clear() } catch { /* jsdom siempre lo tiene */ }
    wrapper?.unmount()
    wrapper = null
  })

  it('aplica widgetDefaultLanguage/widgetDefaultCurrency cuando el huésped no eligió nada', async () => {
    // jsdom trae `navigator.language` = 'en-US' por default — si no lo pisamos, `i18n.locale`
    // daría 'en' IGUAL por la tier 2 de detectBookingLocale (navigator.language), sin que el
    // fix de esta tarea tenga nada que ver. Se fuerza a 'de' (no soportado, cae a 'es') para
    // que 'en' acá SOLO pueda venir de widgetDefaultLanguage.
    vi.stubGlobal('navigator', { language: 'de-DE' })
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValueOnce({
      id: 'h1', name: 'Hotel Demo', logo: null,
      widgetDefaultLanguage: 'en', widgetDefaultCurrency: 'EUR',
    } as any)
    const store = await render({})
    const i18n = useBookingI18nStore()

    expect(i18n.locale).toBe('en')
    expect(store.currencyPreference).toBe('EUR')
  })

  it('NO pisa un idioma que el huésped ya eligió esta sesión (sessionStorage)', async () => {
    sessionStorage.setItem('booking-widget:locale', 'pt')
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValueOnce({
      id: 'h1', name: 'Hotel Demo', logo: null,
      widgetDefaultLanguage: 'en', widgetDefaultCurrency: null,
    } as any)
    await render({})
    const i18n = useBookingI18nStore()

    expect(i18n.locale).toBe('pt')
  })

  it('sin defaults cargados (hotel viejo / sin booking_config) no rompe y no cambia nada', async () => {
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValueOnce({ id: 'h1', name: 'Hotel Demo', logo: null } as any)
    const store = await render({})

    expect(store.currencyPreference).toBe('')
  })
})

// Tarea 3.4 (corrección 2026-08-25) — "Tema del Widget", alcance real: solo el color de acento
// (botones/CTA vía --color-cyan), nunca fondo/texto. Ver ACCENT_PRESETS en booking-widget.vue.
describe('booking-widget — color de acento (widgetAccentPreset, Tarea 3.4)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin cloudflare')))
    wrapper?.unmount()
    wrapper = null
  })

  it('preset conocido (gold) pisa --color-cyan/--color-cyan-light en el root', async () => {
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValueOnce({
      id: 'h1', name: 'Hotel Demo', logo: null, widgetAccentPreset: 'gold',
    } as any)
    await render({})

    const style = wrapper!.find('div.min-h-screen').attributes('style') || ''
    expect(style).toContain('--color-cyan: #B7950B')
    expect(style).toContain('--color-cyan-light: #D4AC0D')
  })

  it('preset desconocido (fila vieja "white"/"dark") no rompe y no aplica ningún override', async () => {
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValueOnce({
      id: 'h1', name: 'Hotel Demo', logo: null, widgetAccentPreset: 'white',
    } as any)
    await render({})

    const style = wrapper!.find('div.min-h-screen').attributes('style') || ''
    expect(style).not.toContain('--color-cyan')
  })

  it('sin widgetAccentPreset (hotel sin config) no aplica override', async () => {
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValueOnce({ id: 'h1', name: 'Hotel Demo', logo: null } as any)
    await render({})

    const style = wrapper!.find('div.min-h-screen').attributes('style') || ''
    expect(style).not.toContain('--color-cyan')
  })
})
