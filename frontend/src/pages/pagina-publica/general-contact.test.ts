// general-contact.test.ts — issue #79 (Reestructurar Configuración vs. Página Pública): Teléfono
// principal y Email son datos PÚBLICOS (allow-list de getPublicHotelInfo: phone/email), así que
// se mudaron desde Configuración → Hotel a Página pública → General, en una SectionCard
// "Contacto público" propia, con validación aislada (HOTEL_RULES, sin `required`: nada
// exclusivo de Página pública es obligatorio) y guardado por `save()` de esta pantalla.
// phone2 NO se mueve (no es público, queda como contacto interno en Configuración). Molde:
// ubicacion-fields.test.ts. Este test fija que los dos campos se precargan del hotel y que el
// PATCH lleva phone/email — incluso vacíos TAL CUAL, para poder limpiarlos.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {}, warning: () => {} }),
}))
// `vi.mock(...)` se hoistea sobre estas líneas: los mocks se referencian desde lambdas para que
// recién se resuelvan al llamarse (TDZ) — mismo patrón que ubicacion-fields.test.ts.
const patchHotelMock = vi.fn(async (_patch: Record<string, unknown>) => ({}))
const hotelFixture: Record<string, unknown> = {
  id: 'h1', slug: 'hotel-test', country: 'República Dominicana',
  phone: '+18095551234', email: 'reservas@hotel.test',
  accommodationType: 'hotel', starRating: 4, website: 'https://hotel.test', logo: '',
  publishReviewScore: 0, publishReviewComments: 0,
  descriptionJson: JSON.stringify({ title: 'Hotel Test', description: 'Desc' }),
  descriptionTranslations: {},
}
vi.mock('@/services/Settings.service', () => ({
  SettingsService: {
    get: async () => ({ hotel: { ...hotelFixture } }),
    patchHotel: (patch: Record<string, unknown>) => patchHotelMock(patch),
  },
}))
vi.mock('@/services/Hotel.service', () => ({
  HotelService: {
    amenitiesHotel: async () => ({ data: [] }),
    saveAmenitiesHotel: async (_keys: string[]) => ({}),
    uploadLogo: async () => ({ url: '' }),
  },
}))
vi.mock('@/services/PublicHotel.service', () => ({
  PublicHotelService: { getBySlug: async () => ({ id: 'h1' }) },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: () => {} }),
  onBeforeRouteLeave: () => {},
}))

import General from './general.vue'

async function mountGeneral(): Promise<VueWrapper> {
  const wrapper = mount(General)
  await flushPromises()
  await flushPromises()
  return wrapper
}

function phoneInput(wrapper: VueWrapper) { return wrapper.find('input[type="tel"]') }
function emailInput(wrapper: VueWrapper) { return wrapper.find('[data-field="email"]') }

async function clickGuardar(wrapper: VueWrapper) {
  const guardar = wrapper.findAll('button').find((b) => b.text().trim().startsWith('Guardar'))
  expect(guardar, 'el botón Guardar tiene que existir').toBeTruthy()
  await guardar!.trigger('click')
  await flushPromises()
}

describe('Contacto público (issue #79): phone/email viven en Página pública → General', () => {
  it('monta la SectionCard "Contacto público" con teléfono y email precargados del hotel', async () => {
    const wrapper = await mountGeneral()
    expect(wrapper.text()).toContain('Contacto público')

    const phone = phoneInput(wrapper)
    expect(phone.exists(), 'Teléfono principal (PhoneInput) debe renderizar en General').toBe(true)
    expect((phone.element as HTMLInputElement).value).toBe('+18095551234')

    const email = emailInput(wrapper)
    expect(email.exists(), 'Email debe renderizar en General').toBe(true)
    expect((email.element as HTMLInputElement).value).toBe('reservas@hotel.test')
  })

  it('Guardar manda phone y email editados en el patch de patchHotel', async () => {
    patchHotelMock.mockClear()
    const wrapper = await mountGeneral()

    await phoneInput(wrapper).setValue('+18095559999')
    await emailInput(wrapper).setValue('contacto@hotel.test')
    await clickGuardar(wrapper)

    expect(patchHotelMock).toHaveBeenCalledTimes(1)
    const patch = patchHotelMock.mock.calls[0]![0]
    // PhoneInput formatea al escribir según el país del hotel (AsYouType): se guarda tal cual.
    expect(patch).toHaveProperty('phone', '+1 809 555 9999')
    expect(patch).toHaveProperty('email', 'contacto@hotel.test')
  })

  it('vacíos NO bloquean el guardado: email va "" (se limpia), phone se OMITE (backend min 7 → 400) y vuelve al guardado', async () => {
    patchHotelMock.mockClear()
    // El backend conserva el phone porque no viajó: la respuesta trae el valor guardado.
    patchHotelMock.mockResolvedValueOnce({ phone: '+1 809 555 1234', email: '' })
    const wrapper = await mountGeneral()

    await phoneInput(wrapper).setValue('')
    await emailInput(wrapper).setValue('')
    await clickGuardar(wrapper)

    expect(patchHotelMock).toHaveBeenCalledTimes(1)
    const patch = patchHotelMock.mock.calls[0]![0]
    // UpdateHotelesSchema.phone = { min: 7 }: "" → 400 y null se descarta, así que no se manda.
    // (`patchHotel` real descarta las claves `undefined` antes de serializar.)
    expect(patch.phone).toBeUndefined()
    expect(patch).toHaveProperty('email', '')
    expect(wrapper.find('[data-field="email"].border-danger').exists()).toBe(false)
    // El formulario vuelve a mostrar el teléfono que quedó persistido, no el vacío.
    expect((phoneInput(wrapper).element as HTMLInputElement).value).toBe('+1 809 555 1234')
  })

  it('un phone corto (min 7) bloquea el guardado, marca el campo en rojo y muestra el error', async () => {
    patchHotelMock.mockClear()
    const wrapper = await mountGeneral()

    await phoneInput(wrapper).setValue('12345')
    await clickGuardar(wrapper)

    expect(patchHotelMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Teléfono principal: mínimo 7 caracteres')
    // `invalid` del PhoneInput: el <input type="tel"> queda con borde rojo, como el email.
    expect(phoneInput(wrapper).classes()).toContain('border-danger')
    // data-field="phone" existe (auto-focus de save() lo busca).
    expect(wrapper.find('[data-field="phone"]').exists()).toBe(true)
  })

  it('un email con formato inválido bloquea el guardado (validación aislada de esta pantalla)', async () => {
    patchHotelMock.mockClear()
    const wrapper = await mountGeneral()

    await emailInput(wrapper).setValue('no-es-un-email')
    await clickGuardar(wrapper)

    expect(patchHotelMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('formato de email inválido')
  })
})
