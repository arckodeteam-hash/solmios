// payments/tests/charge-card.test.ts — fix-refund-pos-card: chargeCard() debe reenviar
// reference/metadata/expiresInMinutes — antes se perdían (el POS no podía reclamar la idempotencia
// de idempotencia-settlement-pos ni el conector reconocer el origen del cobro al escuchar
// onPaymentCompleted/onPaymentExpired).

import { describe, it, expect } from 'bun:test'
import { chargeCard } from '../usecases/charge-card'
import type { ChargeCardDTO, CreatePaymentDTO, PaymentDTO } from '../types'

describe('payments — chargeCard (fix-refund-pos-card)', () => {
  it('reenvía reference/metadata a createPayment (idempotencia + origen del cobro)', async () => {
    let createdDto: CreatePaymentDTO | null = null
    const deps = {
      stripe: {
        isConfigured: async () => true,
        createCheckoutSession: async () => ({ id: 'cs_1', url: 'https://stripe/cs_1' }),
      } as any,
      crud: { updateStatus: async () => ({}) as PaymentDTO, attachSession: async () => ({}) as PaymentDTO } as any,
      createPayment: async (dto: CreatePaymentDTO) => { createdDto = dto; return { id: 'pay_1', ...dto } as PaymentDTO },
    }
    const dto: ChargeCardDTO = {
      hotelId: 'h1', amount: 23.6, description: 'Restaurante · comanda CMD-1',
      successUrl: 'https://app/ok', cancelUrl: 'https://app/cancel',
      reference: 'pos:o1', metadata: { source: 'restaurant', orderId: 'o1' },
    }

    await chargeCard(deps as any, dto)

    expect(createdDto).not.toBeNull()
    expect((createdDto as any).reference).toBe('pos:o1')
    expect((createdDto as any).metadata).toEqual({ source: 'restaurant', orderId: 'o1' })
  })

  it('el client_reference_id de la Checkout Session SIEMPRE es payment.id, no dto.reference', async () => {
    let sessionParams: any = null
    const deps = {
      stripe: {
        isConfigured: async () => true,
        createCheckoutSession: async (p: any) => { sessionParams = p; return { id: 'cs_1', url: 'https://stripe/cs_1' } },
      } as any,
      crud: { updateStatus: async () => ({}) as PaymentDTO, attachSession: async () => ({}) as PaymentDTO } as any,
      createPayment: async (dto: CreatePaymentDTO) => ({ id: 'pay_1', ...dto } as PaymentDTO),
    }
    const dto: ChargeCardDTO = {
      hotelId: 'h1', amount: 23.6, description: 'x',
      successUrl: 'https://app/ok', cancelUrl: 'https://app/cancel',
      reference: 'pos:o1', metadata: { source: 'restaurant', orderId: 'o1' },
      expiresInMinutes: 30,
    }

    await chargeCard(deps as any, dto)

    expect(sessionParams.reference).toBe('pay_1')          // NO 'pos:o1'
    expect(sessionParams.metadata.orderId).toBe('o1')       // pero el metadata SÍ lo lleva
    expect(sessionParams.expiresInMinutes).toBe(30)
  })

  it('sin pasarela configurada → ValidationError explícito (nunca cobra a ciegas)', async () => {
    const deps = {
      stripe: { isConfigured: async () => false, createCheckoutSession: async () => { throw new Error('NO debió llamar') } } as any,
      crud: {} as any,
      createPayment: async (dto: CreatePaymentDTO) => ({ id: 'pay_1', ...dto } as PaymentDTO),
    }
    const dto: ChargeCardDTO = { hotelId: 'h1', amount: 10, description: 'x', successUrl: 'a', cancelUrl: 'b' }

    await expect(chargeCard(deps as any, dto)).rejects.toThrow('pasarela')
  })
})
