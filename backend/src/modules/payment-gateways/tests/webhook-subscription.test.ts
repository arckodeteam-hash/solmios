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

  it("status 'disabled' con ['*'] → igual avisa que está deshabilitado", () => {
    const w = stripeWebhookWarnings(HOTEL, [ep({ status: 'disabled', enabledEvents: ['*'] })])
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('deshabilitado')
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

// ── StripeGateway.listWebhookEndpoints: método REAL, sólo se stubea `webhookEndpoints.list` del ──
// cliente interno (patrón de payments/tests/refund.test.ts). Cubre el mapeo enabled_events →
// enabledEvents, status, coerción a String y `data` vacío/undefined. Sin red.
describe('StripeGateway.listWebhookEndpoints', () => {
  function makeGateway(listResult: any) {
    const gw = new StripeGateway({ secretKey: 'sk_test_x', currency: 'usd' }, 'test')
    const calls: any[] = []
    ;(gw as any).stripe.webhookEndpoints = {
      list: async (params: any) => { calls.push(params); return listResult },
    }
    return { gw, calls }
  }

  it('mapea id/url/status/enabled_events → {id,url,status,enabledEvents} como strings', async () => {
    const { gw, calls } = makeGateway({
      data: [
        { id: 'we_1', url: URL_OWN, status: 'enabled', enabled_events: ['checkout.session.completed', 'payment_intent.payment_failed'] },
        { id: 'we_2', url: 'https://otro.example.com/hook', status: 'disabled', enabled_events: ['*'] },
      ],
    })
    const r = await gw.listWebhookEndpoints()
    expect(r).toEqual([
      { id: 'we_1', url: URL_OWN, status: 'enabled', enabledEvents: ['checkout.session.completed', 'payment_intent.payment_failed'] },
      { id: 'we_2', url: 'https://otro.example.com/hook', status: 'disabled', enabledEvents: ['*'] },
    ])
    expect(calls).toEqual([{ limit: 100 }])
  })

  it('data vacío → []', async () => {
    const { gw } = makeGateway({ data: [] })
    expect(await gw.listWebhookEndpoints()).toEqual([])
  })

  it('respuesta sin data → []', async () => {
    const { gw } = makeGateway({})
    expect(await gw.listWebhookEndpoints()).toEqual([])
  })

  it('endpoint sin enabled_events → enabledEvents: []', async () => {
    const { gw } = makeGateway({ data: [{ id: 'we_3', url: URL_OWN, status: 'enabled' }] })
    expect(await gw.listWebhookEndpoints()).toEqual([{ id: 'we_3', url: URL_OWN, status: 'enabled', enabledEvents: [] }])
  })

  it('campos faltantes o no-string se coercionan a String', async () => {
    const { gw } = makeGateway({ data: [{ id: 123, enabled_events: [1, 'x'] }] })
    expect(await gw.listWebhookEndpoints()).toEqual([{ id: '123', url: '', status: '', enabledEvents: ['1', 'x'] }])
  })
})
