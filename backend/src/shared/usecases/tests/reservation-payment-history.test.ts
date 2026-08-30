import { describe, it, expect } from 'bun:test'
import { reservationPaymentHistory } from '../reservation-payment-history'

// La reserva mostraba un total "Pagado" y nada más: recepción no podía responder "¿por dónde
// pagó?". El listado de /panel/billing existe pero es global del hotel y no filtra por reserva.

const HOTEL = 'h1'
const RES = 'res1'

function deps(payments: any[], users: any[] = [], opts: { folios?: any[]; invoices?: any[] } = {}) {
  return {
    folioRepo: { findMany: async () => opts.folios ?? [] },
    invoiceRepo: { findMany: async () => opts.invoices ?? [] },
    paymentRepo: {
      findMany: async (f: any) => payments.filter(p =>
        (f.reservationId && p.reservationId === f.reservationId) ||
        (f.folioId && p.folioId === f.folioId) ||
        (f.invoiceId && p.invoiceId === f.invoiceId)),
    },
    userRepo: { findMany: async () => users },
  } as any
}

const COBRO = {
  id: 'p1', reservationId: RES, hotelId: HOTEL, type: 'charge', method: 'card',
  status: 'completed', amount: 613.6, currency: 'usd', reference: 'cs_test_123',
  description: 'Reserva web', createdBy: 'u1', createdAt: '2026-08-30T10:00:00Z',
}

describe('historial de pagos de una reserva', () => {
  it('lista el cobro con método, estado, referencia y fecha', async () => {
    const r = await reservationPaymentHistory(deps([COBRO]), HOTEL, RES)
    const e = r.entries[0]
    expect(e.method).toBe('card')
    expect(e.status).toBe('completed')
    expect(e.reference).toBe('cs_test_123')
    expect(e.amount).toBe(613.6)
    expect(e.currency).toBe('USD')
    expect(e.createdAt).toBe('2026-08-30T10:00:00Z')
  })

  it('resuelve quién lo registró contra users', async () => {
    const r = await reservationPaymentHistory(deps([COBRO], [{ id: 'u1', name: 'Rosa Recepción' }]), HOTEL, RES)
    expect(r.entries[0].registeredBy).toBe('Rosa Recepción')
  })

  it('un cobro del sistema (sin createdBy) no inventa un responsable', async () => {
    const r = await reservationPaymentHistory(deps([{ ...COBRO, createdBy: '' }], [{ id: 'u1', name: 'Rosa' }]), HOTEL, RES)
    expect(r.entries[0].registeredBy).toBe('')
  })

  it('la devolución aparece en NEGATIVO y el neto cierra', async () => {
    const refund = { ...COBRO, id: 'p2', type: 'refund', amount: 100, createdAt: '2026-08-30T12:00:00Z' }
    const r = await reservationPaymentHistory(deps([COBRO, refund]), HOTEL, RES)
    const dev = r.entries.find(e => e.type === 'refund')!
    expect(dev.amount).toBe(-100)
    expect(r.net).toBe(513.6)
  })

  it('ordena del más reciente al más viejo', async () => {
    const viejo = { ...COBRO, id: 'p0', createdAt: '2026-08-01T09:00:00Z' }
    const r = await reservationPaymentHistory(deps([viejo, COBRO]), HOTEL, RES)
    expect(r.entries.map(e => e.id)).toEqual(['p1', 'p0'])
  })

  it('un pago pendiente se lista pero NO suma al neto', async () => {
    const pend = { ...COBRO, id: 'p3', status: 'pending', amount: 50, createdAt: '2026-08-30T11:00:00Z' }
    const r = await reservationPaymentHistory(deps([COBRO, pend]), HOTEL, RES)
    expect(r.entries).toHaveLength(2)
    expect(r.net).toBe(613.6)
  })

  it('no duplica el pago que cuelga del folio Y de su factura', async () => {
    const p = { ...COBRO, folioId: 'f1', invoiceId: 'i1' }
    const r = await reservationPaymentHistory(
      deps([p], [], { folios: [{ id: 'f1' }], invoices: [{ id: 'i1' }] }), HOTEL, RES)
    expect(r.entries).toHaveLength(1)
    expect(r.net).toBe(613.6)
  })

  it('sin movimientos devuelve lista vacía y neto 0', async () => {
    const r = await reservationPaymentHistory(deps([]), HOTEL, RES)
    expect(r.entries).toEqual([])
    expect(r.net).toBe(0)
  })

  it('multi-tenancy: exige hotelId', async () => {
    await expect(reservationPaymentHistory(deps([COBRO]), '', RES)).rejects.toThrow(/hotelId/)
  })

  it('si users falla, el historial sigue mostrando el resto', async () => {
    const d = deps([COBRO])
    d.userRepo = { findMany: async () => { throw new Error('caído') } }
    const r = await reservationPaymentHistory(d, HOTEL, RES)
    expect(r.entries[0].amount).toBe(613.6)
    expect(r.entries[0].registeredBy).toBe('')
  })

  it('usa el id de sesión de Stripe si no hay referencia propia', async () => {
    const r = await reservationPaymentHistory(
      deps([{ ...COBRO, reference: '', stripeSessionId: 'cs_live_9' }]), HOTEL, RES)
    expect(r.entries[0].reference).toBe('cs_live_9')
  })
})
