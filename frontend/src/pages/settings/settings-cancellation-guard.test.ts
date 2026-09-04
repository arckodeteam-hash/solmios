// settings-cancellation-guard.test.ts — unificación de Condiciones (#34 follow-up).
//
// El radio group de 4 presets y sus watchers de exclusividad se ELIMINARON del tab: la
// política de cancelación real se edita con `CancellationPolicyEditor` (tiers con
// horas/penalidad/refundo, plantillas rápidas, excepciones por canal) que antes sólo vivía en
// Página pública → Motor de reservas. Los contratos nuevos de este tab:
//   1. El editor está MONTADO en Condiciones con el hotelId del usuario (una sola fuente de
//      verdad: la base guardada es la que aplica resolvePolicy — channel > base > preset).
//   2. El toggle "Cancelación gratuita" (hotels.freeCancellation) sigue presente y editable:
//      lo lee el motor público (public-hotel-info).
//   3. El preset viejo ya no se escribe desde acá: ni radios ni campo en el PATCH de hoteles.
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
    get: async () => ({ hotel: { id: 'h1', name: 'Hotel Test', country: 'República Dominicana' } }),
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

// ── Dependencias del EDITOR (montado real, services del borde mockeados) ─────────────────────
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
import CancellationPolicyEditor from '@/components/booking/CancellationPolicyEditor.vue'

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

beforeEach(() => { vi.clearAllMocks() })

describe('Condiciones — el editor de políticas es la fuente única', () => {
  it('el CancellationPolicyEditor está montado en el tab con el hotelId del usuario', async () => {
    const w = await mountOnConditionsTab()
    const editor = w.findComponent(CancellationPolicyEditor)
    expect(editor.exists(), 'el editor de tiers tiene que vivir en Condiciones').toBe(true)
    expect(editor.props('hotelId')).toBe('h1')
  })

  it('el editor muestra la estructura de tiers (plantillas + agregado de nivel)', async () => {
    const w = await mountOnConditionsTab()
    const text = w.findComponent(CancellationPolicyEditor).text()
    expect(text).toMatch(/plantilla/i)
    expect(text).toMatch(/\+?\s*nivel/i)
  })

  it('el toggle de cancelación gratuita sigue presente (lo lee el motor público)', async () => {
    const w = await mountOnConditionsTab()
    expect(w.find('input[type="checkbox"][data-field="freeCancellation"]').exists()).toBe(true)
  })

  it('el preset viejo ya no se edita acá: sin radios de cancellationType', async () => {
    const w = await mountOnConditionsTab()
    expect(w.find('input[type="radio"][data-field="cancellationType"]').exists()).toBe(false)
  })
})
