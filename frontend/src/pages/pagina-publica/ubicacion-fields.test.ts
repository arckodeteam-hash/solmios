// ubicacion-fields.test.ts — migrado de settings/settings-location-fields.test.ts (tarea 1.9,
// docs/wizard-refactor). Desde la tarea 1.8, País y el resto de los campos geográficos ya NO
// viven juntos en una pestaña "Ubicación" de Configuración: País quedó editable en Configuración
// → Hotel (ver settings-plan-pin.test.ts y el resto de la suite de settings, que siguen pasando
// sin tocar nada de esto), y Dirección + mapa + geo pasaron acá, a pagina-publica/ubicacion.vue,
// con País de SOLO LECTURA (link "Cambiar" hacia Configuración → Hotel — doc 03, es identidad
// administrativa/fiscal, no contenido público). Este test fija esa partición.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

vi.mock('@/composables/useGoogleMaps', () => ({ loadGoogleMaps: async () => null }))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {}, warning: () => {} }),
}))
// `vi.mock(...)` se hoistea sobre esta línea: no se puede referenciar `patchHotelMock` directo en
// el factory (TDZ), así que se envuelve en un lambda que recién resuelve el mock al llamarse
// (mismo patrón que `let x; vi.mock(() => x(...))` del resto de esta suite).
const patchHotelMock = vi.fn(async (_patch: Record<string, unknown>) => ({}))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: {
    get: async () => ({
      hotel: {
        id: 'h1', country: 'República Dominicana', address: 'Calle El Conde 1',
        latitude: 18.4861, longitude: -69.9312, province: 'Distrito Nacional',
        municipality: 'Santo Domingo', locality: 'Zona Colonial', postalCode: '10210',
      },
    }),
    patchHotel: (patch: Record<string, unknown>) => patchHotelMock(patch),
  },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: () => {} }),
  onBeforeRouteLeave: () => {},
}))

import Ubicacion from './ubicacion.vue'

// Stub con template propio (no `true`): el default de vue-test-utils descarta el slot del
// componente stubbeado, y el link "Cambiar" es justamente lo que este test verifica que exista.
const MOUNT_OPTS = { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } }

async function mountUbicacion(): Promise<VueWrapper> {
  const wrapper = mount(Ubicacion, MOUNT_OPTS)
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('País y Dirección: partición 1.8 (País solo lectura acá, editable en Configuración → Hotel)', () => {
  it('muestra País de solo lectura con link "Cambiar", sin selector editable', async () => {
    const wrapper = await mountUbicacion()
    expect(wrapper.text()).toContain('República Dominicana')
    expect(wrapper.text()).toContain('Cambiar')
    // Nada editable para país acá — es texto plano + link a Configuración → Hotel.
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(false)
  })

  it('Dirección y los campos geográficos sí son editables/visibles acá, con los valores del hotel', async () => {
    const wrapper = await mountUbicacion()
    const address = wrapper.find('[data-field="address"]')
    expect(address.exists(), 'Dirección debe renderizar en Ubicación').toBe(true)
    expect((address.element as HTMLInputElement).value).toBe('Calle El Conde 1')
    for (const f of ['latitude', 'longitude', 'province', 'municipality', 'locality', 'postalCode']) {
      expect(wrapper.find(`[data-field="${f}"]`).exists(), `${f} sigue en Ubicación`).toBe(true)
    }
  })

  it('guardar NO manda country en el patch — es de solo lectura, se edita en Configuración → Hotel', async () => {
    patchHotelMock.mockClear()
    const wrapper = await mountUbicacion()
    const guardar = wrapper.findAll('button').find((b) => b.text().trim().startsWith('Guardar'))
    expect(guardar, 'el botón Guardar tiene que existir').toBeTruthy()
    await guardar!.trigger('click')
    await flushPromises()

    expect(patchHotelMock).toHaveBeenCalledTimes(1)
    const patch = patchHotelMock.mock.calls[0]![0]
    expect(patch).not.toHaveProperty('country')
    expect(patch).toHaveProperty('address', 'Calle El Conde 1')
  })
})
