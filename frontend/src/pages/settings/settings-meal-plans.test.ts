// settings-meal-plans.test.ts — issue #360: los regímenes de alimentación pasan de catálogo fijo
// (3 códigos, Página pública → Motor de reservas) a catálogo ABIERTO por hotel administrado desde
// Configuración → pestaña "Regímenes" (MealPlansEditor como lista CRUD).
//
// Contratos de esta pantalla:
//   1. Existe la pestaña "Regímenes" en Configuración.
//   2. Con lista vacía se ve el estado vacío y el botón "+ Agregar régimen".
//   3. Completar el formulario y guardar llama MealPlansService.create con
//      {name, description, priceMode, price, active}.
//   4. Eliminar (con confirm) llama MealPlansService.remove(id).
//   5. Cambiar el checkbox activo llama MealPlansService.update(id, {active}).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

// `vi.mock(...)` se hoistea sobre estas líneas: los mocks se referencian desde arrows para que
// existan al momento de la llamada (mismo patrón que settings-amenities-removed.test.ts).
const mealPlanListMock = vi.fn(async (): Promise<unknown[]> => [])
const mealPlanCreateMock = vi.fn(async (_input: Record<string, unknown>) => ({}))
const mealPlanUpdateMock = vi.fn(async (_id: string, _input: Record<string, unknown>) => ({}))
const mealPlanRemoveMock = vi.fn(async (_id: string) => undefined)

vi.mock('@/services/MealPlans.service', () => ({
  MealPlansService: {
    list: () => mealPlanListMock(),
    create: (input: Record<string, unknown>) => mealPlanCreateMock(input),
    update: (id: string, input: Record<string, unknown>) => mealPlanUpdateMock(id, input),
    remove: (id: string) => mealPlanRemoveMock(id),
  },
}))

// ── Dependencias de la pantalla (mismo set de mocks que settings-amenities-removed.test.ts) ──
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {}, warning: () => {} }),
}))
vi.mock('@/composables/useGoogleMaps', () => ({
  loadGoogleMaps: async () => null,
  resetGoogleMapsLoader: () => {},
}))
vi.mock('@/services/Signup.service', () => ({
  SignupService: {
    publicPlans: async () => [],
    mySubscription: async () => ({
      status: 'active', trialEndsAt: null, currentPeriodEnd: null, planId: 'plan-x',
      allowed: true, reason: null, daysLeft: null, hasStripeCustomer: true,
    }),
  },
}))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: {
    get: async () => ({
      hotel: {
        id: 'h1', name: 'Hotel Test', country: 'República Dominicana',
        phone: '+18095551234', email: 'x@y.test', phone2: '+18295559876',
      },
    }),
    patchHotel: async () => ({}),
  },
}))
vi.mock('@/services/Hotel.service', () => ({
  HotelService: {
    amenitiesCatalog: async () => ({}),
    amenitiesHotel: async () => ({ data: [] }),
    saveAmenitiesHotel: async () => ({}),
  },
}))
vi.mock('@/services/Room.service', () => ({
  RoomService: { list: async () => ({ rooms: [], total: 0 }) },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: async () => null, set: async () => ({}) },
  EmergencyContactsService: { get: async () => null, invalidate: () => {} },
}))
vi.mock('@/services/Guarantee.service', () => ({
  GuaranteeService: { hasPin: async () => ({ hasPin: false }), setPin: async () => ({}) },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: () => {} }),
  onBeforeRouteLeave: () => {},
}))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', name: 'Tester' } }) }))
vi.mock('@/services/cancellationPolicies.service', () => ({
  CancellationPoliciesService: {
    list: async () => [],
    upsertBase: async () => ({}),
    upsertOverride: async () => ({}),
    remove: async () => ({}),
  },
}))
vi.mock('@/services/Channel.service', () => ({
  ChannelService: { status: async () => null },
}))

import Settings from './index.vue'

const MOUNT_OPTS = { global: { stubs: { RouterLink: true, PhoneInput: true } } }

// Se clona en cada mock (`{ ...ROW }`): el editor muta la fila en el toggle optimista.
const ROW = {
  id: 'mp-1', hotelId: 'h1', code: 'breakfast', name: 'Desayuno incluido',
  description: 'Buffet de 7 a 10', active: true, priceMode: 'per_person_per_night', price: 12,
  sortOrder: 1, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

/** Monta la pantalla y activa la pestaña "Regímenes". */
async function mountOnMealPlansTab(): Promise<VueWrapper> {
  const wrapper = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  await flushPromises()
  const tab = wrapper.findAll('button').find((b) => b.text().trim() === 'Regímenes')
  expect(tab, 'la pestaña Regímenes tiene que existir').toBeTruthy()
  await tab!.trigger('click')
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mealPlanListMock.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('#360 — Configuración → Regímenes (lista CRUD)', () => {
  it('la pestaña "Regímenes" existe en Configuración', async () => {
    const w = mount(Settings, MOUNT_OPTS)
    await flushPromises()
    await flushPromises()
    const tab = w.findAll('button').find((b) => b.text().trim() === 'Regímenes')
    expect(tab).toBeTruthy()
  })

  it('con lista vacía se ve el estado vacío y el botón "+ Agregar régimen"', async () => {
    const w = await mountOnMealPlansTab()
    expect(mealPlanListMock).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('Todavía no hay regímenes')
    const add = w.findAll('[data-testid="meal-plan-add"]')
    expect(add.length).toBeGreaterThan(0)
    expect(add[0]!.text()).toBe('+ Agregar régimen')
    expect(w.findAll('[data-testid="meal-plan-row"]')).toHaveLength(0)
    // Texto explicativo pedido por el requisito.
    expect(w.text()).toContain('Los regímenes que ofrece el hotel')
  })

  it('completar el formulario y guardar llama MealPlansService.create con el payload completo', async () => {
    const w = await mountOnMealPlansTab()
    await w.find('[data-testid="meal-plan-add"]').trigger('click')
    await flushPromises()

    const form = w.find('[data-testid="meal-plan-form"]')
    expect(form.exists()).toBe(true)

    await form.find('[data-testid="meal-plan-name"]').setValue('Media pensión')
    await form.find('[data-testid="meal-plan-mode-supplement"]').setValue(true)
    await flushPromises()
    await form.find('[data-testid="meal-plan-price"]').setValue(15)
    await flushPromises()

    await form.find('[data-testid="meal-plan-save"]').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(mealPlanCreateMock).toHaveBeenCalledTimes(1)
    expect(mealPlanCreateMock).toHaveBeenCalledWith({
      name: 'Media pensión',
      description: '',
      priceMode: 'per_person_per_night',
      price: 15,
      active: true,
    })
    // Tras crear se recarga la lista y el formulario se cierra.
    expect(mealPlanListMock).toHaveBeenCalledTimes(2)
    expect(w.find('[data-testid="meal-plan-form"]').exists()).toBe(false)
  })

  it('guardar con nombre vacío no llama a create', async () => {
    const w = await mountOnMealPlansTab()
    await w.find('[data-testid="meal-plan-add"]').trigger('click')
    await flushPromises()
    await w.find('[data-testid="meal-plan-save"]').trigger('submit')
    await flushPromises()
    expect(mealPlanCreateMock).not.toHaveBeenCalled()
    expect(w.find('[data-testid="meal-plan-form"]').text()).toContain('El nombre es obligatorio')
  })

  it('con una fila, muestra nombre/descripción/precio y eliminar (confirm → true) llama remove(id)', async () => {
    mealPlanListMock.mockResolvedValue([{ ...ROW }])
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    const w = await mountOnMealPlansTab()

    const rows = w.findAll('[data-testid="meal-plan-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('Desayuno incluido')
    expect(rows[0]!.text()).toContain('Buffet de 7 a 10')
    expect(rows[0]!.text()).toContain('+ $12 por persona/noche')

    await rows[0]!.find('[data-testid="meal-plan-delete"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(mealPlanRemoveMock).toHaveBeenCalledTimes(1)
    expect(mealPlanRemoveMock).toHaveBeenCalledWith('mp-1')
  })

  it('eliminar con confirm → false NO llama remove', async () => {
    mealPlanListMock.mockResolvedValue([{ ...ROW }])
    vi.stubGlobal('confirm', vi.fn(() => false))
    const w = await mountOnMealPlansTab()
    await w.find('[data-testid="meal-plan-delete"]').trigger('click')
    await flushPromises()
    expect(mealPlanRemoveMock).not.toHaveBeenCalled()
  })

  it('cambiar el checkbox activo llama update(id, {active:false})', async () => {
    mealPlanListMock.mockResolvedValue([{ ...ROW }])
    const w = await mountOnMealPlansTab()

    const active = w.find('[data-testid="meal-plan-active"]')
    expect((active.element as HTMLInputElement).checked).toBe(true)
    await active.setValue(false)
    await flushPromises()
    await flushPromises()

    expect(mealPlanUpdateMock).toHaveBeenCalledTimes(1)
    expect(mealPlanUpdateMock).toHaveBeenCalledWith('mp-1', { active: false })
  })

  it('Editar abre el formulario con los datos de la fila y guardar llama update(id, payload)', async () => {
    mealPlanListMock.mockResolvedValue([{ ...ROW }])
    const w = await mountOnMealPlansTab()
    await w.find('[data-testid="meal-plan-edit"]').trigger('click')
    await flushPromises()

    const form = w.find('[data-testid="meal-plan-form"]')
    expect(form.exists()).toBe(true)
    expect((form.find('[data-testid="meal-plan-name"]').element as HTMLInputElement).value).toBe('Desayuno incluido')

    await form.find('[data-testid="meal-plan-mode-included"]').setValue(true)
    await flushPromises()
    await form.find('[data-testid="meal-plan-save"]').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(mealPlanUpdateMock).toHaveBeenCalledWith('mp-1', {
      name: 'Desayuno incluido',
      description: 'Buffet de 7 a 10',
      priceMode: 'included',
      price: 0,
      active: true,
    })
    expect(mealPlanCreateMock).not.toHaveBeenCalled()
  })
})
