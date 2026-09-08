// #46 — el hotel mejora su plan por su cuenta "pagando lo que falta de su suscripción".
// El Checkout no sirve para esto: con una suscripción viva corta con 409 a propósito (BUG-9, ver
// create-checkout-session.test.ts). El camino es `stripe.subscriptions.update()` sobre el ítem que
// ya existe con `proration_behavior:'always_invoice'`, que factura y cobra EXACTAMENTE la diferencia.
import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { RepositoryAdapter } from 'arckode-framework'
import { ConflictError, ValidationError } from 'arckode-framework'

// `mock.module` es GLOBAL al proceso de bun test (misma advertencia que
// tests/create-checkout-session.test.ts): se parte del módulo real y solo se pisa `getClient`,
// que sin STRIPE_SECRET_KEY devolvería null y taparía todo con "Stripe no está configurado".
const actualStripe = await import('../../../services/stripe-service')
const realStripeService = { ...(actualStripe as any).StripeService }

/** `null` = plataforma sin Stripe configurado (el caso que NO puede romper con un crash). */
let stripeClient: any = null
let retrieves: string[] = []
let updates: any[] = []
let previews: any[] = []
let invoiceRetrieves: string[] = []
/** La factura que Stripe devuelve como `latest_invoice` del update: el cobro puede fallar. */
let invoiceOnUpdate: any = { id: 'in_1', status: 'paid', amount_due: 25000, amount_paid: 25000, currency: 'usd' }
/** Con un valor acá, el update de Stripe devuelve OTRO price: simula que no quedó aplicado
 *  (por ejemplo, una respuesta cacheada por idempotencia). `null` = quedó aplicado. */
let priceOnUpdate: string | null = null

mock.module('../../../services/stripe-service', () => ({
  ...actualStripe,
  StripeService: { ...realStripeService, getClient: async () => stripeClient },
}))

afterAll(() => {
  mock.module('../../../services/stripe-service', () => ({
    ...actualStripe,
    StripeService: realStripeService,
  }))
})

const { previewUpgrade, applyUpgrade } = await import('../usecases/upgrade-plan')

// Fin del período vigente que devuelve Stripe en el ítem (la API 2025-08-27 lo movió ahí).
const PERIOD_END = 1893456000

function fakeStripe() {
  return {
    subscriptions: {
      retrieve: async (id: string) => {
        retrieves.push(id)
        return { id, items: { data: [{ id: 'si_1', current_period_end: PERIOD_END, price: { id: 'price_ess_99' } }] } }
      },
      update: async (id: string, params: any, options?: any) => {
        updates.push({ id, params, options })
        // Stripe devuelve el ítem YA con el price nuevo: el usecase lo confirma antes de
        // reflejar el plan en local. `priceOnUpdate` deja simular que NO quedó aplicado.
        const price = { id: priceOnUpdate ?? params?.items?.[0]?.price }
        return { id, items: { data: [{ id: 'si_1', current_period_end: PERIOD_END, price }] }, latest_invoice: invoiceOnUpdate }
      },
    },
    invoices: {
      createPreview: async (params: any) => {
        previews.push(params)
        return { id: 'in_preview', status: 'draft', amount_due: 25000, currency: 'usd' }
      },
      retrieve: async (id: string) => { invoiceRetrieves.push(id); return invoiceOnUpdate },
    },
  }
}

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

const ESSENTIAL = { id: 'plan-ess', name: 'Esencial', slug: 'esencial', price: 99, currency: 'USD', stripePriceId: 'price_ess_99', isActive: 1 }
const PRO = { id: 'plan-pro', name: 'Professional', slug: 'pro', price: 349, currency: 'USD', stripePriceId: 'price_pro_349', isActive: 1 }
const SIN_PRECIO = { id: 'plan-enterprise', name: 'Enterprise', slug: 'enterprise', price: 999, currency: 'USD', isActive: 1 }

/** Hotel pagando el plan barato: la fila que el gate elegiría (active + stripeSubscriptionId). */
function activeSub(over: any = {}) {
  return {
    id: 's1', hotelId: 'h1', planId: 'plan-ess', status: 'active',
    stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    currentPeriodEnd: '2029-12-31T00:00:00.000Z',
    // El modelo declara `timestamps: true`: toda fila real trae `updatedAt`, y de ahí sale el
    // token del intento en la clave de idempotencia.
    updatedAt: '2026-09-01T00:00:00.000Z', ...over,
  }
}

function setup(subs: any[]) {
  const subRows = subs
  const hotelRows = [{ id: 'h1', name: 'Hotel Sol', email: 'dueno@hotel.com', plan: 'esencial' }]
  const deps = {
    subscriptionsRepo: repoOf(subRows),
    hotelsRepo: repoOf(hotelRows),
    plansRepo: repoOf([ESSENTIAL, PRO, SIN_PRECIO]),
    logger: silentLogger(),
  }
  return { deps, subRows, hotelRows }
}

beforeEach(() => {
  retrieves = []
  updates = []
  previews = []
  invoiceRetrieves = []
  invoiceOnUpdate = { id: 'in_1', status: 'paid', amount_due: 25000, amount_paid: 25000, currency: 'usd' }
  priceOnUpdate = null
  stripeClient = fakeStripe()
})

describe('applyUpgrade — el criterio de aceptación de #46', () => {
  it('mueve el ÍTEM existente al price del plan caro con always_invoice y deja el plan local en el nuevo', async () => {
    const { deps, subRows, hotelRows } = setup([activeSub()])

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    // Se actualiza la suscripción que YA existe (no se crea una segunda: eso es BUG-9).
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('sub_1')
    expect(updates[0].params.items).toEqual([{ id: 'si_1', price: 'price_pro_349' }])
    expect(updates[0].params.proration_behavior).toBe('always_invoice')

    // Se cobró la diferencia y quedó paga.
    expect(res.applied).toBe(true)
    expect(res.paid).toBe(true)
    expect(res.invoiceStatus).toBe('paid')
    expect(res.amountCharged).toBe(25000)
    expect(res.currency).toBe('usd')
    expect(res.planId).toBe('plan-pro')
    expect(res.previousPlanId).toBe('plan-ess')

    // Y el plan local ya es el nuevo, sin esperar el webhook (que igual llega y es idempotente).
    expect(subRows[0].planId).toBe('plan-pro')
    expect(hotelRows[0].plan).toBe('pro')
  })

  it('si la factura del prorrateo queda IMPAGA el resultado lo refleja (no canta victoria)', async () => {
    // `always_invoice` emite y cobra en el acto: si la tarjeta rechaza, la factura queda abierta
    // y Stripe manda invoice.payment_failed (el webhook mueve la fila a past_due).
    invoiceOnUpdate = { id: 'in_2', status: 'open', amount_due: 25000, amount_paid: 0, currency: 'usd' }
    const { deps, subRows } = setup([activeSub()])

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(res.paid).toBe(false)
    expect(res.invoiceStatus).toBe('open')
    expect(res.amountCharged).toBe(25000)
    // En Stripe el plan nuevo YA rige aunque no se haya cobrado: la fila local dice la verdad
    // de Stripe y del impago se ocupa el dunning.
    expect(subRows[0].planId).toBe('plan-pro')
  })

  // Re-revisión #46: sin clave de idempotencia, dos pedidos concurrentes del mismo hotel (dos
  // pestañas, doble clic, un reintento superpuesto) leen los dos el estado local viejo, los dos
  // pasan el chequeo de "ya estás en ese plan" y los dos facturan su prorrateo: doble cobro real.
  it('manda una clave de idempotencia que describe la transición, para que dos pedidos concurrentes no cobren dos veces', async () => {
    const { deps } = setup([activeSub()])

    await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(updates).toHaveLength(1)
    const clave = updates[0].options?.idempotencyKey
    expect(typeof clave).toBe('string')
    // La clave identifica el INTENTO: incluye el `updatedAt` de la fila leída, así dos pedidos
    // concurrentes (mismo snapshot) comparten clave, pero un intento posterior —tras cualquier
    // escritura sobre la suscripción— estrena una. Atarla sólo a origen→destino haría que Stripe
    // devolviera la respuesta CACHEADA de 24h en un A→B→A→B legítimo del mismo día.
    expect(clave).toBe('upgrade:h1:sub_1:plan-pro:2026-09-01T00:00:00.000Z')
  })

  // Si Stripe devolviera una respuesta cacheada por idempotencia (o el ítem no fuera el que se
  // mandó a cambiar), escribir el plan nuevo en local afirmaría algo falso: el hotel quedaría con
  // el plan pago sin que Stripe lo haya cobrado.
  it('si Stripe NO quedó en el plan destino, no refleja nada en local y lo dice', async () => {
    priceOnUpdate = 'price_ess_99' // el ítem siguió en el plan viejo
    const { deps, subRows, hotelRows } = setup([activeSub()])

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(res.applied).toBe(false)
    expect(res.paid).toBe(false)
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).not.toBe('pro')
  })

  it('con latest_invoice sin expandir (solo el id) va a buscarla antes de decir que se cobró', async () => {
    invoiceOnUpdate = 'in_3'
    const { deps } = setup([activeSub()])
    stripeClient.invoices.retrieve = async (id: string) => {
      invoiceRetrieves.push(id)
      return { id, status: 'paid', amount_due: 25000, currency: 'usd' }
    }

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    expect(invoiceRetrieves).toEqual(['in_3'])
    expect(res.paid).toBe(true)
  })

  // Revisión #46: la tarjeta ya se cobró en `subscriptions.update`. Leer la factura es una
  // llamada de RED más y, si fallaba, la excepción subía: el hotel quedaba cobrado mirando un
  // error, sin reflejo del plan nuevo y sin un solo log del cobro. Justo el escenario que el
  // archivo dice evitar, pero blindado sólo para el fallo de escritura local.
  it('si falla la lectura de la factura DESPUÉS del cobro, no lanza: aplica el plan y no afirma pago', async () => {
    invoiceOnUpdate = 'in_4'
    const { deps, subRows, hotelRows } = setup([activeSub()])
    stripeClient.invoices.retrieve = async () => { throw new Error('Stripe timeout') }

    const res = await applyUpgrade(deps, 'h1', 'plan-pro')

    // No se pierde el cambio: el plan quedó aplicado local y en el espejo.
    expect(res.applied).toBe(true)
    expect(subRows[0].planId).toBe('plan-pro')
    expect(hotelRows[0].plan).toBe('pro')
    // Y NO se afirma un cobro que no se pudo confirmar.
    expect(res.paid).toBe(false)
    expect(res.invoiceStatus).toBeNull()
  })
})

describe('previewUpgrade — cuánto va a pagar, sin cobrar', () => {
  it('devuelve el monto prorrateado y NO llama a ningún método que cobre', async () => {
    const { deps, subRows, hotelRows } = setup([activeSub()])

    const res = await previewUpgrade(deps, 'h1', 'plan-pro')

    expect(res).toEqual({
      planId: 'plan-pro',
      planName: 'Professional',
      amountDue: 25000,
      currency: 'usd',
      currentPlanId: 'plan-ess',
      currentPlanName: 'Esencial',
      periodEnd: new Date(PERIOD_END * 1000).toISOString(),
    })
    // Nada que cobre ni que cambie el plan: ni update en Stripe ni escritura local.
    expect(updates).toHaveLength(0)
    expect(subRows[0].planId).toBe('plan-ess')
    expect(hotelRows[0].plan).toBe('esencial')
  })

  it('cotiza con el MISMO proration_behavior que el cobro (o el número mostrado sería otro)', async () => {
    const { deps } = setup([activeSub()])
    await previewUpgrade(deps, 'h1', 'plan-pro')
    expect(previews).toHaveLength(1)
    expect(previews[0].subscription).toBe('sub_1')
    expect(previews[0].subscription_details.items).toEqual([{ id: 'si_1', price: 'price_pro_349' }])
    expect(previews[0].subscription_details.proration_behavior).toBe('always_invoice')
  })
})

describe('upgrade — lo que NO se deja hacer', () => {
  it('downgrade (plan más barato) → ValidationError que manda al portal, sin tocar Stripe', async () => {
    // Con always_invoice un downgrade genera CRÉDITO, no cobro: no es "pagar lo que falta".
    const { deps } = setup([activeSub({ planId: 'plan-pro' })])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-ess') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toMatch(/portal de facturación/i)
    expect(updates).toHaveLength(0)
  })

  it('el preview del downgrade también corta antes de pedirle la cotización a Stripe', async () => {
    const { deps } = setup([activeSub({ planId: 'plan-pro' })])
    await expect(previewUpgrade(deps, 'h1', 'plan-ess')).rejects.toBeInstanceOf(ValidationError)
    expect(previews).toHaveLength(0)
  })

  it('el mismo plan → ValidationError "Ya estás en ese plan", sin tocar Stripe', async () => {
    const { deps } = setup([activeSub({ planId: 'plan-pro' })])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toMatch(/ya estás en ese plan/i)
    expect(updates).toHaveLength(0)
  })

  it('sin suscripción viva en Stripe (trialing sin stripeSubscriptionId) → ConflictError que remite al checkout', async () => {
    const { deps } = setup([{ id: 's1', hotelId: 'h1', planId: 'plan-ess', status: 'trialing', stripeCustomerId: 'cus_1' }])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.httpStatus).toBe(409)
    expect(err.message).toMatch(/checkout/i)
    expect(updates).toHaveLength(0)
  })

  it('sin ninguna fila de suscripción tampoco: el alta va por el checkout normal', async () => {
    const { deps } = setup([])
    await expect(applyUpgrade(deps, 'h1', 'plan-pro')).rejects.toBeInstanceOf(ConflictError)
  })

  it('plan destino sin stripePriceId → ValidationError, igual que el checkout', async () => {
    const { deps } = setup([activeSub()])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-enterprise') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toMatch(/sin precio configurado en Stripe/i)
    expect(updates).toHaveLength(0)
  })

  it('plan destino inexistente → NotFoundError (404)', async () => {
    const { deps } = setup([activeSub()])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-inventado') } catch (e) { err = e }
    expect(err.httpStatus).toBe(404)
    expect(updates).toHaveLength(0)
  })

  it('Stripe sin configurar en la plataforma → ValidationError, sin crash', async () => {
    stripeClient = null
    const { deps } = setup([activeSub()])
    let err: any
    try { await applyUpgrade(deps, 'h1', 'plan-pro') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toMatch(/Stripe no está configurado/i)
    await expect(previewUpgrade(deps, 'h1', 'plan-pro')).rejects.toBeInstanceOf(ValidationError)
  })
})
