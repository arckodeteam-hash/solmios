// facturas/tests/service.test.ts — Tests del servicio
// Usa RepositoryAdapter mocks — sin dependencia de SQLite ni Postgres.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { FacturasService } from '../service'
import type { FacturasDTO, CurrentUser } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

// Auth mock: replica la lógica real de assertOwnership (lanza si no es dueño ni admin).
const mockAuth = {
  assertOwnership: (rid: string, uid: string, role?: string, admin = 'admin') => {
    if (rid === uid) return
    if (role === admin) return
    throw new Error('Forbidden')
  },
} as unknown as Auth
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

const emptyRepo = (): RepositoryAdapter<any> => ({
  findMany: async () => [], findById: async () => null, findOne: async () => null,
  create: async (d: any) => ({ id: 'test-id', ...d }), update: async (id: string, d: any) => ({ id, ...d }),
  delete: async () => true, count: async () => 0,
  paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0, hasNext: false, hasPrev: false }),
})

function makeRepo(overrides: Partial<RepositoryAdapter<FacturasDTO>> = {}): RepositoryAdapter<FacturasDTO> {
  return { ...emptyRepo(), ...overrides } as RepositoryAdapter<FacturasDTO>
}

const enrichDeps = { guest: emptyRepo(), reservation: emptyRepo(), room: emptyRepo() }
// Users mock: el usuario u1 pertenece al hotel h1. (findById para ownership, findOne para
// resolve-hotel en el alta.)
const userRepo = { ...emptyRepo(), findById: async () => ({ id: 'u1', hotelId: 'h1' }), findOne: async () => ({ id: 'u1', hotelId: 'h1' }) } as RepositoryAdapter<any>

describe('FacturasService', () => {
  describe('getById', () => {
    it('lanza NotFound si el item no existe', async () => {
      const service = new FacturasService(makeRepo(), emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      await expect(service.getById('no-existe', user)).rejects.toThrow('Factura no encontrada')
    })

    it('retorna el item enriquecido si existe y es del hotel del usuario', async () => {
      const item = { id: '1', hotelId: 'h1', amount: 100, taxes: 18 } as FacturasDTO
      const service = new FacturasService(makeRepo({ findById: async () => item }), emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      const result = await service.getById('1', user)
      expect(result.id).toBe('1')
      expect(result.subtotal).toBe(82) // 100 - 18
    })

    it('rechaza acceso a factura de otro hotel (IDOR)', async () => {
      const item = { id: '1', hotelId: 'otro-hotel', amount: 100, taxes: 0 } as FacturasDTO
      const service = new FacturasService(makeRepo({ findById: async () => item }), emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      await expect(service.getById('1', user)).rejects.toThrow()
    })
  })

  describe('list', () => {
    it('returns paginated invoices for super_admin', async () => {
      const invoices = [{ id: 'i1', hotelId: 'h1', amount: 100, taxes: 0 }] as FacturasDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: invoices, total: 1, limit: 20, offset: 0, pages: 1, hasNext: false, hasPrev: false }) })
      const svc = new FacturasService(repo, emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      const result = await svc.list({}, { id: 'admin', role: 'super_admin' })
      expect(result.data).toHaveLength(1)
    })

    it('filters by hotelId for hotel_admin', async () => {
      const invoices = [{ id: 'i1', hotelId: 'h1', amount: 100, taxes: 0 }] as FacturasDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: invoices, total: 1, limit: 20, offset: 0, pages: 1, hasNext: false, hasPrev: false }) })
      const svc = new FacturasService(repo, emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      const result = await svc.list({}, user)
      expect(result.data).toHaveLength(1)
    })
  })

  describe('create', () => {
    it('crea una factura calculando impuestos desde la config', async () => {
      const configRepo = { ...emptyRepo(), findOne: async () => ({ value: [{ tasa: 18, activo: true }] }) }
      const service = new FacturasService(makeRepo(), configRepo as any, enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      const result = await service.create({ hotelId: 'h1', amount: 100, type: 'invoice' } as any, user)
      expect(result.id).toBe('test-id')
      expect(result.taxes).toBe(18)
      expect(result.amount).toBe(118)
      expect(result.invoiceNumber).toMatch(/^INV-\d{4}-/)
    })

    it('C1 IDOR: un hotel_admin que manda hotelId ajeno factura en SU hotel, no en el ajeno', async () => {
      const configRepo = { ...emptyRepo(), findOne: async () => null }
      // Capturamos lo que se persiste para ver con qué hotelId se creó.
      let persisted: any = null
      const repo = makeRepo({ create: async (d: any) => { persisted = { id: 'x', ...d }; return persisted } })
      const service = new FacturasService(repo, configRepo as any, enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      // user (u1) es hotel_admin de h1; intenta facturar en 'hotel-victima'.
      await service.create({ hotelId: 'hotel-victima', amount: 666, type: 'invoice' } as any, user)
      expect(persisted.hotelId).toBe('h1')        // se forzó su propio hotel
      expect(persisted.hotelId).not.toBe('hotel-victima')
    })

    it('C1: super_admin SÍ puede facturar en un hotel arbitrario', async () => {
      const configRepo = { ...emptyRepo(), findOne: async () => null }
      let persisted: any = null
      const repo = makeRepo({ create: async (d: any) => { persisted = { id: 'x', ...d }; return persisted } })
      const service = new FacturasService(repo, configRepo as any, enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      await service.create({ hotelId: 'cualquier-hotel', amount: 100, type: 'invoice' } as any, { id: 'sa', role: 'super_admin' })
      expect(persisted.hotelId).toBe('cualquier-hotel')
    })
  })

  describe('pay', () => {
    it('marca la factura como pagada', async () => {
      const inv = { id: 'i1', hotelId: 'h1', amount: 100, taxes: 0, status: 'pending' } as FacturasDTO
      const service = new FacturasService(makeRepo({ findById: async () => inv }), emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      // El cobro exige asiento en `payments`: sin el conector, `pay` falla en vez de marcar la
      // factura pagada sin respaldo (finanzas-consolidacion 1.4).
      service.setPaymentDeps({ recordPayment: async () => ({ id: 'pay-1', status: 'completed' }) })
      const result = await service.pay('i1', { method: 'card' }, user)
      expect(result.status).toBe('paid')
    })

    it('rechaza un sobrepago (monto mayor que el saldo): no invoca paymentPort ni repo.update', async () => {
      // Defensa a nivel servicio: si alguien mueve el guardián fuera de payInvoice, este test
      // verifica que el rechazo burbujee sin efectos secundarios (ni cobro ni update).
      const inv = { id: 'inv-1', hotelId: 'h1', amount: 100, amountPaid: 0, taxes: 0, status: 'pending' } as FacturasDTO
      const paymentCalls: any[] = []
      const paymentPort = {
        recordPayment: async (input: any) => { paymentCalls.push(input); return { id: 'pay-1', status: 'completed' } },
      }
      let updateCalled = false
      const repo = makeRepo({
        findById: async () => inv,
        update: async (id: string, data: any) => { updateCalled = true; return { id, ...data } as FacturasDTO },
      })
      const service = new FacturasService(repo, emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      service.setPaymentDeps(paymentPort)

      await expect(
        service.pay('inv-1', { method: 'cash', amount: 150 }, user),
      ).rejects.toThrow(/excede el saldo pendiente/)
      // Sin side effects: el cobro nunca se asienta ni se actualiza la factura.
      expect(paymentCalls).toHaveLength(0)
      expect(updateCalled).toBe(false)
    })

    it('rechaza un sobrepago sobre saldo parcial: el mensaje referencia el saldo restante', async () => {
      // Factura de 100 con 30 ya pagados → saldo 70. Cobrar 80 excede el saldo pendiente.
      const inv = { id: 'inv-2', hotelId: 'h1', amount: 100, amountPaid: 30, taxes: 0, status: 'pending' } as FacturasDTO
      const paymentCalls: any[] = []
      const paymentPort = {
        recordPayment: async (input: any) => { paymentCalls.push(input); return { id: 'pay-1', status: 'completed' } },
      }
      let updateCalled = false
      const repo = makeRepo({
        findById: async () => inv,
        update: async (id: string, data: any) => { updateCalled = true; return { id, ...data } as FacturasDTO },
      })
      const service = new FacturasService(repo, emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      service.setPaymentDeps(paymentPort)

      await expect(
        service.pay('inv-2', { method: 'card', amount: 80 }, user),
      ).rejects.toThrow(/excede el saldo pendiente \(\$70\)/)
      expect(paymentCalls).toHaveLength(0)
      expect(updateCalled).toBe(false)
    })
  })

  describe('update', () => {
    it('updates own hotel invoice', async () => {
      const inv = { id: 'i1', hotelId: 'h1', amount: 100, taxes: 0 } as FacturasDTO
      const repo = makeRepo({ findById: async () => inv, update: async (id, data) => ({ id, ...data } as FacturasDTO) })
      const svc = new FacturasService(repo, emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      const result = await svc.update('i1', { amount: 200 }, user)
      expect(result.amount).toBe(200)
    })

    it('rejects update to other hotel invoice', async () => {
      const inv = { id: 'i1', hotelId: 'otro-hotel', amount: 100, taxes: 0 } as FacturasDTO
      const repo = makeRepo({ findById: async () => inv })
      const svc = new FacturasService(repo, emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      await expect(svc.update('i1', { amount: 200 }, user)).rejects.toThrow()
    })
  })

  describe('delete', () => {
    it('lanza NotFound si el item no existe', async () => {
      const service = new FacturasService(makeRepo({ delete: async () => false }), emptyRepo(), enrichDeps, userRepo, log, silentCache, mockAuth, emptyRepo())
      await expect(service.delete('no-existe', user)).rejects.toThrow('Factura no encontrada')
    })
  })
})
