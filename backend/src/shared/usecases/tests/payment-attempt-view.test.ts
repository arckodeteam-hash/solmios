import { describe, it, expect } from 'bun:test'
import { paymentAttemptDashboardUrl, toPaymentAttemptView, toPaymentAttemptViews } from '../payment-attempt-view'
import type { PaymentAttemptRow } from '../../../services/payment-gateway/payment-attempts'

// REQ-RWP-02: el hotel ve el historial de intentos de cobro de una reserva web y salta al
// dashboard del proveedor. La proyección es pura: sin I/O, sólo el tipo de la fila.

function row(over: Partial<PaymentAttemptRow> = {}): PaymentAttemptRow {
  return {
    id: 'a1', hotelId: 'h1', reservationId: 'r1', source: 'booking_engine',
    provider: 'stripe', mode: 'test', providerRef: 'pi_x', kind: 'paid',
    amountMinor: 12345, currency: 'USD', occurredAt: '2026-09-01T10:00:00.000Z',
    ...over,
  }
}

describe('paymentAttemptDashboardUrl', () => {
  it('stripe test → /test/payments/<ref>', () => {
    expect(paymentAttemptDashboardUrl({ provider: 'stripe', mode: 'test', providerRef: 'pi_x' }))
      .toBe('https://dashboard.stripe.com/test/payments/pi_x')
  })

  it('stripe live → /payments/<ref> (sin test/)', () => {
    expect(paymentAttemptDashboardUrl({ provider: 'stripe', mode: 'live', providerRef: 'pi_x' }))
      .toBe('https://dashboard.stripe.com/payments/pi_x')
  })

  it('stripe sin mode → live', () => {
    expect(paymentAttemptDashboardUrl({ provider: 'stripe', providerRef: 'pi_x' }))
      .toBe('https://dashboard.stripe.com/payments/pi_x')
  })

  it('stripe sin providerRef → vacío', () => {
    expect(paymentAttemptDashboardUrl({ provider: 'stripe', mode: 'test', providerRef: '' })).toBe('')
    expect(paymentAttemptDashboardUrl({ provider: 'stripe', mode: 'test' })).toBe('')
  })

  it('otro proveedor (azul, cardnet) → vacío', () => {
    expect(paymentAttemptDashboardUrl({ provider: 'azul', mode: 'live', providerRef: 'ord_1' })).toBe('')
    expect(paymentAttemptDashboardUrl({ provider: 'cardnet', mode: 'test', providerRef: 'ord_1' })).toBe('')
  })
})

describe('toPaymentAttemptView', () => {
  it('amountMinor 12345 → amount 123.45 y dashboardUrl armado', () => {
    const v = toPaymentAttemptView(row())
    expect(v.amount).toBe(123.45)
    expect(v.currency).toBe('USD')
    expect(v.kind).toBe('paid')
    expect(v.mode).toBe('test')
    expect(v.dashboardUrl).toBe('https://dashboard.stripe.com/test/payments/pi_x')
    expect(v.occurredAt).toBe('2026-09-01T10:00:00.000Z')
  })

  it('conserva failureCode y failureMessage; strings faltantes → ""', () => {
    const v = toPaymentAttemptView(row({
      kind: 'failed', failureCode: 'card_declined', failureMessage: 'Your card was declined.',
      cardBrand: undefined, cardLast4: undefined, receiptUrl: undefined, currency: undefined,
    }))
    expect(v.failureCode).toBe('card_declined')
    expect(v.failureMessage).toBe('Your card was declined.')
    expect(v.cardBrand).toBe('')
    expect(v.cardLast4).toBe('')
    expect(v.receiptUrl).toBe('')
    expect(v.currency).toBe('')
  })

  it('sin amountMinor → 0; sin mode → ""; usa createdAt si falta occurredAt', () => {
    const v = toPaymentAttemptView({ ...row({ amountMinor: undefined, mode: undefined, occurredAt: undefined }), createdAt: '2026-08-30T00:00:00.000Z' })
    expect(v.amount).toBe(0)
    expect(v.mode).toBe('')
    expect(v.occurredAt).toBe('2026-08-30T00:00:00.000Z')
  })

  it('no expone campos internos (hotelId, eventId)', () => {
    const v = toPaymentAttemptView(row({ eventId: 'evt_1' })) as any
    expect(v.hotelId).toBeUndefined()
    expect(v.eventId).toBeUndefined()
  })
})

describe('toPaymentAttemptViews', () => {
  it('ordena más reciente primero por occurredAt', () => {
    const views = toPaymentAttemptViews([
      row({ id: 'old', occurredAt: '2026-09-01T10:00:00.000Z' }),
      row({ id: 'new', occurredAt: '2026-09-03T10:00:00.000Z' }),
      row({ id: 'mid', occurredAt: '2026-09-02T10:00:00.000Z' }),
    ])
    expect(views.map(v => v.id)).toEqual(['new', 'mid', 'old'])
  })

  it('cae a createdAt cuando falta occurredAt', () => {
    const views = toPaymentAttemptViews([
      { ...row({ id: 'a', occurredAt: undefined }), createdAt: '2026-09-05T00:00:00.000Z' },
      row({ id: 'b', occurredAt: '2026-09-04T00:00:00.000Z' }),
    ])
    expect(views.map(v => v.id)).toEqual(['a', 'b'])
  })

  it('null / undefined / [] → []', () => {
    expect(toPaymentAttemptViews(null)).toEqual([])
    expect(toPaymentAttemptViews(undefined)).toEqual([])
    expect(toPaymentAttemptViews([])).toEqual([])
  })
})
