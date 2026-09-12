// payments/tests/link-to-invoice.test.ts — #253: la factura emitida desde una reserva pagada online
// VINCULA las filas existentes de `payments` (`invoiceId = factura.id`); nunca crea filas.
//
// `payments` es la única fuente de verdad del dinero: si el usecase creara un asiento nuevo por la
// factura, el mismo cobro Stripe contaría dos veces en caja y conciliación. Se prueba sobre un repo
// en memoria: multi-tenancy (otro hotel / otra reserva no se tocan aunque vengan en `paymentIds`),
// idempotencia (una fila ya vinculada no se pisa) y que `rows.length` no cambia.
import { describe, it, expect } from 'bun:test'
import { unbilledPaymentsOfReservation, linkPaymentsToInvoice } from '../usecases/reservation-money'
import type { PaymentDTO } from '../types'

function harness() {
  const rows: any[] = [
    { id: 'p1', hotelId: 'h1', reservationId: 'r1', type: 'charge', status: 'completed', amount: 100, currency: 'DOP', stripeSessionId: 'cs_1' },
    { id: 'p2', hotelId: 'h1', reservationId: 'r1', type: 'charge', status: 'completed', amount: 50, currency: 'DOP', invoiceId: '' },
    { id: 'p3', hotelId: 'h1', reservationId: 'r1', type: 'charge', status: 'completed', amount: 30, currency: 'DOP', invoiceId: 'inv-old' },
    { id: 'p4', hotelId: 'h1', reservationId: 'r2', type: 'charge', status: 'completed', amount: 70, currency: 'DOP' },
    { id: 'p5', hotelId: 'h2', reservationId: 'r1', type: 'charge', status: 'completed', amount: 90, currency: 'DOP' },
  ]
  const updates: Array<{ id: string; data: any }> = []
  const repo = {
    findMany: async (where: Record<string, unknown>) =>
      rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)) as PaymentDTO[],
    update: async (id: string, data: any) => {
      updates.push({ id, data })
      const row = rows.find((r) => r.id === id)
      Object.assign(row, data)
      return row as PaymentDTO
    },
  }
  return { rows, updates, repo }
}

describe('payments — unbilledPaymentsOfReservation (#253)', () => {
  it('devuelve sólo las filas de esa reserva y hotel sin invoiceId (null, undefined o "")', async () => {
    const h = harness()
    const out = await unbilledPaymentsOfReservation(h.repo, 'h1', 'r1')
    expect(out.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    // Las filas salen tal cual: el usecase de facturas necesita type/status/amount/stripeSessionId.
    expect(out.find((p) => p.id === 'p1')).toMatchObject({ type: 'charge', status: 'completed', amount: 100, currency: 'DOP', stripeSessionId: 'cs_1', reservationId: 'r1' })
  })

  it('sin hotelId lanza (multi-tenancy); sin reservationId devuelve vacío', async () => {
    const h = harness()
    await expect(unbilledPaymentsOfReservation(h.repo, '', 'r1')).rejects.toThrow('hotelId')
    expect(await unbilledPaymentsOfReservation(h.repo, 'h1', '')).toEqual([])
  })
})

describe('payments — linkPaymentsToInvoice (#253)', () => {
  it('setea invoiceId en las filas pedidas, devuelve el conteo y NO crea filas', async () => {
    const h = harness()
    const before = h.rows.length
    const linked = await linkPaymentsToInvoice(h.repo, 'h1', 'r1', ['p1', 'p2'], 'inv-new')
    expect(linked).toBe(2)
    expect(h.rows.length).toBe(before)
    expect(h.rows.find((r) => r.id === 'p1')?.invoiceId).toBe('inv-new')
    expect(h.rows.find((r) => r.id === 'p2')?.invoiceId).toBe('inv-new')
    expect(h.updates.map((u) => u.id).sort()).toEqual(['p1', 'p2'])
    expect(h.updates[0]?.data).toEqual({ invoiceId: 'inv-new' })
  })

  it('no toca filas de otro hotel, de otra reserva ni ya vinculadas aunque vengan en paymentIds', async () => {
    const h = harness()
    const linked = await linkPaymentsToInvoice(h.repo, 'h1', 'r1', ['p1', 'p3', 'p4', 'p5', 'p-inexistente'], 'inv-new')
    expect(linked).toBe(1)
    expect(h.updates.map((u) => u.id)).toEqual(['p1'])
    expect(h.rows.find((r) => r.id === 'p3')?.invoiceId).toBe('inv-old')
    expect(h.rows.find((r) => r.id === 'p4')?.invoiceId).toBeUndefined()
    expect(h.rows.find((r) => r.id === 'p5')?.invoiceId).toBeUndefined()
  })

  it('idempotente: la segunda llamada no vuelve a escribir (la fila ya tiene invoiceId)', async () => {
    const h = harness()
    expect(await linkPaymentsToInvoice(h.repo, 'h1', 'r1', ['p1'], 'inv-new')).toBe(1)
    expect(await linkPaymentsToInvoice(h.repo, 'h1', 'r1', ['p1'], 'inv-other')).toBe(0)
    expect(h.rows.find((r) => r.id === 'p1')?.invoiceId).toBe('inv-new')
    expect(h.updates).toHaveLength(1)
  })

  it('lanza sin hotelId o sin invoiceId; sin ids pedidos devuelve 0 sin leer', async () => {
    const h = harness()
    await expect(linkPaymentsToInvoice(h.repo, '', 'r1', ['p1'], 'inv-new')).rejects.toThrow('hotelId')
    await expect(linkPaymentsToInvoice(h.repo, 'h1', 'r1', ['p1'], '')).rejects.toThrow('invoiceId')
    expect(await linkPaymentsToInvoice(h.repo, 'h1', 'r1', [], 'inv-new')).toBe(0)
    expect(h.updates).toHaveLength(0)
  })
})

describe('payments — PaymentsService expone los puertos (#253)', () => {
  it('unbilledPaymentsOfReservation / linkPaymentsToInvoice delegan al usecase con paymentRepo', async () => {
    const { PaymentsService } = await import('../service')
    const h = harness()
    const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger } }
    const svc = new PaymentsService(h.repo as any, {} as any, logger, {} as any, undefined, undefined, {} as any)
    expect((await svc.unbilledPaymentsOfReservation('h1', 'r1')).map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    expect(await svc.linkPaymentsToInvoice('h1', 'r1', ['p2'], 'inv-new')).toBe(1)
    expect(h.rows.find((r) => r.id === 'p2')?.invoiceId).toBe('inv-new')
  })
})
