// reservas/tests/detail-payment-attempts.test.ts — REQ-RWP-02: el detalle de la reserva devuelve
// `paymentAttempts` (bloque "Pasarela de pago") leído por el puerto `listPaymentAttempts` de
// payment-gateways y proyectado con `toPaymentAttemptViews`. Es bitácora, no dinero: si el puerto
// falla o no está cableado, el detalle igual responde con `[]`.

import { describe, it, expect } from 'bun:test'
import { getExtendedDetail } from '../usecases/detail'

const HOTEL = 'h1'
const USER = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const nullRepo = { findById: async () => null } as any

// Mismo contrato de ReservasQueries que usa el detalle (ver detail-pending.test.ts).
function queries() {
  return {
    getCompanions: async () => [],
    getLockCodes: async () => [],
    getPaymentRequests: async () => [],
    getReservationAddons: async () => [],
    paidRepos: {
      folioRepo: { findMany: async () => [] },
      invoiceRepo: { findMany: async () => [] },
      paymentRepo: { findMany: async () => [] },
    },
    findConfiguration: async () => null,
  } as any
}

const messageLogs = async () => []

function reservation(over: Record<string, any> = {}) {
  return { id: 'r1', hotelId: HOTEL, totalAmount: 1000, deposit: 0, otherCharges: 0, ...over }
}

const repo = { findById: async () => reservation() } as any

describe('getExtendedDetail — paymentAttempts (REQ-RWP-02)', () => {
  it('proyecta las filas del puerto: más reciente primero, amount en unidades mayores, dashboardUrl de Stripe test', async () => {
    const calls: [string, string][] = []
    const port = async (hotelId: string, reservationId: string) => {
      calls.push([hotelId, reservationId])
      return [
        {
          id: 'pa-failed', hotelId: HOTEL, reservationId: 'r1', source: 'booking_engine', provider: 'stripe',
          mode: 'test', kind: 'failed', amountMinor: 12345, currency: 'USD',
          failureCode: 'card_declined', failureMessage: 'Tarjeta rechazada', cardBrand: 'visa', cardLast4: '4242',
          occurredAt: '2026-09-01T10:00:00.000Z',
        },
        {
          id: 'pa-paid', hotelId: HOTEL, reservationId: 'r1', source: 'booking_engine', provider: 'stripe',
          mode: 'test', providerRef: 'pi_x', kind: 'paid', amountMinor: 12345, currency: 'USD',
          receiptUrl: 'https://receipt', occurredAt: '2026-09-02T10:00:00.000Z',
        },
      ]
    }

    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queries(), 'r1', USER, messageLogs, undefined, port)

    // Se lee con el hotel de la reserva y su id (multi-tenancy).
    expect(calls).toEqual([[HOTEL, 'r1']])
    expect(d.paymentAttempts).toHaveLength(2)
    expect(d.paymentAttempts.map((a: any) => a.id)).toEqual(['pa-paid', 'pa-failed'])
    expect(d.paymentAttempts[0]).toMatchObject({
      id: 'pa-paid', kind: 'paid', provider: 'stripe', mode: 'test', providerRef: 'pi_x',
      amount: 123.45, currency: 'USD', receiptUrl: 'https://receipt',
      dashboardUrl: 'https://dashboard.stripe.com/test/payments/pi_x',
    })
    expect(d.paymentAttempts[1]).toMatchObject({
      id: 'pa-failed', kind: 'failed', amount: 123.45,
      failureCode: 'card_declined', failureMessage: 'Tarjeta rechazada', cardBrand: 'visa', cardLast4: '4242',
      dashboardUrl: '',
    })
    // Bitácora, no dinero: no toca el cobrado ni el pendiente.
    expect(d.paidAmount).toBe(0)
    expect(d.pendingAmount).toBe(1000)
  })

  it('best-effort: si el puerto lanza, paymentAttempts es [] y el detalle igual se devuelve', async () => {
    const port = async () => { throw new Error('payment-gateways caído') }

    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queries(), 'r1', USER, messageLogs, undefined, port)

    expect(d.id).toBe('r1')
    expect(d.paymentAttempts).toEqual([])
  })

  it('sin puerto cableado (undefined) → paymentAttempts: []', async () => {
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queries(), 'r1', USER, messageLogs, undefined, undefined)

    expect(d.id).toBe('r1')
    expect(d.paymentAttempts).toEqual([])
  })
})
