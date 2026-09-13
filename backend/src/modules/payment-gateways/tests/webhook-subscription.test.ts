// payment-gateways/tests/webhook-subscription.test.ts — #308: avisos sobre el webhook de Stripe.
// Sin red: el usecase es puro y la integración con testGatewayConnection stubea StripeGateway.

import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { stripeWebhookWarnings, REQUIRED_STRIPE_WEBHOOK_EVENTS } from '../usecases/webhook-subscription'
import type { StripeWebhookEndpointInfo } from '../usecases/webhook-subscription'
import { testGatewayConnection } from '../usecases/test-connection'
import { StripeGateway } from '../../../services/payment-gateway/stripe-gateway'
import { encryptCredentials } from '../../../services/payment-gateway/crypto'
import type { PaymentGatewayRow } from '../types'

beforeAll(() => {
  process.env.PAYMENTS_ENCRYPTION_KEY = 'test-master-key-de-al-menos-32-caracteres!!'
})

const HOTEL = 'hotel-demo'
const URL_OWN = `https://pms.example.com/api/public/webhook/stripe/${HOTEL}`

function ep(over: Partial<StripeWebhookEndpointInfo> = {}): StripeWebhookEndpointInfo {
  return { id: 'we_1', url: URL_OWN, status: 'enabled', enabledEvents: [...REQUIRED_STRIPE_WEBHOOK_EVENTS], ...over }
}

describe('stripeWebhookWarnings', () => {
  it('endpoint del hotel sin payment_intent.payment_failed → 1 warning que nombra el evento y la url', () => {
    const w = stripeWebhookWarnings(HOTEL, [ep({ enabledEvents: ['checkout.session.completed', 'checkout.session.expired'] })])
    expect(w.length).toBe(1)
    expect(w[0]).toContain('payment_intent.payment_failed')
    expect(w[0]).toContain('charge.refunded')
    expect(w[0]).toContain(URL_OWN)
  })

  it("enabledEvents ['*'] → sin warnings", () => {
    expect(stripeWebhookWarnings(HOTEL, [ep({ enabledEvents: ['*'] })])).toEqual([])
  })

  it('todos los requeridos tildados → sin warnings', () => {
    expect(stripeWebhookWarnings(HOTEL, [ep()])).toEqual([])
  })

  it('ningún endpoint del hotel (otro hotelId en la url) → 1 warning con el path esperado', () => {
    const w = stripeWebhookWarnings(HOTEL, [ep({ url: 'https://pms.example.com/api/public/webhook/stripe/otro-hotel' })])
    expect(w.length).toBe(1)
    expect(w[0]).toContain('No hay endpoint')
    expect(w[0]).toContain('/api/public/webhook/stripe/')
    expect(w[0]).toContain(HOTEL)
  })

  it('lista vacía → 1 warning de no hay endpoint', () => {
    const w = stripeWebhookWarnings(HOTEL, [])
    expect(w.length).toBe(1)
    expect(w[0]).toContain('No hay endpoint')
  })

  it("status 'disabled' → warning que dice deshabilitado", () => {
    const w = stripeWebhookWarnings(HOTEL, [ep({ status: 'disabled' })])
    expect(w.length).toBe(1)
    expect(w[0]).toContain('deshabilitado')
    expect(w[0]).toContain(URL_OWN)
  })

  it('reconoce el endpoint con query string y trailing slash', () => {
    const w = stripeWebhookWarnings(HOTEL, [ep({ url: `${URL_OWN}/?src=dashboard`, enabledEvents: ['checkout.session.completed'] })])
    expect(w.length).toBe(1)
    expect(w[0]).toContain('payment_intent.payment_failed')
  })
})

describe('testGatewayConnection (stripe) + warnings del webhook', () => {
  const origRetrieve = StripeGateway.prototype.retrieveAccount
  const origList = StripeGateway.prototype.listWebhookEndpoints
  afterEach(() => {
    StripeGateway.prototype.retrieveAccount = origRetrieve
    StripeGateway.prototype.listWebhookEndpoints = origList
  })

  function stripeRow(): PaymentGatewayRow {
    return {
      id: 'gw1', hotelId: HOTEL, provider: 'stripe', mode: 'test', enabled: true, isDefault: true,
      credentials: encryptCredentials({ secretKey: 'sk_test_abc123', currency: 'usd' }),
    }
  }

  it('list devuelve endpoint sin payment_failed → ok:true con 1 warning', async () => {
    StripeGateway.prototype.retrieveAccount = async () => ({ id: 'acct_1', name: 'Hotel Demo' })
    StripeGateway.prototype.listWebhookEndpoints = async () => [ep({ enabledEvents: ['checkout.session.completed', 'checkout.session.expired', 'charge.refunded'] })]
    const r = await testGatewayConnection(stripeRow())
    expect(r.ok).toBe(true)
    expect(r.accountName).toBe('Hotel Demo')
    expect(r.warnings?.length).toBe(1)
    expect(r.warnings?.[0]).toContain('payment_intent.payment_failed')
  })

  it('list lanza (restricted key sin permiso) → ok:true y sin warnings', async () => {
    StripeGateway.prototype.retrieveAccount = async () => ({ id: 'acct_1', name: 'Hotel Demo' })
    StripeGateway.prototype.listWebhookEndpoints = async () => { throw new Error('permission denied') }
    const r = await testGatewayConnection(stripeRow())
    expect(r.ok).toBe(true)
    expect(r.warnings).toBeUndefined()
  })
})
