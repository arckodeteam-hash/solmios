// reservas/tests/detail-invoices.test.ts — El detalle de la reserva trae sus facturas proyectadas.
//
// REQ-FDR-01 (issue #252): el modal necesita mostrar/imprimir la factura de la reserva. El detalle
// las lee por el puerto reserva→facturas que ya existía (`queries.paidRepos.invoiceRepo`) y las
// PROYECTA (`usecases/reservation-invoices.ts`): no expone la fila cruda del módulo facturas.

import { describe, it, expect } from 'bun:test'
import { getExtendedDetail } from '../usecases/detail'

const HOTEL = 'h1'
const USER = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const nullRepo = { findById: async () => null } as any

/** Doble mínimo de ReservasQueries para el detalle (mismo contrato que `detail-pending.test.ts`). */
function queriesWith(money: { folios?: any[]; invoices?: any[]; payments?: any[] } = {}, invoiceRepo?: any) {
  return {
    getCompanions: async () => [],
    getLockCodes: async () => [],
    getPaymentRequests: async () => [],
    getReservationAddons: async () => [],
    // Los dobles respetan el WHERE real (hotel incluido): una factura de otra reserva/hotel no entra.
    paidRepos: {
      folioRepo: { findMany: async (f: any) => (money.folios ?? []).filter((x: any) => x.hotelId === f?.hotelId && x.reservationId === f?.reservationId) },
      invoiceRepo: invoiceRepo ?? { findMany: async (f: any) => (money.invoices ?? []).filter((x: any) => x.hotelId === f?.hotelId && x.reservationId === f?.reservationId) },
      paymentRepo: {
        findMany: async (f: any) => (money.payments ?? []).filter((p: any) => {
          if (p.hotelId !== f?.hotelId) return false
          if (f?.folioId !== undefined) return p.folioId === f.folioId
          if (f?.invoiceId !== undefined) return p.invoiceId === f.invoiceId
          if (f?.reservationId !== undefined) return p.reservationId === f.reservationId
          return false
        }),
      },
    },
    findConfiguration: async () => null,
  } as any
}

/** Puerto al módulo marketing (STR-3): el detalle NO lee `message_logs` por su cuenta. */
function messageLogsPort(rows: any[] = []) {
  return async (_hotelId: string, _reservationId: string) => rows
}

function reservation(over: Record<string, any> = {}) {
  return { id: 'r1', hotelId: HOTEL, totalAmount: 1000, deposit: 0, otherCharges: 0, ...over }
}

function invoice(over: Record<string, any> = {}) {
  return {
    id: 'inv1', hotelId: HOTEL, reservationId: 'r1', invoiceNumber: 'F-0001', type: 'invoice',
    status: 'pending', amount: 500, taxes: 90, amountPaid: 200, currency: 'USD',
    issueDate: '2026-09-01', ncf: 'B0100000001', notes: 'interno', ...over,
  }
}

describe('getExtendedDetail — facturas de la reserva (REQ-FDR-01)', () => {
  it('proyecta la factura de la reserva: número, saldo derivado, fecha y NCF; sin campos crudos', async () => {
    const repo = { findById: async () => reservation() } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith({ invoices: [invoice()] }), 'r1', USER, messageLogsPort())
    expect(d.invoices.length).toBe(1)
    const v = d.invoices[0]
    expect(v.id).toBe('inv1')
    expect(v.number).toBe('F-0001')
    expect(v.type).toBe('invoice')
    expect(v.status).toBe('pending')
    expect(v.amount).toBe(500)
    expect(v.taxes).toBe(90)
    expect(v.amountPaid).toBe(200)
    // `balance` no viene en la fila: amount − amountPaid.
    expect(v.balance).toBe(300)
    expect(v.currency).toBe('USD')
    expect(v.issuedAt).toBe('2026-09-01')
    expect(v.ncf).toBe('B0100000001')
    // La vista NO expone la fila cruda del módulo facturas.
    expect('reservationId' in v).toBe(false)
    expect('hotelId' in v).toBe(false)
    expect('notes' in v).toBe(false)
  })

  it('ordena de la más reciente a la más vieja (la vigente es la que se imprime)', async () => {
    const repo = { findById: async () => reservation() } as any
    const d = await getExtendedDetail(
      repo, nullRepo, nullRepo,
      queriesWith({ invoices: [
        invoice({ id: 'inv-ago', invoiceNumber: 'F-0001', issueDate: '2026-08-01' }),
        invoice({ id: 'inv-sep', invoiceNumber: 'F-0002', issueDate: '2026-09-05' }),
      ] }),
      'r1', USER, messageLogsPort(),
    )
    expect(d.invoices.map((i: any) => i.number)).toEqual(['F-0002', 'F-0001'])
  })

  it('si el puerto de facturas falla, `invoices` es [] y el detalle se devuelve igual', async () => {
    // `paidForReservation` (NO best-effort) también consulta `invoiceRepo` para llegar a `payments`,
    // y `reservationPaymentHistory` (best-effort) otra vez: un `invoiceRepo` que lanzara SIEMPRE
    // tumbaría `paid` antes de llegar al bloque de facturas. Por eso el doble deja pasar la primera
    // llamada (la de `paid`) y lanza en las siguientes, que son las best-effort.
    let calls = 0
    const flaky = { findMany: async () => { calls++; if (calls === 1) return []; throw new Error('facturas caído') } }
    const repo = { findById: async () => reservation({ deposit: 100 }) } as any
    const d = await getExtendedDetail(repo, nullRepo, nullRepo, queriesWith({}, flaky), 'r1', USER, messageLogsPort())
    expect(calls).toBeGreaterThanOrEqual(2)
    expect(d.invoices).toEqual([])
    expect(d.paidAmount).toBe(100)
    expect(d.id).toBe('r1')
  })

  it('no trae facturas de otra reserva del mismo hotel', async () => {
    const repo = { findById: async () => reservation() } as any
    const d = await getExtendedDetail(
      repo, nullRepo, nullRepo,
      queriesWith({ invoices: [
        invoice({ id: 'inv-r1', invoiceNumber: 'F-0001' }),
        invoice({ id: 'inv-r2', invoiceNumber: 'F-0009', reservationId: 'r2' }),
      ] }),
      'r1', USER, messageLogsPort(),
    )
    expect(d.invoices.map((i: any) => i.id)).toEqual(['inv-r1'])
  })
})
