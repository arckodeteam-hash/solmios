// landing-cta.test.ts — Los CTAs de conversión de la home del producto.
//
// El bug: los 6 CTAs de la landing ("Comenzar Gratis", "Empezar ahora", el botón de cada plan y
// "Prueba Gratis" del header) apuntaban TODOS a /login. Un visitante que hacía clic en
// "Comenzar Gratis" aterrizaba en un formulario pidiéndole email y contraseña de una cuenta que
// todavía no tenía. El embudo de captación entero moría ahí: /registro existía y funcionaba,
// pero era inalcanzable navegando.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth.store'

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
    // Los 4 planes contratables; "Ultra" es a cotización y abre el formulario de ventas.
    expect(planLinks).toEqual(expect.arrayContaining([
      '/registro?plan=essential',
      '/registro?plan=starter',
      '/registro?plan=professional',
      '/registro?plan=enterprise',
    ]))
  })

  it('el plan a cotización sigue yendo a ventas, no al alta', () => {
    const w = mount(Landing, MOUNT_OPTS)
    // Va al formulario de ventas (Panel › Leads de Ventas), no al alta y no a un `mailto:`
    // que dejaría el lead fuera del sistema.
    expect(w.findAll('button').some(b => /contactar ventas/i.test(b.text()))).toBe(true)
    expect(hrefsOf(w).some(h => h.includes('plan=ultra'))).toBe(false)
  })
})

describe('SiteHeader — separa "ya soy cliente" de "quiero probarlo"', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  const mountHeader = () => mount(SiteHeader, { global: { stubs: { RouterLink: RouterLinkStub } } })
  const byText = (w: ReturnType<typeof mount>, re: RegExp) => w.findAll('a').find(a => re.test(a.text()))

  it('sin sesión: "Prueba Gratis" va al alta y "Iniciar Sesión" sigue yendo al login', () => {
    const w = mountHeader()

    expect(byText(w, /Prueba Gratis/i)?.attributes('href')).toBe('/registro')
    // Regresión a evitar: mandar TODO al registro dejaría sin puerta a quien ya es cliente.
    expect(byText(w, /Iniciar Sesión/i)?.attributes('href')).toBe('/login')
    expect(byText(w, /^Dashboard$/i)).toBeUndefined()
  })

  it('con sesión de hotel: aparece "Dashboard" al panel y desaparecen login y alta', () => {
    const auth = useAuthStore()
    auth.token = 'tkn'
    auth.user = { id: 'u1', name: 'Ana', email: 'ana@hotel.com', role: 'hotel_admin' } as never

    const w = mountHeader()

    expect(byText(w, /Dashboard/i)?.attributes('href')).toBe('/panel')
    // Los dos CTA de invitado rebotan contra el guard del router cuando ya hay sesión.
    expect(byText(w, /Iniciar Sesión/i)).toBeUndefined()
    expect(byText(w, /Prueba Gratis/i)).toBeUndefined()
  })

  it('con sesión de super admin: el "Dashboard" apunta a /admin, no al panel del hotel', () => {
    const auth = useAuthStore()
    auth.token = 'tkn'
    auth.user = { id: 'u0', name: 'Root', email: 'admin@solmios.com', role: 'super_admin' } as never

    expect(byText(mountHeader(), /Dashboard/i)?.attributes('href')).toBe('/admin')
  })
})
