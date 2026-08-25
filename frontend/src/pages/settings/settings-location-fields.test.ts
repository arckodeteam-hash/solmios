// settings-location-fields.test.ts — unificación UX de /panel/config: País y Dirección
// duplicaban conceptos contra Provincia/Municipio/Localidad/CP. Se mudaron de la pestaña
// Hotel ("Datos del hotel") a la pestaña Ubicación, arriba del mapa.
//
// Este test fija la reubicación: los dos campos renderizan en Ubicación (mismos
// data-field / v-model / validaciones) y NO aparecen en la pestaña Hotel, que queda
// solo con identidad (Nombre, Tipo, Clasificación).
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

vi.mock('@/composables/useGoogleMaps', () => ({ loadGoogleMaps: async () => null }))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {}, warning: () => {} }),
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
        address: 'Calle El Conde 1',
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

async function mountSettings() {
  const wrapper = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  return wrapper
}

/** El input del SearchSelect de país: es el único combobox cuyo value es el país cargado. */
function countryCombobox(wrapper: VueWrapper) {
  return wrapper
    .findAll('input[role="combobox"]')
    .find((i) => (i.element as HTMLInputElement).value === 'República Dominicana')
}

describe('País y Dirección viven en la pestaña Ubicación', () => {
  it('la pestaña Hotel (Datos del hotel) ya no los muestra', async () => {
    const wrapper = await mountSettings()

    expect(wrapper.find('[data-field="address"]').exists(), 'Dirección no debe renderizar en Hotel').toBe(false)
    expect(wrapper.text(), 'la pestaña Hotel no debe tener el label País').not.toContain('País *')
    expect(countryCombobox(wrapper), 'el selector de país no debe estar en Hotel').toBeUndefined()
    // Lo que sí queda es identidad.
    expect(wrapper.find('[data-field="name"]').exists()).toBe(true)
  })

  it('la pestaña Ubicación los muestra encima del mapa, junto a los campos geográficos', async () => {
    const wrapper = await mountSettings()
    const tab = wrapper.findAll('button').find((b) => b.text().trim() === 'Ubicación')
    expect(tab, 'la pestaña Ubicación tiene que existir').toBeTruthy()
    await tab!.trigger('click')
    await flushPromises()

    // Dirección: mismo data-field/validaciones que antes del move.
    const address = wrapper.find('[data-field="address"]')
    expect(address.exists(), 'Dirección debe renderizar en Ubicación').toBe(true)
    expect((address.element as HTMLInputElement).value).toBe('Calle El Conde 1')
    // País (SearchSelect) y el resto del bloque geográfico intacto.
    expect(countryCombobox(wrapper), 'el selector de país debe estar en Ubicación').toBeTruthy()
    expect(wrapper.text()).toContain('País *')
    for (const f of ['latitude', 'longitude', 'province', 'municipality', 'locality', 'postalCode']) {
      expect(wrapper.find(`[data-field="${f}"]`).exists(), `${f} sigue en Ubicación`).toBe(true)
    }
  })
})
