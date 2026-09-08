// index.test.ts — Centro de configuración (rediseño a wizard standalone, 2026-09-08). Testea el
// SHELL en aislamiento: orden de pasos en la barra, % SOLO de requeridos (mismo criterio que
// ProfileProgressBar.vue), arranque en el primer paso pendiente, y la navegación entre pasos
// (click en la barra / anterior / siguiente). El contenido interno de cada step (formularios,
// llamadas a SettingsService/HotelService/etc.) ya se verificó en vivo (Playwright) y no se
// re-testea acá: los 9 steps se stubean por completo para que este archivo pruebe SOLO la
// lógica del stepper, no la de cada formulario.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { OnboardingStatus } from '@/services/Onboarding.service'

// `vi.mock(...)` se hoistea sobre este archivo: `STUB` tiene que declararse con `vi.hoisted`
// para no caer en la TDZ (mismo patrón que `ubicacion-fields.test.ts`).
const { STUB } = vi.hoisted(() => ({
  STUB: { name: 'StepStub', template: '<div data-testid="step-stub">stub</div>' },
}))
vi.mock('./steps/StepBienvenida.vue', () => ({ default: STUB }))
vi.mock('./steps/StepIdentidad.vue', () => ({ default: STUB }))
vi.mock('./steps/StepContacto.vue', () => ({ default: STUB }))
vi.mock('./steps/StepUbicacion.vue', () => ({ default: STUB }))
vi.mock('./steps/StepPoliticas.vue', () => ({ default: STUB }))
vi.mock('./steps/StepAmenities.vue', () => ({ default: STUB }))
vi.mock('./steps/StepExternal.vue', () => ({ default: STUB }))

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

let statusImpl: () => Promise<OnboardingStatus>
vi.mock('@/services/Onboarding.service', () => ({
  OnboardingService: { status: () => statusImpl() },
}))

import Index from './index.vue'

const step = (over: Partial<OnboardingStatus['steps'][number]> = {}): OnboardingStatus['steps'][number] => ({
  key: 'x', title: 'X', description: 'desc', how: 'how', impact: 'impact', route: '/panel/configuracion-inicial',
  cta: 'Ir', done: false, required: true, kind: 'profile', ...over,
})

const STEPS_9 = [
  step({ key: 'bienvenida', title: 'Contá lo básico de tu hotel', done: true, kind: 'profile' }),
  step({ key: 'identidad', title: 'Definí el tipo de alojamiento', done: false, kind: 'profile' }),
  step({ key: 'contacto', title: 'Sumá datos de contacto extra', done: false, required: false, kind: 'profile' }),
  step({ key: 'ubicacion', title: 'Marcá dónde está tu hotel', done: false, kind: 'profile' }),
  step({ key: 'politicas', title: 'Confirmá impuestos y cancelación', done: false, kind: 'profile' }),
  step({ key: 'amenities', title: 'Contá qué ofrece tu hotel', done: false, required: false, kind: 'profile' }),
  step({ key: 'rooms', title: 'Cargá tus habitaciones', done: false, kind: 'external' }),
  step({ key: 'rates', title: 'Definí tus tarifas', done: false, required: false, kind: 'external' }),
  step({ key: 'channels', title: 'Conectá tus canales de venta', done: false, required: false, kind: 'external' }),
]

async function mountShell() {
  const wrapper = mount(Index, { global: { stubs: { RouterLink: true } } })
  await flushPromises()
  return wrapper
}

describe('Centro de configuración — barra de pasos', () => {
  it('muestra los 9 pasos en el orden que devuelve el backend', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 9, steps: STEPS_9 })
    const wrapper = await mountShell()

    const buttons = wrapper.findAll('nav button')
    expect(buttons.length).toBe(9)
    // SHORT_LABEL de cada key, en orden.
    const labels = ['Bienvenida', 'Identidad', 'Contacto', 'Ubicación', 'Políticas', 'Amenities', 'Habitaciones', 'Tarifas', 'Canales']
    labels.forEach((label, i) => expect(buttons[i]!.text()).toContain(label))
  })

  it('el % mostrado cuenta SOLO los pasos requeridos (mismo criterio que ProfileProgressBar.vue)', async () => {
    // STEPS_9 tiene 5 requeridos (bienvenida, identidad, ubicacion, politicas, rooms), 1 hecho
    // (bienvenida) = 20% — NO 60%, que daría doneCount/totalCount del backend (6/9) si se
    // contaran los opcionales.
    statusImpl = async () => ({ completed: false, doneCount: 6, totalCount: 9, steps: STEPS_9 })
    const wrapper = await mountShell()
    expect(wrapper.text()).toContain('20%')
    expect(wrapper.text()).not.toContain('60%')
  })

  it('arranca mostrando el primer paso pendiente', async () => {
    // bienvenida (i=0) está done -> el primer pendiente es identidad (i=1).
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 9, steps: STEPS_9 })
    const wrapper = await mountShell()
    expect(wrapper.find('h1').text()).toContain('Definí el tipo de alojamiento')
  })

  it('click en un paso de la barra salta directo a ese paso', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 9, steps: STEPS_9 })
    const wrapper = await mountShell()

    const buttons = wrapper.findAll('nav button')
    await buttons[6]!.trigger('click') // rooms
    await flushPromises()
    expect(wrapper.find('h1').text()).toContain('Cargá tus habitaciones')
  })

  it('"Siguiente"/"Anterior" navegan un paso a la vez', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 9, steps: STEPS_9 })
    const wrapper = await mountShell()
    expect(wrapper.find('h1').text()).toContain('Definí el tipo de alojamiento') // identidad (i=1)

    const next = () => wrapper.findAll('button').find((b) => b.text().includes('Siguiente'))
    await next()!.trigger('click')
    await flushPromises()
    expect(wrapper.find('h1').text()).toContain('Sumá datos de contacto extra') // contacto (i=2)

    const prev = () => wrapper.findAll('button').find((b) => b.text().includes('Anterior'))
    await prev()!.trigger('click')
    await flushPromises()
    expect(wrapper.find('h1').text()).toContain('Definí el tipo de alojamiento') // vuelve a identidad
  })

  it('un solo step montado a la vez', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 9, steps: STEPS_9 })
    const wrapper = await mountShell()
    expect(wrapper.findAll('[data-testid="step-stub"]').length).toBe(1)
  })

  it('cuando todo lo requerido está completo, muestra el cierre en vez del contenido del paso 0', async () => {
    statusImpl = async () => ({
      completed: true, doneCount: 9, totalCount: 9,
      steps: STEPS_9.map((s) => ({ ...s, done: true })),
    })
    const wrapper = await mountShell()
    expect(wrapper.text()).toContain('Su hotel está listo')
    expect(wrapper.find('[data-testid="step-stub"]').exists()).toBe(false)
  })
})
