// login-captcha.test.ts — El captcha del login lo decide el super-admin por pantalla (#12).
//
// La config pública trae `scopes.login`; el widget solo se dibuja si el interruptor general Y el
// del login están prendidos, y el token viaja en el POST /auth/login. Con `scopes.login=false`
// (el default, porque la app móvil entra por el mismo endpoint sin token) el login no cambia.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }))
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))
// jsdom no ejecuta scripts externos: el objeto global del proveedor se simula para que `render` no toque la red.
vi.stubGlobal('turnstile', { render: vi.fn(() => 'w1'), reset: vi.fn(), remove: vi.fn() })

const publicConfig = vi.fn()
vi.mock('@/services/Captcha.service', () => ({
  CaptchaService: { publicConfig: (...a: unknown[]) => publicConfig(...a) },
}))
const loginMock = vi.fn()
vi.mock('@/services/Auth.service', () => ({
  AuthService: { login: (...a: unknown[]) => loginMock(...a), me: vi.fn(), getHotels: vi.fn(), logout: vi.fn() },
}))

import Login from './login.vue'

const RouterLinkStub = { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>' }
const cfg = (login: boolean, enabled = true) => ({
  enabled, provider: 'turnstile', siteKey: enabled ? '1x000' : '', scriptUrl: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
  globalName: 'turnstile', scopes: { register: true, login },
})

async function render() {
  setActivePinia(createPinia())
  const w = mount(Login, { global: { stubs: { RouterLink: RouterLinkStub } } })
  await flushPromises()
  return w
}

describe('login — captcha por pantalla', () => {
  beforeEach(() => { publicConfig.mockReset(); loginMock.mockReset() })

  it('con el switch del login apagado (default) no hay widget y el POST no lleva token', async () => {
    publicConfig.mockResolvedValue(cfg(false))
    loginMock.mockRejectedValue(new Error('credenciales'))
    const w = await render()
    expect(w.find('[data-testid="login-captcha"]').exists()).toBe(false)
    await w.get('[data-testid="login-email"]').setValue('a@b.com')
    await w.get('[data-testid="login-password"]').setValue('secreta1')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(loginMock).toHaveBeenCalledWith('a@b.com', 'secreta1', undefined)
  })

  it('con el switch del login prendido aparece el widget', async () => {
    publicConfig.mockResolvedValue(cfg(true))
    const w = await render()
    expect(w.find('[data-testid="login-captcha"]').exists()).toBe(true)
  })

  it('con el interruptor general apagado no hay widget aunque el del login esté prendido', async () => {
    publicConfig.mockResolvedValue(cfg(true, false))
    const w = await render()
    expect(w.find('[data-testid="login-captcha"]').exists()).toBe(false)
  })
})
