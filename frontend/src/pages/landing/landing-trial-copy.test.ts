// landing-trial-copy.test.ts — #28: la landing no puede prometer "sin tarjeta" por su cuenta.
//
// El bug reportado: el registro decía "Empezás con 7 días gratis, sin tarjeta" mientras el dueño
// de la plataforma quería exigir la tarjeta para poder cobrar al día 8. El texto era un literal en
// el template, así que ninguna configuración podía cambiarlo — la página contradecía al backend.
// Ahora sale de `GET /api/public/signup-policy`, la misma fuente que decide el comportamiento.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { PublicPlan } from '@/services/Signup.service'

let policyImpl: () => Promise<{ requireCardOnTrial: boolean; trialDays: number }>
vi.mock('@/services/Signup.service', () => ({
  SignupService: {
    publicPlans: async (): Promise<PublicPlan[]> => [],
    signupPolicy: () => policyImpl(),
  },
}))

import Landing from './index.vue'

const RouterLinkStub = { props: ['to'], template: '<a><slot /></a>' }
const MOUNT_OPTS = { global: { stubs: { RouterLink: RouterLinkStub, SiteHeader: true, SiteFooter: true } } }

beforeEach(() => {
  policyImpl = async () => ({ requireCardOnTrial: false, trialDays: 7 })
})

describe('landing — la promesa de la prueba sale del servidor (#28)', () => {
  it('con la política que NO exige tarjeta, sigue diciendo "Sin tarjeta de crédito"', async () => {
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()
    expect(w.text()).toContain('Sin tarjeta de crédito')
  })

  it('con la política que SÍ exige tarjeta, deja de prometer que no hace falta', async () => {
    policyImpl = async () => ({ requireCardOnTrial: true, trialDays: 7 })
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()
    expect(w.text()).not.toContain('Sin tarjeta de crédito')
    expect(w.text()).toContain('7 días sin cargo')
  })

  it('los días de prueba salen del servidor, no de un 7 escrito a mano', async () => {
    policyImpl = async () => ({ requireCardOnTrial: true, trialDays: 14 })
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()
    expect(w.text()).toContain('14 días sin cargo')
  })

  it('si la política no responde, la página igual se dibuja con el copy conservador', async () => {
    policyImpl = async () => { throw new Error('endpoint caído') }
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()
    expect(w.text()).toContain('Sin tarjeta de crédito')
  })
})
