// settings-plan-pin.test.ts — dos issues de la pantalla de Configuración.
//
// GH-32: el PIN de tarjeta de garantía aparecía escrito sin que nadie lo tipeara. El input es
// `type="password"` sin `autocomplete`, así que Chrome lo trataba como campo de login y le metía
// una credencial guardada. `guaranteePinDraft` arranca en '' — el valor no venía de la app.
//
// GH-31: la tarjeta "Plan" mostraba el literal 'Professional' y un precio de una tabla
// hardcodeada ($199/$99/$49) sin mirar la suscripción contratada.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { PublicPlan, MySubscription } from '@/services/Signup.service'

let publicPlansImpl: () => Promise<PublicPlan[]>
let mySubscriptionImpl: () => Promise<MySubscription>
let hotelPlanColumn: string | undefined
let amenitiesCatalogImpl: () => Promise<unknown>

vi.mock('@/services/Signup.service', () => ({
  SignupService: {
    publicPlans: () => publicPlansImpl(),
    mySubscription: () => mySubscriptionImpl(),
  },
}))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: {
    get: async () => ({ hotel: { id: 'h1', name: 'Hotel Test', country: 'República Dominicana', plan: hotelPlanColumn } }),
    patchHotel: async () => ({}),
  },
}))
vi.mock('@/services/Hotel.service', () => ({
  HotelService: {
    amenitiesCatalog: () => amenitiesCatalogImpl(),
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
vi.mock('@/composables/useGoogleMaps', () => ({ loadGoogleMaps: async () => { throw new Error('sin key') } }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }) }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', name: 'Tester' } }) }))

import Settings from './index.vue'

const MOUNT_OPTS = { global: { stubs: { RouterLink: true, PhoneInput: true } } }

const sub = (over: Partial<MySubscription> = {}): MySubscription => ({
  status: 'active', trialEndsAt: null, currentPeriodEnd: null, planId: 'plan-essential',
  allowed: true, reason: null, daysLeft: null, hasStripeCustomer: true, ...over,
})
const plan = (over: Partial<PublicPlan>): PublicPlan => ({
  id: 'plan-x', name: 'X', slug: 'x', price: 0, currency: 'USD', description: '', features: [], ...over,
})

const PLANS = [
  plan({ id: 'plan-essential', name: 'Essential', slug: 'essential', price: 49 }),
  plan({ id: 'plan-professional', name: 'Professional', slug: 'professional', price: 99 }),
]

beforeEach(() => {
  hotelPlanColumn = undefined
  amenitiesCatalogImpl = async () => ({})
  publicPlansImpl = async () => PLANS
  mySubscriptionImpl = async () => sub()
})

async function mountSettings() {
  const w = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  await flushPromises()
  return w
}

describe('GH-32 — el PIN de garantía no se autocompleta solo', () => {
  it('el input declara un secreto nuevo, no una credencial guardada', async () => {
    const w = await mountSettings()
    const pin = w.find('[data-testid="guarantee-pin"]')
    expect(pin.exists()).toBe(true)
    expect(pin.attributes('type')).toBe('password')
    expect(pin.attributes('autocomplete')).toBe('new-password')
  })

  it('ningún campo password del panel queda sin autocomplete', async () => {
    const w = await mountSettings()
    const passwords = w.findAll('input[type="password"]')
    expect(passwords.length).toBeGreaterThan(0)
    for (const input of passwords) {
      // 'current-password' sería correcto en un login; acá NO hay ninguno: todos definen
      // un secreto nuevo (PIN de garantía, clave del WiFi del hotel).
      expect(input.attributes('autocomplete')).toBe('new-password')
    }
  })
})

describe('GH-31 — la tarjeta "Plan" muestra el plan contratado', () => {
  it('nombre y precio salen de la suscripción cruzada con `plans`', async () => {
    const w = await mountSettings()
    expect(w.find('[data-testid="settings-plan-name"]').text()).toBe('Essential')
    expect(w.find('[data-testid="settings-plan-price"]').text()).toBe('USD 49/mes')
    // El default inventado y el precio hardcodeado del código viejo.
    expect(w.find('[data-testid="settings-plan-name"]').text()).not.toBe('Professional')
  })

  it('en trial no dice "Activo": dice en qué estado está', async () => {
    mySubscriptionImpl = async () => sub({ status: 'trialing', planId: 'plan-professional' })
    const w = await mountSettings()
    expect(w.find('[data-testid="settings-plan-status"]').text()).toBe('En prueba')
    expect(w.find('[data-testid="settings-plan-name"]').text()).toBe('Professional')
    expect(w.find('[data-testid="settings-plan-price"]').text()).toBe('USD 99/mes')
  })

  it('sin suscripción, cae al plan de la ficha del hotel — el precio sigue siendo el de la DB', async () => {
    hotelPlanColumn = 'professional'
    mySubscriptionImpl = async () => sub({ status: 'none', planId: '' })
    const w = await mountSettings()
    expect(w.find('[data-testid="settings-plan-status"]').text()).toBe('Sin suscripción')
    expect(w.find('[data-testid="settings-plan-name"]').text()).toBe('Professional')
    expect(w.find('[data-testid="settings-plan-price"]').text()).toBe('USD 99/mes')
  })

  // COR-4: `loadPlan()` era el 8º `await` de un `try` con siete cargas antes. Si cualquiera de esas
  // siete fallaba, nunca corría: `planLoading` arranca en `true` y sólo se apaga en el `finally` de
  // `loadPlan`, así que la tarjeta quedaba en skeleton para siempre y el fallback era inalcanzable.
  it('si falla una carga anterior, la tarjeta resuelve igual — nada de skeleton eterno', async () => {
    amenitiesCatalogImpl = async () => { throw new Error('500 amenities') }
    const w = await mountSettings()
    expect(w.find('[data-testid="settings-plan-name"]').text()).toBe('Essential')
    expect(w.find('[data-testid="settings-plan-price"]').text()).toBe('USD 49/mes')
  })

  it('si falla una carga anterior Y el plan no resuelve, muestra el fallback (no el skeleton)', async () => {
    amenitiesCatalogImpl = async () => { throw new Error('500 amenities') }
    mySubscriptionImpl = async () => { throw new Error('401') }
    publicPlansImpl = async () => { throw new Error('network') }
    const w = await mountSettings()
    expect(w.find('[data-testid="settings-plan-empty"]').exists()).toBe(true)
  })

  it('si no hay con qué resolver el plan, lo dice en vez de inventar uno', async () => {
    mySubscriptionImpl = async () => { throw new Error('401') }
    publicPlansImpl = async () => { throw new Error('network') }
    const w = await mountSettings()
    expect(w.find('[data-testid="settings-plan-empty"]').exists()).toBe(true)
    expect(w.find('[data-testid="settings-plan-name"]').exists()).toBe(false)
    expect(w.html()).not.toContain('$99')
  })
})
