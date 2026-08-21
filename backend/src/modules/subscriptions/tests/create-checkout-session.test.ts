// BUG-9 — doble suscripción: con una fila `active`/`past_due` en `subscriptions`, lanzar otro
// Checkout `mode:'subscription'` creaba una SEGUNDA suscripción en Stripe (segundo cobro
// mensual) y huérfana la vieja: `create-checkout-session.ts` leía la fila y jamás miraba
// `sub.status`. Acá se clava la puerta de entrada: status vivo → 409 SIN tocar Stripe;
// `canceled`/`expired`/sin fila (y `trialing`, la conversión de la prueba) siguen pasando.
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { RepositoryAdapter } from 'arckode-framework'
import { ConflictError } from 'arckode-framework'

// `mock.module` es GLOBAL al proceso de bun test (misma advertencia que
// payment-requests/tests/stripe-webhook.test.ts): se parte del módulo real y solo se pisa
// `getClient`, que sin STRIPE_SECRET_KEY devolvería null y taparía el test con el
// ValidationError de "Stripe no está configurado".
const actualStripe = await import('../../../services/stripe-service')
const realStripeService = { ...(actualStripe as any).StripeService }

let sessionsCreated: any[] = []
let customersCreated: any[] = []

mock.module('../../../services/stripe-service', () => ({
  ...actualStripe,
  StripeService: {
    ...realStripeService,
    getClient: async () => ({
      customers: { create: async (input: any) => { customersCreated.push(input); return { id: 'cus_test_1' } } },
      checkout: { sessions: { create: async (input: any) => { sessionsCreated.push(input); return { id: 'cs_test_1', url: 'https://checkout.stripe.test/pay' } } } },
    }),
  },
}))

// El mock de `getClient` es GLOBAL al proceso de bun test: sin esto, los archivos que corran
// después creerían que Stripe está configurado (mismo patrón de restore que
// payment-requests/tests/stripe-webhook.test.ts).
afterAll(() => {
  mock.module('../../../services/stripe-service', () => ({
    ...actualStripe,
    StripeService: realStripeService,
  }))
})

const { createCheckoutSession } = await import('../usecases/create-checkout-session')

function repoOf(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async (f: any = {}) => rows.filter(r => Object.entries(f).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => rows.find(r => r.id === id) ?? null,
    create: async (r: any) => { rows.push(r); return r },
    update: async (id: string, patch: any) => {
      const r = rows.find(x => x.id === id)
      if (r) Object.assign(r, patch)
      return r
    },
  } as unknown as RepositoryAdapter<any>
}

const PLAN = { id: 'plan-pro', name: 'Professional', stripePriceId: 'price_pro_349' }
const HOTEL = { id: 'h1', name: 'Hotel Sol', email: 'dueno@hotel.com' }

function depsWith(subs: any[]) {
  return {
    subscriptionsRepo: repoOf(subs),
    hotelsRepo: repoOf([HOTEL]),
    plansRepo: repoOf([PLAN]),
    logger: silentLogger(),
  }
}

beforeEach(() => {
  sessionsCreated = []
  customersCreated = []
})

describe('createCheckoutSession — BUG-9: no crear una segunda suscripción', () => {
  it('con suscripción active rechaza 409 y NUNCA llama a Stripe (ni customer ni session)', async () => {
    const deps = depsWith([{ id: 's1', hotelId: 'h1', planId: 'plan-ess', status: 'active', stripeCustomerId: 'cus_viejo' }])
    let err: any
    try { await createCheckoutSession(deps, 'h1', 'plan-pro', 'https://app.test') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.httpStatus).toBe(409)
    expect(err.message).toMatch(/suscripción activa/i)
    expect(sessionsCreated).toHaveLength(0)
    expect(customersCreated).toHaveLength(0)
  })

  it('con suscripción past_due también rechaza (sigue viva en Stripe hasta cancelarse)', async () => {
    const deps = depsWith([{ id: 's1', hotelId: 'h1', planId: 'plan-ess', status: 'past_due', stripeCustomerId: 'cus_viejo' }])
    await expect(createCheckoutSession(deps, 'h1', 'plan-pro', 'https://app.test')).rejects.toThrow(/suscripción activa/i)
    expect(sessionsCreated).toHaveLength(0)
  })

  it('con suscripción active rechaza TAMBIÉN el mismo plan: todo Checkout nuevo es una segunda suscripción', async () => {
    const deps = depsWith([{ id: 's1', hotelId: 'h1', planId: 'plan-pro', status: 'active', stripeCustomerId: 'cus_viejo' }])
    await expect(createCheckoutSession(deps, 'h1', 'plan-pro', 'https://app.test')).rejects.toBeInstanceOf(ConflictError)
    expect(sessionsCreated).toHaveLength(0)
  })

  it('con suscripción canceled el checkout sigue disponible (reactivación)', async () => {
    const deps = depsWith([{ id: 's1', hotelId: 'h1', planId: 'plan-ess', status: 'canceled', stripeCustomerId: 'cus_viejo' }])
    const res = await createCheckoutSession(deps, 'h1', 'plan-pro', 'https://app.test')
    expect(res.url).toBe('https://checkout.stripe.test/pay')
    expect(sessionsCreated).toHaveLength(1)
    expect(sessionsCreated[0].mode).toBe('subscription')
    expect(sessionsCreated[0].customer).toBe('cus_viejo') // reutiliza el Customer, no crea otro
  })

  it('con suscripción expired el checkout sigue disponible', async () => {
    const deps = depsWith([{ id: 's1', hotelId: 'h1', planId: 'plan-ess', status: 'expired' }])
    const res = await createCheckoutSession(deps, 'h1', 'plan-pro', 'https://app.test')
    expect(res.url).toBeTruthy()
    expect(sessionsCreated).toHaveLength(1)
  })

  it('en trialing el checkout sigue disponible: la prueba no tiene suscripción en Stripe aún', async () => {
    const deps = depsWith([{ id: 's1', hotelId: 'h1', planId: 'plan-pro', status: 'trialing', stripeCustomerId: 'cus_viejo' }])
    const res = await createCheckoutSession(deps, 'h1', 'plan-pro', 'https://app.test')
    expect(res.url).toBeTruthy()
    expect(sessionsCreated).toHaveLength(1)
  })

  it('sin fila de suscripción (hotel viejo) crea el Customer y el checkout normalmente', async () => {
    const deps = depsWith([])
    const res = await createCheckoutSession(deps, 'h1', 'plan-pro', 'https://app.test')
    expect(res.url).toBeTruthy()
    expect(customersCreated).toHaveLength(1)
    expect(sessionsCreated).toHaveLength(1)
  })
})
