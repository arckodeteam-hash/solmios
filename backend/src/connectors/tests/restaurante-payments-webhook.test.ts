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

  const restaurantStub = {
    setSettlementDeps: (p: any) => Object.assign(settlementPorts, p),
    settlePaidOrder: async (orderId: string, paymentId: string, user: any) => { settlePaidOrderCalls.push({ orderId, paymentId, user }) },
    unsettleOrder: async (orderId: string, user: any) => { unsettleOrderCalls.push({ orderId, user }) },
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

  return { ctx, settlementPorts, paymentsSockets, settlePaidOrderCalls, unsettleOrderCalls }
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
