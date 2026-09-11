// payment-gateways/tests/stripe-gateway-confirm.test.ts — REQ-RWP-01: `StripeGateway.confirm()`
// devuelve el detalle del outcome (failureCode/failureMessage/card/receiptUrl/occurredAt) que
// payment_attempts necesita para explicar por qué una reserva web quedó sin cobrar.
//
// Sin red: la firma se calcula acá con el mismo HMAC que Stripe (patrón de
// payments/tests/webhook-failed.test.ts) y la lectura del charge se stubea sobre el cliente
// interno del gateway. Nunca se guarda más que marca + últimos 4 de la tarjeta.

import { describe, it, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import { StripeGateway } from '../../../services/payment-gateway/stripe-gateway'

const WHSEC = 'whsec_test'

function stripeSig(payload: string, ts: number): string {
  const v1 = createHmac('sha256', WHSEC).update(`${ts}.${payload}`, 'utf8').digest('hex')
  return `t=${ts},v1=${v1}`
}

function makeGateway(): StripeGateway {
  return new StripeGateway({ secretKey: 'sk_test_x', webhookSecret: WHSEC, currency: 'usd' }, 'test')
}

/** Cualquier llamada real a Stripe rompe el test: no hay red acá. */
function stubRetrieve(gw: StripeGateway, impl: (...args: any[]) => Promise<any>) {
  ;(gw as any).stripe.paymentIntents.retrieve = impl
}

async function confirmEvent(gw: StripeGateway, event: Record<string, unknown>) {
  const payload = JSON.stringify(event)
  const ts = Math.floor(Date.now() / 1000)
  return gw.confirm({
    hotelId: 'h1',
    rawBody: Buffer.from(payload),
    headers: { 'stripe-signature': stripeSig(payload, ts) },
  })
}

const CREATED = 1_757_000_000 // segundos epoch, como lo manda Stripe

const FAILED_EVENT = {
  id: 'evt_failed_1',
  type: 'payment_intent.payment_failed',
  created: CREATED,
  data: {
    object: {
      id: 'pi_1', amount: 15000, currency: 'usd', metadata: { reference: 'res-1' },
      last_payment_error: {
        code: 'card_declined',
        decline_code: 'generic_decline',
        message: 'Your card was declined.',
        payment_method: { card: { brand: 'visa', last4: '0002', exp_month: 12, exp_year: 2030 } },
      },
    },
  },
}

const COMPLETED_EVENT = {
  id: 'evt_completed_1',
  type: 'checkout.session.completed',
  created: CREATED,
  data: {
    object: {
      id: 'cs_1', payment_status: 'paid', amount_total: 15000, currency: 'usd',
      client_reference_id: 'res-1', payment_intent: 'pi_1',
    },
  },
}

const EXPIRED_EVENT = {
  id: 'evt_expired_1',
  type: 'checkout.session.expired',
  created: CREATED,
  data: { object: { id: 'cs_2', payment_status: 'unpaid', amount_total: 15000, currency: 'usd', client_reference_id: 'res-2' } },
}

describe('StripeGateway.confirm — detalle del outcome (REQ-RWP-01)', () => {
  it('payment_intent.payment_failed: failureCode, failureMessage, marca+last4 y occurredAt ISO', async () => {
    const gw = makeGateway()
    stubRetrieve(gw, async () => { throw new Error('no debería consultar el charge en un fallo') })

    const out = await confirmEvent(gw, FAILED_EVENT)

    expect(out?.status).toBe('failed')
    expect(out?.reference).toBe('res-1')
    expect(out?.failureCode).toBe('card_declined')
    expect(out?.failureMessage).toBe('Your card was declined.')
    expect(out?.card).toEqual({ brand: 'visa', last4: '0002' })
    expect(out?.occurredAt).toBe(new Date(CREATED * 1000).toISOString())
  })

  it('checkout.session.completed pagada: lee el charge y suma card + receiptUrl', async () => {
    const gw = makeGateway()
    const calls: any[] = []
    stubRetrieve(gw, async (id: string, opts: any) => {
      calls.push([id, opts])
      return {
        latest_charge: {
          payment_method_details: { card: { brand: 'visa', last4: '4242' } },
          receipt_url: 'https://r/x',
        },
      }
    })

    const out = await confirmEvent(gw, COMPLETED_EVENT)

    expect(out?.status).toBe('paid')
    expect(out?.card).toEqual({ brand: 'visa', last4: '4242' })
    expect(out?.receiptUrl).toBe('https://r/x')
    expect(out?.occurredAt).toBe(new Date(CREATED * 1000).toISOString())
    expect(calls).toEqual([['pi_1', { expand: ['latest_charge'] }]])
  })

  it('checkout.session.completed pagada con lectura del charge que falla: sigue paid, sin card ni recibo, no lanza', async () => {
    const gw = makeGateway()
    stubRetrieve(gw, async () => { throw new Error('boom') })

    const out = await confirmEvent(gw, COMPLETED_EVENT)

    expect(out?.status).toBe('paid')
    expect(out?.eventId).toBe('evt_completed_1')
    expect(out?.reference).toBe('res-1')
    expect(out?.card).toBeUndefined()
    expect(out?.receiptUrl).toBeUndefined()
    expect(out?.failureCode).toBeUndefined()
  })

  it('checkout.session.expired: status expired, sin failureCode', async () => {
    const gw = makeGateway()
    stubRetrieve(gw, async () => { throw new Error('no debería consultar el charge en una expiración') })

    const out = await confirmEvent(gw, EXPIRED_EVENT)

    expect(out?.status).toBe('expired')
    expect(out?.failureCode).toBeUndefined()
    expect(out?.failureMessage).toBeUndefined()
    expect(out?.card).toBeUndefined()
    expect(out?.occurredAt).toBe(new Date(CREATED * 1000).toISOString())
  })
})
