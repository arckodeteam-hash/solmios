// ProfileProgressBar.test.ts — tarea 4.1 (wizard-refactor F4). 3 estados: 0% (invitación, no
// "0% completa"), parcial (barra+porcentaje+botón), 100% de lo REQUERIDO (el componente no
// renderiza nada — v-if apagado, sin resabio visual, aunque queden pasos opcionales pendientes).
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { OnboardingStatus } from '@/services/Onboarding.service'

let statusImpl: () => Promise<OnboardingStatus>
vi.mock('@/services/Onboarding.service', () => ({
  OnboardingService: { status: () => statusImpl() },
}))

import ProfileProgressBar from './ProfileProgressBar.vue'

const step = (over: Partial<OnboardingStatus['steps'][number]> = {}): OnboardingStatus['steps'][number] => ({
  key: 'x', title: 'X', description: 'd', how: 'h', impact: 'i', route: '/panel/configuracion-inicial',
  cta: 'Ir', done: false, required: true, kind: 'profile', ...over,
})

// Stub con template propio (no `true`): el default de vue-test-utils descarta el slot del
// componente stubbeado, y "Completar →" es justamente lo que estos tests verifican.
async function mountBar() {
  const wrapper = mount(ProfileProgressBar, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  await flushPromises()
  return wrapper
}

describe('ProfileProgressBar', () => {
  it('0%: muestra la invitación, no "0% completa"', async () => {
    statusImpl = async () => ({
      completed: false, doneCount: 0, totalCount: 4,
      steps: [step({ done: false }), step({ done: false, required: false })],
    })
    const wrapper = await mountBar()
    expect(wrapper.text()).toContain('Empiece por acá')
    expect(wrapper.text()).not.toContain('0% completa')
  })

  it('parcial: muestra porcentaje, barra y botón Completar', async () => {
    statusImpl = async () => ({
      completed: false, doneCount: 2, totalCount: 4,
      steps: [step({ done: true }), step({ done: false }), step({ done: false, required: false })],
    })
    const wrapper = await mountBar()
    // 1 de 2 requeridos hecho = 50% (el opcional no cuenta ni en el numerador ni en el denominador).
    expect(wrapper.text()).toContain('50%')
    expect(wrapper.text()).toContain('Completar')
    const bar = wrapper.find('.bg-cyan.transition-all')
    expect(bar.attributes('style')).toContain('width: 50%')
  })

  it('los pasos OPCIONALES no cuentan en el porcentaje (doc 04)', async () => {
    statusImpl = async () => ({
      completed: false, doneCount: 1, totalCount: 4,
      // 1 requerido hecho de 1 requerido = 100%, aunque 2 opcionales sigan pendientes.
      steps: [
        step({ key: 'req', done: true, required: true }),
        step({ key: 'opt1', done: false, required: false }),
        step({ key: 'opt2', done: false, required: false }),
      ],
    })
    const wrapper = await mountBar()
    // 100% de lo requerido -> el componente no renderiza nada (mismo criterio que el test de abajo).
    expect(wrapper.find('.bg-navy').exists()).toBe(false)
  })

  it('100% de lo requerido: no renderiza nada, sin resabio visual', async () => {
    statusImpl = async () => ({
      completed: true, doneCount: 4, totalCount: 4,
      steps: [step({ done: true }), step({ done: true })],
    })
    const wrapper = await mountBar()
    expect(wrapper.find('.bg-navy').exists()).toBe(false)
    expect(wrapper.text().trim()).toBe('')
  })
})
