// payments/tests/audit.test.ts — SC-05: todo movimiento de plata deja rastro.
//
// Lo que se protege acá no es el happy path del cobro (eso ya está cubierto), sino que NADIE
// pueda mover dinero sin quedar registrado, y que el audit log JAMÁS tumbe la operación:
// si el registro falla, el huésped igual queda con su reembolso.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { PaymentsService } from '../service'
import type { AuditEntry } from '../usecases/audit'
import { PaymentGatewayRegistry } from '../../../services/payment-gateway/registry'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

// Registry de pasarelas: estos tests no cobran por pasarela, pero el service lo exige para que
// NINGUNA operación de dinero pueda correr sin decir de qué hotel es (multi-tenancy).
const emptyGatewayRepo: any = { findMany: async () => [], findById: async () => null, create: async (d: any) => d, update: async () => {}, delete: async () => {}, count: async () => 0 }
const testRegistry = new PaymentGatewayRegistry(emptyGatewayRepo, log)

function makeRepo(overrides: Partial<RepositoryAdapter<any>> = {}): RepositoryAdapter<any> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => ({ id: 'test-id', ...data }),
    update: async (id, data) => ({ id, ...data }),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

/** Captura lo que se manda al audit log. */
function spyAudit() {
  const entries: AuditEntry[] = []
  return { entries, port: { record: async (e: AuditEntry) => { entries.push(e) } } }
}

const DEPOSIT = {
  id: 'dep-1', hotelId: 'h1', amount: 200, currency: 'USD', status: 'held',
}

describe('payments — audit log (SC-05)', () => {
  describe('depósitos', () => {
    it('registra quién devolvió el depósito, con hotel y monto', async () => {
      const audit = spyAudit()
      const depositRepo = makeRepo({
        findById: async () => ({ ...DEPOSIT }),
        update: async (id, data) => ({ ...DEPOSIT, id, ...data }),
      })
      const service = new PaymentsService(makeRepo(), depositRepo, log, silentCache, undefined, undefined, testRegistry)
      service.setAuditDeps(audit.port)

      await service.refundDeposit('dep-1', { refundAmount: 200 } as any, { id: 'u-9', role: 'hotel_admin' })

      expect(audit.entries).toHaveLength(1)
      const [entry] = audit.entries
      expect(entry.action).toBe('deposit.refund')
      expect(entry.entity).toBe('deposit')
      expect(entry.entityId).toBe('dep-1')
      expect(entry.userId).toBe('u-9')   // QUIÉN: sin esto el rastro no sirve
      expect(entry.hotelId).toBe('h1')
      expect(entry.detail).toContain('200')
    })

    it('registra la liberación del depósito', async () => {
      const audit = spyAudit()
      const depositRepo = makeRepo({
        findById: async () => ({ ...DEPOSIT }),
        update: async (id, data) => ({ ...DEPOSIT, id, ...data }),
      })
      const service = new PaymentsService(makeRepo(), depositRepo, log, silentCache, undefined, undefined, testRegistry)
      service.setAuditDeps(audit.port)

      await service.releaseDeposit('dep-1', { id: 'u-9', role: 'hotel_admin' })

      expect(audit.entries.map((e) => e.action)).toEqual(['deposit.release'])
      expect(audit.entries[0].userId).toBe('u-9')
    })
  })

  describe('resiliencia', () => {
    it('si el audit log falla, la operación de dinero NO se cae', async () => {
      const depositRepo = makeRepo({
        findById: async () => ({ ...DEPOSIT }),
        update: async (id, data) => ({ ...DEPOSIT, id, ...data }),
      })
      const service = new PaymentsService(makeRepo(), depositRepo, log, silentCache, undefined, undefined, testRegistry)
      service.setAuditDeps({ record: async () => { throw new Error('auditlog caído') } })

      // No debe propagar: un audit log roto no puede impedir devolverle la plata al huésped.
      const deposit = await service.releaseDeposit('dep-1', { id: 'u-9' })
      expect(deposit.id).toBe('dep-1')
    })

    it('sin connector de audit conectado, la operación sigue funcionando', async () => {
      const depositRepo = makeRepo({
        findById: async () => ({ ...DEPOSIT }),
        update: async (id, data) => ({ ...DEPOSIT, id, ...data }),
      })
      const service = new PaymentsService(makeRepo(), depositRepo, log, silentCache, undefined, undefined, testRegistry)
      // sin setAuditDeps() a propósito

      const deposit = await service.releaseDeposit('dep-1', { id: 'u-9' })
      expect(deposit.id).toBe('dep-1')
    })
  })
})
