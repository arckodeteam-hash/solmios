// settings-amenities-removed.test.ts — issue #291 (REQ-02): el tab "Catálogo de amenities"
// (ex "Amenities de habitación") se retiró de Configuración Base. Era el remanente del mecanismo
// global que #290 reemplazó: las amenidades por habitación viven en Habitaciones (RoomAmenities)
// y las de nivel hotel en Página pública → General (misma tabla hotel_amenities).
//
// Contratos de esta pantalla después del retiro:
//   1. No queda ningún tab/botón con "amenit" ni el hint `amenities-config-hint`.
//   2. Al montar NO se llama a `HotelService.amenitiesCatalog` ni `amenitiesHotel`.
//   3. `saveAll` NO llama a `HotelService.saveAmenitiesHotel` — sólo `patchHotel`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

// `vi.mock(...)` se hoistea sobre estas líneas: los mocks se referencian desde arrows para que
// existan al momento de la llamada (mismo patrón que settings-contact-moved.test.ts).
const patchHotelMock = vi.fn(async (_patch: Record<string, unknown>) => ({}))
const amenitiesCatalogMock = vi.fn(async () => ({}))
const amenitiesHotelMock = vi.fn(async () => ({ data: [] }))
const saveAmenitiesHotelMock = vi.fn(async (_keys: string[]) => ({}))

// ── Dependencias de la pantalla (mismo set de mocks que settings-contact-moved.test.ts) ──
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
    amenitiesCatalog: () => amenitiesCatalogMock(),
    amenitiesHotel: () => amenitiesHotelMock(),
    saveAmenitiesHotel: (keys: string[]) => saveAmenitiesHotelMock(keys),
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
  amenitiesCatalogMock.mockClear()
  amenitiesHotelMock.mockClear()
  saveAmenitiesHotelMock.mockClear()
})

describe('#291 — Configuración Base ya no tiene el tab "Catálogo de amenities"', () => {
  it('ningún tab/botón menciona amenities y no existe el hint amenities-config-hint', async () => {
    const w = await mountOnHotelTab()

    const withAmenit = w.findAll('button').filter((b) => /amenit/i.test(b.text()))
    expect(withAmenit.map((b) => b.text()), 'no queda ningún tab/botón de amenities').toEqual([])
    expect(w.find('[data-testid="amenities-config-hint"]').exists()).toBe(false)
    expect(w.findAll('input[type="checkbox"]').some((c) => c.attributes('value') !== undefined && /amenit/i.test(c.html()))).toBe(false)
    expect(w.text()).not.toMatch(/amenit/i)
  })

  it('al montar NO se piden el catálogo ni las amenities del hotel', async () => {
    await mountOnHotelTab()
    expect(amenitiesCatalogMock).not.toHaveBeenCalled()
    expect(amenitiesHotelMock).not.toHaveBeenCalled()
  })

  it('Guardar en el tab Hotel NO llama a saveAmenitiesHotel — sólo patchHotel', async () => {
    const w = await mountOnHotelTab()
    const guardar = w.findAll('button').find((b) => b.text().trim() === 'Guardar')
    expect(guardar, 'el botón Guardar del header tiene que existir').toBeTruthy()
    await guardar!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(patchHotelMock).toHaveBeenCalledTimes(1)
    expect(saveAmenitiesHotelMock).not.toHaveBeenCalled()
  })
})
