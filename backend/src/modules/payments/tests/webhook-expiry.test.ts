// payments/tests/webhook-expiry.test.ts — fix-refund-pos-card: checkout.session.expired.
//
// Simétrico a webhook-idempotency.test.ts (checkout.session.completed), pero para el evento de
// expiración: el payment `processing` pasa a `cancelled` y dispara `onExpired` — SIN tocar el path
// `paid` existente (webhook-idempotency.test.ts sigue pasando igual).

import { describe, it, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentsService } from '../service'
import { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import { PaymentEventStore } from '../../../services/payment-gateway/payment-events'

const log = silentLogger()
const silentCache: any = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const WHSEC = 'whsec_expiry_test'

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
  let expiredCalls = 0
  let completedCalls = 0
  svc.setSockets({
    onPaymentExpired: async () => { expiredCalls++ },
    onPaymentCompleted: async () => { completedCalls++ },
  })
  return { svc, pRepo, expiredCalls: () => expiredCalls, completedCalls: () => completedCalls }
}

const EXPIRED_EVENT = JSON.stringify({
  id: 'evt_expired_1',
  type: 'checkout.session.expired',
  data: { object: { id: 'cs_1', amount_total: 15000, currency: 'usd', client_reference_id: 'pay_1' } },
})

const COMPLETED_EVENT = JSON.stringify({
  id: 'evt_completed_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_2', payment_status: 'paid', amount_total: 15000, currency: 'usd', client_reference_id: 'pay_1' } },
})

describe('webhook de pago: checkout.session.expired (fix-refund-pos-card)', () => {
  it('marca el payment `cancelled` y dispara onPaymentExpired (no onPaymentCompleted)', async () => {
    const { svc, pRepo, expiredCalls, completedCalls } = makeService()
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(EXPIRED_EVENT, ts)

    const r = await svc.handleStripeWebhook('h1', Buffer.from(EXPIRED_EVENT), sig)

    expect(r?.type).toBe('payment_expired')
    expect(pRepo.rows.pay_1.status).toBe('cancelled')
    expect(expiredCalls()).toBe(1)
    expect(completedCalls()).toBe(0)
  })

  it('un reintento del mismo evento de expiración no lo procesa dos veces', async () => {
    const { svc, pRepo, expiredCalls } = makeService()
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(EXPIRED_EVENT, ts)

    const r1 = await svc.handleStripeWebhook('h1', Buffer.from(EXPIRED_EVENT), sig)
    const r2 = await svc.handleStripeWebhook('h1', Buffer.from(EXPIRED_EVENT), sig)

    expect(r1?.type).toBe('payment_expired')
    expect(r2?.type).toBe('already_processed')
    expect(expiredCalls()).toBe(1)
    expect(pRepo.rows.pay_1.status).toBe('cancelled')
  })

  it('el path `paid` (checkout.session.completed) sigue intacto — no lo rompió sumar `expired`', async () => {
    const { svc, pRepo, completedCalls, expiredCalls } = makeService()
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(COMPLETED_EVENT, ts)

    const r = await svc.handleStripeWebhook('h1', Buffer.from(COMPLETED_EVENT), sig)

    expect(r?.type).toBe('payment_completed')
    expect(pRepo.rows.pay_1.status).toBe('completed')
    expect(completedCalls()).toBe(1)
    expect(expiredCalls()).toBe(0)
  })
})
