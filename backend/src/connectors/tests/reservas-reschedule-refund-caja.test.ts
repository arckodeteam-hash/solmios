// connectors/tests/reservas-reschedule-refund-caja.test.ts — La devolución en EFECTIVO del excedente de
// una reserva reprogramada llega hasta el EGRESO en caja.
//
// Cadena real: reservas.creditReschedule (connector reservas-reschedule-charge) → settleRescheduleCredit
// → payments.recordDirectRefund (PaymentsService real, repos en memoria) → socket `onRefundProcessed` →
// connector payments-caja → caja.registerRefundOutflow. Regresión de #214 COR-D: `createPayment` dejó de
// emitir `onPaymentCompleted` para un `refund` (nunca fue un cobro), y ese camino creaba el refund con
// `createPayment` a secas: la fila quedaba en `payments` pero caja no se enteraba y el arqueo del turno
// seguía contando una plata que ya se le había devuelto al huésped.
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { PaymentsService } from '../../modules/payments/service'
import { paymentsCajaConnector } from '../payments-caja'
import { reservasRescheduleChargeConnector } from '../reservas-reschedule-charge'

const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this } } as any

function world() {
  const created: any[] = []
  const repo: any = {
    findById: async (id: string) => created.find((c) => c.id === id) ?? null,
    findOne: async (w: any) => created.find((c) => c.id === w.id) ?? null,
    findMany: async (f: any) => created.filter((c) => Object.entries(f).every(([k, v]) => c[k] === v)),
    create: async (d: any) => { const row = { id: `pay-${created.length + 1}`, ...d }; created.push(row); return row },
    update: async (id: string, d: any) => { const row = created.find((c) => c.id === id); Object.assign(row ?? {}, d); return row },
  }
  const gateway = { isConfigured: async () => true, refund: async () => ({ id: 're_1' }) }
  const registry: any = { resolve: async () => gateway, forHotel: async () => gateway }
  // Repos de ownership (folio/invoice/guest/reservation): todo pertenece a h1.
  const belongs: any = { findOne: async (w: any) => ({ id: w.id, hotelId: 'h1' }) }
  const payments = new PaymentsService(repo, {} as any, logger, {} as any, undefined, undefined, registry, undefined, belongs, belongs, belongs, belongs)
  ;(payments as any).stripe = gateway   // el usecase de Stripe, reemplazado por el gateway falso (como en payments/tests/refund-direct.test.ts)
  const events: string[] = []
  payments.setSockets({
    onPaymentCompleted: async (p: any) => { events.push(`completed:${p.type}:${p.method}`) },
    onRefundProcessed: async (p: any) => { events.push(`refunded:${p.type}:${p.method}`) },
  })

  const outflows: any[] = []
  const incomes: any[] = []
  const caja = {
    registerPaymentIncome: async (i: any) => { incomes.push(i); return {} },
    registerRefundOutflow: async (i: any) => { outflows.push(i); return {} },
  }
  const orchestration: any = {}
  const reservas = {
    setOrchestrationDeps: (d: any) => Object.assign(orchestration, d),
    paymentsOfReservation: async () => created.filter((c) => c.reservationId === 'r1'),
    hasInvoiceForReservation: async () => false,
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'payments') return payments
      if (name === 'caja') return caja
      if (name === 'reservas') return reservas
      if (name === 'folios') return {}
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  paymentsCajaConnector(ctx)
  reservasRescheduleChargeConnector(ctx)
  return { payments, created, events, outflows, incomes, orchestration }
}

const user = { id: 'u1', role: 'hotel_admin' }
const credit = (amount: number) => ({ reservationId: 'r1', hotelId: 'h1', guestId: 'g1', currency: 'DOP', amount, action: 'refund' as const, reason: 'salió una noche antes' })

describe('reprogramación → devolución en efectivo → egreso en caja', () => {
  it('sin cobro con tarjeta que devolver, la devolución sale por caja: refund cash completed, onRefundProcessed y EGRESO en la caja de recepción', async () => {
    const w = world()
    const res = await w.orchestration.creditReschedule(credit(150), user)
    expect(res).toMatchObject({ action: 'refund', applied: true, target: 'cash' })
    const refund = w.created.find((c) => c.type === 'refund')
    expect(refund).toMatchObject({ method: 'cash', status: 'completed', amount: 150, currency: 'DOP', reservationId: 'r1', guestId: 'g1' })
    expect(refund.metadata).toMatchObject({ source: 'reschedule-credit', reservationId: 'r1' })
    expect(res.paymentId).toBe(refund.id)
    // El evento es el de una DEVOLUCIÓN, nunca el de un cobro.
    expect(w.events).toEqual(['refunded:refund:cash'])
    expect(w.incomes).toHaveLength(0)
    expect(w.outflows).toHaveLength(1)
    expect(w.outflows[0]).toMatchObject({ hotelId: 'h1', paymentId: refund.id, amount: 150, register: 'reception' })
  })

  it('con un cobro de Stripe devolvible, la plata vuelve a la tarjeta (Stripe) y caja NO mueve el cajón', async () => {
    const w = world()
    await w.payments.createPayment({ hotelId: 'h1', type: 'charge', method: 'card', amount: 300, currency: 'DOP', status: 'completed', reservationId: 'r1', stripePaymentId: 'pi_1' } as any)
    w.events.length = 0
    const res = await w.orchestration.creditReschedule(credit(100), user)
    expect(res).toMatchObject({ action: 'refund', applied: true, target: 'card' })
    expect(w.events).toEqual(['refunded:refund:card'])
    expect(w.outflows).toHaveLength(0)
  })

  it('"dejar a favor" no asienta nada ni toca la caja', async () => {
    const w = world()
    const res = await w.orchestration.creditReschedule({ ...credit(80), action: 'keep' }, user)
    expect(res).toMatchObject({ action: 'keep', target: 'none' })
    expect(w.created).toHaveLength(0)
    expect(w.events).toEqual([])
    expect(w.outflows).toHaveLength(0)
  })
})
