// settings-children-room-types.test.ts — REQ-03 (#235): la "Política de niños" (Requerimiento 1,
// 2026-09-03) se retiró ENTERA de Configuración Base — mismo patrón que #291 (Catálogo de
// amenities) y #292 (toggle global de cuna): ya vivía duplicada campo por campo en Página pública
// → Motor de reservas (`pages/booking-engine/index.vue`), que es donde queda la única copia
// editable de acá en más. Cobertura del contenido en su nuevo/único lugar:
// `pages/booking-engine/booking-engine-child-max-free.test.ts`.
//
// El Requerimiento 2 (capacidad por tipo de habitación) se mudó con su pestaña a Habitaciones:
// ver `pages/rooms/rooms-type-capacity.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let roomsImpl: () => Promise<{ rooms: any[]; total: number }>
const configGet = vi.fn(async (_key: string) => null)
const configSet = vi.fn(async (_key: string, _value: unknown) => ({}))

vi.mock('@/services/Room.service', () => ({
  RoomService: { list: (...args: any[]) => roomsImpl() },
}))
vi.mock('@/services/Signup.service', () => ({
  SignupService: { publicPlans: async () => [], mySubscription: async () => ({ status: 'none', planId: '', trialEndsAt: null, currentPeriodEnd: null, allowed: true, reason: null, daysLeft: null, hasStripeCustomer: false }) },
}))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: { get: async () => ({ hotel: { id: 'h1', name: 'Hotel Test', country: 'República Dominicana' } }), patchHotel: async () => ({}) },
}))
vi.mock('@/services/Hotel.service', () => ({
  HotelService: { amenitiesCatalog: async () => ({}), amenitiesHotel: async () => ({ data: [] }), saveAmenitiesHotel: async () => ({}) },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: (key: string) => configGet(key), set: (key: string, value: unknown) => configSet(key, value) },
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
vi.mock('@/composables/useGoogleMaps', () => ({ loadGoogleMaps: async () => { throw new Error('sin key') } }))
const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ success: toastSuccess, error: toastError, info: () => {} }) }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', name: 'Tester' } }) }))

import Settings from './index.vue'

const MOUNT_OPTS = { global: { stubs: { RouterLink: true, PhoneInput: true } } }

beforeEach(() => {
  roomsImpl = async () => ({ rooms: [], total: 0 })
  configGet.mockClear()
  configSet.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
})

async function mountSettings() {
  const w = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  await flushPromises()
  return w
}

describe('REQ-03 (#235) — Configuración Base ya no tiene el tab "Niños"', () => {
  it('no queda ningún tab/botón "Niños" ni el heading "Política de niños"', async () => {
    const w = await mountSettings()
    const withNinos = w.findAll('button').filter((b) => b.text().trim() === 'Niños')
    expect(withNinos.map((b) => b.text()), 'no queda ningún tab/botón "Niños"').toEqual([])
    expect(w.text()).not.toContain('Política de niños')
    expect(w.text()).not.toContain('Aceptar niños')
    expect(w.text()).not.toContain('Cobro reducido para niños')
  })

  it('al montar, NUNCA se pide ni se guarda configuration(child_policy) desde acá', async () => {
    const w = await mountSettings()
    expect(configGet).not.toHaveBeenCalledWith('child_policy')
    // Guardar cualquier otro bloque de la pantalla (Hotel, el primero visible) tampoco debe
    // tocar la clave de política de niños — el guardado de acá no puede pisarla nunca más.
    const guardar = w.findAll('button').find((b) => b.text().trim() === 'Guardar')
    if (guardar) {
      await guardar.trigger('click')
      await flushPromises()
    }
    expect(configSet).not.toHaveBeenCalledWith('child_policy', expect.anything())
  })
})
