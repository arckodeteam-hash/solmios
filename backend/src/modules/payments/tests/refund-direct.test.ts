// payments/tests/refund-direct.test.ts — #214 (COR-5): devolución de un cobro en efectivo/transferencia.
//
// No hay pasarela a quien pedirle la plata: se asienta un `payment` `type:'refund'` con el MISMO método,
// `completed` (los reportes restan `type:'refund'`), y el cobro original pasa a `refunded`. Idempotente
// por referencia (`<pos:...>:refund`): pedirlo dos veces devuelve el mismo asiento.
import { describe, it, expect } from 'bun:test'
import { refundDirectPayment, directRefundReference } from '../usecases/refund-direct'
import type { CreatePaymentDTO, PaymentDTO } from '../types'

function harness(payment: Partial<PaymentDTO>) {
  const row: any = { id: 'p1', hotelId: 'h1', type: 'charge', status: 'completed', method: 'cash', amount: 140, currency: 'DOP', reference: 'pos:o1:2', metadata: { source: 'restaurant', orderId: 'o1' }, ...payment }
  const created: CreatePaymentDTO[] = []
  const statuses: string[] = []
  const deps = {
    crud: {
      getById: async () => row,
      updateStatus: async (_id: string, status: string) => { statuses.push(status); row.status = status; return row },
      findByReference: async (_h: string, reference: string) => created.find((c) => c.reference === reference) ?? null,
    },
    createPayment: async (dto: CreatePaymentDTO) => { created.push(dto); return { id: `r-${created.length}`, ...dto } as PaymentDTO },
  }
  return { deps: deps as any, row, created, statuses }
}

describe('payments — refundDirectPayment', () => {
  it('efectivo: asienta un refund cash completed por el mismo monto, con la referencia pos:<...>:refund, y marca el cobro refunded', async () => {
    const h = harness({})
    const refund = await refundDirectPayment(h.deps, 'p1', { id: 'u1', role: 'hotel_admin' })
    expect(h.created).toHaveLength(1)
    expect(h.created[0]).toMatchObject({ type: 'refund', method: 'cash', status: 'completed', amount: 140, currency: 'DOP', reference: 'pos:o1:2:refund', hotelId: 'h1' })
    expect((h.created[0] as any).metadata).toMatchObject({ source: 'restaurant', orderId: 'o1', refundOf: 'p1' })
    expect(h.statuses).toEqual(['refunded'])
    expect(refund.id).toBe('r-1')
  })

  it('transferencia también; tarjeta NO (va por Stripe); un `refund` no se devuelve', async () => {
    await expect(refundDirectPayment(harness({ method: 'transfer' }).deps, 'p1')).resolves.toMatchObject({ method: 'transfer' })
    await expect(refundDirectPayment(harness({ method: 'card' }).deps, 'p1')).rejects.toThrow('Stripe')
    await expect(refundDirectPayment(harness({ type: 'refund' }).deps, 'p1')).rejects.toThrow('Solo se devuelve un cobro')
    await expect(refundDirectPayment(harness({ status: 'pending' }).deps, 'p1')).rejects.toThrow('not completed')
  })

  it('idempotente: la segunda llamada devuelve el asiento existente sin crear otro', async () => {
    const h = harness({})
    const first = await refundDirectPayment(h.deps, 'p1')
    const second = await refundDirectPayment(h.deps, 'p1')
    expect(h.created).toHaveLength(1)
    expect(second.reference).toBe(first.reference)
  })

  it('sin referencia pos:*, la idempotency key es refund:<paymentId>', () => {
    expect(directRefundReference({ id: 'p9', reference: '' })).toBe('refund:p9')
    expect(directRefundReference({ id: 'p9', reference: 'pos:o1' })).toBe('pos:o1:refund')
  })
})

describe('payments — PaymentsService.refundPaymentByMethod', () => {
  it('tarjeta → refundPayment (Stripe); efectivo → refundDirectPayment; ambos emiten onRefundProcessed', async () => {
    const { PaymentsService } = await import('../service')
    const rows: Record<string, any> = {
      'p-card': { id: 'p-card', hotelId: 'h1', type: 'charge', method: 'card', status: 'completed', amount: 10, currency: 'USD', stripePaymentId: 'pi_1', reference: 'pos:o1:1', metadata: {} },
      'p-cash': { id: 'p-cash', hotelId: 'h1', type: 'charge', method: 'cash', status: 'completed', amount: 20, currency: 'USD', reference: 'pos:o1:2', metadata: {} },
    }
    const created: any[] = []
    const repo: any = {
      findById: async (id: string) => rows[id] ?? null,
      findMany: async (f: any) => created.filter((c) => c.reference === f.reference),
      create: async (d: any) => { const row = { id: `r-${created.length + 1}`, ...d }; created.push(row); return row },
      update: async (id: string, d: any) => { Object.assign(rows[id] ?? {}, d); return rows[id] },
    }
    const registry: any = { resolve: async () => ({ isConfigured: async () => true, refund: async () => ({ id: 're_1' }) }), forHotel: async () => ({ isConfigured: async () => true, refund: async () => ({ id: 're_1' }) }) }
    const svc = new PaymentsService(repo, {} as any, { info() {}, warn() {}, error() {}, debug() {}, child() { return this } } as any, {} as any, undefined, undefined, registry)
    ;(svc as any).stripe = { isConfigured: async () => true, refund: async () => ({ id: 're_1' }) }
    const refunds: string[] = []
    svc.setSockets({ onRefundProcessed: async (p: any) => { refunds.push(p.method) } })
    await svc.refundPaymentByMethod('p-card', { id: 'u1', role: 'hotel_admin' })
    await svc.refundPaymentByMethod('p-cash', { id: 'u1', role: 'hotel_admin' })
    expect(created.map((c) => [c.type, c.method, c.reference])).toEqual([['refund', 'card', 're_1'], ['refund', 'cash', 'pos:o1:2:refund']])
    expect(rows['p-card'].status).toBe('refunded')
    expect(rows['p-cash'].status).toBe('refunded')
    expect(refunds).toEqual(['card', 'cash'])
  })
})

// #214 (COR-D): el asiento `refund` nace `completed` (los reportes restan `type:'refund'` completados),
// pero NO es un cobro: `onPaymentCompleted` (→ webhook externo `payment.completed`, caja, contabilidad)
// no se emite para él. La devolución avisa por `onRefundProcessed` (→ `payment.refunded`), una vez.
describe('payments — una devolución no dispara onPaymentCompleted', () => {
  async function service() {
    const { PaymentsService } = await import('../service')
    const rows: Record<string, any> = {
      'p-cash': { id: 'p-cash', hotelId: 'h1', type: 'charge', method: 'cash', status: 'completed', amount: 20, currency: 'USD', reference: 'pos:o1:2', metadata: { source: 'restaurant', orderId: 'o1' } },
      'p-card': { id: 'p-card', hotelId: 'h1', type: 'charge', method: 'card', status: 'completed', amount: 10, currency: 'USD', stripePaymentId: 'pi_1', reference: 'pos:o1:1', metadata: {} },
    }
    const created: any[] = []
    const repo: any = {
      findById: async (id: string) => rows[id] ?? created.find((c) => c.id === id) ?? null,
      findMany: async (f: any) => created.filter((c) => c.reference === f.reference),
      create: async (d: any) => { const row = { id: `r-${created.length + 1}`, ...d }; created.push(row); return row },
      update: async (id: string, d: any) => { Object.assign(rows[id] ?? {}, d); return rows[id] },
    }
    const registry: any = { resolve: async () => ({ isConfigured: async () => true, refund: async () => ({ id: 're_1' }) }), forHotel: async () => ({ isConfigured: async () => true, refund: async () => ({ id: 're_1' }) }) }
    const svc = new PaymentsService(repo, {} as any, { info() {}, warn() {}, error() {}, debug() {}, child() { return this } } as any, {} as any, undefined, undefined, registry)
    ;(svc as any).stripe = { isConfigured: async () => true, refund: async () => ({ id: 're_1' }) }
    const events: string[] = []
    svc.setSockets({
      onPaymentCreated: async (p: any) => { events.push(`created:${p.type}`) },
      onPaymentCompleted: async (p: any) => { events.push(`completed:${p.type}`) },
      onRefundProcessed: async (p: any) => { events.push(`refunded:${p.method}`) },
    })
    return { svc, events, created }
  }
  it('refund directo (cash): onPaymentCreated + onRefundProcessed, nunca onPaymentCompleted', async () => {
    const { svc, events } = await service()
    await svc.refundPaymentByMethod('p-cash', { id: 'u1', role: 'hotel_admin' })
    expect(events).toEqual(['created:refund', 'refunded:cash'])
  })
  it('refund por Stripe (card): lo mismo', async () => {
    const { svc, events } = await service()
    await svc.refundPaymentByMethod('p-card', { id: 'u1', role: 'hotel_admin' })
    expect(events).toEqual(['created:refund', 'refunded:card'])
  })
  it('un cobro completed sigue emitiendo onPaymentCompleted', async () => {
    const { svc, events } = await service()
    await svc.createPayment({ hotelId: 'h1', type: 'charge', method: 'cash', amount: 5, status: 'completed' } as any)
    expect(events).toEqual(['created:charge', 'completed:charge'])
  })
})
