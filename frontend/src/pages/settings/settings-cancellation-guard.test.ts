// settings-cancellation-guard.test.ts — #34/INT-3/INT-4: ejercita el WIRING REAL de los
// watchers de exclusividad ("cancelación gratuita" × "No Reembolsable") sobre el
// componente montado. El bug: `conditionsHydrated` se seteaba sincrónico pegado a la
// hidratación, pero los watchers son flush 'pre' (diferidos), así que cuando corrían el
// flag ya era true y un hotel legacy contradictorio se auto-flippeaba en la carga —
// mutación silenciosa de un dato persistido y aviso de conflicto inalcanzable.
//
// Estos tests montan la pantalla con un hotel legacy contradictorio y fijan el contrato:
// 1. la carga NO auto-resuelve (el dato llega intacto y el aviso se renderiza);
// 2. la interacción del usuario SÍ auto-resuelve (ambos watchers, en ambos sentidos).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

// ── Dependencias de la pantalla (mismo criterio de mock que settings-geocoding.test.ts) ──────
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
    // Hotel LEGACY contradictorio: freeCancellation=true + non_refundable persistidos
    // por una vía que no validaba (p.ej. POST /api/hoteles antes de COR-6).
    get: async () => ({
      hotel: {
        id: 'h1', name: 'Hotel Legacy', country: 'República Dominicana',
        freeCancellation: true, cancellationType: 'non_refundable',
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

import Settings from './index.vue'

const MOUNT_OPTS = { global: { stubs: { RouterLink: true, PhoneInput: true } } }

/** Monta la pantalla, espera la hidratación completa y entra a la pestaña Condiciones. */
async function mountOnConditionsTab(): Promise<VueWrapper> {
  const wrapper = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  const tab = wrapper.findAll('button').find((b) => b.text().trim() === 'Condiciones')
  expect(tab, 'la pestaña Condiciones tiene que existir').toBeTruthy()
  await tab!.trigger('click')
  await flushPromises()
  return wrapper
}

const radioChecked = (w: VueWrapper, key: string) =>
  (w.find(`input[type="radio"][data-field="cancellationType"][value="${key}"]`).element as HTMLInputElement).checked
const freeCancellationOn = (w: VueWrapper) =>
  (w.find('input[type="checkbox"][data-field="freeCancellation"]').element as HTMLInputElement).checked
const avisoConflicto = (w: VueWrapper) =>
  w.text().includes('incompatible con la cancelación gratuita')

beforeEach(() => { vi.clearAllMocks() })

describe('#34 — guard de hidratación de condiciones (wiring real de watchers)', () => {
  it('INT-3: la hidratación NO auto-resuelve el dato legacy contradictorio', async () => {
    const wrapper = await mountOnConditionsTab()

    // El dato llega de la DB TAL CUAL: ambos checkboxes/radios contradictorios activos.
    // Si el guard fuera inerte (flag seteado antes del flush de los watchers), acá ya
    // estaría "resuelto" (freeCancellation=false o type=flexible).
    expect(freeCancellationOn(wrapper)).toBe(true)
    expect(radioChecked(wrapper, 'non_refundable')).toBe(true)
  })

  it('COR-5: el aviso de conflicto es ALCANZABLE — se renderiza con el dato legacy', async () => {
    const wrapper = await mountOnConditionsTab()
    expect(avisoConflicto(wrapper)).toBe(true)
  })

  it('la interacción del usuario SÍ auto-resuelve: apagar el toggle con No Reembolsable activo', async () => {
    const wrapper = await mountOnConditionsTab()
    expect(avisoConflicto(wrapper)).toBe(true)

    // Usuario apaga "Cancelación gratuita": el conflicto se resuelve por decisión propia.
    const toggle = wrapper.find('input[type="checkbox"][data-field="freeCancellation"]')
    await toggle.setValue(false)
    await flushPromises()

    expect(freeCancellationOn(wrapper)).toBe(false)
    expect(radioChecked(wrapper, 'non_refundable')).toBe(true) // se mantiene: ya no choca
    expect(avisoConflicto(wrapper)).toBe(false)
  })

  it('re-activar el toggle con No Reembolsable activo vuelve a Flexible (el OTRO watcher)', async () => {
    const wrapper = await mountOnConditionsTab()

    // Salimos del conflicto a mano y volvemos a entrar: el watcher de freeCancellation
    // debe cambiar cancellationType a flexible (no puede quedar non_refundable + true).
    const toggle = wrapper.find('input[type="checkbox"][data-field="freeCancellation"]')
    await toggle.setValue(false)
    await flushPromises()
    await toggle.setValue(true)
    await flushPromises()

    expect(freeCancellationOn(wrapper)).toBe(true)
    expect(radioChecked(wrapper, 'flexible')).toBe(true)
    expect(radioChecked(wrapper, 'non_refundable')).toBe(false)
    expect(avisoConflicto(wrapper)).toBe(false)
  })

  it('elegir No Reembolsable con el toggle activo apaga el toggle (watcher de cancellationType)', async () => {
    const wrapper = await mountOnConditionsTab()

    // Partimos del estado contradictorio legacy; el usuario elige Flexible primero para
    // salir del conflicto y después vuelve a No Reembolsable: el toggle debe apagarse.
    const flexible = wrapper.find('input[type="radio"][data-field="cancellationType"][value="flexible"]')
    await flexible.setValue(true)
    await flushPromises()
    expect(avisoConflicto(wrapper)).toBe(false)

    const nonRefundable = wrapper.find('input[type="radio"][data-field="cancellationType"][value="non_refundable"]')
    await nonRefundable.setValue(true)
    await flushPromises()

    expect(radioChecked(wrapper, 'non_refundable')).toBe(true)
    expect(freeCancellationOn(wrapper)).toBe(false) // auto-resuelto por la interacción
    expect(avisoConflicto(wrapper)).toBe(false)
  })
})
