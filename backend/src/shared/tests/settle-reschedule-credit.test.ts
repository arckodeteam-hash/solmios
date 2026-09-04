// La plata que el huésped pagó de más tenía un solo destino: un toast que desaparecía. Estos casos
// son las reglas que el recepcionista NO tiene que saber de memoria.
import { describe, it, expect } from 'bun:test'
import {
  settleRescheduleCredit, type RescheduleCreditPorts, type CreditPaymentRow,
} from '../usecases/settle-reschedule-credit'

const PARAMS = {
  reservationId: 'r1', hotelId: 'h1', guestId: 'g1',
  currency: 'USD', amount: 11.7, action: 'refund' as const,
}

function makePorts(rows: CreditPaymentRow[] = [], opts: { invoice?: boolean; cardFails?: string } = {}) {
  const calls = { refundCard: [] as any[], cashRefund: [] as any[] }
  const ports: RescheduleCreditPorts = {
    paymentsOf: async () => rows,
    refundCard: async (paymentId, amount) => {
      calls.refundCard.push({ paymentId, amount })
      if (opts.cardFails) throw new Error(opts.cardFails)
      return { id: `refund-${paymentId}` }
    },
    createCashRefund: async (dto) => { calls.cashRefund.push(dto); return { id: 'cash-1' } },
    hasInvoice: async () => !!opts.invoice,
  }
  return { ports, calls }
}

const stripeCharge: CreditPaymentRow = { id: 'p-card', type: 'charge', status: 'completed', method: 'card', amount: 210, stripePaymentId: 'pi_123' }
const posCard: CreditPaymentRow = { id: 'p-pos', type: 'charge', status: 'completed', method: 'card', amount: 210, stripePaymentId: '' }
const cashCharge: CreditPaymentRow = { id: 'p-cash', type: 'charge', status: 'completed', method: 'cash', amount: 210 }

describe('dejar a favor', () => {
  it('no mueve un peso', async () => {
    const { ports, calls } = makePorts([stripeCharge])
    const out = await settleRescheduleCredit(ports, { ...PARAMS, action: 'keep' })
    expect(out).toMatchObject({ action: 'keep', applied: true, target: 'none' })
    expect(calls.refundCard).toHaveLength(0)
    expect(calls.cashRefund).toHaveLength(0)
  })
})

describe('devolver', () => {
  it('si pagó por Stripe, vuelve a la tarjeta', async () => {
    const { ports, calls } = makePorts([stripeCharge])
    const out = await settleRescheduleCredit(ports, PARAMS)
    expect(out).toMatchObject({ target: 'card', applied: true })
    expect(calls.refundCard).toEqual([{ paymentId: 'p-card', amount: 11.7 }])
    expect(calls.cashRefund).toHaveLength(0)
  })

  it('una tarjeta pasada por el POS NO se intenta reembolsar por Stripe: sale por caja', async () => {
    // El cobro POS se registra como pago manual y Stripe no lo conoce; intentarlo falla feo.
    const { ports, calls } = makePorts([posCard])
    const out = await settleRescheduleCredit(ports, PARAMS)
    expect(out.target).toBe('cash')
    expect(calls.refundCard).toHaveLength(0)
    expect(calls.cashRefund[0]).toMatchObject({ amount: 11.7, reservationId: 'r1' })
  })

  it('si pagó en efectivo, sale de la caja', async () => {
    const { ports, calls } = makePorts([cashCharge])
    const out = await settleRescheduleCredit(ports, PARAMS)
    expect(out.target).toBe('cash')
    expect(out.message).toContain('caja')
    expect(calls.refundCard).toHaveLength(0)
  })

  it('si Stripe rechaza, la devolución NO se pierde: cae a caja y dice por qué', async () => {
    const { ports, calls } = makePorts([stripeCharge], { cardFails: 'charge already refunded' })
    const out = await settleRescheduleCredit(ports, PARAMS)
    expect(out).toMatchObject({ applied: true, target: 'cash' })
    expect(out.message).toContain('charge already refunded')
    expect(calls.cashRefund).toHaveLength(1)
  })

  it('un cobro devuelto o no completado no se elige para reembolsar', async () => {
    const { ports, calls } = makePorts([
      { ...stripeCharge, id: 'p-refund', type: 'refund' },
      { ...stripeCharge, id: 'p-pending', status: 'pending' },
    ])
    const out = await settleRescheduleCredit(ports, PARAMS)
    expect(out.target).toBe('cash')          // ninguno servía → caja
    expect(calls.refundCard).toHaveLength(0)
  })

  it('elige el cobro más grande: un reembolso parcial tiene que caber adentro', async () => {
    const { ports, calls } = makePorts([
      { ...stripeCharge, id: 'p-chico', amount: 5 },
      { ...stripeCharge, id: 'p-grande', amount: 210 },
    ])
    await settleRescheduleCredit(ports, PARAMS)
    expect(calls.refundCard[0].paymentId).toBe('p-grande')
  })

  it('sin ningún pago registrado igual devuelve por caja (el hotel decide, no el sistema)', async () => {
    const { ports, calls } = makePorts([])
    const out = await settleRescheduleCredit(ports, PARAMS)
    expect(out).toMatchObject({ applied: true, target: 'cash' })
    expect(calls.cashRefund).toHaveLength(1)
  })
})

describe('factura ya emitida', () => {
  it('avisa que falta la nota de crédito — devolver la plata no cuadra el libro de ventas', async () => {
    const { ports } = makePorts([cashCharge], { invoice: true })
    const out = await settleRescheduleCredit(ports, PARAMS)
    expect(out.needsCreditNote).toBe(true)
    expect(out.message).toContain('nota de crédito')
  })

  it('también avisa cuando queda a favor, sin devolver nada', async () => {
    const { ports } = makePorts([cashCharge], { invoice: true })
    const out = await settleRescheduleCredit(ports, { ...PARAMS, action: 'keep' })
    expect(out.needsCreditNote).toBe(true)
    expect(out.target).toBe('none')
  })

  it('sin factura no menciona nada fiscal', async () => {
    const { ports } = makePorts([cashCharge])
    const out = await settleRescheduleCredit(ports, PARAMS)
    expect(out.needsCreditNote).toBe(false)
    expect(out.message).not.toContain('nota de crédito')
  })
})
