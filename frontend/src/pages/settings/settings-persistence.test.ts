// settings-persistence.test.ts — issue #80 (CA 105-111): persistencia general de Panel → Configuración.
//
// Contratos de esta pantalla que se protegen acá:
//   1. `saveAll` manda en el PATCH de hoteles phone2/ownerName/ownerTaxId/wifiNetwork/wifiPassword
//      tal como están en el form — y NO phone/accommodationType/starRating, que los persiste
//      Página pública con su propio guardado.
//   2. El toast de éxito ("Configuración guardada") sale SÓLO después de que el backend confirmó:
//      mientras `patchHotel` no resolvió, el botón dice "Guardando..." y no hay toast.
//   3. Si `patchHotel` rechaza, se ve `toast.error` con el detalle del error y NO hay
//      `toast.success` (nada de "éxito visual" con un guardado que falló).
//   4. Lo mismo para `saveAutomation` (configuration('automation_config')).
//   5. El form se hidrata desde `SettingsService.get()`: al recargar, los inputs muestran lo
//      persistido en el backend (no un estado local).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

// `vi.mock(...)` se hoistea sobre estas líneas: los mocks se referencian desde arrows para que
// existan al momento de la llamada (mismo patrón que settings-contact-moved.test.ts).
const patchHotelMock = vi.fn(async (_patch: Record<string, unknown>) => ({}))
const configSet = vi.fn(async (_key: string, _value: unknown) => ({}))
let configGetImpl: (key: string) => Promise<unknown>
const toastError = vi.fn()
const toastSuccess = vi.fn()

const HOTEL = {
  id: 'h1', name: 'Hotel Test', country: 'República Dominicana',
  phone: '+18095551234', email: 'x@y.test', phone2: '+18295559876',
  accommodationType: 'hotel', starRating: 4,
  ownerName: 'Juan Pérez', ownerTaxId: '131-12345-6',
  wifiNetwork: 'SolmiosGuest', wifiPassword: 'clave-wifi-2026',
}

// ── Dependencias de la pantalla (mismo set de mocks que settings-contact-moved.test.ts) ──
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: () => {}, warning: () => {} }),
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
    get: async () => ({ hotel: { ...HOTEL } }),
    patchHotel: (patch: Record<string, unknown>) => patchHotelMock(patch),
  },
}))
// #291: la pantalla ya no consume HotelService (el catálogo de servicios se retiró de
// Configuración Base); el mock queda vacío por si algún hijo lo importa.
vi.mock('@/services/Hotel.service', () => ({ HotelService: {} }))
vi.mock('@/services/Room.service', () => ({
  RoomService: { list: async () => ({ rooms: [], total: 0 }) },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: (key: string) => configGetImpl(key), set: (key: string, value: unknown) => configSet(key, value) },
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

/** Promesa diferida: el test decide a mano cuándo "responde" el backend. */
function deferred<T = unknown>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function guardarBtn(w: VueWrapper) {
  return w.findAll('button').find((b) => /^Guardar(?:\.\.\.|ando\.\.\.)?$/.test(b.text().trim()) && b.attributes('title') !== undefined)
}
function automationBtn(w: VueWrapper) {
  return w.findAll('button').find((b) => ['Guardar automatización', 'Guardando…'].includes(b.text().trim()) && b.attributes('title') === undefined)
}
function inputValue(w: VueWrapper, field: string) {
  return (w.find(`[data-field="${field}"]`).element as HTMLInputElement).value
}

beforeEach(() => {
  vi.clearAllMocks()
  patchHotelMock.mockReset().mockImplementation(async () => ({}))
  configSet.mockReset().mockImplementation(async () => ({}))
  configGetImpl = async () => null
})

describe('#80 — el form carga desde el backend lo persistido (recargar muestra lo guardado)', () => {
  it('wifiNetwork/wifiPassword/ownerName/ownerTaxId/phone2 aparecen en los inputs con lo que devuelve SettingsService.get()', async () => {
    const w = await mountOnHotelTab()
    expect(inputValue(w, 'wifiNetwork')).toBe('SolmiosGuest')
    expect(inputValue(w, 'wifiPassword')).toBe('clave-wifi-2026')
    expect(inputValue(w, 'ownerName')).toBe('Juan Pérez')
    expect(inputValue(w, 'ownerTaxId')).toBe('131-12345-6')
    // phone2 vive en un PhoneInput (stubeado): el único de la pestaña.
    const phones = w.findAll('phone-input-stub')
    expect(phones.length).toBe(1)
    expect(phones[0]!.attributes('modelvalue')).toBe('+18295559876')
  })

  it('la automatización se hidrata desde configuration(automation_config)', async () => {
    configGetImpl = async (key) => (key === 'automation_config' ? { autoLockCode: true, autoPaymentRequest: false } : null)
    const w = await mountOnHotelTab()
    const boxes = w.findAll('input[type="checkbox"]').map((c) => (c.element as HTMLInputElement).checked)
    expect(boxes).toContain(true)
    expect(boxes).toContain(false)
  })
})

describe('#80 — saveAll: qué viaja y cuándo se confirma', () => {
  it('manda phone2/ownerName/ownerTaxId/wifiNetwork/wifiPassword tal como están en el form, y NO phone/accommodationType/starRating', async () => {
    const w = await mountOnHotelTab()
    await w.find('[data-field="wifiNetwork"]').setValue('RedNueva')
    await w.find('[data-field="wifiPassword"]').setValue('otra-clave')
    await w.find('[data-field="ownerName"]').setValue('María Gómez')
    await w.find('[data-field="ownerTaxId"]').setValue('999-99999-9')

    const btn = guardarBtn(w)
    expect(btn, 'el botón Guardar del header tiene que existir').toBeTruthy()
    expect(btn!.attributes('disabled')).toBeUndefined()
    await btn!.trigger('click')
    await flushPromises()

    expect(patchHotelMock).toHaveBeenCalledTimes(1)
    const patch = patchHotelMock.mock.calls[0]![0]
    expect(patch).toMatchObject({
      phone2: '+18295559876',
      ownerName: 'María Gómez',
      ownerTaxId: '999-99999-9',
      wifiNetwork: 'RedNueva',
      wifiPassword: 'otra-clave',
    })
    expect(patch).not.toHaveProperty('phone')
    expect(patch).not.toHaveProperty('accommodationType')
    expect(patch).not.toHaveProperty('starRating')
    expect(toastSuccess).toHaveBeenCalledWith('Configuración guardada')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toast.success sale SÓLO después de que patchHotel resuelve; mientras tanto el botón dice "Guardando..."', async () => {
    const d = deferred()
    patchHotelMock.mockImplementation(() => d.promise as Promise<{}>)
    const w = await mountOnHotelTab()

    await guardarBtn(w)!.trigger('click')
    await flushPromises()

    // El backend todavía no respondió: no hay éxito visual.
    expect(patchHotelMock).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    const busy = w.findAll('button').find((b) => b.text().trim() === 'Guardando...')
    expect(busy, 'el botón del header tiene que mostrar "Guardando..."').toBeTruthy()
    expect(busy!.attributes('disabled')).toBeDefined()

    d.resolve({})
    await flushPromises()
    await flushPromises()

    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith('Configuración guardada')
    expect(toastError).not.toHaveBeenCalled()
    expect(w.findAll('button').some((b) => b.text().trim() === 'Guardando...')).toBe(false)
  })

  it('si patchHotel rechaza: toast.error con el detalle del backend y SIN toast.success', async () => {
    patchHotelMock.mockImplementation(async () => { throw new Error('boom') })
    const w = await mountOnHotelTab()

    await guardarBtn(w)!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(toastError).toHaveBeenCalledTimes(1)
    expect(String(toastError.mock.calls[0]![0])).toContain('boom')
    expect(toastSuccess).not.toHaveBeenCalled()
    // El botón vuelve a estar disponible para reintentar.
    expect(w.findAll('button').some((b) => b.text().trim() === 'Guardando...')).toBe(false)
  })

})

describe('#80 — saveAutomation: configuration(automation_config)', () => {
  it('guarda {autoLockCode, autoPaymentRequest} y el toast de éxito sale SÓLO tras resolver', async () => {
    const d = deferred()
    configSet.mockImplementation(() => d.promise as Promise<{}>)
    const w = await mountOnHotelTab()

    // Prender "Generar código de puerta al hacer check-in" (primer toggle de la card).
    const lockToggle = w.findAll('input[type="checkbox"]')[0]!
    await lockToggle.setValue(true)

    const btn = automationBtn(w)
    expect(btn, 'el botón "Guardar automatización" tiene que existir').toBeTruthy()
    await btn!.trigger('click')
    await flushPromises()

    expect(configSet).toHaveBeenCalledTimes(1)
    expect(configSet).toHaveBeenCalledWith('automation_config', { autoLockCode: true, autoPaymentRequest: false })
    expect(toastSuccess).not.toHaveBeenCalled()
    const busy = automationBtn(w)
    expect(busy!.text().trim()).toBe('Guardando…')
    expect(busy!.attributes('disabled')).toBeDefined()

    d.resolve({})
    await flushPromises()
    await flushPromises()

    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith('Automatización guardada')
    expect(toastError).not.toHaveBeenCalled()
    expect(automationBtn(w)!.text().trim()).toBe('Guardar automatización')
  })

  it('si ConfigService.set rechaza: toast.error con el detalle y SIN toast.success', async () => {
    configSet.mockImplementation(async () => { throw new Error('boom') })
    const w = await mountOnHotelTab()

    await automationBtn(w)!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(configSet).toHaveBeenCalledWith('automation_config', { autoLockCode: false, autoPaymentRequest: false })
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(String(toastError.mock.calls[0]![0])).toContain('boom')
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(automationBtn(w)!.text().trim()).toBe('Guardar automatización')
  })
})
