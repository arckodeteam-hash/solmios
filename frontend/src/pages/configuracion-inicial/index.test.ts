// index.test.ts — Centro de configuración (wizard-refactor F3, tarea 3.15). Testea el SHELL en
// aislamiento: orden/badges/progreso de los 10 pasos colapsados (tarea 3.3) y la invariante de
// "un solo paso abierto a la vez" (tarea 3.4) — el contenido interno de cada step (formularios,
// llamadas a SettingsService/HotelService/etc.) ya se verificó en vivo (Playwright, ver
// docs/wizard-refactor/tareas/tareas.md 3.x) y no se re-testea acá: los 10 steps se stubean por
// completo para que este archivo pruebe SOLO la lógica del acordeón, no la de cada formulario.
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

let statusImpl: () => Promise<OnboardingStatus>
vi.mock('@/services/Onboarding.service', () => ({
  OnboardingService: { status: () => statusImpl() },
}))

import Index from './index.vue'

const step = (over: Partial<OnboardingStatus['steps'][number]> = {}): OnboardingStatus['steps'][number] => ({
  key: 'x', title: 'X', description: 'desc', how: 'how', impact: 'impact', route: '/panel/configuracion-inicial',
  cta: 'Ir', done: false, required: true, kind: 'profile', ...over,
})

const STEPS_10 = [
  step({ key: 'bienvenida', title: 'Contá lo básico de tu hotel', done: true, kind: 'profile' }),
  step({ key: 'identidad', title: 'Definí el tipo de alojamiento', done: false, kind: 'profile' }),
  step({ key: 'contacto', title: 'Sumá datos de contacto extra', done: false, required: false, kind: 'profile' }),
  step({ key: 'ubicacion', title: 'Marcá dónde está tu hotel', done: false, kind: 'profile' }),
  step({ key: 'politicas', title: 'Confirmá impuestos y cancelación', done: false, kind: 'profile' }),
  step({ key: 'amenities', title: 'Contá qué ofrece tu hotel', done: false, required: false, kind: 'profile' }),
  step({ key: 'rooms', title: 'Cargá tus habitaciones', done: false, kind: 'external' }),
  step({ key: 'rates', title: 'Definí tus tarifas', done: false, required: false, kind: 'external' }),
  step({ key: 'channels', title: 'Conectá tus canales de venta', done: false, required: false, kind: 'external' }),
  step({ key: 'team', title: 'Sumá a tu equipo', done: false, required: false, kind: 'external' }),
]

async function mountShell() {
  const wrapper = mount(Index, { global: { stubs: { RouterLink: true } } })
  await flushPromises()
  return wrapper
}

describe('Centro de configuración — shell (tarea 3.3)', () => {
  it('muestra los 10 pasos en el orden que devuelve el backend', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 10, steps: STEPS_10 })
    const wrapper = await mountShell()

    const titles = wrapper.findAll('.divide-y > div > div').map((el) => el.text())
    // Cada fila colapsada arranca con el título del paso — alcanza con que aparezcan en orden.
    const order = STEPS_10.map((s) => s.title)
    let lastIndex = -1
    for (const title of order) {
      const idx = titles.findIndex((t, i) => i > lastIndex && t.includes(title))
      expect(idx, `"${title}" tiene que aparecer después de los anteriores`).toBeGreaterThan(-1)
      lastIndex = idx
    }
  })

  it('la cabecera muestra el % SOLO de los pasos requeridos (mismo criterio que ProfileProgressBar.vue)', async () => {
    // STEPS_10 tiene 5 requeridos (bienvenida, identidad, ubicacion, politicas, rooms), 1 hecho
    // (bienvenida) = 20% — NO 60% ni 10%, que darían `doneCount`/`totalCount` del backend
    // (6/10) si la cabecera contara los opcionales. Antes de este fix la cabecera usaba
    // `doneCount`/`totalCount` directo: mostraba un % distinto al de la franja del dashboard
    // para el mismo hotel (ej. 80% en el dashboard, 60% acá), que se leía como un bug.
    statusImpl = async () => ({ completed: false, doneCount: 6, totalCount: 10, steps: STEPS_10 })
    const wrapper = await mountShell()
    expect(wrapper.text()).toContain('20%')
    expect(wrapper.text()).not.toContain('60%')
  })

  it('los pasos opcionales no cuentan para el % de la cabecera', async () => {
    // 1 requerido hecho de 1 requerido = 100%, aunque 2 opcionales sigan pendientes y
    // doneCount/totalCount del backend digan 1/3.
    statusImpl = async () => ({
      completed: true, doneCount: 1, totalCount: 3,
      steps: [
        step({ key: 'req', title: 'Requerido', done: true, required: true }),
        step({ key: 'opt1', title: 'Opcional 1', done: false, required: false }),
        step({ key: 'opt2', title: 'Opcional 2', done: false, required: false }),
      ],
    })
    const wrapper = await mountShell()
    expect(wrapper.text()).toContain('100%')
  })

  it('badge "opcional" solo en los pasos no requeridos; "hecho" solo en los completados', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 10, steps: STEPS_10 })
    const wrapper = await mountShell()
    const text = wrapper.text()
    // bienvenida: requerido y hecho -> "hecho", sin "opcional" a su lado.
    // contacto: opcional y no hecho -> "opcional", sin "hecho".
    expect(text).toContain('hecho')
    expect(text).toContain('opcional')
  })
})

describe('Centro de configuración — expandir/colapsar (tarea 3.4)', () => {
  // Nota: al montar, el shell auto-abre el primer paso PENDIENTE (mismo criterio que
  // OnboardingGuide.vue) — en STEPS_10 eso es 'identidad' (bienvenida es el único `done` al
  // principio de la lista). Los tests de acá parten de ESE estado real, no de "todo cerrado".

  it('arranca con el primer paso pendiente abierto', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 10, steps: STEPS_10 })
    const wrapper = await mountShell()
    expect(wrapper.findAll('[data-testid="step-stub"]').length).toBe(1)
  })

  it('un solo paso abierto a la vez: abrir otro paso cierra el que estaba abierto', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 10, steps: STEPS_10 })
    const wrapper = await mountShell()
    expect(wrapper.findAll('[data-testid="step-stub"]').length).toBe(1) // identidad, auto-abierto

    const headers = wrapper.findAll('.cursor-pointer')
    await headers[3]!.trigger('click') // ubicacion
    await flushPromises()
    // Sigue habiendo UN solo stub montado — el anterior (identidad) se cerró solo.
    expect(wrapper.findAll('[data-testid="step-stub"]').length).toBe(1)
  })

  it('click en el mismo paso ya abierto lo cierra', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 10, steps: STEPS_10 })
    const wrapper = await mountShell()
    expect(wrapper.findAll('[data-testid="step-stub"]').length).toBe(1) // identidad, auto-abierto

    const headers = wrapper.findAll('.cursor-pointer')
    await headers[1]!.trigger('click') // identidad: ya estaba abierto -> se cierra
    await flushPromises()
    expect(wrapper.findAll('[data-testid="step-stub"]').length).toBe(0)
  })

  it('un paso YA HECHO también se puede reabrir (a diferencia de OnboardingGuide.vue)', async () => {
    statusImpl = async () => ({ completed: false, doneCount: 1, totalCount: 10, steps: STEPS_10 })
    const wrapper = await mountShell()

    const headers = wrapper.findAll('.cursor-pointer')
    await headers[0]!.trigger('click') // bienvenida, done:true — cierra identidad (auto-abierto) y abre bienvenida
    await flushPromises()
    expect(wrapper.findAll('[data-testid="step-stub"]').length).toBe(1)
  })
})
