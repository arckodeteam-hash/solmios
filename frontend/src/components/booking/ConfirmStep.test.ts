// ConfirmStep.test.ts — #292 (revisión del PR #329): cuna pedida que la habitación asignada no
// ofrece. El step 5 del widget llega DESPUÉS del redirect de Stripe (la respuesta del POST ya no
// está), así que lee `cribUnavailable` de `GET /api/public/reservations/:id` y muestra el aviso.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', () => ({ useRoute: () => ({ query: { booking: 'r1', token: 'tok' } }) }))

const pollConfirmation = vi.fn()
vi.mock('@/composables/useBooking', () => ({
  useBookingStore: () => ({ slug: 'hotel-boutique-palma', chargeCurrency: 'USD', guest: { email: 'ana@example.com' }, pollConfirmation }),
  readStoredReservation: () => null,
  clearStoredReservation: () => {},
}))

import ConfirmStep from './ConfirmStep.vue'
import { useBookingI18nStore } from '@/composables/useBookingI18n'

const PAID = {
  reservation: { id: 'r1-aaaa-bbbb', checkIn: '2026-10-19', checkOut: '2026-10-21', status: 'confirmed', totalAmount: 200, currency: 'USD', totalBreakdown: null },
  guest: { name: 'Ana', email: 'ana@example.com' },
  paymentStatus: 'paid',
}

async function render(reservation: Record<string, unknown>, locale: 'es' | 'en' = 'es') {
  setActivePinia(createPinia())
  useBookingI18nStore().setLocale(locale)
  pollConfirmation.mockResolvedValue(reservation)
  const w = mount(ConfirmStep, { global: { stubs: { 'router-link': true, PriceBreakdownLines: true } } })
  await flushPromises()
  return w
}

beforeEach(() => { vi.clearAllMocks() })

describe('ConfirmStep — aviso de cuna no disponible (#292)', () => {
  it('cribUnavailable: true → aviso en la confirmación exitosa', async () => {
    const w = await render({ ...PAID, reservation: { ...PAID.reservation, cribUnavailable: true } })
    const notice = w.find('[data-testid="confirm-crib-unavailable"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toBe('La cuna no está disponible en la habitación asignada; el hotel se pondrá en contacto.')
    expect(w.text()).toContain('¡Reserva confirmada!')
  })

  it('en inglés se traduce', async () => {
    const w = await render({ ...PAID, reservation: { ...PAID.reservation, cribUnavailable: true } }, 'en')
    expect(w.find('[data-testid="confirm-crib-unavailable"]').text()).toBe('The crib is not available in the assigned room; the hotel will get in touch with you.')
  })

  it('sin la marca no aparece (ausente o false)', async () => {
    expect((await render(PAID)).find('[data-testid="confirm-crib-unavailable"]').exists()).toBe(false)
    expect((await render({ ...PAID, reservation: { ...PAID.reservation, cribUnavailable: false } })).find('[data-testid="confirm-crib-unavailable"]').exists()).toBe(false)
  })
})
