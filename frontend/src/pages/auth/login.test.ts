// login.test.ts — El camino desde el login hacia el alta pública.
//
// El bug: /registro existía y funcionaba (formulario de 2 pasos, endpoint público, planes,
// referidos, captcha) pero NADIE la enlazaba. El único link a esa página vivía dentro del aviso
// de "suscripción vencida" —`v-if="error && needsPlan"`— que solo puede ver alguien que YA es
// cliente y falló al entrar. Un visitante nuevo no tenía ningún camino hasta el alta.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import Login from './login.vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }))

// El login pide /api/public/users al montarse (botones de cuentas demo). Sin backend el fetch
// falla y ensucia la salida; el componente ya lo tolera, acá solo se silencia.
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>',
}

function render() {
  setActivePinia(createPinia())
  return mount(Login, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('login — acceso al alta pública', () => {
  it('ofrece registrarse SIN necesidad de fallar un intento de login antes', () => {
    // Esta es la regresión concreta: antes había que equivocarse al entrar (y encima tener una
    // suscripción vencida) para que apareciera un link a /registro.
    const w = render()
    const link = w.get('[data-testid="login-register-link"]')
    expect(link.attributes('href')).toBe('/registro')
    expect(w.text()).toContain('¿No tienes cuenta?')
  })

  it('el link al alta es visible en el estado inicial, sin errores en pantalla', () => {
    const w = render()
    expect(w.findAll('[data-testid="login-register-link"]')).toHaveLength(1)
  })

  it('sigue ofreciendo recuperar la contraseña (no se pisó el bloque de ayuda)', () => {
    expect(render().findAll('a[href="/forgot-password"]')).toHaveLength(1)
  })

  it('el formulario de login queda intacto: email, contraseña y submit', () => {
    const w = render()
    expect(w.find('[data-testid="login-email"]').exists()).toBe(true)
    expect(w.find('[data-testid="login-password"]').exists()).toBe(true)
    expect(w.find('[data-testid="login-submit"]').exists()).toBe(true)
  })
})
