// facturas/tests/credit-note.test.ts — generateCreditNote propaga el emisor a issuedBy (#326, CA 24 de #298).
//
// La nota de crédito es una fila más de `facturas` (type=credit_note): tiene que quedar con el
// mismo rastro de quién la emitió que una factura normal.

import { describe, it, expect } from 'bun:test'
import { generateCreditNote } from '../usecases/credit-note'
import type { FacturasDTO } from '../types'

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

const baseInvoice: FacturasDTO = {
  id: 'inv-1', hotelId: 'h1', reservationId: 'r1', guestId: 'g1',
  invoiceNumber: 'INV-0001', type: 'invoice', amount: 590, taxes: 90, currency: 'DOP',
  status: 'paid', issueDate: '2026-03-01', ncf: 'B0100000001', notes: null, amountPaid: 590,
  issuedBy: 'u-admin', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
} as FacturasDTO

describe('generateCreditNote', () => {
  it('crea la nota de crédito type=credit_note con issuedBy = userId', async () => {
    const repo = memRepo([{ ...baseInvoice }], 'cn')
    const result = await generateCreditNote(repo as any, baseInvoice, 'huésped canceló', 'u-recepcion')

    // rows[0] es la factura original; rows[1] la nota de crédito nueva.
    expect(repo.rows).toHaveLength(2)
    expect(repo.rows[1].type).toBe('credit_note')
    expect(repo.rows[1].invoiceNumber).toBe('CN-INV-0001')
    expect(repo.rows[1].issuedBy).toBe('u-recepcion')
    expect(result.creditNote.issuedBy).toBe('u-recepcion')
    // No hereda el emisor de la factura original.
    expect(repo.rows[1].issuedBy).not.toBe(baseInvoice.issuedBy)
  })

  it('cancela la factura original y deja rastro del usuario en las notas', async () => {
    const repo = memRepo([{ ...baseInvoice }], 'cn')
    const result = await generateCreditNote(repo as any, baseInvoice, 'duplicada', 'u-recepcion')

    expect(result.originalInvoice.status).toBe('cancelled')
    expect(repo.rows[0].status).toBe('cancelled')
    expect(repo.rows[0].notes).toContain('Cancelado por u-recepcion')
    expect(repo.rows[0].notes).toContain('CN-INV-0001')
  })

  it('issuedBy queda null si no llega userId', async () => {
    const repo = memRepo([], 'cn')
    await generateCreditNote(repo as any, baseInvoice, 'sin usuario', undefined as any)

    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0].type).toBe('credit_note')
    expect(repo.rows[0].issuedBy).toBeNull()
  })
})
