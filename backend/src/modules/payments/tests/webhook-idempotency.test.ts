// webhook-idempotency.test.ts — el mismo webhook, llegado dos veces, asienta UN cobro.
//
// Prueba el flujo completo del service: verifica firma → settleOnce → asiento. Un reintento de
// Stripe (mismo eventId) no debe marcar el pago dos veces ni disparar el socket dos veces.

import { describe, it, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentsService } from '../service'
import { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'
import { PaymentEventStore } from '../../../services/payment-gateway/payment-events'

const log = silentLogger()
const silentCache: any = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const WHSEC = 'whsec_idem_test'

function stripeSig(payload: string, ts: number): string {
  const v1 = createHmac('sha256', WHSEC).update(`${ts}.${payload}`, 'utf8').digest('hex')
  return `t=${ts},v1=${v1}`
}

/** Un pago 'processing' que el webhook debe completar. */
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

/** Gateway del hotel h1 con el whsec de prueba, cargado directo en el registry. */
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
  let completedCalls = 0
  svc.setSockets({ onPaymentCompleted: async () => { completedCalls++ } })
  return { svc, pRepo, completedCalls: () => completedCalls }
}

const EVENT = JSON.stringify({
  id: 'evt_idem_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 15000, currency: 'usd', client_reference_id: 'pay_1' } },
})

describe('webhook de pago: idempotencia end-to-end', () => {
  it('un reintento del mismo evento asienta el cobro UNA vez', async () => {
    const { svc, pRepo, completedCalls } = makeService()
    const ts = Math.floor(Date.now() / 1000)
    const sig = stripeSig(EVENT, ts)

    const r1 = await svc.handleStripeWebhook('h1', Buffer.from(EVENT), sig)
    const r2 = await svc.handleStripeWebhook('h1', Buffer.from(EVENT), sig) // reintento de Stripe

    expect(r1?.type).toBe('payment_completed')
    expect(r2?.type).toBe('already_processed')
    expect(pRepo.rows.pay_1.status).toBe('completed')
    expect(completedCalls()).toBe(1) // el socket NO se disparó dos veces
  })

  it('rechaza el webhook con firma inválida (no asienta nada)', async () => {
    const { svc, pRepo } = makeService()
    const r = await svc.handleStripeWebhook('h1', Buffer.from(EVENT), 't=1,v1=firma_falsa')
    expect(r).toBeNull()
    expect(pRepo.rows.pay_1.status).toBe('processing') // intacto
  })
})
