// facturas/tests/invoice-from-reservation.test.ts — Factura desde la reserva sin folio (#253, REQ-FDR-02).
//
// Escenario que no se podía facturar: reserva pagada online por Stripe, sin folio. La factura
// tiene que salir con el total cobrable, los impuestos de la CONFIG del hotel (el 18 vive acá,
// en el test, nunca en el usecase), quedar `paid` y VINCULAR el pago existente — sin crear filas
// en `payments`.

import { describe, it, expect } from 'bun:test'
import { NotFoundError, ConflictError, ValidationError } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { invoiceFromReservation, ReservationAlreadyInvoicedError } from '../usecases/invoice-from-reservation'
import type { PaymentPort } from '../usecases/payment-port'
import type { AuditEntry } from '../usecases/audit'
import type { CurrentUser } from '../types'

const log = silentLogger()
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const TAX_RATE = 18
const net = (gross: number) => Math.round((gross / (1 + TAX_RATE / 100) + Number.EPSILON) * 100) / 100

const baseReservation = {
  id: 'r1', hotelId: 'h1', guestId: 'g1', status: 'confirmed', currency: 'DOP',
  checkIn: '2026-03-01', checkOut: '2026-03-03', totalAmount: 590, otherCharges: 0, deposit: 590,
}

/** Repo en memoria: filtra por igualdad de cada campo del where. */
function memRepo(rows: any[] = [], prefix = 'row') {
  let seq = 0
  const matches = (r: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)
  return {
    rows,
    findMany: async (where?: any) => rows.filter((r) => matches(r, where)),
    findOne: async (where?: any) => rows.find((r) => matches(r, where)) ?? null,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    create: async (d: any) => { const row = { id: `${prefix}-${++seq}`, ...d }; rows.push(row); return row },
    update: async (id: string, d: any) => {
      const i = rows.findIndex((r) => r.id === id)
      if (i < 0) return null
      rows[i] = { ...rows[i], ...d }
      return rows[i]
    },
    delete: async () => true, count: async () => rows.length,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0, hasNext: false, hasPrev: false }),
  }
}

/** Puerto de pagos falso: lee del array y sólo escribe `invoiceId`. Jamás agrega filas. */
function makePaymentPort(payments: any[]): PaymentPort {
  return {
    recordPayment: async () => { throw new Error('la factura desde la reserva NO crea pagos') },
    paymentsOfReservation: async (_hotelId, reservationId) =>
      payments.filter((p: any) => p.reservationId === reservationId && !p.invoiceId),
    linkPaymentsToInvoice: async (_hotelId, _reservationId, ids, invoiceId) => {
      let n = 0
      for (const p of payments) if (ids.includes(p.id) && !p.invoiceId) { p.invoiceId = invoiceId; n++ }
      return n
    },
  }
}

function setup(over: {
  reservation?: any
  reservations?: any[]
  payments?: any[]
  addons?: any[]
  invoices?: any[]
  paymentPort?: PaymentPort | null
  addonsRepo?: any
} = {}) {
  const reservation = { ...baseReservation, ...(over.reservation ?? {}) }
  const payments: any[] = over.payments ?? []
  const audits: AuditEntry[] = []
  const repo = memRepo(over.invoices ?? [], 'inv')
  const configRepo = memRepo([{ id: 'c1', hotelId: 'h1', key: 'taxes', value: [{ name: 'ITBIS', rate: TAX_RATE, active: true }] }], 'cfg')
  const itemRepo = memRepo([], 'it')
  const deps = {
    repo: repo as any, configRepo: configRepo as any, itemRepo: itemRepo as any, logger: log,
    reservationRepo: memRepo(over.reservations ?? [reservation]),
    addonsRepo: over.addonsRepo ?? memRepo(over.addons ?? []),
    paymentPort: over.paymentPort === undefined ? makePaymentPort(payments) : over.paymentPort,
    auditPort: { record: async (e: AuditEntry) => { audits.push(e) } },
  }
  return { deps, repo, itemRepo, payments, audits, paymentsBefore: payments.length }
}

const stripePayment = (over: Record<string, unknown> = {}): Record<string, any> => ({
  id: 'p1', hotelId: 'h1', reservationId: 'r1', type: 'charge', status: 'completed', method: 'card',
  amount: 590, currency: 'DOP', stripeSessionId: 'cs_1', invoiceId: null, ...over,
})

describe('invoiceFromReservation — reserva pagada online, sin folio (#253)', () => {
  it('emite la factura paid por el total bruto, con impuestos de config, y vincula el pago sin crear otro', async () => {
    const { deps, repo, itemRepo, payments, audits, paymentsBefore } = setup({ payments: [stripePayment()] })
    const result = await invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)

    const inv = result.invoice
    expect(inv.type).toBe('invoice')
    expect(inv.status).toBe('paid')
    expect(inv.reservationId).toBe('r1')
    expect(inv.currency).toBe('DOP')
    expect(inv.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/)
    // 590 bruto = 500 neto + 90 de ITBIS (18% de la CONFIG, no del código)
    expect(Math.abs(inv.amount - 590)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(inv.taxes - 90)).toBeLessThanOrEqual(0.01)
    expect(inv.amountPaid).toBe(590)
    expect(result.amountPaid).toBe(590)

    // Las líneas persistidas suman la base neta.
    const items = itemRepo.rows.filter((r) => r.invoiceId === inv.id)
    expect(items).toHaveLength(1)
    expect(items[0].description).toContain('Alojamiento')
    expect(items[0].description).toContain('2 noches')
    expect(Math.abs(items.reduce((s, r) => s + r.amount, 0) - (inv.amount - inv.taxes))).toBeLessThanOrEqual(0.01)

    // El pago existente queda VINCULADO; `payments` no creció.
    expect(result.linkedPayments).toBe(1)
    expect(payments[0].invoiceId).toBe(inv.id)
    expect(payments).toHaveLength(paymentsBefore)
    expect(repo.rows).toHaveLength(1)
    expect(inv.paymentMethod).toBe('card')

    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe('invoice.issued_from_reservation')
    expect(audits[0].entityId).toBe(inv.id)
    expect(audits[0].hotelId).toBe('h1')
  })

  it('extras con signo (service suma, discount resta) y pago parcial → pending con lo pagado', async () => {
    const addons = [
      { id: 'a1', hotelId: 'h1', reservationId: 'r1', description: 'Spa', amount: 100, quantity: 1, kind: 'service' },
      { id: 'a2', hotelId: 'h1', reservationId: 'r1', description: 'Promo', amount: 50, quantity: 1, kind: 'discount' },
      { id: 'ajena', hotelId: 'h1', reservationId: 'otra', description: 'No es de r1', amount: 999, quantity: 1, kind: 'service' },
    ]
    const { deps, itemRepo, payments } = setup({ addons, payments: [stripePayment({ amount: 200 })] })
    const result = await invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1', notes: 'web' }, user)

    const inv = result.invoice
    // chargeableTotal = 590 + 100 − 50 = 640 bruto
    expect(Math.abs(inv.amount - 640)).toBeLessThanOrEqual(0.01)
    expect(inv.status).toBe('pending')
    expect(inv.amountPaid).toBe(200)
    expect(result.amountPaid).toBe(200)
    expect(inv.notes).toBe('web')

    const items = itemRepo.rows.filter((r) => r.invoiceId === inv.id)
    expect(items.map((r) => r.description)).toEqual([expect.stringContaining('Alojamiento'), 'Spa', 'Promo'])
    expect(items[1].amount).toBe(net(100))
    expect(items[2].amount).toBe(-net(50))
    expect(payments[0].invoiceId).toBe(inv.id)
  })

  it('refund parcial: charge 590 + refund 90 → amountPaid 500 y pending, ambas filas vinculadas', async () => {
    const payments = [
      stripePayment(),
      stripePayment({ id: 'p2', type: 'refund', amount: 90, stripeSessionId: null }),
    ]
    const { deps, paymentsBefore } = setup({ payments })
    const result = await invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)

    expect(result.amountPaid).toBe(500)
    expect(result.invoice.status).toBe('pending')
    expect(result.invoice.amountPaid).toBe(500)
    expect(result.linkedPayments).toBe(2)
    expect(payments.every((p) => p.invoiceId === result.invoice.id)).toBe(true)
    expect(payments).toHaveLength(paymentsBefore)
  })

  it('ignora pagos que no cuentan (pending/failed) y los ya facturados', async () => {
    const payments = [
      stripePayment({ id: 'p1', status: 'pending' }),
      stripePayment({ id: 'p2', status: 'failed' }),
      stripePayment({ id: 'p3', amount: 100, invoiceId: 'inv-vieja' }),
    ]
    const { deps } = setup({ payments })
    const result = await invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)
    expect(result.amountPaid).toBe(0)
    expect(result.linkedPayments).toBe(0)
    expect(result.invoice.status).toBe('pending')
    expect(payments[0].invoiceId).toBeNull()
    expect(payments[2].invoiceId).toBe('inv-vieja')
  })

  it('segunda emisión → ReservationAlreadyInvoicedError con el invoiceId de la viva; anulada la primera, emite otra', async () => {
    const { deps, repo, payments } = setup({ payments: [stripePayment()] })
    const first = await invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)

    let caught: any
    try { await invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ReservationAlreadyInvoicedError)
    expect(caught).toBeInstanceOf(ConflictError)
    expect(caught.invoiceId).toBe(first.invoice.id)
    expect(caught.message).toContain(first.invoiceNumber)
    expect(repo.rows).toHaveLength(1)

    // Anular ≠ borrar: la factura cancelada (nota de crédito) no bloquea una nueva emisión.
    await repo.update(first.invoice.id, { status: 'cancelled' })
    const second = await invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)
    expect(second.invoice.id).not.toBe(first.invoice.id)
    expect(second.invoiceNumber).not.toBe(first.invoiceNumber)
    // El pago ya cuelga de la primera: no se re-vincula ni se cuenta de nuevo.
    expect(second.linkedPayments).toBe(0)
    expect(second.amountPaid).toBe(0)
    expect(second.invoice.status).toBe('pending')
    expect(payments[0].invoiceId).toBe(first.invoice.id)
  })

  it('reserva de otro hotel → NotFoundError (multi-tenancy) y nada se escribe', async () => {
    const { deps, repo } = setup({ reservation: { hotelId: 'h2' }, payments: [stripePayment({ hotelId: 'h2' })] })
    await expect(invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)).rejects.toBeInstanceOf(NotFoundError)
    expect(repo.rows).toHaveLength(0)
  })

  it('reserva inexistente → NotFoundError', async () => {
    const { deps } = setup()
    await expect(invoiceFromReservation(deps as any, 'h1', { reservationId: 'nope' }, user)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('reserva cancelada → ConflictError', async () => {
    const { deps } = setup({ reservation: { status: 'cancelled' } })
    await expect(invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)).rejects.toBeInstanceOf(ConflictError)
  })

  it('sin puerto de pagos (o sin los métodos de #253) → ValidationError antes de emitir nada', async () => {
    const noPort = setup({ paymentPort: null })
    await expect(invoiceFromReservation(noPort.deps as any, 'h1', { reservationId: 'r1' }, user)).rejects.toBeInstanceOf(ValidationError)
    expect(noPort.repo.rows).toHaveLength(0)

    const oldPort = setup({ paymentPort: { recordPayment: async () => ({ id: 'x', status: 'completed' }) } })
    await expect(invoiceFromReservation(oldPort.deps as any, 'h1', { reservationId: 'r1' }, user)).rejects.toThrow(/facturas-payments/)
    expect(oldPort.repo.rows).toHaveLength(0)
  })

  it('total cobrable 0 → ValidationError', async () => {
    const { deps, repo } = setup({ reservation: { totalAmount: 0 } })
    await expect(invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)).rejects.toBeInstanceOf(ValidationError)
    expect(repo.rows).toHaveLength(0)
  })

  it('sin extras ni pagos (addonsRepo vacío) → factura pending con amountPaid 0 y ningún vínculo', async () => {
    const { deps, audits } = setup({ addonsRepo: { findMany: async () => [] }, payments: [] })
    const result = await invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)
    expect(result.invoice.status).toBe('pending')
    expect(result.amountPaid).toBe(0)
    expect(result.linkedPayments).toBe(0)
    expect(result.invoice.amountPaid ?? 0).toBe(0)
    expect(Math.abs(result.invoice.amount - 590)).toBeLessThanOrEqual(0.01)
    expect(audits[0].action).toBe('invoice.issued_from_reservation')
  })

  it('si el vínculo falla después de emitir, propaga el error (la factura ya consumió numerador)', async () => {
    const payments = [stripePayment()]
    const port = makePaymentPort(payments)
    port.linkPaymentsToInvoice = async () => { throw new Error('payments caído') }
    const { deps, repo } = setup({ payments, paymentPort: port })
    await expect(invoiceFromReservation(deps as any, 'h1', { reservationId: 'r1' }, user)).rejects.toThrow('payments caído')
    expect(repo.rows).toHaveLength(1)
    expect(payments[0].invoiceId).toBeNull()
  })
})
