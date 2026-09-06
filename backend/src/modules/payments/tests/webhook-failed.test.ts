// payments/tests/webhook-failed.test.ts — payment_intent.payment_failed (hallazgo de auditoría
// 2026-07-29): el módulo declaraba `onPaymentFailed` en sockets.ts/contract.events y el connector
// payments-webhooks.ts ya escuchaba el evento para disparar el webhook saliente `payment.failed`,
// pero NADA en el módulo lo invocaba nunca — settleStripeWebhook no tenía rama para
// `outcome.status==='failed'`, caía al `return` genérico sin tocar el payment ni avisar a nadie.
//
// Simétrico a webhook-expiry.test.ts (checkout.session.expired), pero el payload real de
// `payment_intent.payment_failed` es un PaymentIntent, no una Checkout Session: no tiene
// `client_reference_id` (campo exclusivo de Sessions) — el `reference` viaja en `metadata.reference`,
// que ahora sí se le pasa al PaymentIntent vía `payment_intent_data.metadata` en createCharge
// (stripe-gateway.ts). Sin ese fix, `reference` llegaría vacío y el 'failed' branch no podría
// identificar qué payment actualizar.

import { describe, it, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentsService } from '../service'
import { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import { PaymentEventStore } from '../../../services/payment-gateway/payment-events'

const log = silentLogger()
const silentCache: any = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const WHSEC = 'whsec_failed_test'

function stripeSig(payload: string, ts: number): string {
  const v1 = createHmac('sha256', WHSEC).update(`${ts}.${payload}`, 'utf8').digest('hex')
  return `t=${ts},v1=${v1}`
}

function paymentRepo() {
  const rows: any = { pay_1: { id: 'pay_1', hotelId: 'h1', status: 'processing', amount: 150, currency: 'usd' } }
  return {
    rows,
    findById: async (id: string) => rows[id] ?? null,
    findMany: async () => Object.values(rows),
    update: async (id: string, d: any) => { rows[id] = { ...rows[id], ...d }; return rows[id] },
    create: async (d: any) => d, count: async () => Object.keys(rows).length,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 1 }),
  } as any
}

function registryWith(): PaymentGatewayRegistry {
  const { encryptCredentials } = require('../../../services/payment-gateway/crypto')
  process.env.PAYMENTS_ENCRYPTION_KEY = 'test-master-key-de-al-menos-32-caracteres!!'
  const row = {
    id: 'gw1', hotelId: 'h1', provider: 'stripe', mode: 'test', enabled: true, isDefault: true,
    credentials: encryptCredentials({ secretKey: 'sk_test_x', webhookSecret: WHSEC, currency: 'usd' }),
  }
  const repo: any = { findMany: async (f: any) => (f.hotelId === 'h1' ? [row] : []) }
  return new PaymentGatewayRegistry(repo, log)
}

function makeService() {
  const pRepo = paymentRepo()
  const eventStore = new PaymentEventStore({
    _rows: new Map(),
    create: async function (d: any) { if (this._rows.has(d.id)) throw new Error('UNIQUE constraint failed'); this._rows.set(d.id, d); return d },
    delete: async function (id: string) { this._rows.delete(id) },
  } as any, log)
  const svc = new PaymentsService(pRepo, paymentRepo(), log, silentCache, undefined, undefined, registryWith(), eventStore)
  let failedCalls = 0
  let completedCalls = 0
  svc.setSockets({
    onPaymentFailed: async () => { failedCalls++ },
    onPaymentCompleted: async () => { completedCalls++ },
  })
  return { svc, pRepo, failedCalls: () => failedCalls, completedCalls: () => completedCalls }
}

// PaymentIntent real: sin client_reference_id (eso es de Checkout Session), reference en metadata.
const FAILED_EVENT = JSON.stringify({
  id: 'evt_failed_1',
  type: 'payment_intent.payment_failed',
  data: { object: { id: 'pi_1', amount: 15000, currency: 'usd', metadata: { reference: 'pay_1' } } },
})

const COMPLETED_EVENT = JSON.stringify({
  id: 'evt_completed_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_2', payment_status: 'paid', amount_total: 15000, currency: 'usd', client_reference_id: 'pay_1' } },
})

describe('webhook de pago: payment_intent.payment_failed (fix hallazgo auditoría 2026-07-29)', () => {
  it('marca el payment `failed` y dispara onPaymentFailed (no onPaymentCompleted)', async () => {
    const { svc, pRepo, failedCalls, completedCalls } = makeService()
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(FAILED_EVENT, ts)

    const r = await svc.handleStripeWebhook('h1', Buffer.from(FAILED_EVENT), sig)

    expect(r?.type).toBe('payment_failed')
    expect(pRepo.rows.pay_1.status).toBe('failed')
    expect(failedCalls()).toBe(1)
    expect(completedCalls()).toBe(0)
  })

  it('un reintento del mismo evento de fallo no lo procesa dos veces', async () => {
    const { svc, pRepo, failedCalls } = makeService()
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(FAILED_EVENT, ts)

    const r1 = await svc.handleStripeWebhook('h1', Buffer.from(FAILED_EVENT), sig)
    const r2 = await svc.handleStripeWebhook('h1', Buffer.from(FAILED_EVENT), sig)

    expect(r1?.type).toBe('payment_failed')
    expect(r2?.type).toBe('already_processed')
    expect(failedCalls()).toBe(1)
    expect(pRepo.rows.pay_1.status).toBe('failed')
  })

  it('el path `paid` (checkout.session.completed) sigue intacto — no lo rompió sumar `failed`', async () => {
    const { svc, pRepo, completedCalls, failedCalls } = makeService()
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(COMPLETED_EVENT, ts)

    const r = await svc.handleStripeWebhook('h1', Buffer.from(COMPLETED_EVENT), sig)

    expect(r?.type).toBe('payment_completed')
    expect(pRepo.rows.pay_1.status).toBe('completed')
    expect(completedCalls()).toBe(1)
    expect(failedCalls()).toBe(0)
  })
})
