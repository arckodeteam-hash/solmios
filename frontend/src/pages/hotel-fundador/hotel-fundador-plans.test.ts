// hotel-fundador-plans.test.ts — GH-31: el precio fundador se deriva del precio real del plan.
//
// El bug: esta página tenía su propio juego de precios (`publicPrice: 'USD 349'`,
// `founderPrice: 'USD 244'`) que no coincidía ni con la landing ni con la tabla `plans`. El
// "30% off" era un texto, no un cálculo: cambiar el precio en la DB no movía nada acá.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { PublicPlan } from '@/services/Signup.service'

let publicPlansImpl: () => Promise<PublicPlan[]>
let founderDiscountImpl: () => Promise<number | null>
vi.mock('@/services/Signup.service', () => ({
  SignupService: {
    publicPlans: () => publicPlansImpl(),
    founderDiscountPct: () => founderDiscountImpl(),
  },
}))

import HotelFundador from './index.vue'

const MOUNT_OPTS = { global: { stubs: { RouterLink: true, SiteHeader: true, SiteFooter: true } } }

const dbPlan = (over: Partial<PublicPlan>): PublicPlan => ({
  id: 'plan-x', name: 'X', slug: 'x', price: 0, currency: 'USD', description: '', features: [], ...over,
})

beforeEach(() => {
  publicPlansImpl = async () => []
  // Por defecto el servidor no tiene config usable → la vista cae al respaldo del build (30).
  founderDiscountImpl = async () => null
})

const publicPrices = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="plan-public-price"]').map(n => n.text())
const founderPrices = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="plan-founder-price"]').map(n => n.text())

describe('hotel-fundador — precio público de la DB, precio fundador calculado', () => {
  it('el 30% se aplica sobre el precio real del plan', async () => {
    publicPlansImpl = async () => [dbPlan({ id: 'plan-professional', name: 'Professional', slug: 'professional', price: 99 })]
    const w = mount(HotelFundador, MOUNT_OPTS)
    await flushPromises()

    expect(publicPrices(w)).toEqual(['Precio público USD 99'])
    expect(founderPrices(w)).toEqual(['USD 69'])   // 99 - 30%
    // El juego de precios viejo, hardcodeado, ya no existe.
    const html = w.html()
    expect(html).not.toContain('USD 349')
    expect(html).not.toContain('USD 244')
  })

  it('mover el precio en la DB mueve el precio fundador', async () => {
    publicPlansImpl = async () => [dbPlan({ id: 'plan-starter', name: 'Starter', slug: 'starter', price: 200 })]
    const w = mount(HotelFundador, MOUNT_OPTS)
    await flushPromises()
    expect(founderPrices(w)).toEqual(['USD 140'])
  })

  it('un plan a cotización no muestra descuento inventado', async () => {
    publicPlansImpl = async () => [dbPlan({ id: 'plan-ultra', name: 'Ultra', slug: 'ultra', price: 0 })]
    const w = mount(HotelFundador, MOUNT_OPTS)
    await flushPromises()

    expect(publicPrices(w)).toEqual(['A cotización'])
    expect(founderPrices(w)).toEqual([])
  })

  it('API caída: "Consultar" + aviso, nunca un precio viejo', async () => {
    publicPlansImpl = async () => { throw new Error('network') }
    const w = mount(HotelFundador, MOUNT_OPTS)
    await flushPromises()

    expect(w.find('[data-testid="plans-fallback-notice"]').exists()).toBe(true)
    expect(publicPrices(w).every(p => p === 'Consultar' || p === 'A cotización')).toBe(true)
    expect(founderPrices(w)).toEqual([])
    expect(w.html()).not.toContain('USD 244')
  })

  // ── CFG-1: el % lo manda el servidor, no el build ────────────────────────────────────────────
  // `special_category_config.discountPct` es el número con el que se cobra de verdad. Mientras
  // salía sólo de `VITE_FOUNDER_DISCOUNT_PCT`, bajarlo desde /admin dejaba la página prometiendo
  // el viejo: precio mostrado ≠ precio cobrado, lo mismo que GH-31 cerró para el precio base.
  it('el % del programa sale de la config del servidor', async () => {
    founderDiscountImpl = async () => 20
    publicPlansImpl = async () => [dbPlan({ id: 'plan-professional', name: 'Professional', slug: 'professional', price: 100 })]
    const w = mount(HotelFundador, MOUNT_OPTS)
    await flushPromises()

    expect(founderPrices(w)).toEqual(['USD 80'])   // 100 − 20%, no el 30 del build
    expect(w.html()).toContain('20% de descuento')
  })

  it('si el servidor no tiene config usable, cae al respaldo del build sin romper', async () => {
    founderDiscountImpl = async () => { throw new Error('500') }
    publicPlansImpl = async () => [dbPlan({ id: 'plan-professional', name: 'Professional', slug: 'professional', price: 100 })]
    const w = mount(HotelFundador, MOUNT_OPTS)
    await flushPromises()

    expect(founderPrices(w)).toEqual(['USD 70'])
  })
})
