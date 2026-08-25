// hoteles/tests/service.test.ts — Tests del servicio
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Postgres.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { HotelesService } from '../service'
import type { HotelesDTO } from '../types'

// silentLogger es una factory function — SIEMPRE llamarla con ()
const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const adminUser = { id: 'admin1', role: 'super_admin', hotelId: undefined }
const hotelAdminUser = { id: 'user1', role: 'hotel_admin', hotelId: 'h1' }
const receptionistUser = { id: 'user2', role: 'receptionist', hotelId: 'h1' }
const otherHotelAdmin = { id: 'user3', role: 'hotel_admin', hotelId: 'h2' }

function makeRepo(overrides: Partial<RepositoryAdapter<HotelesDTO>> = {}): RepositoryAdapter<HotelesDTO> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => ({ id: 'test-id', ...data } as HotelesDTO),
    update: async (id, data) => ({ id, ...data } as HotelesDTO),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

describe('HotelesService', () => {
  // ─── list ──────────────────────────────────────────────
  describe('list', () => {
    it('returns paginated results for super_admin', async () => {
      const hotels = [{ id: 'h1', name: 'Hotel 1' }, { id: 'h2', name: 'Hotel 2' }] as HotelesDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: hotels, total: 2, limit: 20, offset: 0, pages: 1 }) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({ page: 1, limit: 20 }, adminUser)
      expect(result.data).toHaveLength(2)
      expect(result.total).toBe(2)
    })

    it('filters by hotelId for non-super_admin', async () => {
      const hotels = [{ id: 'h1', name: 'My Hotel' }] as HotelesDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: hotels, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({}, hotelAdminUser)
      expect(result.data).toHaveLength(1)
    })

    it('throws when non-super_admin has no hotelId', async () => {
      const noHotelUser = { id: 'user4', role: 'hotel_admin', hotelId: undefined }
      const svc = new HotelesService(makeRepo(), log, silentCache, fakeAuth)
      await expect(svc.list({}, noHotelUser)).rejects.toThrow('No hotel assigned')
    })

    it('search filters by name', async () => {
      const hotels = [{ id: 'h1', name: 'Beach Resort' }, { id: 'h2', name: 'Mountain Lodge' }] as HotelesDTO[]
      const repo = makeRepo({ findMany: async () => hotels })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({ search: 'beach' }, adminUser)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toBe('Beach Resort')
    })

    it('search filters by email', async () => {
      const hotels = [
        { id: 'h1', name: 'Hotel 1', email: 'info@beach.com' },
        { id: 'h2', name: 'Hotel 2', email: 'contact@mountain.com' },
      ] as HotelesDTO[]
      const repo = makeRepo({ findMany: async () => hotels })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({ search: 'beach.com' }, adminUser)
      expect(result.data).toHaveLength(1)
      expect(result.data[0].email).toBe('info@beach.com')
    })

    it('search is case-insensitive', async () => {
      const hotels = [{ id: 'h1', name: 'Beach Resort' }] as HotelesDTO[]
      const repo = makeRepo({ findMany: async () => hotels })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({ search: 'BEACH' }, adminUser)
      expect(result.data).toHaveLength(1)
    })

    it('filters sensitive fields from response', async () => {
      const hotels = [{ id: 'h1', name: 'Hotel', wifiPassword: 'secret', ownerTaxId: '123' }] as HotelesDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: hotels, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({}, adminUser)
      expect(result.data[0]).not.toHaveProperty('wifiPassword')
      expect(result.data[0]).not.toHaveProperty('ownerTaxId')
    })

    it('filters by status when provided', async () => {
      const hotels = [{ id: 'h1', name: 'Hotel', status: 'active' }] as HotelesDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: hotels, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({ status: 'active' }, adminUser)
      expect(result.data).toHaveLength(1)
    })

    it('returns empty when no match', async () => {
      const hotels = [{ id: 'h1', name: 'Beach Resort' }] as HotelesDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: hotels, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({ search: 'xyz' }, adminUser)
      expect(result.data).toHaveLength(0)
    })

    it('returns empty data when paginate returns empty', async () => {
      const svc = new HotelesService(makeRepo(), log, silentCache, fakeAuth)
      const result = await svc.list({}, adminUser)
      expect(result.data).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('receptionist sees only own hotel', async () => {
      const hotels = [{ id: 'h1', name: 'My Hotel' }] as HotelesDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: hotels, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({}, receptionistUser)
      expect(result.data).toHaveLength(1)
    })
  })

  // ─── getById ───────────────────────────────────────────
  describe('getById', () => {
    it('returns hotel for super_admin', async () => {
      const hotel = { id: 'h1', name: 'Hotel' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.getById('h1', adminUser)
      expect(result.name).toBe('Hotel')
    })

    it('returns own hotel for hotel_admin', async () => {
      const hotel = { id: 'h1', name: 'My Hotel' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.getById('h1', hotelAdminUser)
      expect(result.name).toBe('My Hotel')
    })

    it('returns own hotel for receptionist', async () => {
      const hotel = { id: 'h1', name: 'My Hotel' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.getById('h1', receptionistUser)
      expect(result.name).toBe('My Hotel')
    })

    it('throws for other hotel access', async () => {
      const hotel = { id: 'h2', name: 'Other Hotel' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      await expect(svc.getById('h2', hotelAdminUser)).rejects.toThrow('No autorizado')
    })

    it('throws NotFound for non-existent', async () => {
      const svc = new HotelesService(makeRepo(), log, silentCache, fakeAuth)
      await expect(svc.getById('nope', adminUser)).rejects.toThrow('Hotel no encontrado')
    })

    it('filters sensitive fields from response', async () => {
      const hotel = { id: 'h1', name: 'Hotel', wifiPassword: 'secret', ownerTaxId: '123' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.getById('h1', adminUser)
      expect(result).not.toHaveProperty('wifiPassword')
      expect(result).not.toHaveProperty('ownerTaxId')
    })
  })

  // ─── create ────────────────────────────────────────────
  describe('create', () => {
    it('creates hotel and returns it', async () => {
      const svc = new HotelesService(makeRepo(), log, silentCache, fakeAuth)
      const result = await svc.create({ name: 'New Hotel' })
      expect(result.id).toBe('test-id')
    })

    it('creates hotel with all fields', async () => {
      const svc = new HotelesService(makeRepo(), log, silentCache, fakeAuth)
      const result = await svc.create({ name: 'New Hotel', email: 'info@hotel.com' })
      expect(result.id).toBe('test-id')
    })

    // #34 (COR-6): POST /api/hoteles persistía el estado contradictorio que las dos vías
    // de update ya rechazan (assertCancellationCompatible). El create valida igual.
    it('rechaza create con freeCancellation=true y cancellationType non_refundable', async () => {
      let created = 0
      const repo = makeRepo({ create: async (data) => { created++; return { id: 'x', ...data } as HotelesDTO } })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      await expect(svc.create({ name: 'Bad', freeCancellation: true, cancellationType: 'non_refundable' }))
        .rejects.toThrow('incompatibles')
      expect(created).toBe(0) // sin efectos: nada se persiste
    })

    it('rechaza el create que crea el conflicto vía defaults del modelo (non_refundable sin freeCancellation)', async () => {
      const repo = makeRepo({ create: async (data) => ({ id: 'x', ...data } as HotelesDTO) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      // freeCancellation omitido → default del modelo true → estado efectivo contradictorio.
      await expect(svc.create({ name: 'Bad', cancellationType: 'non_refundable' }))
        .rejects.toThrow('incompatibles')
    })

    it('acepta create non_refundable cuando la cancelación gratuita viene desactivada', async () => {
      const repo = makeRepo({ create: async (data) => ({ id: 'x', ...data } as HotelesDTO) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.create({ name: 'OK', freeCancellation: false, cancellationType: 'non_refundable' })
      expect(result.cancellationType).toBe('non_refundable')
    })
  })

  // ─── update ────────────────────────────────────────────
  describe('update', () => {
    it('updates own hotel', async () => {
      const hotel = { id: 'h1', name: 'Old' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel, update: async (id, data) => ({ id, ...data } as HotelesDTO) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.update('h1', { name: 'New' }, hotelAdminUser)
      expect(result.name).toBe('New')
    })

    it('rejects update to other hotel', async () => {
      const hotel = { id: 'h2', name: 'Other' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      await expect(svc.update('h2', { name: 'X' }, hotelAdminUser)).rejects.toThrow()
    })

    it('super_admin can update any hotel', async () => {
      const hotel = { id: 'h2', name: 'Other' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel, update: async (id, data) => ({ id, ...data } as HotelesDTO) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.update('h2', { name: 'Changed' }, adminUser)
      expect(result.name).toBe('Changed')
    })

    it('throws NotFound for non-existent hotel', async () => {
      const repo = makeRepo({ update: async () => null })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      await expect(svc.update('nope', { name: 'X' }, adminUser)).rejects.toThrow('Hotel no encontrado')
    })

    it('receptionist cannot update other hotel', async () => {
      const hotel = { id: 'h2', name: 'Other' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      await expect(svc.update('h2', { name: 'X' }, receptionistUser)).rejects.toThrow('No autorizado')
    })

    // #34 (SEC-2): la exclusividad "cancelación gratuita × No Reembolsable" no puede vivir
    // sólo en la UI — un cliente directo podía persistir condiciones contradictorias.
    it('rechaza freeCancellation=true junto a cancellationType non_refundable', async () => {
      const hotel = { id: 'h1', name: 'Hotel', freeCancellation: false } as HotelesDTO
      let updated = 0
      const repo = makeRepo({ findById: async () => hotel, update: async (id, data) => { updated++; return { id, ...data } as HotelesDTO } })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      await expect(svc.update('h1', { freeCancellation: true, cancellationType: 'non_refundable' }, hotelAdminUser))
        .rejects.toThrow('incompatibles')
      expect(updated).toBe(0) // sin efectos: nada se persiste
    })

    it('rechaza el PUT parcial que crea el conflicto con lo ya persistido (merge con DB)', async () => {
      const hotel = { id: 'h1', name: 'Hotel', freeCancellation: true, cancellationType: 'flexible' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      await expect(svc.update('h1', { cancellationType: 'non_refundable' }, hotelAdminUser))
        .rejects.toThrow('incompatibles')
    })

    it('acepta non_refundable cuando la cancelación gratuita está desactivada', async () => {
      const hotel = { id: 'h1', name: 'Hotel', freeCancellation: false, cancellationType: 'flexible' } as HotelesDTO
      const repo = makeRepo({ findById: async () => hotel, update: async (id, data) => ({ id, ...data } as HotelesDTO) })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      const result = await svc.update('h1', { cancellationType: 'non_refundable' }, hotelAdminUser)
      expect(result.cancellationType).toBe('non_refundable')
    })
  })

  // ─── delete ────────────────────────────────────────────
  describe('delete', () => {
    it('super_admin can delete', async () => {
      const svc = new HotelesService(makeRepo(), log, silentCache, fakeAuth)
      await expect(svc.delete('h1', adminUser)).resolves.toBeUndefined()
    })

    it('hotel_admin cannot delete', async () => {
      const svc = new HotelesService(makeRepo(), log, silentCache, fakeAuth)
      await expect(svc.delete('h1', hotelAdminUser)).rejects.toThrow('Solo super_admin puede eliminar hoteles')
    })

    it('receptionist cannot delete', async () => {
      const svc = new HotelesService(makeRepo(), log, silentCache, fakeAuth)
      await expect(svc.delete('h1', receptionistUser)).rejects.toThrow('Solo super_admin puede eliminar hoteles')
    })

    it('throws NotFound for non-existent hotel', async () => {
      const repo = makeRepo({ delete: async () => false })
      const svc = new HotelesService(repo, log, silentCache, fakeAuth)
      await expect(svc.delete('nope', adminUser)).rejects.toThrow('Hotel no encontrado')
    })
  })
})
