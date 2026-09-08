// settings-logo.test.ts — GH-70: en Configuración el logo del hotel "fallaba en la primera carga
// y después aparecía bien". Dos cosas lo causaban y las dos se fijan acá:
//
//  1. El <img> se dibujaba sin ningún manejo de @error, así que un logo cuya URL no resuelve
//     (archivo borrado del storage, valor legacy, URL absoluta que no carga) dejaba el recuadro
//     de imagen rota del navegador — justo lo que el criterio 2 del issue prohíbe.
//  2. Un logo nuevo no volvía a intentarse después de un fallo previo, así que hacía falta
//     recargar o salir y volver a entrar (criterios 3, 4 y 5).
//
// El tratamiento es el que el repo ya tenía resuelto en CommandCenterHeader.vue: un flag
// logoFailed que @error enciende y que un watch sobre el logo vuelve a apagar.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

const LOGO_SUBIDO = '/uploads/hotel-logos/1788905139044-a7v2xx1k7.png'

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
// El hotel YA tiene logo guardado: es el caso del criterio 1 (un logo existente debe verse
// desde la primera carga, sin recargar).
vi.mock('@/services/Settings.service', () => ({
  SettingsService: {
    get: async () => ({
      hotel: {
        id: 'h1', name: 'Hotel Test', country: 'República Dominicana',
        logo: '/uploads/hotel-logos/1788905139044-a7v2xx1k7.png',
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
    uploadLogo: async () => ({ logo: '/uploads/hotel-logos/nuevo.png' }),
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

import Settings from './index.vue'

const MOUNT_OPTS = { global: { stubs: { RouterLink: true, PhoneInput: true } } }

async function mountSettings() {
  const wrapper = mount(Settings, MOUNT_OPTS)
  await flushPromises()
  return wrapper
}

/** El <img> del logo de la tarjeta "Logo del Hotel". */
const logoImg = (w: VueWrapper) => w.findAll('img').find((i) => i.attributes('alt') === 'Logo')

/** El placeholder de arrastrar/soltar, que es lo que debe quedar cuando no hay logo utilizable. */
const placeholder = (w: VueWrapper) => w.text().includes('Arrastrá o hacé clic')

describe('GH-70 — el logo del hotel en Configuración', () => {
  it('un logo existente se dibuja en el PRIMER render, sin recargar', async () => {
    const wrapper = await mountSettings()

    const img = logoImg(wrapper)
    expect(img, 'el <img> del logo tiene que existir ya en la primera carga').toBeTruthy()
    expect(img!.attributes('src')).toBe(LOGO_SUBIDO)
    // El campo de texto muestra el mismo valor que la imagen.
    expect((wrapper.find('[data-field="logo"]').element as HTMLInputElement).value).toBe(LOGO_SUBIDO)
  })

  it('si la imagen no carga, cae al placeholder en vez de dejar el recuadro roto', async () => {
    const wrapper = await mountSettings()

    await logoImg(wrapper)!.trigger('error')
    await flushPromises()

    expect(logoImg(wrapper), 'una imagen que falló no debe seguir dibujada').toBeFalsy()
    expect(placeholder(wrapper), 'en su lugar queda el placeholder de subir logo').toBe(true)
  })

  it('un logo NUEVO se vuelve a intentar aunque el anterior hubiera fallado', async () => {
    const wrapper = await mountSettings()

    await logoImg(wrapper)!.trigger('error')
    await flushPromises()
    expect(logoImg(wrapper), 'precondición: quedó sin imagen tras el fallo').toBeFalsy()

    // Es lo que hace uploadLogoFile() al terminar la subida: escribir el nuevo valor en el form.
    await wrapper.find('[data-field="logo"]').setValue('/uploads/hotel-logos/nuevo.png')
    await flushPromises()

    const img = logoImg(wrapper)
    expect(img, 'el logo nuevo merece otra oportunidad de cargar').toBeTruthy()
    expect(img!.attributes('src')).toBe('/uploads/hotel-logos/nuevo.png')
  })

  it('el campo del logo no usa type=url: la ruta que sube la app no es una URL absoluta', async () => {
    const wrapper = await mountSettings()

    // Con type="url" el navegador marca /uploads/... como inválido y pelea con la validación
    // del proyecto, que desde GH-70 acepta rutas del propio sitio.
    expect(wrapper.find('[data-field="logo"]').attributes('type')).not.toBe('url')
  })
})
