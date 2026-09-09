// index.test.ts — Centro de configuración (rediseño 2026-09-09, réplica del mockup del usuario).
// Testea el SHELL en aislamiento: orden de pasos en la barra, contador "Paso X de N", arranque en
// el primer paso pendiente, navegación entre pasos (barra / Anterior / delegación de "Guardar y
// continuar" al step activo). El contenido interno de cada step (formularios, llamadas a
// SettingsService/HotelService/etc.) ya se verificó en vivo (Playwright) y no se re-testea acá:
// los 6 steps se stubean por completo, exponiendo `save`/`skip` como mocks para probar que el
// shell delega correctamente (desde el rediseño, cada Step*.vue ya no dibuja su propio botón).
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { OnboardingStatus } from '@/services/Onboarding.service'

// `vi.mock(...)` se hoistea sobre este archivo: todo lo que el STUB necesita referenciar tiene
// que declararse DENTRO del mismo `vi.hoisted` para no caer en la TDZ (mismo patrón que
// `ubicacion-fields.test.ts`).
const { STUB, saveMock, skipMock } = vi.hoisted(() => {
  const saveMock = vi.fn(async () => {})
  const skipMock = vi.fn()
  return {
    saveMock, skipMock,
    STUB: {
      name: 'StepStub',
      template: '<div data-testid="step-stub">stub</div>',
      setup(_props: unknown, { expose }: { expose: (exposed: Record<string, unknown>) => void }) {
        expose({ save: saveMock, skip: skipMock })
      },
    },
  }
})
vi.mock('./steps/StepBienvenida.vue', () => ({ default: STUB }))
vi.mock('./steps/StepIdentidad.vue', () => ({ default: STUB }))
vi.mock('./steps/StepContacto.vue', () => ({ default: STUB }))
vi.mock('./steps/StepUbicacion.vue', () => ({ default: STUB }))
vi.mock('./steps/StepPoliticas.vue', () => ({ default: STUB }))
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

const STEPS_6 = [
  step({ key: 'bienvenida', title: 'Contá lo básico de tu hotel', done: true, kind: 'profile' }),
  step({ key: 'identidad', title: 'Definí el tipo de alojamiento', done: false, kind: 'profile' }),
  step({ key: 'contacto', title: 'Sumá datos de contacto extra', done: false, required: false, kind: 'profile' }),
  step({ key: 'ubicacion', title: 'Marcá dónde está tu hotel', done: false, kind: 'profile' }),
  step({ key: 'politicas', title: 'Confirmá impuestos y cancelación', done: false, kind: 'profile' }),
  step({ key: 'rooms', title: 'Cargá tus habitaciones', done: false, kind: 'external' }),
]

async function mountShell() {
  const wrapper = mount(Index, { global: { stubs: { RouterLink: true } } })
  await flushPromises()
  return wrapper
}

describe('Centro de configuración — barra de pasos', () => {
  it('muestra los 6 pasos en el orden que devuelve el backend', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()

    const buttons = wrapper.findAll('nav button')
    expect(buttons.length).toBe(6)
    // SHORT_LABEL de cada key, en orden.
    const labels = ['Bienvenida', 'Identidad', 'Contacto', 'Ubicación', 'Políticas', 'Habitaciones']
    labels.forEach((label, i) => expect(buttons[i]!.text()).toContain(label))
  })

  it('el header muestra "Paso X de N" según el paso activo', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()
    // Arranca en identidad (i=1) -> "Paso 2 de 6".
    expect(wrapper.text()).toContain('Paso 2 de 6')

    const buttons = wrapper.findAll('nav button')
    await buttons[5]!.trigger('click') // rooms, i=5
    await flushPromises()
    expect(wrapper.text()).toContain('Paso 6 de 6')
  })

  it('arranca mostrando el primer paso pendiente', async () => {
    // bienvenida (i=0) está done -> el primer pendiente es identidad (i=1).
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()
    expect(wrapper.find('h1').text()).toContain('Definí el tipo de alojamiento')
  })

  it('click en un paso de la barra salta directo a ese paso', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()

    const buttons = wrapper.findAll('nav button')
    await buttons[5]!.trigger('click') // rooms
    await flushPromises()
    expect(wrapper.find('h1').text()).toContain('Cargá tus habitaciones')
  })

  it('"Guardar y continuar" delega el guardado al step activo (expuesto vía defineExpose)', async () => {
    saveMock.mockClear()
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()

    const primary = wrapper.findAll('button').find((b) => b.text().includes('Guardar y continuar'))
    expect(primary, 'el paso activo (identidad) es kind:profile, debe mostrar el botón primario').toBeTruthy()
    await primary!.trigger('click')
    await flushPromises()
    expect(saveMock).toHaveBeenCalledTimes(1)
  })

  it('"Saltear" solo aparece en el único paso opcional (contacto) y delega en el step activo', async () => {
    skipMock.mockClear()
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()
    // Arranca en identidad (requerido): sin botón "Saltear".
    expect(wrapper.findAll('button').some((b) => b.text().includes('Saltear'))).toBe(false)

    const buttons = wrapper.findAll('nav button')
    await buttons[2]!.trigger('click') // contacto (i=2, único opcional)
    await flushPromises()
    const skip = wrapper.findAll('button').find((b) => b.text().includes('Saltear'))
    expect(skip).toBeTruthy()
    await skip!.trigger('click')
    expect(skipMock).toHaveBeenCalledTimes(1)
  })

  it('"Anterior" retrocede un paso — no aparece en el primer paso', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()
    expect(wrapper.find('h1').text()).toContain('Definí el tipo de alojamiento') // identidad (i=1)

    const prev = () => wrapper.findAll('button').find((b) => b.text().includes('Anterior'))
    expect(prev()).toBeTruthy()
    await prev()!.trigger('click')
    await flushPromises()
    expect(wrapper.find('h1').text()).toContain('Contá lo básico de tu hotel') // bienvenida (i=0)
    expect(prev(), 'en el primer paso no hay botón Anterior').toBeFalsy()
  })

  it('el paso operativo (kind:external) no muestra "Guardar y continuar" — su acción es el CTA del propio componente', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()

    const buttons = wrapper.findAll('nav button')
    await buttons[5]!.trigger('click') // rooms, kind:'external'
    await flushPromises()
    expect(wrapper.findAll('button').some((b) => b.text().includes('Guardar y continuar'))).toBe(false)
  })

  it('un solo step montado a la vez', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 6, steps: STEPS_6 })
    const wrapper = await mountShell()
    expect(wrapper.findAll('[data-testid="step-stub"]').length).toBe(1)
  })

  it('cuando todo lo requerido está completo, muestra el cierre en vez del contenido del paso 0', async () => {
    statusImpl = async () => ({
      completed: true, doneCount: 6, totalCount: 6,
      steps: STEPS_6.map((s) => ({ ...s, done: true })),
    })
    const wrapper = await mountShell()
    expect(wrapper.text()).toContain('Su hotel está listo')
    expect(wrapper.find('[data-testid="step-stub"]').exists()).toBe(false)
  })
})
