// landing-plans.test.ts — GH-31: los precios de la landing salen de la tabla `plans`.
//
// El bug: `pages/landing/index.vue` tenía su propia lista con `price: 'USD 99'` (Essential) y
// `'USD 349'` (Professional). `pages/hotel-fundador/index.vue` tenía otra. `/panel/suscripcion`
// leía `GET /api/public/plans`. Tres fuentes de verdad para el mismo número: el visitante veía
// un precio en la landing y otro cuando entraba a suscribirse.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { PublicPlan } from '@/services/Signup.service'

let publicPlansImpl: () => Promise<PublicPlan[]>
vi.mock('@/services/Signup.service', () => ({
  SignupService: { publicPlans: () => publicPlansImpl() },
}))

import Landing from './index.vue'

const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="typeof to === \'string\' ? to : to.path + (to.query?.plan ? `?plan=${to.query.plan}` : \'\')"><slot /></a>',
}
const MOUNT_OPTS = { global: { stubs: { RouterLink: RouterLinkStub, SiteHeader: true, SiteFooter: true } } }

const dbPlan = (over: Partial<PublicPlan>): PublicPlan => ({
  id: 'plan-x', name: 'X', slug: 'x', price: 0, currency: 'USD', description: '', features: [], ...over,
})

beforeEach(() => { publicPlansImpl = async () => [] })

function prices(w: ReturnType<typeof mount>): string[] {
  return w.findAll('[data-testid="plan-price"]').map(n => n.text())
}

describe('landing — el precio lo manda la DB, no el template', () => {
  it('pinta el precio de `plans`, no el literal viejo de marketing', async () => {
    publicPlansImpl = async () => [
      dbPlan({ id: 'plan-essential', name: 'Essential', slug: 'essential', price: 49 }),
      dbPlan({ id: 'plan-professional', name: 'Professional', slug: 'professional', price: 99 }),
    ]
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()

    expect(prices(w)).toEqual(['USD 49', 'USD 99'])
    // Los tres literales que el issue reporta como desincronizados.
    const html = w.html()
    expect(html).not.toContain('USD 349')
    expect(html).not.toContain('USD 199')
    expect(html).not.toContain('USD 549')
  })

  it('un plan a cotización (precio 0 en la DB) va a ventas y no dice "/mes"', async () => {
    publicPlansImpl = async () => [dbPlan({ id: 'plan-ultra', name: 'Ultra', slug: 'ultra', price: 0 })]
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()

    expect(prices(w)).toEqual(['A cotización'])
    expect(w.findAll('a').some(a => a.attributes('href')?.startsWith('mailto:'))).toBe(true)
  })

  it('el nombre también sale de la DB: renombrar el plan se refleja en la landing', async () => {
    publicPlansImpl = async () => [dbPlan({ id: 'plan-professional', name: 'Pro Caribe', slug: 'professional', price: 120 })]
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()
    expect(w.text()).toContain('Pro Caribe')
  })
})

describe('landing — si la API no responde, la página no queda en blanco', () => {
  it('muestra los planes con "Consultar" y avisa, sin inventar un precio', async () => {
    publicPlansImpl = async () => { throw new Error('network') }
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()

    const hrefs = w.findAll('a').map(a => a.attributes('href') ?? '')
    // El embudo sigue vivo: cada plan lleva al alta con su slug.
    expect(hrefs).toEqual(expect.arrayContaining([
      '/registro?plan=essential', '/registro?plan=professional',
    ]))
    expect(prices(w).every(p => p === 'Consultar' || p === 'A cotización')).toBe(true)
    expect(w.find('[data-testid="plans-fallback-notice"]').exists()).toBe(true)
  })

  it('sin planes publicados también avisa en vez de mostrar la sección vacía', async () => {
    publicPlansImpl = async () => []
    const w = mount(Landing, MOUNT_OPTS)
    await flushPromises()
    expect(w.find('[data-testid="plans-fallback-notice"]').exists()).toBe(true)
    expect(w.findAll('[data-testid="plan-price"]').length).toBeGreaterThan(0)
  })

  it('mientras la API responde muestra el placeholder de carga, no un precio viejo', () => {
    let resolve!: (v: PublicPlan[]) => void
    publicPlansImpl = () => new Promise<PublicPlan[]>((r) => { resolve = r })
    const w = mount(Landing, MOUNT_OPTS)

    expect(w.findAll('[data-testid="plan-price-loading"]').length).toBeGreaterThan(0)
    expect(w.html()).not.toContain('USD 349')
    resolve([])
  })
})
