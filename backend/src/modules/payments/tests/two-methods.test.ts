// payments/tests/two-methods.test.ts — #353
//
// Invariante de `payments` como fuente de verdad del dinero: cobrar una misma factura/folio con DOS
// métodos distintos (ej. efectivo + tarjeta, un pago mixto) debe producir DOS filas independientes en
// `payments`, cada una con su propio `method`. Ninguna pisa a la otra (no es un UPDATE del mismo
// registro). Antes de la consolidación esto vivía como comprobantes `type:'payment'` en `invoices`;
// ahora cada cobro es una fila propia acá.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentsService } from '../service'
import type { PaymentDTO } from '../types'
import { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const emptyGatewayRepo: any = { findMany: async () => [], findById: async () => null, create: async (d: any) => d, update: async () => {}, delete: async () => {}, count: async () => 0 }
const testRegistry = new PaymentGatewayRegistry(emptyGatewayRepo, log)

/** Repo con estado real en memoria: cada `create` agrega una fila con id propio (no sobreescribe). */
function statefulRepo(): { repo: RepositoryAdapter<PaymentDTO>; rows: PaymentDTO[] } {
  const rows: PaymentDTO[] = []
  let seq = 0
  const repo = {
    findMany: async (filter: any = {}) =>
      rows.filter(r => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)),
    findById: async (id: string) => rows.find(r => r.id === id) ?? null,
    findOne: async () => null,
    create: async (data: any) => { const row = { id: `pay-${++seq}`, ...data }; rows.push(row); return row },
    update: async (id: string, data: any) => {
      const row = rows.find(r => r.id === id)
      if (row) Object.assign(row, data)
      return row ?? null
    },
    delete: async () => true,
    count: async () => rows.length,
    paginate: async (filter: any = {}, { limit = 20, offset = 0 }: any = {}) => {
      const filtered = rows.filter(r => Object.entries(filter).every(([k, v]) => (r as any)[k] === v))
      return { data: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset, pages: Math.ceil(filtered.length / limit) }
    },
  } as unknown as RepositoryAdapter<PaymentDTO>
  return { repo, rows }
}

// El pago verifica que folioId/invoiceId/guestId sean del MISMO hotel (IDOR de campos de
// relación). El guard es FAIL-CLOSED: sin repo para comprobarlo, rechaza. Estos fixtures usan
// hotelId 'h1', así que el repo de referencias devuelve siempre una fila de ese hotel.
const refRepo = { findOne: async ({ id }: any) => ({ id, hotelId: 'h1' }) } as any

describe('payments — dos métodos sobre la misma factura (#353)', () => {
  it('crea DOS filas, una por método, sin pisar ninguna', async () => {
    const { repo, rows } = statefulRepo()
    const service = new PaymentsService(repo, repo as any, log, silentCache, undefined, undefined, testRegistry, undefined, refRepo, refRepo, refRepo)

    const cash = await service.createPayment({
      hotelId: 'h1', invoiceId: 'inv1', type: 'charge', method: 'cash', amount: 60, currency: 'USD', status: 'completed',
    })
    const card = await service.createPayment({
      hotelId: 'h1', invoiceId: 'inv1', type: 'charge', method: 'card', amount: 40, currency: 'USD', status: 'completed',
    })

    // Dos ids distintos: no fue un UPDATE del mismo registro.
    expect(cash.id).not.toBe(card.id)

    const stored = rows.filter(r => r.invoiceId === 'inv1')
    expect(stored).toHaveLength(2)

    // Cada fila conserva SU método (ninguna quedó pisada por la otra).
    const byMethod = new Map(stored.map(r => [r.method, r]))
    expect(byMethod.get('cash')?.amount).toBe(60)
    expect(byMethod.get('card')?.amount).toBe(40)
    expect([...byMethod.keys()].sort()).toEqual(['card', 'cash'])
  })

  it('listPayments devuelve las dos filas para la misma factura', async () => {
    const { repo } = statefulRepo()
    const service = new PaymentsService(repo, repo as any, log, silentCache, undefined, undefined, testRegistry, undefined, refRepo, refRepo, refRepo)

    await service.createPayment({ hotelId: 'h1', invoiceId: 'inv1', type: 'charge', method: 'cash', amount: 60, status: 'completed' })
    await service.createPayment({ hotelId: 'h1', invoiceId: 'inv1', type: 'charge', method: 'transfer', amount: 40, status: 'completed' })

    const listed = await service.listPayments({ hotelId: 'h1', invoiceId: 'inv1' })
    expect(listed.data).toHaveLength(2)
    expect(listed.data.map(p => p.method).sort()).toEqual(['cash', 'transfer'])
  })
})
