// settings-contact-moved.test.ts — issue #79: el contacto PÚBLICO (teléfono principal + email)
// se mudó de Configuración → Hotel a Página pública → General (general.vue, "Contacto público").
//
// Contratos de esta pantalla después de la mudanza (mismo criterio que 1.7/1.8 con
// tipo/estrellas/logo y dirección):
//   1. En Hotel ya no hay input de email ni PhoneInput para `phone`: queda sólo `phone2`
//      ("Teléfono 2") como contacto interno, que no se publica.
//   2. `saveAll` NO manda `phone` ni `email` en el PATCH de hoteles — los persiste Página pública
//      con su propio guardado; mandarlos desde acá pisaría ese guardado con lo cargado al abrir
//      Configuración. `phone2` sí viaja.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

// `vi.mock(...)` se hoistea sobre esta línea: el mock se referencia desde una arrow para que
// exista al momento de la llamada.
const patchHotelMock = vi.fn(async (_patch: Record<string, unknown>) => ({}))

// ── Dependencias de la pantalla (mismo set de mocks que settings-cancellation-guard.test.ts) ──
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
    patchHotel: (patch: Record<string, unknown>) => patchHotelMock(patch),
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

// PhoneInput stubeado: cada uso renderiza un `<phone-input-stub>` con su `modelValue`.
const MOUNT_OPTS = { global: { stubs: { RouterLink: true, PhoneInput: true } } }

/** Monta la pantalla en la pestaña Hotel (la inicial) con la hidratación completa. */
async function mountOnHotelTab(): Promise<VueWrapper> {
  const wrapper = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  patchHotelMock.mockClear()
})

describe('#79 — Configuración → Hotel ya no edita el contacto público', () => {
  it('no hay input de email ni PhoneInput para el teléfono principal; queda sólo Teléfono 2', async () => {
    const w = await mountOnHotelTab()

    expect(w.find('[data-field="email"]').exists(), 'el email se edita en Página pública → General').toBe(false)
    expect(w.text()).not.toContain('Teléfono principal')
    expect(w.text()).toContain('Teléfono 2')

    // Único PhoneInput de la pestaña: el de phone2, precargado con el valor del hotel.
    const phones = w.findAll('phone-input-stub')
    expect(phones.length).toBe(1)
    expect(phones[0]!.attributes('modelvalue')).toBe('+18295559876')
  })

  it('la card se presenta como contacto interno y apunta a Página pública para el público', async () => {
    const w = await mountOnHotelTab()
    expect(w.text()).toContain('Contacto interno')
    expect(w.text()).toContain('Página pública → General')
  })

  it('guardar NO manda phone ni email en el PATCH de hoteles — phone2 sí', async () => {
    const w = await mountOnHotelTab()
    const guardar = w.findAll('button').find((b) => b.text().trim() === 'Guardar')
    expect(guardar, 'el botón Guardar del header tiene que existir').toBeTruthy()
    await guardar!.trigger('click')
    await flushPromises()

    expect(patchHotelMock).toHaveBeenCalledTimes(1)
    const patch = patchHotelMock.mock.calls[0]![0]
    expect(patch).not.toHaveProperty('phone')
    expect(patch).not.toHaveProperty('email')
    expect(patch).toHaveProperty('phone2', '+18295559876')
    expect(patch).toHaveProperty('name', 'Hotel Test')
  })
})
