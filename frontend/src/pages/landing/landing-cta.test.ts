// landing-cta.test.ts — Los CTAs de conversión de la home del producto.
//
// El bug: los 6 CTAs de la landing ("Comenzar Gratis", "Empezar ahora", el botón de cada plan y
// "Prueba Gratis" del header) apuntaban TODOS a /login. Un visitante que hacía clic en
// "Comenzar Gratis" aterrizaba en un formulario pidiéndole email y contraseña de una cuenta que
// todavía no tenía. El embudo de captación entero moría ahí: /registro existía y funcionaba,
// pero era inalcanzable navegando.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// La landing pide datos públicos al montarse; sin backend el fetch falla y ensucia la salida.
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))

import Landing from './index.vue'
import SiteHeader from '@/components/site/SiteHeader.vue'

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : to.path + (to.query?.plan ? `?plan=${to.query.plan}` : \'\')"><slot /></a>',
}

const MOUNT_OPTS = { global: { stubs: { RouterLink: RouterLinkStub, SiteHeader: true } } }

function hrefsOf(w: ReturnType<typeof mount>): string[] {
  return w.findAll('a').map(a => a.attributes('href') ?? '')
}

describe('landing — el embudo termina en el alta, no en el login', () => {
  it('ningún CTA que promete crear una cuenta manda al login', () => {
    const w = mount(Landing, MOUNT_OPTS)
    const ctas = w.findAll('a').filter(a => /Comenzar Gratis|Empezar ahora|Prueba gratis/i.test(a.text()))
    expect(ctas.length).toBeGreaterThan(0)
    for (const cta of ctas) {
      expect(cta.attributes('href')).not.toBe('/login')
      expect(cta.attributes('href')).toMatch(/^\/registro/)
    }
  })

  it('cada plan de precios lleva al alta con SU plan preseleccionado', () => {
    const w = mount(Landing, MOUNT_OPTS)
    const planLinks = hrefsOf(w).filter(h => h.startsWith('/registro?plan='))
    // Los 4 planes contratables; "Ultra" es a cotización y va a ventas por mailto.
    expect(planLinks).toEqual(expect.arrayContaining([
      '/registro?plan=essential',
      '/registro?plan=starter',
      '/registro?plan=professional',
      '/registro?plan=enterprise',
    ]))
  })

  it('el plan a cotización sigue yendo a ventas, no al alta', () => {
    const w = mount(Landing, MOUNT_OPTS)
    expect(hrefsOf(w).some(h => h.startsWith('mailto:'))).toBe(true)
  })
})

describe('SiteHeader — separa "ya soy cliente" de "quiero probarlo"', () => {
  it('"Prueba Gratis" va al alta y "Iniciar Sesión" sigue yendo al login', () => {
    const w = mount(SiteHeader, { global: { stubs: { RouterLink: RouterLinkStub } } })
    const byText = (re: RegExp) => w.findAll('a').find(a => re.test(a.text()))

    expect(byText(/Prueba Gratis/i)?.attributes('href')).toBe('/registro')
    // Regresión a evitar: mandar TODO al registro dejaría sin puerta a quien ya es cliente.
    expect(byText(/Iniciar Sesión/i)?.attributes('href')).toBe('/login')
  })
})
