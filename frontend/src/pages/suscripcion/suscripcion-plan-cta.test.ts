// suscripcion-plan-cta.test.ts — El botón de cada plan en /panel/suscripcion.
//
// El bug (issue #29): el badge "Tu plan" se pintaba con `p.id === sub.planId`, pero el texto del
// botón exigía ADEMÁS `status === 'active'`. Un hotel en `trialing` veía la misma tarjeta con
// "Tu plan" arriba y "Suscribirse a Professional" abajo, y el botón nunca se deshabilitaba para el
// plan que ya tenía: apretarlo relanzaba el Checkout de una suscripción viva (segundo cobro).
//
// Lo que se protege acá:
//   1. El CTA mira el PLAN, no el estado: la tarjeta del plan actual jamás dice "Suscribirse a X",
//      y esa tarjeta se identifica con el badge "Plan actual" (#84, CA 23).
//   2. Con una suscripción viva en Stripe (`active` / `past_due`) NINGÚN plan llama a checkout:
//      relanzar el Checkout crea una SEGUNDA suscripción (doble cobro) y huérfana la vieja
//      (BUG-9; el backend espeja la regla en create-checkout-session.ts con 409).
//   3. En `trialing` NO hay suscripción de Stripe todavía: el Checkout es la ÚNICA vía de
//      conversión, así que el botón sigue vivo — con texto propio, no con el de un plan ajeno.
//   4. Con `canceled`/`expired` (o sin suscripción) cambiar de plan SÍ se puede: la vieja ya
//      no cobra, un Checkout nuevo no duplica nada.
//   5. La sección "Estado" nombra el plan del hotel, también con la suscripción vencida
//      (#84, CA 9/10/22).
//
// Cambió en #84 (CA 2/25/26): antes, con la suscripción viva, los OTROS planes quedaban
// deshabilitados con "Ya tenés una suscripción activa" y no había forma de cambiarse desde acá.
// Ahora TODO plan que no sea el actual dice "Suscribirse a [nombre]" y funciona — sale por el
// flujo de cambio de plan (preview + confirmación), nunca por el Checkout, así que la protección
// de BUG-9 sigue en pie: lo que se asserta es que `checkout` NO se llama.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'

const mySubscription = vi.fn()
const publicPlans = vi.fn()
vi.mock('@/services/Signup.service', () => ({
  SignupService: {
    mySubscription: (...a: unknown[]) => mySubscription(...a),
    publicPlans: (...a: unknown[]) => publicPlans(...a),
  },
}))

const checkout = vi.fn()
const upgradePreview = vi.fn()
const upgrade = vi.fn()
vi.mock('@/services/Subscriptions.service', () => ({
  SubscriptionsService: {
    checkout: (...a: unknown[]) => checkout(...a),
    portal: vi.fn(() => Promise.resolve({ url: 'https://portal.test' })),
    upgradePreview: (...a: unknown[]) => upgradePreview(...a),
    upgrade: (...a: unknown[]) => upgrade(...a),
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

/**
 * Pinia REAL y fresca por montaje. La página lee el estado de la suscripción del store
 * compartido (la barra superior y el aviso muestran lo mismo), y el store pide el dato por
 * `SignupService.mySubscription`, que ya está mockeado acá arriba: así el test recorre el
 * camino completo (store → service) en vez de saltearlo.
 *
 * Fresca por montaje y no una sola global: el store cachea por hotel, y compartirla dejaría
 * al segundo test leyendo la suscripción del primero.
 */
function mountOpts() {
  return {
    global: {
      plugins: [createPinia()],
      stubs: {
        SectionCard: { template: '<section><slot /></section>' },
        EmptyState: true,
        // Sin Teleport: el modal de confirmación del cambio de plan queda dentro del wrapper.
        AppModal: { template: '<div class="modal"><slot /></div>' },
      },
    },
  }
}

function subscription(over: Record<string, unknown> = {}) {
  return {
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: null,
    planId: 'plan-pro',
    planName: 'Professional',
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
  const w = mount(Suscripcion, mountOpts())
  await flushPromises()
  const cards = w.findAll('div.grid > div')
  expect(cards.length).toBe(PLANS.length)
  const ctas = new Map(PLANS.map((p, i) => [p.id, cards[i]!.find('button')]))
  return { w, ctas }
}

beforeEach(() => {
  vi.clearAllMocks()
  checkout.mockResolvedValue({ url: 'https://checkout.test' })
  upgradePreview.mockResolvedValue({
    planId: 'plan-ess', planName: 'Essential', amountDue: 0, currency: 'usd',
    currentPlanId: 'plan-pro', currentPlanName: 'Professional', periodEnd: null,
  })
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

  // BUG-9 — con status vivo, un plan DISTINTO sigue sin poder relanzar el Checkout: ese era
  // exactamente el camino del doble cobro. Lo que cambió (#84, CA 2/25/26) es que ya no queda
  // BLOQUEADO con "Ya tenés una suscripción activa": se ofrece y sale por el cambio de plan.
  it('con suscripción activa un plan DISTINTO se ofrece pero NO por Checkout (no crea una segunda suscripción)', async () => {
    const { ctas } = await mountWith(subscription({ status: 'active' }))
    const other = ctas.get('plan-ess')!

    expect(other.text()).toBe('Suscribirse a Essential')
    expect(other.text()).not.toMatch(/suscripción activa/i)
    expect(other.attributes('disabled')).toBeUndefined()

    await other.trigger('click')
    await flushPromises()
    expect(checkout).not.toHaveBeenCalled()
    expect(upgradePreview).toHaveBeenCalledWith('plan-ess')
  })

  // #84 CA 2/25/26 — el plan MÁS BARATO que el actual también se ofrece: el backend acepta el
  // cambio en las dos direcciones. Antes decía "Ya tenés una suscripción activa" deshabilitado.
  it('con suscripción activa un plan MÁS BARATO se ofrece y su botón NO está deshabilitado', async () => {
    const { ctas } = await mountWith(subscription({ status: 'active', planId: 'plan-pro' }))
    const cheaper = ctas.get('plan-ess')! // 99 contra los 349 del plan actual

    expect(cheaper.text()).toBe('Suscribirse a Essential')
    expect(cheaper.attributes('disabled')).toBeUndefined()

    await cheaper.trigger('click')
    await flushPromises()
    expect(checkout).not.toHaveBeenCalled()
    expect(upgradePreview).toHaveBeenCalledWith('plan-ess')
  })

  it('con el pago pendiente un plan distinto también se ofrece, y tampoco por Checkout', async () => {
    const { ctas } = await mountWith(subscription({ status: 'past_due' }))
    const other = ctas.get('plan-ess')!

    expect(other.attributes('disabled')).toBeUndefined()
    expect(other.text()).toBe('Suscribirse a Essential')

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

  // #84 CA 9/10/22 y CA 23 — el nombre del plan tiene que estar a la vista SIN abrir nada, y
  // también con la suscripción caída: "Vencida" sola no dice de qué plan se habla.
  it('con la suscripción vencida el Estado nombra el plan y la tarjeta dice "Plan actual"', async () => {
    const { w } = await mountWith(subscription({ status: 'expired', planName: 'Professional' }))

    const estado = w.find('section') // la primera SectionCard es "Estado"
    expect(estado.text()).toMatch(/Plan actual:\s*Professional/)
    expect(estado.text()).toContain('Vencida')

    const cards = w.findAll('div.grid > div')
    expect(cards[1]!.text()).toContain('Plan actual') // badge de la tarjeta del plan del hotel
    expect(cards[0]!.text()).not.toContain('Plan actual')
  })

  // El plan puede haber sido retirado del catálogo: sin nombre no se inventa un "Plan actual: —".
  it('sin nombre de plan el Estado no muestra la línea del plan, pero sí el estado', async () => {
    const { w } = await mountWith(subscription({ status: 'active', planName: null }))

    const estado = w.find('section')
    expect(estado.text()).not.toMatch(/Plan actual:/)
    expect(estado.text()).toContain('Activa')
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
    mySubscription.mockResolvedValue(subscription({ status: 'none', planId: '', planName: null, allowed: false, hasStripeCustomer: false }))
    publicPlans.mockResolvedValue(PLANS)
    const w = mount(Suscripcion, mountOpts())
    await flushPromises()
    const texts = w.findAll('div.grid > div').map(c => c.find('button').text())
    expect(texts).toEqual(['Suscribirse a Essential', 'Suscribirse a Professional'])
  })
})
