// settings-children-room-types.test.ts — Requerimiento 1 (política de niños), pestaña de
// Configuración (2026-09-03).
//
// Qué se protege: valores por defecto, validación "sin plaza ≤ niño" (RFC del pedido), guardado
// como configuration('child_policy'). El stepper de niños del wizard depende de `acceptChildren`
// — acá solo se cubre lo que esta pantalla controla.
//
// El Requerimiento 2 (capacidad por tipo de habitación) se mudó con su pestaña a Habitaciones:
// ver `pages/rooms/rooms-type-capacity.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let roomsImpl: () => Promise<{ rooms: any[]; total: number }>
let configGetImpl: (key: string) => Promise<unknown>
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
  ConfigService: { get: (key: string) => configGetImpl(key), set: (key: string, value: unknown) => configSet(key, value) },
  EmergencyContactsService: { get: async () => null, invalidate: () => {} },
}))
vi.mock('@/services/Guarantee.service', () => ({
  GuaranteeService: { hasPin: async () => ({ hasPin: false }), setPin: async () => ({}) },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { tab: 'children' } }),
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
  configGetImpl = async () => null
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

function setTab(w: Awaited<ReturnType<typeof mountSettings>>, tab: string) {
  return w.findAll('button').find(b => b.text() === tab)
}

describe('Requerimiento 1 — Política de niños', () => {
  it('valores por defecto: acepta niños, hasta 17 años niño, 0 años sin plaza', async () => {
    const w = await mountSettings()
    await setTab(w, 'Niños')?.trigger('click')
    const toggle = w.find('input[type="checkbox"]')
    expect((toggle.element as HTMLInputElement).checked).toBe(true)
    const numberInputs = w.findAll('input[type="number"]').filter(i => (i.element as HTMLInputElement).value)
    expect(numberInputs.map(i => (i.element as HTMLInputElement).value)).toContain('17')
    expect(numberInputs.map(i => (i.element as HTMLInputElement).value)).toContain('0')
  })

  it('carga la política ya guardada del hotel', async () => {
    configGetImpl = async (key) => (key === 'child_policy' ? { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 } : null)
    const w = await mountSettings()
    await setTab(w, 'Niños')?.trigger('click')
    expect(w.text()).toContain('0–3 años no consume plaza')
    expect(w.text()).toContain('4–12 años consume plaza')
    expect(w.text()).toContain('mayor de 12 años se trata como adulto')
  })

  it('si "Aceptar niños" está apagado, no muestra los campos de edad', async () => {
    configGetImpl = async (key) => (key === 'child_policy' ? { acceptChildren: false, maxChildAge: 12, maxFreeAge: 3 } : null)
    const w = await mountSettings()
    await setTab(w, 'Niños')?.trigger('click')
    expect(w.find('input[type="checkbox"]').exists()).toBe(true)
    expect((w.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(w.findAll('input[type="number"]')).toHaveLength(0)
  })

  it('"edad sin plaza" > "edad máxima niño" bloquea el guardado con el error del pedido', async () => {
    configGetImpl = async (key) => (key === 'child_policy' ? { acceptChildren: true, maxChildAge: 5, maxFreeAge: 10 } : null)
    const w = await mountSettings()
    await setTab(w, 'Niños')?.trigger('click')
    expect(w.text()).toContain('no puede ser mayor que la edad máxima de niño')

    // Botón "Guardar" de la card de política de niños: deshabilitado mientras el error exista.
    const childCard = w.findAll('h3').find(h => h.text() === 'Política de niños')!.element.closest('div.rounded-\\[20px\\]')!
    const saveBtn = childCard.querySelector('button')!
    expect(saveBtn.disabled).toBe(true)
    expect(configSet).not.toHaveBeenCalledWith('child_policy', expect.anything())
  })

  it('guarda la política vía configuration(child_policy)', async () => {
    const w = await mountSettings()
    await setTab(w, 'Niños')?.trigger('click')
    const childCard = w.findAll('h3').find(h => h.text() === 'Política de niños')!.element.closest('div.rounded-\\[20px\\]')!
    const saveBtn = childCard.querySelector('button') as HTMLButtonElement
    saveBtn.click()
    await flushPromises()
    expect(configSet).toHaveBeenCalledWith('child_policy', { acceptChildren: true, maxChildAge: 17, maxFreeAge: 0 })
    expect(toastSuccess).toHaveBeenCalled()
  })
})
