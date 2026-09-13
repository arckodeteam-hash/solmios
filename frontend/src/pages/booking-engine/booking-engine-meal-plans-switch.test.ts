// booking-engine-meal-plans-switch.test.ts — #361: el editor de regímenes se mudó a
// Configuración Base → Regímenes (ver `settings/settings-meal-plans.test.ts`). En Página pública
// → Motor de reservas queda SÓLO el switch "Mostrar regímenes en el motor de reservas"
// (`booking_config.showMealPlans`): carga desde getConfig y viaja en updateConfig al guardar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let showMealPlansFromApi = false
const updateConfig = vi.fn(async (v: unknown) => v)
const mealPlansList = vi.fn(async () => [])

vi.mock('@/services/BookingEngine.service', () => ({
  BookingEngineService: {
    getConfig: async () => ({
      id: 'be1', hotelId: 'h1', enabled: true, theme: 'navy', position: 'corner',
      currency: 'USD', language: 'es', minNights: 1, maxNights: 30,
      pendingTtlMinutes: 60, approvalDeadlineHours: 24, autoAssignBeforeArrivalHours: 0,
      cancellationPolicy: '', showComparison: false, showMealPlans: showMealPlansFromApi,
      googleAdsEnabled: false, whatsappConfirmation: false,
      instantConfirmation: false, stripeAccountId: '', allowedCountries: [],
    }),
    getAnalytics: async () => ({
      totalSearches: 0, totalBookings: 0, conversionRate: 0, totalRevenue: 0,
      averageBookingValue: 0, funnel: [],
    }),
    updateConfig: (v: unknown) => updateConfig(v),
  },
}))
vi.mock('@/services/MealPlans.service', () => ({
  MealPlansService: { list: () => mealPlansList(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: async () => null, set: async () => ({}) },
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
    },
  },
}

beforeEach(() => {
  showMealPlansFromApi = false
  updateConfig.mockClear()
  mealPlansList.mockClear()
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

const SWITCH = '#booking-engine-mostrar-regimenes'

describe('#361 — Página pública → Motor de reservas ya NO administra los regímenes', () => {
  it('no monta MealPlansEditor ni el bloque "Regímenes de alimentación"', async () => {
    const w = await mountBookingEngine()
    expect(w.text()).not.toContain('Regímenes de alimentación')
    expect(w.find('[data-testid=meal-plan-add]').exists()).toBe(false)
    expect(w.find('[data-testid=meal-plan-row]').exists()).toBe(false)
    expect(w.findComponent({ name: 'MealPlansEditor' }).exists()).toBe(false)
    // Ni siquiera pide el catálogo: eso es de Configuración Base.
    expect(mealPlansList).not.toHaveBeenCalled()
  })

  it('remite a Configuración Base → Regímenes desde el switch', async () => {
    const w = await mountBookingEngine()
    expect(w.text()).toContain('Mostrar regímenes en el motor de reservas')
    expect(w.text()).toContain('Configuración Base → Regímenes')
  })
})

describe('#361 — switch "Mostrar regímenes en el motor de reservas" (showMealPlans)', () => {
  it('por default (getConfig sin encender) el checkbox está apagado', async () => {
    const w = await mountBookingEngine()
    const input = w.find(SWITCH)
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).name).toBe('showMealPlans')
    expect((input.element as HTMLInputElement).checked).toBe(false)
  })

  it('carga showMealPlans=true desde getConfig → checked', async () => {
    showMealPlansFromApi = true
    const w = await mountBookingEngine()
    expect((w.find(SWITCH).element as HTMLInputElement).checked).toBe(true)
  })

  it('al encenderlo y guardar, updateConfig recibe showMealPlans: true', async () => {
    const w = await mountBookingEngine()
    await w.find(SWITCH).setValue(true)
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(updateConfig).toHaveBeenCalledTimes(1)
    expect(updateConfig.mock.calls[0][0]).toEqual(expect.objectContaining({ showMealPlans: true }))
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('al apagarlo (venía encendido) y guardar, updateConfig recibe showMealPlans: false', async () => {
    showMealPlansFromApi = true
    const w = await mountBookingEngine()
    await w.find(SWITCH).setValue(false)
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(updateConfig.mock.calls[0][0]).toEqual(expect.objectContaining({ showMealPlans: false }))
  })
})
