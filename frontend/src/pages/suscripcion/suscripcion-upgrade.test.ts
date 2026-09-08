// suscripcion-upgrade.test.ts — El hotel mejora su plan solo, desde /panel/suscripcion (#46).
//
// Hasta acá, con una suscripción viva en Stripe TODOS los planes quedaban bloqueados con
// "Ya tenés una suscripción activa" (BUG-9: un Checkout nuevo crea una SEGUNDA suscripción que
// cobra en paralelo). El único camino para subir de plan era escribirle a soporte.
//
// Lo que se protege acá:
//   1. Con la suscripción viva, un plan MÁS CARO deja de estar bloqueado y ofrece mejorar
//      (mismo criterio que el backend: precio mayor al del plan actual).
//   2. Un plan más barato y el plan actual siguen bloqueados: un downgrade con prorrateo genera
//      crédito, no cobro, y se gestiona desde el Billing Portal.
//   3. En `trialing` no hay suscripción en Stripe: la contratación por Checkout no se toca.
//   4. El monto sale en CENTAVOS del backend (tal cual Stripe) y se muestra dividido por 100:
//      mostrarlo crudo diría "1234" donde se cobran 12,34.
//   5. `paid: false` = el plan se aplicó pero la tarjeta no pagó. La UI NO puede decir "listo":
//      avisa y manda al portal a arreglar el método de pago.
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
const portal = vi.fn()
const upgradePreview = vi.fn()
const upgrade = vi.fn()
vi.mock('@/services/Subscriptions.service', () => ({
  SubscriptionsService: {
    checkout: (...a: unknown[]) => checkout(...a),
    portal: (...a: unknown[]) => portal(...a),
    upgradePreview: (...a: unknown[]) => upgradePreview(...a),
    upgrade: (...a: unknown[]) => upgrade(...a),
  },
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: toastWarning, info: vi.fn() }),
}))

// El menú lateral lee el cache de módulos: tras el upgrade hay que revalidarlo o sigue mostrando
// lo del plan viejo. Se mockean los stores para no necesitar una pinia activa en el test.
const modulesRefresh = vi.fn()
vi.mock('@/stores/modules.store', () => ({
  useModulesStore: () => ({ refresh: modulesRefresh }),
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { hotelId: 'hotel-1' } }),
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
        // Sin Teleport: así el modal queda DENTRO del wrapper y se puede leer con find().
        AppModal: { template: '<div class="modal"><slot /><footer><slot name="footer" /></footer></div>' },
      },
    },
  }
}

function subscription(over: Record<string, unknown> = {}) {
  return {
    status: 'active',
    trialEndsAt: null,
    currentPeriodEnd: null,
    planId: 'plan-ess',
    allowed: true,
    reason: null,
    daysLeft: null,
    hasStripeCustomer: true,
    ...over,
  }
}

function preview(over: Record<string, unknown> = {}) {
  return {
    planId: 'plan-pro', planName: 'Professional',
    amountDue: 1234, currency: 'usd',
    currentPlanId: 'plan-ess', currentPlanName: 'Essential',
    periodEnd: '2026-10-12T00:00:00.000Z',
    ...over,
  }
}

function result(over: Record<string, unknown> = {}) {
  return {
    applied: true, paid: true,
    planId: 'plan-pro', planName: 'Professional', previousPlanId: 'plan-ess',
    amountCharged: 1234, currency: 'usd', invoiceStatus: 'paid',
    ...over,
  }
}

/** Monta la página y devuelve el CTA de cada tarjeta de plan, indexado por id de plan. */
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

/** Llega hasta el modal de confirmación apretando "Mejorar a Professional". */
async function openConfirm() {
  const { w, ctas } = await mountWith(subscription({ status: 'active', planId: 'plan-ess' }))
  await ctas.get('plan-pro')!.trigger('click')
  await flushPromises()
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  checkout.mockResolvedValue({ url: 'https://checkout.test' })
  portal.mockResolvedValue({ url: 'https://portal.test' })
  upgradePreview.mockResolvedValue(preview())
  upgrade.mockResolvedValue(result())
})

describe('/panel/suscripcion — mejora de plan con la suscripción viva', () => {
  it('un plan más caro ofrece mejorar en vez de decir que ya hay una suscripción activa', async () => {
    const { ctas } = await mountWith(subscription({ status: 'active', planId: 'plan-ess' }))
    const better = ctas.get('plan-pro')!

    expect(better.text()).toBe('Mejorar a Professional')
    expect(better.text()).not.toMatch(/suscripción activa/i)
    expect(better.attributes('disabled')).toBeUndefined()
  })

  it('el plan más barato y el actual siguen bloqueados (un downgrade se hace por el portal)', async () => {
    const { ctas } = await mountWith(subscription({ status: 'active', planId: 'plan-pro' }))

    const cheaper = ctas.get('plan-ess')!
    expect(cheaper.text()).toMatch(/suscripción activa/i)
    expect(cheaper.attributes('disabled')).toBeDefined()

    const current = ctas.get('plan-pro')!
    expect(current.text()).toMatch(/plan actual/i)
    expect(current.attributes('disabled')).toBeDefined()

    await cheaper.trigger('click')
    await current.trigger('click')
    await flushPromises()
    expect(upgradePreview).not.toHaveBeenCalled()
    expect(checkout).not.toHaveBeenCalled()
  })

  it('en prueba no hay upgrade: la contratación por Checkout queda igual que siempre', async () => {
    const { ctas } = await mountWith(subscription({ status: 'trialing', planId: 'plan-ess', hasStripeCustomer: false, daysLeft: 7 }))
    const better = ctas.get('plan-pro')!

    expect(better.text()).toBe('Suscribirse a Professional')
    await better.trigger('click')
    await flushPromises()
    expect(checkout).toHaveBeenCalledWith('plan-pro')
    expect(upgradePreview).not.toHaveBeenCalled()
  })

  it('antes de cobrar muestra el monto convertido de centavos, no el número crudo de Stripe', async () => {
    const w = await openConfirm()

    expect(upgradePreview).toHaveBeenCalledWith('plan-pro')
    expect(upgrade).not.toHaveBeenCalled() // nada se cobra sin confirmación explícita

    const modal = w.find('.modal')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('12,34')
    expect(modal.text()).not.toContain('1234')
    expect(modal.text()).toContain('Essential')
    expect(modal.text()).toContain('Professional')
  })

  it('al confirmar cobra, avisa y refresca la suscripción y el cache de módulos', async () => {
    const w = await openConfirm()
    mySubscription.mockResolvedValue(subscription({ status: 'active', planId: 'plan-pro' }))

    await w.find('footer').findAll('button')[1]!.trigger('click')
    await flushPromises()

    expect(upgrade).toHaveBeenCalledWith('plan-pro')
    expect(toastSuccess).toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
    expect(w.find('.modal').exists()).toBe(false)
    // Sin recargar a mano: el estado de la página y el menú lateral quedan al día.
    // `refresh()` y no `reset()`+`ensure()`: reset vacía el estado y el store falla ABIERTO,
    // así que el menú parpadearía mostrando módulos que el hotel quizá no tiene.
    expect(mySubscription).toHaveBeenCalledTimes(2)
    expect(modulesRefresh).toHaveBeenCalledWith('hotel-1')
  })

  // Cierre #46: con `applied:false` (el backend confirmó contra Stripe que el cambio NO quedó
  // aplicado) el mensaje de "pago pendiente" afirmaba dos cosas falsas: que el plan quedó activo
  // y que había un cobro para reintentar. `paid` también es false ahí, así que el orden importa.
  it('con applied:false NO dice que el plan quedó activo ni que hay un pago pendiente', async () => {
    upgrade.mockResolvedValue(result({ applied: false, paid: false, amountCharged: 0, invoiceStatus: null }))
    const w = await openConfirm()

    await w.find('footer').findAll('button')[1]!.trigger('click')
    await flushPromises()

    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
    // Ni "quedó activo" ni un monto pendiente inventado.
    const texto = toastError.mock.calls.map((c) => String(c[0]) + ' ' + String(c[1] ?? '')).join(' ')
    expect(texto).not.toMatch(/pendiente/i)
    expect(texto).not.toMatch(/quedó activo/i)
  })

  it('con el cobro rechazado (paid:false) avisa que el pago quedó pendiente y manda al portal', async () => {
    upgrade.mockResolvedValue(result({ paid: false, invoiceStatus: 'open' }))
    const w = await openConfirm()

    await w.find('footer').findAll('button')[1]!.trigger('click')
    await flushPromises()

    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastWarning).toHaveBeenCalled()
    expect(String(toastWarning.mock.calls[0]![0])).toMatch(/pendiente/i)

    const modal = w.find('.modal')
    expect(modal.text()).toMatch(/pendiente/i)
    expect(modal.text()).not.toMatch(/Ya estás en Professional\./i)

    const portalBtn = w.find('footer').findAll('button').find(b => /método de pago/i.test(b.text()))!
    expect(portalBtn).toBeTruthy()
    await portalBtn.trigger('click')
    await flushPromises()
    expect(portal).toHaveBeenCalled()
  })

  it('si el preview falla muestra el motivo del backend tal cual y no deja el botón colgado', async () => {
    upgradePreview.mockRejectedValue(new Error('Ese plan no es una mejora del actual. Para bajar de plan usá el portal de facturación.'))
    const { w, ctas } = await mountWith(subscription({ status: 'active', planId: 'plan-ess' }))

    await ctas.get('plan-pro')!.trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith(expect.any(String), 'Ese plan no es una mejora del actual. Para bajar de plan usá el portal de facturación.')
    expect(w.find('.modal').exists()).toBe(false)
    const better = w.findAll('div.grid > div')[1]!.find('button')
    expect(better.text()).toBe('Mejorar a Professional')
    expect(better.attributes('disabled')).toBeUndefined()
  })
})
