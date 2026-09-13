// booking-engine-meal-plans-toggle.test.ts — REQ "Mover la gestión completa de Regímenes a
// Página pública": el editor CRUD de regímenes vive ACÁ (mudado desde Configuración Base), junto
// al toggle `booking_config.showMealPlans`. Este archivo cubre el toggle en sí — se muestra,
// refleja la config cargada y viaja al guardar — con `MealPlansEditor` stubeado (su propio CRUD
// tiene test dedicado en `components/booking/MealPlansEditor.test.ts`, decoupled de esta página).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let showMealPlansFromApi: boolean | undefined
const updateConfig = vi.fn(async (v: unknown) => v)

vi.mock('@/services/BookingEngine.service', () => ({
  BookingEngineService: {
    getConfig: async () => ({
      id: 'be1', hotelId: 'h1', enabled: true, theme: 'navy', position: 'corner',
      currency: 'USD', language: 'es', minNights: 1, maxNights: 30,
      pendingTtlMinutes: 60, approvalDeadlineHours: 24, cancellationPolicy: '',
      showComparison: false, googleAdsEnabled: false, whatsappConfirmation: false,
      instantConfirmation: false, stripeAccountId: '', allowedCountries: [],
      ...(showMealPlansFromApi === undefined ? {} : { showMealPlans: showMealPlansFromApi }),
    }),
    getAnalytics: async () => ({
      totalSearches: 0, totalBookings: 0, conversionRate: 0, totalRevenue: 0,
      averageBookingValue: 0, funnel: [],
    }),
    updateConfig: (v: unknown) => updateConfig(v),
  },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: async () => null, set: async () => {} },
}))
vi.mock('@/services/http', () => ({ http: { get: async () => ({}) } }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', name: 'Tester' } }) }))
const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ success: toastSuccess, error: toastError, info: () => {} }) }))

import BookingEngine from './index.vue'

const MOUNT_OPTS = {
  global: {
    stubs: {
      RouterLink: true,
      CancellationPolicyEditor: true,
      MealPlansEditor: true,
    },
  },
}

beforeEach(() => {
  showMealPlansFromApi = undefined
  updateConfig.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
})

async function mountBookingEngine() {
  const w = mount(BookingEngine, MOUNT_OPTS)
  await flushPromises()
  await flushPromises()
  return w
}

function saveBtnOf(w: Awaited<ReturnType<typeof mountBookingEngine>>) {
  return w.findAll('button').find(b => b.text() === 'Guardar')!
}

function toggleOf(w: Awaited<ReturnType<typeof mountBookingEngine>>) {
  return w.find('#booking-engine-regimenes-mostrar')
}

describe('Página pública → Motor de reservas: toggle "Mostrar regímenes" + editor de regímenes', () => {
  it('la página monta el editor de regímenes junto al toggle (gestión completa acá)', async () => {
    const w = await mountBookingEngine()
    expect(w.findComponent({ name: 'MealPlansEditor' }).exists()).toBe(true)
  })

  it('muestra el checkbox con su etiqueta', async () => {
    const w = await mountBookingEngine()
    const input = toggleOf(w)
    expect(input.exists()).toBe(true)
    expect(input.attributes('type')).toBe('checkbox')
    expect(input.attributes('name')).toBe('showMealPlans')
    expect(w.text()).toContain('Mostrar regímenes en el motor de reservas')
  })

  it('con getConfig → showMealPlans:false el checkbox queda desmarcado', async () => {
    showMealPlansFromApi = false
    const w = await mountBookingEngine()
    expect((toggleOf(w).element as HTMLInputElement).checked).toBe(false)
  })

  it('con getConfig → showMealPlans:true el checkbox queda marcado', async () => {
    showMealPlansFromApi = true
    const w = await mountBookingEngine()
    expect((toggleOf(w).element as HTMLInputElement).checked).toBe(true)
  })

  it('marcarlo y guardar llama updateConfig con showMealPlans:true en el payload', async () => {
    showMealPlansFromApi = false
    const w = await mountBookingEngine()
    await toggleOf(w).setValue(true)
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ showMealPlans: true }))
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('desmarcarlo y guardar manda showMealPlans:false', async () => {
    showMealPlansFromApi = true
    const w = await mountBookingEngine()
    await toggleOf(w).setValue(false)
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ showMealPlans: false }))
  })
})
