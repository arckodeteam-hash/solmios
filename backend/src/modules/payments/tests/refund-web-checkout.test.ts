// payments/tests/refund-web-checkout.test.ts — #272: devolución de un cobro del widget público.
//
// El cobro web se asienta con `method:'link'`, `stripePaymentId=''` y el id de la Checkout Session en
// `stripeSessionId` (shared/usecases/post-booking-payment.ts). Stripe sólo reembolsa por PaymentIntent,
// así que `refundPayment` pasa el `cs_…` y el gateway lo resuelve desde la sesión.
import { describe, it, expect } from 'bun:test'
import { refundPayment } from '../usecases/refund'
import { StripeGateway } from '../../../services/payment-gateway/stripe-gateway'
import type { CreatePaymentDTO, PaymentDTO } from '../types'

const SYSTEM = { id: 'system', role: 'system' }

function harness(payment: Partial<PaymentDTO>) {
  const row: any = {
    id: 'p1', hotelId: 'h1', type: 'charge', status: 'completed', method: 'link', amount: 200, currency: 'USD',
    stripePaymentId: '', stripeSessionId: 'cs_x', reservationId: 'r1', metadata: { source: 'web' }, ...payment,
  }
  const created: CreatePaymentDTO[] = []
  const statuses: string[] = []
  const refundCalls: Array<{ hotelId: string; paymentId: string; amount?: number }> = []
  const deps = {
    crud: {
      getById: async () => row,
      updateStatus: async (_id: string, status: string) => { statuses.push(status); row.status = status; return row },
    },
    stripe: {
      isConfigured: async () => true,
      refund: async (p: { hotelId: string; paymentId: string; amount?: number }) => { refundCalls.push(p); return { id: 're_1', status: 'succeeded' } },
    },
    createPayment: async (dto: CreatePaymentDTO) => { created.push(dto); return { id: `r-${created.length}`, ...dto } as PaymentDTO },
  }
  return { deps: deps as any, row, created, statuses, refundCalls }
}

describe('payments — refund de un cobro del widget (method link + stripeSessionId)', () => {
  it('parcial: llama a stripe.refund con el cs_ y el monto, asienta refund link con metadata.reason y deja el cobro completed', async () => {
    const h = harness({})
    const refund = await refundPayment(h.deps, 'p1', 100, SYSTEM, 'guest_cancellation')

    expect(h.refundCalls).toEqual([{ hotelId: 'h1', paymentId: 'cs_x', amount: 100 }])
    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({ type: 'refund', method: 'link', status: 'completed', amount: 100, currency: 'USD', reference: 're_1', reservationId: 'r1', createdBy: 'system' })
    expect(h.created[0].metadata).toEqual({ source: 'web', refundOf: 'p1', reason: 'guest_cancellation' })
    expect(h.created[0].description).toBe('Refund for payment p1 (guest_cancellation)')
    expect(refund.id).toBe('r-1')
    expect(h.statuses).toEqual([])
    expect(h.row.status).toBe('completed')
  })

  it('total: el cobro original pasa a refunded', async () => {
    const h = harness({})
    await refundPayment(h.deps, 'p1', 200, SYSTEM, 'guest_cancellation')
    expect(h.statuses).toEqual(['refunded'])
    expect(h.created[0]).toMatchObject({ type: 'refund', amount: 200 })
  })

  it('sin reason: descripción y metadata sin el motivo (comportamiento previo intacto)', async () => {
    const h = harness({})
    await refundPayment(h.deps, 'p1', undefined, SYSTEM)
    expect(h.created[0].description).toBe('Refund for payment p1')
    expect(h.created[0].metadata).toEqual({ source: 'web', refundOf: 'p1' })
    expect(h.statuses).toEqual(['refunded'])
  })

  it('link SIN stripeSessionId ni stripePaymentId → ConflictError y no llama a Stripe', async () => {
    const h = harness({ stripeSessionId: '', stripePaymentId: '' })
    await expect(refundPayment(h.deps, 'p1', undefined, SYSTEM, 'guest_cancellation'))
      .rejects.toThrow(/no tiene un cargo de Stripe asociado/)
    expect(h.refundCalls).toHaveLength(0)
    expect(h.created).toHaveLength(0)
  })

  it('un cobro cash sigue rechazado: sólo card/link son de Stripe', async () => {
    const h = harness({ method: 'cash' })
    await expect(refundPayment(h.deps, 'p1', undefined, SYSTEM)).rejects.toThrow(/Only card payments/)
    expect(h.refundCalls).toHaveLength(0)
  })
})

describe('StripeGateway.refund — cs_ → payment_intent', () => {
  function gatewayWith(fake: any) {
    const gw = new StripeGateway({ secretKey: 'sk_test_fake' }, 'test')
    ;(gw as any).stripe = fake
    return gw
  }

  it('con una Checkout Session resuelve el payment_intent y reembolsa por él', async () => {
    const calls: any[] = []
    const retrieved: string[] = []
    const gw = gatewayWith({
      checkout: { sessions: { retrieve: async (id: string) => { retrieved.push(id); return { payment_intent: 'pi_y' } } } },
      refunds: { create: async (p: any) => { calls.push(p); return { id: 're_1', status: 'succeeded' } } },
    })
    const r = await gw.refund('cs_x', 10000)
    expect(retrieved).toEqual(['cs_x'])
    expect(calls).toEqual([{ payment_intent: 'pi_y', amount: 10000 }])
    expect(r).toEqual({ refundId: 're_1', status: 'succeeded' })
  })

  it('con la sesión expandida (payment_intent como objeto) usa su id', async () => {
    const calls: any[] = []
    const gw = gatewayWith({
      checkout: { sessions: { retrieve: async () => ({ payment_intent: { id: 'pi_obj' } }) } },
      refunds: { create: async (p: any) => { calls.push(p); return { id: 're_2', status: 'pending' } } },
    })
    await gw.refund('cs_x')
    expect(calls).toEqual([{ payment_intent: 'pi_obj' }])
  })

  it('con un pi_ directo NO consulta la sesión', async () => {
    const calls: any[] = []
    let retrieveCalled = false
    const gw = gatewayWith({
      checkout: { sessions: { retrieve: async () => { retrieveCalled = true; return {} } } },
      refunds: { create: async (p: any) => { calls.push(p); return { id: 're_3', status: 'succeeded' } } },
    })
    await gw.refund('pi_z', 500)
    expect(retrieveCalled).toBe(false)
    expect(calls).toEqual([{ payment_intent: 'pi_z', amount: 500 }])
  })

  it('sesión sin payment_intent (no se pagó) → error claro y no crea el refund', async () => {
    let createCalled = false
    const gw = gatewayWith({
      checkout: { sessions: { retrieve: async () => ({ payment_intent: null }) } },
      refunds: { create: async () => { createCalled = true; return { id: 're_x', status: 'succeeded' } } },
    })
    await expect(gw.refund('cs_unpaid')).rejects.toThrow(/no tiene payment_intent/)
    expect(createCalled).toBe(false)
  })
})
