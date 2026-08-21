// suscripcion-plan-cta.test.ts — El botón de cada plan en /panel/suscripcion.
//
// El bug (issue #29): el badge "Tu plan" se pintaba con `p.id === sub.planId`, pero el texto del
// botón exigía ADEMÁS `status === 'active'`. Un hotel en `trialing` veía la misma tarjeta con
// "Tu plan" arriba y "Suscribirse a Professional" abajo, y el botón nunca se deshabilitaba para el
// plan que ya tenía: apretarlo relanzaba el Checkout de una suscripción viva (segundo cobro).
//
// Lo que se protege acá:
//   1. El CTA mira el PLAN, no el estado: la tarjeta del plan actual jamás dice "Suscribirse a X".
//   2. Con una suscripción viva en Stripe (`active` / `past_due`) TODOS los botones están
//      deshabilitados y NO llaman a checkout — el plan actual y también cualquier OTRO plan:
//      relanzar el Checkout crea una SEGUNDA suscripción (doble cobro) y huérfana la vieja
//      (BUG-9; el backend espeja la regla en create-checkout-session.ts con 409).
//   3. En `trialing` NO hay suscripción de Stripe todavía: el Checkout es la ÚNICA vía de
//      conversión, así que el botón sigue vivo — con texto propio, no con el de un plan ajeno.
//   4. Con `canceled`/`expired` (o sin suscripción) cambiar de plan SÍ se puede: la vieja ya
//      no cobra, un Checkout nuevo no duplica nada.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const mySubscription = vi.fn()
const publicPlans = vi.fn()
vi.mock('@/services/Signup.service', () => ({
  SignupService: {
    mySubscription: (...a: unknown[]) => mySubscription(...a),
    publicPlans: (...a: unknown[]) => publicPlans(...a),
  },
}))

const checkout = vi.fn()
vi.mock('@/services/Subscriptions.service', () => ({
  SubscriptionsService: {
    checkout: (...a: unknown[]) => checkout(...a),
    portal: vi.fn(() => Promise.resolve({ url: 'https://portal.test' })),
  },
}))

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))

import Suscripcion from './index.vue'

const PLANS = [
  { id: 'plan-ess', name: 'Essential', slug: 'essential', price: 99, currency: 'USD', description: '', features: [] },
  { id: 'plan-pro', name: 'Professional', slug: 'professional', price: 349, currency: 'USD', description: '', features: [] },
]

const MOUNT_OPTS = {
  global: {
    stubs: {
      SectionCard: { template: '<section><slot /></section>' },
      EmptyState: true,
    },
  },
}

function subscription(over: Record<string, unknown> = {}) {
  return {
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: null,
    planId: 'plan-pro',
    allowed: true,
    reason: null,
    daysLeft: null,
    hasStripeCustomer: true,
    ...over,
  }
}

/** Botón CTA de cada tarjeta de plan, indexado por id de plan. */
async function mountWith(sub: Record<string, unknown>) {
  mySubscription.mockResolvedValue(sub)
  publicPlans.mockResolvedValue(PLANS)
  const w = mount(Suscripcion, MOUNT_OPTS)
  await flushPromises()
  const cards = w.findAll('div.grid > div')
  expect(cards.length).toBe(PLANS.length)
  const ctas = new Map(PLANS.map((p, i) => [p.id, cards[i]!.find('button')]))
  return { w, ctas }
}

beforeEach(() => {
  vi.clearAllMocks()
  checkout.mockResolvedValue({ url: 'https://checkout.test' })
})

describe('/panel/suscripcion — CTA del plan actual', () => {
  it('con suscripción activa el plan actual no se puede volver a contratar', async () => {
    const { ctas } = await mountWith(subscription({ status: 'active' }))
    const current = ctas.get('plan-pro')!

    expect(current.text()).not.toMatch(/Suscribirse/i)
    expect(current.text()).toMatch(/plan actual/i)
    expect(current.attributes('disabled')).toBeDefined()

    await current.trigger('click')
    await flushPromises()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('en prueba el plan actual no se ofrece como si fuera ajeno, pero se puede activar', async () => {
    const { ctas } = await mountWith(subscription({ status: 'trialing', hasStripeCustomer: false, daysLeft: 5 }))
    const current = ctas.get('plan-pro')!

    // El bug exacto de #29: "Tu plan" arriba y "Suscribirse a Professional" abajo.
    expect(current.text()).not.toMatch(/Suscribirse a Professional/i)
    expect(current.text()).toMatch(/plan actual/i)
    // El trial NO tiene suscripción en Stripe: el Checkout es la única salida a plan pago.
    expect(current.attributes('disabled')).toBeUndefined()

    await current.trigger('click')
    await flushPromises()
    expect(checkout).toHaveBeenCalledWith('plan-pro')
  })

  // BUG-9 — con status vivo, un plan DISTINTO tampoco puede relanzar el Checkout: antes este
  // era exactamente el camino del doble cobro ("Suscribirse a Essential" clickable con la
  // suscripción Professional activa).
  it('con suscripción activa un plan DISTINTO también queda bloqueado (no crea una segunda suscripción)', async () => {
    const { ctas } = await mountWith(subscription({ status: 'active' }))
    const other = ctas.get('plan-ess')!

    expect(other.text()).not.toMatch(/Suscribirse/i)
    expect(other.text()).toMatch(/suscripción activa/i)
    expect(other.attributes('disabled')).toBeDefined()

    await other.trigger('click')
    await flushPromises()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('con el pago pendiente un plan distinto también queda bloqueado', async () => {
    const { ctas } = await mountWith(subscription({ status: 'past_due' }))
    const other = ctas.get('plan-ess')!

    expect(other.attributes('disabled')).toBeDefined()
    expect(other.text()).not.toMatch(/Suscribirse/i)

    await other.trigger('click')
    await flushPromises()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('con la suscripción cancelada cambiar de plan vuelve a poderse (la vieja ya no cobra)', async () => {
    const { ctas } = await mountWith(subscription({ status: 'canceled' }))
    const other = ctas.get('plan-ess')!

    expect(other.text()).toBe('Suscribirse a Essential')
    expect(other.attributes('disabled')).toBeUndefined()

    await other.trigger('click')
    await flushPromises()
    expect(checkout).toHaveBeenCalledWith('plan-ess')
  })

  it('con la suscripción vencida cambiar de plan también se puede', async () => {
    const { ctas } = await mountWith(subscription({ status: 'expired' }))
    const other = ctas.get('plan-ess')!

    expect(other.attributes('disabled')).toBeUndefined()

    await other.trigger('click')
    await flushPromises()
    expect(checkout).toHaveBeenCalledWith('plan-ess')
  })

  it('con el pago pendiente el plan actual tampoco relanza el Checkout (se regulariza por el portal)', async () => {
    const { ctas } = await mountWith(subscription({ status: 'past_due' }))
    const current = ctas.get('plan-pro')!

    expect(current.text()).not.toMatch(/Suscribirse/i)
    expect(current.attributes('disabled')).toBeDefined()

    await current.trigger('click')
    await flushPromises()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('sin suscripción todos los planes se ofrecen igual', async () => {
    mySubscription.mockResolvedValue(subscription({ status: 'none', planId: '', allowed: false, hasStripeCustomer: false }))
    publicPlans.mockResolvedValue(PLANS)
    const w = mount(Suscripcion, MOUNT_OPTS)
    await flushPromises()
    const texts = w.findAll('div.grid > div').map(c => c.find('button').text())
    expect(texts).toEqual(['Suscribirse a Essential', 'Suscribirse a Professional'])
  })
})
