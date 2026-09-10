// tickets/tests/service.test.ts — Tests del servicio con ownership, paginación y seguridad.
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Postgres.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { TicketsService } from '../service'
import type { TicketsDTO } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const mockAuth = { assertOwnership: () => {} } as unknown as Auth
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const adminUser = { id: 'admin1', role: 'super_admin', hotelId: undefined }
const hotelAdmin = { id: 'user1', role: 'hotel_admin', hotelId: 'h1' }

function makeRepo(overrides: Partial<RepositoryAdapter<TicketsDTO>> = {}): RepositoryAdapter<TicketsDTO> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => ({ id: 'ticket-1', ...data } as TicketsDTO),
    update: async (id, data) => ({ id, ...data } as TicketsDTO),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

function makeUserRepo() {
  return {
    findById: async () => ({ id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }),
    findMany: async () => [],
  } as unknown as RepositoryAdapter<any>
}

function makeHotelRepo() {
  return { findMany: async () => [] } as unknown as RepositoryAdapter<any>
}

const mockUser = { id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }

describe('TicketsService', () => {
  describe('list', () => {
    it('returns paginated tickets', async () => {
      const tickets = [{ id: 't1', hotelId: 'h1', subject: 'Issue' }] as TicketsDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: tickets, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.list({}, adminUser)
      expect(result.data).toHaveLength(1)
    })

    it('returns empty list when no tickets exist', async () => {
      const svc = new TicketsService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.list({}, adminUser)
      expect(result.data).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('filters by hotelId for hotel_admin', async () => {
      const tickets = [{ id: 't1', hotelId: 'h1', subject: 'Issue' }] as TicketsDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: tickets, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(1)
    })

    it('throws when no hotelId assigned', async () => {
      const noHotel = { id: 'u1', role: 'hotel_admin', hotelId: undefined }
      const userRepoNoHotel = { findById: async () => ({ id: 'u1', hotelId: undefined, role: 'hotel_admin' }) } as unknown as RepositoryAdapter<any>
      const svc = new TicketsService(makeRepo(), log, silentCache, userRepoNoHotel, fakeAuth, makeHotelRepo())
      await expect(svc.list({}, noHotel)).rejects.toThrow('No hotel assigned')
    })

    it('security: hotel_admin only sees own hotel', async () => {
      const tickets = [{ id: 't1', hotelId: 'h1', subject: 'Own hotel issue' }] as TicketsDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: tickets, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].hotelId).toBe('h1')
    })
  })

  describe('getById', () => {
    it('returns ticket for super_admin', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.getById('t1', adminUser)
      expect(result.subject).toBe('Issue')
    })

    it('hotel_admin can access own hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.getById('t1', hotelAdmin)
      expect(result.id).toBe('t1')
    })

    it('rejects other hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h2', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.getById('t1', hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws when ticket not found', async () => {
      const svc = new TicketsService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.getById('nonexistent', adminUser)).rejects.toThrow('Ticket no encontrado')
    })
  })

  describe('create', () => {
    it('creates ticket in own hotel', async () => {
      const svc = new TicketsService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.create({ hotelId: 'h1', userId: 'u1', subject: 'Issue' }, hotelAdmin)
      expect(result.id).toBe('ticket-1')
    })

    it('super_admin can create ticket in any hotel', async () => {
      const svc = new TicketsService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.create({ hotelId: 'h99', userId: 'u1', subject: 'Admin issue' }, adminUser)
      expect(result.id).toBe('ticket-1')
    })

    it('rejects ticket in other hotel', async () => {
      const svc = new TicketsService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.create({ hotelId: 'h2', userId: 'u1', subject: 'Issue' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  describe('update', () => {
    it('updates own hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket, update: async (id, data) => ({ id, ...data } as TicketsDTO) })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.update('t1', { status: 'resolved' }, hotelAdmin)
      expect(result.status).toBe('resolved')
    })

    it('super_admin can update any hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h2', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket, update: async (id, data) => ({ id, ...data } as TicketsDTO) })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const result = await svc.update('t1', { status: 'resolved' }, adminUser)
      expect(result.status).toBe('resolved')
    })

    it('rejects update to other hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h2', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.update('t1', { status: 'resolved' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws when ticket not found on update', async () => {
      const svc = new TicketsService(makeRepo({ findById: async () => null }), log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.update('nonexistent', { status: 'resolved' }, adminUser)).rejects.toThrow('Ticket no encontrado')
    })

    // REQ-SOP-03: assignedTo solo escribible por userType 'admin' (plataforma).
    it('merchant con assignedTo en PUT → 400', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const merchant = { id: 'm1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' }
      await expect(svc.update('t1', { assignedTo: 'agent-1' }, merchant)).rejects.toMatchObject({ httpStatus: 400 })
    })

    it('admin (plataforma) con assignedTo en PUT → 200 y persiste', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({
        findById: async () => ticket,
        update: async (id, data) => ({ id, hotelId: 'h1', subject: 'Issue', ...data } as TicketsDTO),
      })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const admin = { id: 'admin1', role: 'super_admin', hotelId: undefined, userType: 'admin' }
      const result = await svc.update('t1', { assignedTo: 'agent-1' }, admin)
      expect(result.assignedTo).toBe('agent-1')
    })

    // REQ-SOP-04: PUT { status: 'in_progress' } desde admin auto-asigna si assignedTo está vacío.
    it('admin pasa a in_progress sin agente → se auto-asigna', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue', status: 'open' } as TicketsDTO
      const repo = makeRepo({
        findById: async () => ticket,
        update: async (id, data) => ({ id, hotelId: 'h1', subject: 'Issue', ...data } as TicketsDTO),
      })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const admin = { id: 'admin1', role: 'super_admin', hotelId: undefined, userType: 'admin' }
      const result = await svc.update('t1', { status: 'in_progress' }, admin)
      expect(result.assignedTo).toBe('admin1')
    })

    it('admin pasa a in_progress con agente ya asignado → no cambia', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue', status: 'open', assignedTo: 'agent-existing' } as TicketsDTO
      const repo = makeRepo({
        findById: async () => ticket,
        update: async (id, data) => ({ id, hotelId: 'h1', subject: 'Issue', assignedTo: 'agent-existing', ...data } as TicketsDTO),
      })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      const admin = { id: 'admin1', role: 'super_admin', hotelId: undefined, userType: 'admin' }
      const result = await svc.update('t1', { status: 'in_progress' }, admin)
      expect(result.assignedTo).toBe('agent-existing')
    })

    // REQ-SOP-01/03: el hotel no puede resolver por su cuenta el nombre de un agente que no
    // pertenece a su hotel (no aparece en su propio /api/usuarios) — lo resuelve el servidor.
    it('hotel_admin ve assignee.name de un agente que no pertenece a su hotel', async () => {
      const ticket = { id: 't1', hotelId: 'h1', userId: 'user1', subject: 'Issue', assignedTo: 'agent-99' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const userRepo = {
        findById: async () => ({ id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }),
        findMany: async () => [{ id: 'agent-99', name: 'Agente Plataforma', email: 'a@solmios.com', role: 'admin', hotelId: 'platform', active: 1 }],
      } as unknown as RepositoryAdapter<any>
      const svc = new TicketsService(repo, log, silentCache, userRepo, fakeAuth, makeHotelRepo())
      const result = await svc.getById('t1', hotelAdmin)
      expect(result.assignee?.name).toBe('Agente Plataforma')
    })
  })

  describe('delete', () => {
    it('super_admin can delete', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.delete('t1', adminUser)).resolves.toBeUndefined()
    })

    it('hotel_admin can delete own hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h1', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.delete('t1', hotelAdmin)).resolves.toBeUndefined()
    })

    it('rejects delete of other hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h2', subject: 'Issue' } as TicketsDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new TicketsService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.delete('t1', hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws when ticket not found on delete', async () => {
      const svc = new TicketsService(makeRepo({ findById: async () => null }), log, silentCache, makeUserRepo(), fakeAuth, makeHotelRepo())
      await expect(svc.delete('nonexistent', adminUser)).rejects.toThrow('Ticket no encontrado')
    })
  })
})
