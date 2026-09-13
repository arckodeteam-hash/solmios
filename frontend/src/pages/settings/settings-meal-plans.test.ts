// settings-meal-plans.test.ts — #361: el catálogo de regímenes (solo alojamiento, desayuno, media
// pensión…) se administra en Configuración Base → pestaña "Regímenes" (CRUD abierto,
// `components/booking/MealPlansEditor.vue`). Página pública → Motor de reservas sólo conserva el
// switch que decide si el motor los muestra — ver
// `pages/booking-engine/booking-engine-meal-plans-switch.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const mealPlansList = vi.fn(async () => [
  { id: 'mp1', hotelId: 'h1', code: 'breakfast', name: 'Desayuno incluido', description: null, active: true, priceMode: 'included', price: 0, createdAt: '', updatedAt: '' },
])

vi.mock('@/services/MealPlans.service', () => ({
  MealPlansService: { list: () => mealPlansList(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
vi.mock('@/services/Room.service', () => ({
  RoomService: { list: async () => ({ rooms: [], total: 0 }) },
}))
vi.mock('@/services/Signup.service', () => ({
  SignupService: { publicPlans: async () => [], mySubscription: async () => ({ status: 'none', planId: '', trialEndsAt: null, currentPeriodEnd: null, allowed: true, reason: null, daysLeft: null, hasStripeCustomer: false }) },
}))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: { get: async () => ({ hotel: { id: 'h1', name: 'Hotel Test', country: 'República Dominicana', currency: 'EUR' } }), patchHotel: async () => ({}) },
}))
vi.mock('@/services/Hotel.service', () => ({
  HotelService: { amenitiesCatalog: async () => ({}), amenitiesHotel: async () => ({ data: [] }), saveAmenitiesHotel: async () => ({}) },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: async () => null, set: async () => ({}) },
  EmergencyContactsService: { get: async () => null, invalidate: () => {} },
}))
vi.mock('@/services/Guarantee.service', () => ({
  GuaranteeService: { hasPin: async () => ({ hasPin: false }), setPin: async () => ({}) },
}))
let routeQuery: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery }),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  onBeforeRouteLeave: () => {},
}))
vi.mock('@/composables/useGoogleMaps', () => ({ loadGoogleMaps: async () => { throw new Error('sin key') } }))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }) }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', name: 'Tester' } }) }))

import Settings from './index.vue'

const MOUNT_OPTS = { global: { stubs: { RouterLink: true, PhoneInput: true, CancellationPolicyEditor: true, teleport: true } } }

beforeEach(() => {
  routeQuery = {}
  mealPlansList.mockClear()
})

async function mountSettings() {
  const w = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  await flushPromises()
  return w
}

function tabButton(w: Awaited<ReturnType<typeof mountSettings>>, label: string) {
  return w.findAll('button').find((b) => b.text().trim() === label)
}

describe('#361 — Configuración Base tiene la pestaña "Regímenes"', () => {
  it('la pestaña existe en "Config. administrativo", después de Condiciones, y no se monta el editor hasta activarla', async () => {
    const w = await mountSettings()
    const labels = w.findAll('button').map((b) => b.text().trim())
    const idxCond = labels.indexOf('Condiciones')
    const idxMeal = labels.indexOf('Regímenes')
    expect(idxCond).toBeGreaterThanOrEqual(0)
    expect(idxMeal).toBe(idxCond + 1)
    // Pestaña Hotel activa por default: el catálogo todavía no se pidió.
    expect(w.find('[data-testid=meal-plan-add]').exists()).toBe(false)
    expect(mealPlansList).not.toHaveBeenCalled()
  })

  it('al activarla monta MealPlansEditor: "+ Agregar régimen" y las filas del catálogo', async () => {
    const w = await mountSettings()
    await tabButton(w, 'Regímenes')!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(w.text()).toContain('Regímenes')
    expect(w.find('[data-testid=meal-plan-add]').exists()).toBe(true)
    expect(w.find('[data-testid=meal-plan-add]').text()).toContain('+ Agregar régimen')
    expect(mealPlansList).toHaveBeenCalledTimes(1)
    expect(w.findAll('[data-testid=meal-plan-row]')).toHaveLength(1)
    expect(w.text()).toContain('Desayuno incluido')
    // La card remite al switch que vive en Página pública → Motor de reservas.
    expect(w.text()).toContain('Mostrar regímenes')
  })

  it('deep-link ?tab=mealplans aterriza directo en la pestaña', async () => {
    routeQuery = { tab: 'mealplans' }
    const w = await mountSettings()
    await flushPromises()
    expect(w.find('[data-testid=meal-plan-add]').exists()).toBe(true)
  })
})
