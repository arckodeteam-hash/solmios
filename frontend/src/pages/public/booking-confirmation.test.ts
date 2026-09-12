// booking-confirmation.test.ts — #241: la página pública que ve el huésped después de pagar.
//
// Qué se protege: la identidad del hotel sale de la API pública (logo solo si existe), el
// contacto muestra únicamente lo configurado (y desaparece sin nada), las fechas se leen en el
// idioma de la página, el nombre del huésped se normaliza SOLO para mostrar, el número de reserva
// se copia, y "Cancelar reserva" es un enlace discreto que pide confirmación antes de llamar a la API.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const route: { params: Record<string, string>; query: Record<string, string> } = {
  params: { slug: 'hotel-boutique-palma' },
  query: { booking: 'r1', token: 'tok' },
}
vi.mock('vue-router', () => ({ useRoute: () => route }))

const getBySlug = vi.fn()
vi.mock('@/services/PublicHotel.service', () => ({ PublicHotelService: { getBySlug: (...a: unknown[]) => getBySlug(...a) } }))

const getReservation = vi.fn()
vi.mock('@/services/Booking.service', () => ({ BookingService: { getReservation: (...a: unknown[]) => getReservation(...a) } }))

const cancelReservation = vi.fn()
vi.mock('@/composables/useBooking', () => ({
  readStoredReservation: () => null,
  clearStoredReservation: () => {},
  cancelReservation: (...a: unknown[]) => cancelReservation(...a),
}))
vi.mock('@/composables/useTracking', () => ({ useTracking: () => ({ track: vi.fn() }), initTracking: vi.fn() }))

import BookingConfirmation from './booking-confirmation.vue'
import { useBookingI18nStore } from '@/composables/useBookingI18n'

const HOTEL = {
  id: 'h1', slug: 'hotel-boutique-palma', name: 'Hotel Boutique Palma', currency: 'USD',
  logo: '/uploads/hotel-logos/palma.png',
  address: 'Calle Principal 123, Punta Cana', locality: 'Santo Domingo de Guzmán',
  municipality: 'Santo Domingo de Guzmán', province: 'Distrito Nacional',
  phone: '+1 809 555 0100', whatsapp: '+1 829 555 0101', whatsappUrl: 'https://wa.me/18295550101',
  email: 'reservas@palma.test', checkIn: '15:00', checkOut: '12:00',
}

const RESERVATION = {
  reservation: {
    id: '5108c56c-aaaa-4bbb-8ccc-000000000000', hotelId: 'h1', roomId: 'room1',
    checkIn: '2026-10-19', checkOut: '2026-10-21', status: 'confirmed', paymentStatus: 'paid',
    totalAmount: 200.6, amountPaid: 200.6, pendingAmount: 0, currency: 'USD',
  },
  guest: { name: 'LUIS BERNIEL Ortiz mOYA', email: 'elavatar255@gmail.com' },
  paymentStatus: 'paid',
}

let wrapper: VueWrapper | null = null

async function render(
  hotel: Record<string, unknown> | null = HOTEL,
  locale: 'es' | 'en' | 'pt' = 'es',
  reservation: Record<string, unknown> = RESERVATION,
) {
  setActivePinia(createPinia())
  useBookingI18nStore().setLocale(locale)
  if (hotel) getBySlug.mockResolvedValue(hotel)
  else getBySlug.mockRejectedValue(new Error('404'))
  getReservation.mockResolvedValue(reservation)
  wrapper = mount(BookingConfirmation, {
    global: { stubs: { 'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' }, Teleport: true } },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe('identidad del hotel en la cabecera', () => {
  it('muestra logo, nombre y dirección desde la API pública', async () => {
    const w = await render()
    const header = w.find('[data-testid="confirm-hotel-header"]')
    expect(header.find('h1').text()).toBe('Hotel Boutique Palma')
    const logo = w.find('[data-testid="confirm-hotel-logo"]')
    expect(logo.exists()).toBe(true)
    expect(logo.attributes('src')).toBe('/uploads/hotel-logos/palma.png')
    expect(logo.attributes('alt')).toBe('Hotel Boutique Palma')
    expect(w.find('[data-testid="confirm-hotel-address"]').text())
      .toBe('Calle Principal 123, Punta Cana, Santo Domingo de Guzmán, Distrito Nacional')
  })

  it('sin logo no dibuja <img>; sin dirección no dibuja el pin', async () => {
    const w = await render({ ...HOTEL, logo: null, address: null, locality: null, municipality: null, province: null })
    expect(w.find('[data-testid="confirm-hotel-logo"]').exists()).toBe(false)
    expect(w.find('[data-testid="confirm-hotel-address"]').exists()).toBe(false)
    expect(w.find('[data-testid="confirm-hotel-header"] h1').text()).toBe('Hotel Boutique Palma')
  })

  it('si la API del hotel falla, la confirmación se muestra igual con el título genérico', async () => {
    const w = await render(null)
    expect(w.find('[data-testid="confirm-success"]').exists()).toBe(true)
    expect(w.find('[data-testid="confirm-hotel-header"] h1').text()).toBe('Reservá tu estadía')
    expect(w.find('[data-testid="confirm-contact"]').exists()).toBe(false)
  })
})

describe('resumen de la estadía', () => {
  it('fechas legibles en español, noches y huésped con capitalización de título', async () => {
    const w = await render()
    expect(w.find('[data-testid="confirm-checkin"]').text()).toBe('Lunes, 19 de octubre de 2026')
    expect(w.find('[data-testid="confirm-checkout"]').text()).toBe('Miércoles, 21 de octubre de 2026')
    expect(w.find('[data-testid="confirm-nights"]').text()).toBe('2 noches')
    expect(w.find('[data-testid="confirm-guest"]').text()).toBe('Luis Berniel Ortiz Moya')
    // El YYYY-MM-DD crudo ya no aparece en ningún lado.
    expect(w.text()).not.toContain('2026-10-19')
  })

  it('en inglés las fechas cambian de idioma sin tocar el dato', async () => {
    const w = await render(HOTEL, 'en')
    expect(w.find('[data-testid="confirm-checkin"]').text()).toBe('Monday, October 19, 2026')
    expect(w.find('[data-testid="confirm-nights"]').text()).toBe('2 nights')
    expect(w.find('[data-testid="confirm-checkin-time"]').text()).toBe('Check-in from 15:00')
  })

  it('pago: total, pagado y estado en palabras', async () => {
    const w = await render()
    expect(w.find('[data-testid="confirm-paid"]').text()).toContain('200.60 USD')
    expect(w.find('[data-testid="confirm-pending"]').exists()).toBe(false)
    expect(w.find('[data-testid="confirm-payment-state"]').text()).toBe('Pago recibido — no queda nada por pagar.')
  })

  it('"Qué sigue" usa los horarios del hotel; sin horario válido, la línea no aparece', async () => {
    const w = await render()
    expect(w.find('[data-testid="confirm-checkin-time"]').text()).toBe('Check-in a partir de las 15:00')
    expect(w.find('[data-testid="confirm-checkout-time"]').text()).toBe('Check-out hasta las 12:00')

    const w2 = await render({ ...HOTEL, checkIn: '', checkOut: 'tarde' })
    expect(w2.find('[data-testid="confirm-checkin-time"]').exists()).toBe(false)
    expect(w2.find('[data-testid="confirm-checkout-time"]').exists()).toBe(false)
  })
})

describe('número de reserva copiable', () => {
  it('muestra los 8 primeros del id y copia exactamente eso', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = await render()
    expect(w.find('[data-testid="confirm-code-value"]').text()).toBe('5108c56c')
    const btn = w.find('[data-testid="confirm-copy"]')
    expect(btn.attributes('aria-label')).toBe('Copiar número de reserva')
    expect(btn.text()).toBe('Copiar')
    await btn.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('5108c56c')
    expect(btn.text()).toBe('Copiado')
  })

  it('si copiar falla, no miente "Copiado"', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    const execCommand = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    const w = await render()
    await w.find('[data-testid="confirm-copy"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="confirm-copy"]').text()).toBe('Copiar')
  })
})

describe('contacto del hotel', () => {
  it('teléfono, WhatsApp y email con sus esquemas, solo los configurados', async () => {
    const w = await render()
    const phone = w.find('[data-testid="confirm-contact-phone"]')
    expect(phone.attributes('href')).toBe('tel:+18095550100')
    expect(phone.attributes('title')).toBe('+1 809 555 0100')
    const wa = w.find('[data-testid="confirm-contact-whatsapp"]')
    expect(wa.attributes('href')).toBe('https://wa.me/18295550101')
    expect(wa.attributes('target')).toBe('_blank')
    expect(wa.attributes('rel')).toBe('noopener noreferrer')
    expect(w.find('[data-testid="confirm-contact-email"]').attributes('href')).toBe('mailto:reservas@palma.test')
    // Íconos SVG inline, sin emoji.
    expect(w.find('[data-testid="confirm-contact"]').findAll('svg').length).toBe(3)
  })

  it('solo teléfono → un botón; sin WhatsApp normalizable no hay botón aunque haya número crudo', async () => {
    const w = await render({ ...HOTEL, whatsapp: '809', whatsappUrl: null, email: '' })
    expect(w.find('[data-testid="confirm-contact-phone"]').exists()).toBe(true)
    expect(w.find('[data-testid="confirm-contact-whatsapp"]').exists()).toBe(false)
    expect(w.find('[data-testid="confirm-contact-email"]').exists()).toBe(false)
  })

  it('sin ningún medio configurado, la tarjeta de contacto no existe', async () => {
    const w = await render({ ...HOTEL, phone: null, whatsapp: null, whatsappUrl: null, email: null })
    expect(w.find('[data-testid="confirm-contact"]').exists()).toBe(false)
    // Y la confirmación sigue completa.
    expect(w.find('[data-testid="confirm-stay"]').exists()).toBe(true)
    expect(w.find('[data-testid="confirm-back"]').exists()).toBe(true)
  })
})

describe('acciones', () => {
  it('"Volver al hotel" es el CTA principal y "Cancelar" un enlace discreto que pide confirmación', async () => {
    const w = await render()
    const back = w.find('[data-testid="confirm-back"]')
    expect(back.attributes('href')).toBe('/h/hotel-boutique-palma')
    expect(back.classes()).toContain('bg-cyan')
    const cancel = w.find('[data-testid="confirm-cancel-link"]')
    expect(cancel.text()).toBe('¿Necesitás cancelar esta reserva?')
    expect(cancel.classes()).not.toContain('text-danger')
    expect(cancel.classes()).toContain('underline')
    // Sin clic no se llama a la API.
    await cancel.trigger('click')
    expect(cancelReservation).not.toHaveBeenCalled()
  })

  it('confirmar en el modal cancela y muestra el estado cancelado', async () => {
    cancelReservation.mockResolvedValue({ reservationId: 'r1', status: 'cancelled', refundAmount: 200.6, cancellationFee: 0, policyApplied: null })
    const w = await render()
    await w.find('[data-testid="confirm-cancel-link"]').trigger('click')
    await flushPromises()
    await w.find('[data-testid="confirm-cancel-yes"]').trigger('click')
    await flushPromises()
    expect(cancelReservation).toHaveBeenCalledWith('r1', 'tok')
    expect(w.find('[data-testid="confirm-cancelled"]').exists()).toBe(true)
    expect(w.find('[data-testid="confirm-cancelled"]').text()).toContain('200.60 USD')
  })

  it('no queda ningún emoji como ícono', async () => {
    const w = await render()
    expect(w.text()).not.toMatch(/[✅❌⏳⚠️]/u)
  })
})

// #266 (MR-01) — el cron / checkout.session.expired cancelan la reserva `pending` sin pago con
// cancellationReason='payment_timeout'. Al huésped se le dice que venció y se le ofrece reservar
// de nuevo; cualquier otra cancelación sigue siendo el error genérico de pago.
describe('reserva vencida por falta de pago (#266)', () => {
  const EXPIRED = {
    ...RESERVATION,
    reservation: {
      ...RESERVATION.reservation, status: 'cancelled', paymentStatus: 'unpaid',
      cancellationReason: 'payment_timeout', amountPaid: 0, pendingAmount: 200.6,
    },
    paymentStatus: 'unpaid',
  }

  it('cancelled + payment_timeout → bloque "venció" con texto y CTA a volver a reservar, sin error genérico', async () => {
    const w = await render(HOTEL, 'es', EXPIRED)
    const block = w.find('[data-testid="booking-expired"]')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('Tu reserva venció porque no se completó el pago')
    expect(block.text()).toContain('La habitación volvió a estar disponible. Podés hacer una nueva reserva.')
    const cta = w.find('[data-testid="booking-expired-cta"]')
    expect(cta.exists()).toBe(true)
    expect(cta.text()).toBe('Volver a reservar')
    expect(cta.attributes('href')).toBe('/book/hotel-boutique-palma')
    expect(w.text()).not.toContain('No pudimos confirmar')
    expect(w.text()).not.toContain('El pago fue rechazado o cancelado')
    expect(w.find('[data-testid="confirm-success"]').exists()).toBe(false)
  })

  it('en inglés el bloque se traduce', async () => {
    const w = await render(HOTEL, 'en', EXPIRED)
    expect(w.find('[data-testid="booking-expired"]').text()).toContain('Your booking expired because the payment was not completed')
    expect(w.find('[data-testid="booking-expired-cta"]').text()).toBe('Book again')
  })

  it('cancelled sin motivo de vencimiento → error genérico como antes', async () => {
    const w = await render(HOTEL, 'es', {
      ...EXPIRED,
      reservation: { ...EXPIRED.reservation, cancellationReason: null },
    })
    expect(w.find('[data-testid="booking-expired"]').exists()).toBe(false)
    expect(w.text()).toContain('No pudimos confirmar')
    expect(w.text()).toContain('El pago fue rechazado o cancelado')
  })

  it('cancelled por otro motivo (p. ej. el huésped) → error genérico, no "venció"', async () => {
    const w = await render(HOTEL, 'es', {
      ...EXPIRED,
      reservation: { ...EXPIRED.reservation, cancellationReason: 'guest_request' },
    })
    expect(w.find('[data-testid="booking-expired"]').exists()).toBe(false)
    expect(w.text()).toContain('No pudimos confirmar')
  })
})

// `messages` no se exporta del composable: se verifica sobre el fuente que cada clave nueva
// exista en es/en/pt (mismo criterio que booking-confirmation-payment.test.ts).
import i18nSrc from '@/composables/useBookingI18n.ts?raw'
import pageSrc from './booking-confirmation.vue?raw'

describe('textos nuevos en los 3 idiomas y sin strings sueltos', () => {
  const KEYS = [
    'confirm.bookingNumber', 'confirm.copy', 'confirm.copied', 'confirm.copyAria', 'confirm.stayTitle',
    'confirm.nights', 'confirm.paymentTitle', 'confirm.nextTitle', 'confirm.checkInFrom',
    'confirm.checkOutUntil', 'confirm.nextArrive', 'confirm.contactTitle', 'confirm.contactBody',
    'confirm.call', 'confirm.whatsapp', 'confirm.emailAction', 'confirm.cancelLink', 'confirm.cancelTitle',
    'confirm.cancelBody', 'confirm.cancelKeep', 'confirm.cancelYes', 'confirm.cancelling',
    'confirm.cancelErrorIds', 'confirm.cancelErrorDefault', 'confirm.cancelledTitle', 'confirm.cancelledBody',
    'confirm.refund', 'confirm.cancellationFee', 'confirm.noRefund', 'confirm.alreadyCancelled',
    'confirm.backToStart', 'confirm.walletTitle',
    'confirm.expiredTitle', 'confirm.expiredBody', 'confirm.expiredCta',
  ]
  it.each(KEYS)('%s está en es/en/pt', (key) => {
    expect(i18nSrc.split(`'${key}':`).length - 1).toBe(3)
  })

  it('la cancelación ya no tiene textos en español pegados en el template', () => {
    expect(pageSrc).not.toContain('¿Seguro que querés cancelar')
    expect(pageSrc).not.toContain('>Cancelar reserva<')
    expect(pageSrc).not.toContain('No, mantener')
  })
})
