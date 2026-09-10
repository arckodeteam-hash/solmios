import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { ApikeysService } from '../service'
import type { ApikeysDTO } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const adminUser = { id: 'admin1', role: 'super_admin', hotelId: undefined }
const hotelAdmin = { id: 'user1', role: 'hotel_admin', hotelId: 'h1' }

function makeRepo(overrides: Partial<RepositoryAdapter<ApikeysDTO>> = {}): RepositoryAdapter<ApikeysDTO> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => ({ id: 'key-1', ...data } as ApikeysDTO),
    update: async (id, data) => ({ id, ...data } as ApikeysDTO),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

describe('ApikeysService', () => {
  describe('list', () => {
    it('returns paginated api keys', async () => {
      const keys = [{ id: 'k1', hotelId: 'h1', name: 'Test Key' }] as ApikeysDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: keys, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({}, adminUser)
      expect(result.data).toHaveLength(1)
    })

    it('filters by hotelId for hotel_admin', async () => {
      const keys = [{ id: 'k1', hotelId: 'h1', name: 'Test Key' }] as ApikeysDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: keys, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(1)
    })

    it('throws when no hotelId assigned', async () => {
      const noHotel = { id: 'u1', role: 'hotel_admin', hotelId: undefined }
      const svc = new ApikeysService(makeRepo(), log, silentCache, fakeAuth)
      await expect(svc.list({}, noHotel)).rejects.toThrow('No hotel assigned')
    })
  })

  describe('getById', () => {
    it('returns api key for super_admin', async () => {
      const key = { id: 'k1', hotelId: 'h1', name: 'Test Key' } as ApikeysDTO
      const repo = makeRepo({ findById: async () => key })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      const result = await svc.getById('k1', adminUser)
      expect(result.name).toBe('Test Key')
    })

    it('rejects other hotel api key', async () => {
      const key = { id: 'k1', hotelId: 'h2', name: 'Test Key' } as ApikeysDTO
      const repo = makeRepo({ findById: async () => key })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      await expect(svc.getById('k1', hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  describe('create', () => {
    it('creates api key in own hotel', async () => {
      const svc = new ApikeysService(makeRepo(), log, silentCache, fakeAuth)
      const result = await svc.create({ hotelId: 'h1', name: 'Test Key' }, hotelAdmin)
      expect(result.id).toBe('key-1')
    })

    it('rejects api key in other hotel', async () => {
      const svc = new ApikeysService(makeRepo(), log, silentCache, fakeAuth)
      await expect(svc.create({ hotelId: 'h2', name: 'Test Key' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  describe('update', () => {
    it('updates own hotel api key', async () => {
      const key = { id: 'k1', hotelId: 'h1', name: 'Test Key' } as ApikeysDTO
      const repo = makeRepo({ findById: async () => key, update: async (id, data) => ({ id, ...data } as ApikeysDTO) })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      const result = await svc.update('k1', { name: 'Updated' }, hotelAdmin)
      expect(result.name).toBe('Updated')
    })

    it('rejects update to other hotel api key', async () => {
      const key = { id: 'k1', hotelId: 'h2', name: 'Test Key' } as ApikeysDTO
      const repo = makeRepo({ findById: async () => key })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      await expect(svc.update('k1', { name: 'X' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  describe('delete', () => {
    it('super_admin can delete', async () => {
      const key = { id: 'k1', hotelId: 'h1', name: 'Test Key' } as ApikeysDTO
      const repo = makeRepo({ findById: async () => key })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      await expect(svc.delete('k1', adminUser)).resolves.toBeUndefined()
    })

    it('hotel_admin can delete own hotel api key', async () => {
      const key = { id: 'k1', hotelId: 'h1', name: 'Test Key' } as ApikeysDTO
      const repo = makeRepo({ findById: async () => key })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      await expect(svc.delete('k1', hotelAdmin)).resolves.toBeUndefined()
    })

    it('rejects delete of other hotel api key', async () => {
      const key = { id: 'k1', hotelId: 'h2', name: 'Test Key' } as ApikeysDTO
      const repo = makeRepo({ findById: async () => key })
      const svc = new ApikeysService(repo, log, silentCache, fakeAuth)
      await expect(svc.delete('k1', hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })
})

// Regresión: con un caché REAL (no el mudo de arriba), crear una clave y volver a listar tenía
// que devolver la lista vieja hasta vencer el TTL, porque la invalidación borraba una clave que
// no existía (`apikeys:list:{hotelId}` vs `apikeys:list:{filtros}:{page}:{limit}`).
describe('ApikeysService — caché del listado tras mutación', () => {
  function memoryCache(): CacheAdapter {
    const store = new Map<string, unknown>()
    return {
      get: async <T,>(k: string) => (store.has(k) ? (store.get(k) as T) : null),
      set: async (k: string, v: unknown) => { store.set(k, v) },
      delete: async (k: string) => { store.delete(k) },
      flush: async () => { store.clear() },
    }
  }

  it('super_admin: list → create → list muestra la clave nueva sin esperar el TTL', async () => {
    const rows: ApikeysDTO[] = []
    const repo = makeRepo({
      create: async (data) => { const k = { id: `key-${rows.length + 1}`, ...data } as ApikeysDTO; rows.push(k); return k },
      paginate: async () => ({ data: [...rows], total: rows.length, limit: 20, offset: 0, pages: 1 }),
    })
    const svc = new ApikeysService(repo, log, memoryCache(), fakeAuth)
    expect((await svc.list({}, adminUser)).data).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 2))
    await svc.create({ name: 'Nueva', hotelId: 'h1' } as any, adminUser)
    expect((await svc.list({}, adminUser)).data).toHaveLength(1)
  })

  it('hotel_admin: revocar y volver a listar refleja active=0', async () => {
    const rows: ApikeysDTO[] = [{ id: 'k1', hotelId: 'h1', name: 'X', active: 1 } as ApikeysDTO]
    const repo = makeRepo({
      findById: async (id) => rows.find((r) => r.id === id) ?? null,
      update: async (id, data) => { const r = rows.find((x) => x.id === id)!; Object.assign(r, data); return r },
      paginate: async () => ({ data: rows.map((r) => ({ ...r })), total: rows.length, limit: 20, offset: 0, pages: 1 }),
    })
    const svc = new ApikeysService(repo, log, memoryCache(), fakeAuth)
    expect((await svc.list({}, hotelAdmin)).data[0].active).toBe(1)
    await new Promise((r) => setTimeout(r, 2))
    await svc.update('k1', { active: 0 } as any, hotelAdmin)
    expect((await svc.list({}, hotelAdmin)).data[0].active).toBe(0)
  })
})
