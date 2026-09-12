// booking-engine-child-max-free.test.ts — REQ-03 (#235): "Máximo de niños que no consumen plaza
// por habitación" se mudó de Configuración Base a Página pública → Motor de reservas (mismo
// patrón que #291/#79 — ver `settings/settings-children-room-types.test.ts`, describe "el máximo
// de niños sin plaza ya NO vive en Configuración Base"). Este archivo cubre el campo en su
// destino: se muestra, carga, valida y guarda dentro de la misma `configuration('child_policy')`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let configGetImpl: (key: string) => Promise<unknown>
const configSet = vi.fn(async (_key: string, _value: unknown) => {})

vi.mock('@/services/BookingEngine.service', () => ({
  BookingEngineService: {
    getConfig: async () => ({
      id: 'be1', hotelId: 'h1', enabled: true, theme: 'navy', position: 'corner',
      currency: 'USD', language: 'es', minNights: 1, maxNights: 30,
      pendingTtlMinutes: 60, approvalDeadlineHours: 24, cancellationPolicy: '',
      showComparison: false, googleAdsEnabled: false, whatsappConfirmation: false,
      instantConfirmation: false, stripeAccountId: '', allowedCountries: [],
    }),
    getAnalytics: async () => ({
      totalSearches: 0, totalBookings: 0, conversionRate: 0, totalRevenue: 0,
      averageBookingValue: 0, funnel: [],
    }),
    updateConfig: async (v: unknown) => v,
  },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: (key: string) => configGetImpl(key), set: (key: string, value: unknown) => configSet(key, value) },
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
  configGetImpl = async () => null
  configSet.mockClear()
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

describe('REQ-03 (#235, mudado de Configuración Base) — máximo de niños sin plaza en Página pública → Motor de reservas', () => {
  it('por default el campo está vacío (sin límite): NO se precarga ningún número', async () => {
    const w = await mountBookingEngine()
    const input = w.find('#booking-engine-max-ninos-sin-plaza')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('')
    expect((input.element as HTMLInputElement).placeholder).toBe('Sin límite')
  })

  it('carga maxFreeChildrenPerRoom=2 desde ConfigService.get y lo muestra en el input', async () => {
    configGetImpl = async (key) => (key === 'child_policy' ? { acceptChildren: true, maxFreeChildrenPerRoom: 2 } : null)
    const w = await mountBookingEngine()
    expect((w.find('#booking-engine-max-ninos-sin-plaza').element as HTMLInputElement).value).toBe('2')
  })

  it('al guardar, ConfigService.set(child_policy) incluye maxFreeChildrenPerRoom', async () => {
    const w = await mountBookingEngine()
    await w.find('#booking-engine-max-ninos-sin-plaza').setValue('3')
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(configSet).toHaveBeenCalledWith('child_policy', expect.objectContaining({ maxFreeChildrenPerRoom: 3 }))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('0 es un valor válido y se guarda como 0, no como null', async () => {
    const w = await mountBookingEngine()
    await w.find('#booking-engine-max-ninos-sin-plaza').setValue('0')
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(configSet).toHaveBeenCalledWith('child_policy', expect.objectContaining({ maxFreeChildrenPerRoom: 0 }))
  })

  it('input vacío guarda maxFreeChildrenPerRoom: null (sin límite)', async () => {
    configGetImpl = async (key) => (key === 'child_policy' ? { acceptChildren: true, maxFreeChildrenPerRoom: 2 } : null)
    const w = await mountBookingEngine()
    await w.find('#booking-engine-max-ninos-sin-plaza').setValue('')
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(configSet).toHaveBeenCalledWith('child_policy', expect.objectContaining({ maxFreeChildrenPerRoom: null }))
  })

  it('un valor negativo bloquea el guardado con su propio error', async () => {
    const w = await mountBookingEngine()
    await w.find('#booking-engine-max-ninos-sin-plaza').setValue('-1')
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Debe ser un entero mayor o igual a 0')
    expect(configSet).not.toHaveBeenCalled()
  })

  it('un valor decimal bloquea el guardado', async () => {
    const w = await mountBookingEngine()
    await w.find('#booking-engine-max-ninos-sin-plaza').setValue('1.5')
    await saveBtnOf(w).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Debe ser un entero mayor o igual a 0')
    expect(configSet).not.toHaveBeenCalled()
  })
})
