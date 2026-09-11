// connectors/tests/restaurante-payments-webhook.test.ts — fix-refund-pos-card.
//
// El conector SOLO cablea: 1) `chargeCardPayment` delega a `payments().chargeCard` con
// reference:'pos:'+orderId (idempotencia-settlement-pos) + metadata.source='restaurant'; 2) el socket
// inverso `onPaymentCompleted`/`onPaymentExpired` de payments llama `settlePaidOrder`/`unsettleOrder`
// SOLO cuando `metadata.source==='restaurant'` — un cobro de folios/reservas con el mismo evento no
// debe tocar una orden del POS.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { restaurantePaymentsConnector } from '../restaurante-payments'

function makeCtx() {
  const settlementPorts: any = {}
  const paymentsSockets: any = {}
  const settlePaidOrderCalls: any[] = []
  const unsettleOrderCalls: any[] = []
  // #214: la rama por PARTE (metadata.orderPaymentId).
  const settlePartCalls: any[] = []
  const expirePartCalls: any[] = []

  const restaurantStub = {
    setSettlementDeps: (p: any) => Object.assign(settlementPorts, p),
    settlePaidOrder: async (orderId: string, paymentId: string, user: any) => { settlePaidOrderCalls.push({ orderId, paymentId, user }) },
    unsettleOrder: async (orderId: string, user: any) => { unsettleOrderCalls.push({ orderId, user }) },
    settleOrderPayment: async (partId: string, paymentId: string, user: any) => { settlePartCalls.push({ partId, paymentId, user }) },
    expireOrderPayment: async (partId: string, user: any) => { expirePartCalls.push({ partId, user }) },
  }
  const paymentsStub = {
    createPayment: async () => ({ id: 'pay1' }),
    refundPayment: async () => ({ id: 'ref1' }),
    chargeCard: async (dto: any) => ({ payment: { id: 'pay_card_1' }, checkoutUrl: 'https://stripe/cs_1', ...dto }),
    setSockets: (s: any) => Object.assign(paymentsSockets, s),
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'restaurant') return restaurantStub
      if (name === 'payments') return paymentsStub
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext

  return { ctx, settlementPorts, paymentsSockets, settlePaidOrderCalls, unsettleOrderCalls, settlePartCalls, expirePartCalls }
}

describe('restaurantePaymentsConnector — chargeCardPayment (fix-refund-pos-card)', () => {
  it('delega a payments().chargeCard con reference pos:orderId y metadata.source=restaurant', async () => {
    let captured: any = null
    const settlementPorts: any = {}
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'restaurant') return { setSettlementDeps: (p: any) => Object.assign(settlementPorts, p), settlePaidOrder: async () => {}, unsettleOrder: async () => {} }
        if (name === 'payments') return {
          createPayment: async () => ({ id: 'pay1' }),
          refundPayment: async () => ({ id: 'ref1' }),
          chargeCard: async (dto: any) => { captured = dto; return { payment: { id: 'pay_card_1' }, checkoutUrl: 'https://stripe/cs_1' } },
          setSockets: () => {},
        }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as unknown as ConnectorContext
    restaurantePaymentsConnector(ctx)

    const res = await settlementPorts.chargeCardPayment({
      orderId: 'o1', hotelId: 'h1', amount: 23.6, currency: 'USD',
      description: 'Restaurante · comanda CMD-1', successUrl: 'https://app/ok', cancelUrl: 'https://app/cancel',
    })

    expect(res).toEqual({ paymentId: 'pay_card_1', checkoutUrl: 'https://stripe/cs_1' })
    expect(captured.reference).toBe('pos:o1')
    expect(captured.metadata).toEqual({ source: 'restaurant', orderId: 'o1' })
    expect(captured.successUrl).toBe('https://app/ok')
    expect(captured.cancelUrl).toBe('https://app/cancel')
    expect(typeof captured.expiresInMinutes).toBe('number')
  })
})

describe('restaurantePaymentsConnector — socket inverso onPaymentCompleted/onPaymentExpired', () => {
  it('onPaymentCompleted con source=restaurant y method=card llama settlePaidOrder(orderId, paymentId)', async () => {
    const { ctx, paymentsSockets, settlePaidOrderCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentCompleted({ id: 'pay1', type: 'charge', method: 'card', metadata: { source: 'restaurant', orderId: 'o1' } })

    expect(settlePaidOrderCalls).toHaveLength(1)
    expect(settlePaidOrderCalls[0].orderId).toBe('o1')
    expect(settlePaidOrderCalls[0].paymentId).toBe('pay1')
  })

  it('#213: una devolución (type=refund) hereda source=restaurant y nace completed, pero NO es un cobro a confirmar', async () => {
    const { ctx, paymentsSockets, settlePaidOrderCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentCompleted({ id: 'rf1', type: 'refund', method: 'card', metadata: { source: 'restaurant', orderId: 'o1', refundOf: 'pay1' } })

    expect(settlePaidOrderCalls).toHaveLength(0)
  })

  it('onPaymentCompleted con method=cash/transfer NO llama settlePaidOrder (cobro directo: payOrder ya marca paid)', async () => {
    const { ctx, paymentsSockets, settlePaidOrderCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentCompleted({ id: 'pay_cash', method: 'cash', metadata: { source: 'restaurant', orderId: 'o1' } })
    await paymentsSockets.onPaymentCompleted({ id: 'pay_xfer', method: 'transfer', metadata: { source: 'restaurant', orderId: 'o2' } })

    // Regresión bug e2e 2026-08-01: el callback disparaba settlePaidOrder para cash, que chocaba con
    // el guard de estado (!== processing_payment) y rompía el cobro directo (payment colgando, orden sin paid).
    expect(settlePaidOrderCalls).toHaveLength(0)
  })

  it('onPaymentCompleted con OTRO source (folios/reservas) NO toca al restaurant', async () => {
    const { ctx, paymentsSockets, settlePaidOrderCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentCompleted({ id: 'pay2', metadata: { source: 'folio', folioId: 'f1' } })
    await paymentsSockets.onPaymentCompleted({ id: 'pay3', metadata: {} })
    await paymentsSockets.onPaymentCompleted({ id: 'pay4' })

    expect(settlePaidOrderCalls).toHaveLength(0)
  })

  it('onPaymentExpired con source=restaurant llama unsettleOrder(orderId)', async () => {
    const { ctx, paymentsSockets, unsettleOrderCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentExpired({ id: 'pay1', metadata: { source: 'restaurant', orderId: 'o1' } })

    expect(unsettleOrderCalls).toHaveLength(1)
    expect(unsettleOrderCalls[0].orderId).toBe('o1')
  })

  it('onPaymentExpired con OTRO source NO llama unsettleOrder', async () => {
    const { ctx, paymentsSockets, unsettleOrderCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentExpired({ id: 'pay2', metadata: { source: 'folio' } })

    expect(unsettleOrderCalls).toHaveLength(0)
  })
})

// ─── #214: UNA PARTE de un cobro dividido (metadata.orderPaymentId) ───────────
describe('restaurantePaymentsConnector — #214 partes de un cobro dividido', () => {
  it('recordPayment/chargeCardPayment: la referencia por parte (`pos:<orderId>:<n>`) y `orderPaymentId` viajan a payments tal cual', async () => {
    let captured: any = null
    const settlementPorts: any = {}
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'restaurant') return { setSettlementDeps: (p: any) => Object.assign(settlementPorts, p), settlePaidOrder: async () => {}, unsettleOrder: async () => {}, settleOrderPayment: async () => {}, expireOrderPayment: async () => {} }
        if (name === 'payments') return {
          createPayment: async (dto: any) => { captured = dto; return { id: 'pay_part' } },
          refundPayment: async () => ({ id: 'ref1' }),
          chargeCard: async (dto: any) => { captured = dto; return { payment: { id: 'pay_card_part' }, checkoutUrl: 'https://stripe/cs_2' } },
          setSockets: () => {},
        }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as unknown as ConnectorContext
    restaurantePaymentsConnector(ctx)

    await settlementPorts.recordPayment({ hotelId: 'h1', method: 'cash', amount: 40, description: 'Comanda CMD-1 · parte 1', orderId: 'o1', reference: 'pos:o1:1', metadata: { source: 'restaurant', orderId: 'o1', orderPaymentId: 'p1' } })
    expect(captured.reference).toBe('pos:o1:1')
    expect(captured.metadata).toEqual({ source: 'restaurant', orderId: 'o1', orderPaymentId: 'p1' })

    await settlementPorts.chargeCardPayment({ orderId: 'o1', hotelId: 'h1', amount: 60, description: 'Comanda CMD-1 · parte 2', successUrl: 'https://app/ok', cancelUrl: 'https://app/cancel', reference: 'pos:o1:2', metadata: { source: 'restaurant', orderId: 'o1', orderPaymentId: 'p2' } })
    expect(captured.reference).toBe('pos:o1:2')
    expect(captured.metadata).toEqual({ source: 'restaurant', orderId: 'o1', orderPaymentId: 'p2' })
    // Sin `reference` (cobro entero) sigue armando `pos:<orderId>` — el cobro total no cambia.
    await settlementPorts.chargeCardPayment({ orderId: 'o9', hotelId: 'h1', amount: 1, description: 'x', successUrl: 'https://app/ok', cancelUrl: 'https://app/cancel' })
    expect(captured.reference).toBe('pos:o9')
    expect(captured.metadata).toEqual({ source: 'restaurant', orderId: 'o9' })
  })

  it('onPaymentCompleted con metadata.orderPaymentId llama settleOrderPayment(partId, paymentId) y NO settlePaidOrder', async () => {
    const { ctx, paymentsSockets, settlePaidOrderCalls, settlePartCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentCompleted({ id: 'pay_card_part', type: 'charge', method: 'card', metadata: { source: 'restaurant', orderId: 'o1', orderPaymentId: 'p2' } })

    expect(settlePartCalls).toEqual([{ partId: 'p2', paymentId: 'pay_card_part', user: { id: 'system', role: 'super_admin' } }])
    expect(settlePaidOrderCalls).toHaveLength(0)
  })

  it('onPaymentCompleted de una parte cash/transfer NO toca al restaurant (la parte ya quedó completed al registrarla)', async () => {
    const { ctx, paymentsSockets, settlePaidOrderCalls, settlePartCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentCompleted({ id: 'pay_part', method: 'cash', metadata: { source: 'restaurant', orderId: 'o1', orderPaymentId: 'p1' } })

    expect(settlePartCalls).toHaveLength(0)
    expect(settlePaidOrderCalls).toHaveLength(0)
  })

  it('onPaymentExpired con metadata.orderPaymentId llama expireOrderPayment(partId) y NO unsettleOrder', async () => {
    const { ctx, paymentsSockets, unsettleOrderCalls, expirePartCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentExpired({ id: 'pay_card_part', metadata: { source: 'restaurant', orderId: 'o1', orderPaymentId: 'p2' } })

    expect(expirePartCalls).toEqual([{ partId: 'p2', user: { id: 'system', role: 'super_admin' } }])
    expect(unsettleOrderCalls).toHaveLength(0)
  })

  it('una parte de OTRO source (folio) con orderPaymentId no toca al restaurant', async () => {
    const { ctx, paymentsSockets, settlePartCalls, expirePartCalls } = makeCtx()
    restaurantePaymentsConnector(ctx)

    await paymentsSockets.onPaymentCompleted({ id: 'x', method: 'card', metadata: { source: 'folio', orderId: 'o1', orderPaymentId: 'p2' } })
    await paymentsSockets.onPaymentExpired({ id: 'x', metadata: { source: 'folio', orderId: 'o1', orderPaymentId: 'p2' } })

    expect(settlePartCalls).toHaveLength(0)
    expect(expirePartCalls).toHaveLength(0)
  })
})

// ─── #214 COR-5 / COR-2: refund por método y consulta por referencia ─────────────────────────────
describe('restaurantePaymentsConnector — refundPayment por método y findPaymentByReference (#214)', () => {
  function mountWith(paymentsExtra: Record<string, any>) {
    const settlementPorts: any = {}
    const calls: string[] = []
    const ctx = {
      resolveModule: (name: string) => {
        if (name === 'restaurant') return { setSettlementDeps: (p: any) => Object.assign(settlementPorts, p), settlePaidOrder: async () => {}, unsettleOrder: async () => {}, settleOrderPayment: async () => {}, expireOrderPayment: async () => {} }
        if (name === 'payments') return {
          createPayment: async () => ({ id: 'pay1' }),
          refundPayment: async (id: string) => { calls.push(`stripe:${id}`); return { id: 'ref1' } },
          chargeCard: async () => ({ payment: { id: 'c1' }, checkoutUrl: 'u' }),
          setSockets: () => {},
          ...paymentsExtra,
        }
        throw new Error(`módulo desconocido: ${name}`)
      },
    } as unknown as ConnectorContext
    restaurantePaymentsConnector(ctx)
    return { settlementPorts, calls }
  }
  const sys = { id: 'system', role: 'super_admin' }

  it('con payments.refundPaymentByMethod cableado, el refund de una parte va por ahí (payments decide Stripe o asiento directo)', async () => {
    const { settlementPorts, calls } = mountWith({
      refundPaymentByMethod: async (id: string, u: any) => { calls.push(`byMethod:${id}:${u.role}`); return { id: 'ref-m' } },
    })
    await settlementPorts.refundPayment({ paymentId: 'p-cash' }, sys)
    expect(calls).toEqual(['byMethod:p-cash:super_admin'])
  })

  it('sin refundPaymentByMethod cableado (payments viejo) sigue yendo todo por Stripe', async () => {
    const { settlementPorts, calls } = mountWith({})
    await settlementPorts.refundPayment({ paymentId: 'p-cash' }, sys)
    expect(calls).toEqual(['stripe:p-cash'])
  })

  it('findPaymentByReference traduce la fila de payments a { paymentId, status, method } y null si no existe', async () => {
    const { settlementPorts } = mountWith({ findByReference: async (_h: string, ref: string) => (ref === 'pos:o1:1' ? { id: 'p1', method: 'cash', status: 'completed' } : null) })
    expect(await settlementPorts.findPaymentByReference({ hotelId: 'h1', reference: 'pos:o1:1' })).toEqual({ paymentId: 'p1', status: 'completed', method: 'cash' })
    expect(await settlementPorts.findPaymentByReference({ hotelId: 'h1', reference: 'pos:o1:2' })).toBeNull()
    const old = mountWith({})
    expect(await old.settlementPorts.findPaymentByReference({ hotelId: 'h1', reference: 'pos:o1:1' })).toBeNull()
  })
})
