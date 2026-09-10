// anuncios/tests/service.test.ts — Tests del servicio con ownership, paginacion y seguridad
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Postgres.
// list, getById, create, update, delete, setSockets, cache, sockets, auth y lecturas por
// usuario (ANN-4): seen/dismiss idempotentes, listado del banner por usuario y reads reales.

import { describe, it, expect, setSystemTime, afterEach } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AnunciosService } from '../service'
import type { AnnouncementReadDTO, AnnouncementWithReads } from '../service'
import type { AnunciosDTO, AnnouncementType, AnunciosPaginated } from '../types'

const log = silentLogger()
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const adminUser = { id: 'admin1', role: 'super_admin', hotelId: undefined }
const hotelAdmin = { id: 'user1', role: 'hotel_admin', hotelId: 'h1' }
// Dos usuarios del MISMO hotel: el caso que rompía el ✕ por hotel (ANN-4).
const userA = { id: 'user-a', role: 'hotel_admin', hotelId: 'h1' }
const userB = { id: 'user-b', role: 'hotel_admin', hotelId: 'h1' }

afterEach(() => setSystemTime())

function makeCache(overrides: Partial<CacheAdapter> = {}): CacheAdapter {
  return { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {}, ...overrides }
}

function makeRepo(overrides: Partial<RepositoryAdapter<AnunciosDTO>> = {}): RepositoryAdapter<AnunciosDTO> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => ({
      ...data,
      id: 'ann-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as AnunciosDTO),
    update: async (id, data) => ({ id, ...data } as AnunciosDTO),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

function makeAnuncio(overrides: Partial<AnunciosDTO> = {}): AnunciosDTO {
  return {
    id: 'a1',
    hotelId: 'h1',
    title: 'Fire alarm test',
    message: 'Scheduled maintenance',
    type: 'maintenance' as AnnouncementType,
    priority: 'high',
    active: 1,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
    ...overrides,
  }
}

/**
 * announcement_reads en memoria: mismo contrato que OrmRepository y, como la tabla real,
 * el create respeta el UNIQUE (announcementId, userId) de migrate-db.ts (ver reads.e2e.test.ts).
 */
function makeReadsRepo(
  rows: AnnouncementReadDTO[] = [],
  overrides: Partial<RepositoryAdapter<AnnouncementReadDTO>> = {},
): RepositoryAdapter<AnnouncementReadDTO> & { rows: AnnouncementReadDTO[] } {
  const matches = (r: AnnouncementReadDTO, filters: Record<string, unknown> = {}) =>
    Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
  return {
    rows,
    findMany: async (filters) => rows.filter((r) => matches(r, filters as Record<string, unknown>)),
    findById: async (id) => rows.find((r) => r.id === id) ?? null,
    findOne: async (filters) => rows.find((r) => matches(r, filters as Record<string, unknown>)) ?? null,
    create: async (data) => {
      const d = data as unknown as AnnouncementReadDTO
      if (rows.some((r) => r.announcementId === d.announcementId && r.userId === d.userId)) {
        throw new Error('UNIQUE constraint failed: announcement_reads.announcementId, announcement_reads.userId')
      }
      const row = { ...d, id: `read-${rows.length + 1}` } as AnnouncementReadDTO
      rows.push(row)
      return row
    },
    update: async (id, data) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, data)
      return row
    },
    delete: async (id) => {
      const i = rows.findIndex((r) => r.id === id)
      if (i < 0) return false
      rows.splice(i, 1)
      return true
    },
    count: async (filters) => rows.filter((r) => matches(r, filters as Record<string, unknown>)).length,
    paginate: async () => ({ data: [...rows], total: rows.length, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  } as RepositoryAdapter<AnnouncementReadDTO> & { rows: AnnouncementReadDTO[] }
}

/** Cache real en memoria, para probar que la vista por usuario no se filtra vía cache compartido. */
function makeRealCache(): CacheAdapter {
  const store = new Map<string, unknown>()
  return {
    get: (async (key: string) => store.get(key) ?? null) as CacheAdapter['get'],
    set: async (key: string, value: unknown) => { store.set(key, value) },
    delete: async (key: string) => { store.delete(key) },
    flush: async () => { store.clear() },
  }
}

// ==================== list ====================

function makeUserRepo() {
  return { findById: async () => ({ id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }) } as unknown as RepositoryAdapter<any>
}

const mockUser = { id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }

describe('AnunciosService', () => {
  describe('list', () => {
    it('returns paginated results for super_admin', async () => {
      const items = [makeAnuncio({ id: 'a1' }), makeAnuncio({ id: 'a2' })]
      const repo = makeRepo({
        paginate: async () => ({ data: items, total: 2, limit: 20, offset: 0, pages: 1 }),
      })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      const result = await svc.list({}, adminUser)
      expect(result.data).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
    })

    it('enforces hotel scope for hotel_admin', async () => {
      let capturedFilters: any = {}
      const items = [makeAnuncio()]
      const repo = makeRepo({
        paginate: async (filters) => { capturedFilters = filters; return { data: items, total: 1, limit: 20, offset: 0, pages: 1 } },
      })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await svc.list({}, hotelAdmin)
      expect(capturedFilters.hotelId).toBe('h1')
    })

    it('throws AuthError when hotel_admin has no hotelId', async () => {
      const noHotel = { id: 'u1', role: 'hotel_admin', hotelId: undefined }
      const noHotelRepo = { findById: async () => ({ id: 'u1', hotelId: null, role: 'hotel_admin' }) } as unknown as RepositoryAdapter<any>
      const svc = new AnunciosService(makeRepo(), log, makeCache(), noHotelRepo, makeReadsRepo(), fakeAuth)
      await expect(svc.list({}, noHotel)).rejects.toThrow('No hotel assigned')
    })

    it('applies pagination bounds correctly', async () => {
      let capturedOpts: any = {}
      const repo = makeRepo({
        paginate: async (filters, opts) => { capturedOpts = opts; return { data: [], total: 50, limit: 10, offset: 20, pages: 5 } },
      })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      const result = await svc.list({ page: 3, limit: 10 }, adminUser)
      expect(capturedOpts.offset).toBe(20)
      expect(capturedOpts.limit).toBe(10)
      expect(result.pages).toBe(5)
    })

    it('clamps limit between 1 and 100', async () => {
      let capturedOpts: any = {}
      const repo = makeRepo({
        paginate: async (filters, opts) => { capturedOpts = opts; return { data: [], total: 0, limit: opts?.limit ?? 0, offset: 0, pages: 0 } },
      })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await svc.list({ limit: 999 }, adminUser)
      expect(capturedOpts.limit).toBe(100)
    })

    it('la segunda consulta idéntica NO vuelve a pegarle a la base', async () => {
      // Se cuenta el acceso al REPO, no las llamadas a cache.get: desde #160 la clave del listado
      // incluye un token de versión, así que una lectura de página son varias lecturas de caché.
      // Lo que importa es que la base se consulte una sola vez.
      let paginates = 0
      const repo = makeRepo({
        paginate: (async () => {
          paginates++
          return { data: [makeAnuncio()], total: 1, limit: 20, offset: 0, pages: 1 }
        }) as RepositoryAdapter<AnunciosDTO>['paginate'],
      })
      const svc = new AnunciosService(repo, log, makeRealCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)

      await svc.list({}, hotelAdmin)
      await svc.list({}, hotelAdmin)

      expect(paginates).toBe(1)
    })

    it('super_admin can filter by hotelId', async () => {
      let capturedFilters: any = {}
      const repo = makeRepo({
        paginate: async (filters) => { capturedFilters = filters; return { data: [], total: 0, limit: 20, offset: 0, pages: 0 } },
      })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await svc.list({ hotelId: 'h5' }, adminUser)
      expect(capturedFilters.hotelId).toBe('h5')
    })
  })

  // ==================== getById ====================

  describe('getById', () => {
    it('returns announcement for super_admin', async () => {
      const ann = makeAnuncio({ id: 'a1', title: 'Notice' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      const result = await svc.getById('a1', adminUser)
      expect(result.title).toBe('Notice')
    })

    it('returns announcement for own hotel admin', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      const result = await svc.getById('a1', hotelAdmin)
      expect(result.id).toBe('a1')
    })

    it('rejects hotel_admin accessing other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.getById('a1', hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError for missing announcement', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.getById('nonexistent', adminUser)).rejects.toThrow('Anuncio no encontrado')
    })
  })

  // ==================== create ====================

  describe('create', () => {
    it('creates announcement in own hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      const result = await svc.create({ title: 'New notice', hotelId: 'h1' }, hotelAdmin)
      expect(result.id).toBe('ann-1')
      expect(result.title).toBe('New notice')
    })

    it('rejects hotel_admin creating in other hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.create({ title: 'X', hotelId: 'h2' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('super_admin can create in any hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      const result = await svc.create({ title: 'Admin notice', hotelId: 'h99' }, adminUser)
      expect(result.title).toBe('Admin notice')
    })

    it('fires onAnunciosCreated socket', async () => {
      let firedWith: AnunciosDTO | null = null
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      svc.setSockets({ onAnunciosCreated: async (item) => { firedWith = item } })
      const result = await svc.create({ title: 'Socket test', hotelId: 'h1' }, hotelAdmin)
      expect(firedWith).not.toBeNull()
      expect(firedWith!.id).toBe(result.id)
    })

    it('invalida el listado del hotel al crear (#160)', async () => {
      // Antes se borraba `anuncios:list:h1`, una clave que NUNCA existió (la real lleva página,
      // límite y filtros) y el listado quedaba viejo hasta 5 minutos. Ahora sube el token de
      // versión del hotel, que es lo que hace caer TODAS sus entradas.
      const cache = makeRealCache()
      const svc = new AnunciosService(makeRepo(), log, cache, makeUserRepo(), makeReadsRepo(), fakeAuth)
      await svc.list({}, hotelAdmin) // siembra el token
      const antes = await cache.get('anuncios:ver:h1')

      await svc.create({ title: 'Cache bust', hotelId: 'h1' }, hotelAdmin)

      expect(await cache.get('anuncios:ver:h1')).not.toBe(antes)
    })
  })

  // ==================== update ====================

  describe('update', () => {
    it('updates own hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1', title: 'Old' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      const result = await svc.update('a1', { title: 'Updated' }, hotelAdmin)
      expect(result.title).toBe('Updated')
    })

    it('rejects hotel_admin updating other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.update('a1', { title: 'X' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError when item does not exist', async () => {
      const repo = makeRepo({ update: async () => null as any })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.update('ghost', { title: 'X' }, adminUser)).rejects.toThrow('Anuncio no encontrado')
    })

    it('invalida el listado del hotel al editar (#160)', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const cache = makeRealCache()
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, cache, makeUserRepo(), makeReadsRepo(), fakeAuth)
      await svc.list({}, hotelAdmin)
      const antes = await cache.get('anuncios:ver:h1')

      await svc.update('a1', { title: 'Cached' }, hotelAdmin)

      expect(await cache.get('anuncios:ver:h1')).not.toBe(antes)
    })
  })

  // ==================== delete ====================

  describe('delete', () => {
    it('super_admin can delete any announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.delete('a1', adminUser)).resolves.toBeUndefined()
    })

    it('hotel_admin can delete own hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.delete('a1', hotelAdmin)).resolves.toBeUndefined()
    })

    it('rejects hotel_admin deleting other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.delete('a1', hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError when deleting non-existent item', async () => {
      const svc = new AnunciosService(makeRepo({ delete: async () => false }), log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      await expect(svc.delete('ghost', adminUser)).rejects.toThrow('Anuncio no encontrado')
    })

    it('fires onAnunciosDeleted socket with the id', async () => {
      let firedId = ''
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      svc.setSockets({ onAnunciosDeleted: async (id) => { firedId = id } })
      await svc.delete('a1', adminUser)
      expect(firedId).toBe('a1')
    })

    it('invalida el listado del hotel al borrar (#160)', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const cache = makeRealCache()
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, cache, makeUserRepo(), makeReadsRepo(), fakeAuth)
      await svc.list({}, hotelAdmin)
      const antes = await cache.get('anuncios:ver:h1')

      await svc.delete('a1', hotelAdmin)

      expect(await cache.get('anuncios:ver:h1')).not.toBe(antes)
    })
  })

  // ==================== setSockets ====================

  describe('setSockets', () => {
    it('accumulates multiple handlers for same event', async () => {
      const calls: string[] = []
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      svc.setSockets({ onAnunciosCreated: async () => { calls.push('first') } })
      svc.setSockets({ onAnunciosCreated: async () => { calls.push('second') } })
      await svc.create({ title: 'Accumulate', hotelId: 'h1' }, hotelAdmin)
      expect(calls).toEqual(['first', 'second'])
    })

    it('skips null handlers without error', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), makeReadsRepo(), fakeAuth)
      svc.setSockets({ onAnunciosCreated: null as any, onAnunciosUpdated: undefined as any })
      await expect(svc.create({ title: 'No socket', hotelId: 'h1' }, hotelAdmin)).resolves.toBeDefined()
    })
  })

  // ==================== lecturas por usuario (ANN-4) ====================

  describe('markSeen', () => {
    it('3 veces el mismo (announcementId, userId) deja 1 fila con el seenAt de la PRIMERA', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)

      // Reloj controlado: sin esto, las 3 llamadas caen en el mismo ms y "conserva el
      // primero" no se puede distinguir de "lo pisó con uno igual".
      setSystemTime(new Date('2026-09-10T10:00:00.000Z'))
      await svc.markSeen('a1', hotelAdmin)
      const firstSeenAt = reads.rows[0].seenAt
      expect(firstSeenAt).toBe('2026-09-10T10:00:00.000Z')

      setSystemTime(new Date('2026-09-10T11:00:00.000Z'))
      await svc.markSeen('a1', hotelAdmin)
      setSystemTime(new Date('2026-09-10T12:00:00.000Z'))
      await svc.markSeen('a1', hotelAdmin)

      expect(reads.rows).toHaveLength(1)
      // Por VALOR: el seenAt de la fila sigue siendo el de la primera llamada.
      expect(reads.rows[0].seenAt).toBe(firstSeenAt)
      expect(reads.rows[0].seenAt).toBe('2026-09-10T10:00:00.000Z')
    })

    it('registra una fila POR USUARIO: dos usuarios del hotel, dos lecturas', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)

      await svc.markSeen('a1', userA)
      await svc.markSeen('a1', userB)

      expect(reads.rows).toHaveLength(2)
      expect(reads.rows.map((r) => r.userId).sort()).toEqual(['user-a', 'user-b'])
    })

    it('anuncio inexistente: NotFoundError y NINGUNA fila huérfana', async () => {
      const reads = makeReadsRepo()
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), reads, fakeAuth)
      await expect(svc.markSeen('ghost', hotelAdmin)).rejects.toThrow('Anuncio no encontrado')
      expect(reads.rows).toHaveLength(0)
    })

    it('anuncio de otro hotel: AuthError y NINGUNA fila huérfana', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)
      await expect(svc.markSeen('a1', hotelAdmin)).rejects.toThrow('No autorizado')
      expect(reads.rows).toHaveLength(0)
    })

    it('pierde la carrera de insert y devuelve la existente en vez de reventar', async () => {
      // El SELECT no vio la fila que otro request del mismo par ya insertó: el create
      // choca contra el UNIQUE (announcementId, userId). Es la carrera de reads.e2e.test.ts.
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const reads = makeReadsRepo([
        { id: 'r1', hotelId: 'h1', userId: 'user1', announcementId: 'a1', seenAt: '2026-09-10T09:00:00.000Z' },
      ])
      let staleRead = true
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), makeReadsRepo(reads.rows, {
        findMany: async (filters) => {
          const f = filters as Record<string, unknown>
          if (staleRead) { staleRead = false; return [] } // el findMany "de antes" del insert
          return reads.rows.filter((r) =>
            Object.entries(f).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
        },
      }), fakeAuth)

      await expect(svc.markSeen('a1', hotelAdmin)).resolves.toBeUndefined()
      expect(reads.rows).toHaveLength(1)
      expect(reads.rows[0].seenAt).toBe('2026-09-10T09:00:00.000Z')
    })
  })

  describe('dismiss', () => {
    it('setea dismissedAt SIN tocar el seenAt de la misma fila', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)

      setSystemTime(new Date('2026-09-10T10:00:00.000Z'))
      await svc.markSeen('a1', hotelAdmin)
      setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
      await svc.dismiss('a1', hotelAdmin)

      expect(reads.rows).toHaveLength(1)
      expect(reads.rows[0].seenAt).toBe('2026-09-10T10:00:00.000Z')
      expect(reads.rows[0].dismissedAt).toBe('2026-09-11T10:00:00.000Z')
    })

    it('sin seen previo crea la fila con seenAt null', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)

      await svc.dismiss('a1', hotelAdmin)

      expect(reads.rows).toHaveLength(1)
      expect(reads.rows[0].seenAt ?? null).toBeNull()
      expect(reads.rows[0].dismissedAt).toBeTruthy()
    })

    it('repetido no revienta ni duplica: conserva el dismissedAt de la primera', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)

      setSystemTime(new Date('2026-09-10T10:00:00.000Z'))
      await svc.dismiss('a1', hotelAdmin)
      setSystemTime(new Date('2026-09-10T20:00:00.000Z'))
      await svc.dismiss('a1', hotelAdmin)
      await expect(svc.dismiss('a1', hotelAdmin)).resolves.toBeUndefined()

      expect(reads.rows).toHaveLength(1)
      expect(reads.rows[0].dismissedAt).toBe('2026-09-10T10:00:00.000Z')
    })

    it('anuncio de otro hotel: AuthError y NINGUNA fila huérfana', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)
      await expect(svc.dismiss('a1', hotelAdmin)).rejects.toThrow('No autorizado')
      expect(reads.rows).toHaveLength(0)
    })
  })

  // ==================== list: vista por usuario ====================

  describe('list — el ✕ es por usuario, no por hotel', () => {
    function makeHotelRepo(items: AnunciosDTO[]) {
      return makeRepo({
        findById: async () => items[0],
        paginate: async () => ({ data: items, total: items.length, limit: 20, offset: 0, pages: 1 }),
      })
    }

    it('A descarta y deja de verlo; B del MISMO hotel lo sigue recibiendo', async () => {
      const items = [makeAnuncio({ id: 'a1', hotelId: 'h1' }), makeAnuncio({ id: 'a2', hotelId: 'h1' })]
      const repo = makeHotelRepo(items)
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)

      await svc.dismiss('a1', userA)

      const forA = await svc.list({}, userA)
      const forB = await svc.list({}, userB)
      expect(forA.data.map((a) => a.id)).toEqual(['a2'])
      expect(forB.data.map((a) => a.id)).toEqual(['a1', 'a2'])
    })

    it('el visto (seenAt) NO oculta el aviso: sólo el ✕ lo saca del banner', async () => {
      const items = [makeAnuncio({ id: 'a1', hotelId: 'h1' })]
      const repo = makeHotelRepo(items)
      const reads = makeReadsRepo()
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)

      await svc.markSeen('a1', userA)
      const forA = await svc.list({}, userA)
      expect(forA.data.map((a) => a.id)).toEqual(['a1'])
    })

    it('la página cacheada del hotel NO arrastra el filtro de un usuario a otro', async () => {
      const items = [makeAnuncio({ id: 'a1', hotelId: 'h1' }), makeAnuncio({ id: 'a2', hotelId: 'h1' })]
      const repo = makeHotelRepo(items)
      const reads = makeReadsRepo()
      const cache = makeRealCache()
      const svc = new AnunciosService(repo, log, cache, makeUserRepo(), reads, fakeAuth)

      await svc.dismiss('a1', userA)
      await svc.list({}, userA) // puebla el cache compartido del hotel
      const forB = await svc.list({}, userB) // sale del cache… y B ve los dos igual
      expect(forB.data.map((a) => a.id)).toEqual(['a1', 'a2'])
    })

    it('super_admin ve TODOS (los que él mismo cerró incluidos) con reads = COUNT real', async () => {
      const items = [
        makeAnuncio({ id: 'a1', hotelId: 'h1' }),
        makeAnuncio({ id: 'a2', hotelId: 'h1' }),
        makeAnuncio({ id: 'a3', hotelId: 'h2' }),
      ]
      const repo = makeHotelRepo(items)
      const reads = makeReadsRepo([
        { id: 'r1', hotelId: 'h1', userId: 'user-a', announcementId: 'a1', seenAt: '2026-09-10T10:00:00.000Z' },
        { id: 'r2', hotelId: 'h1', userId: 'user-b', announcementId: 'a1', seenAt: '2026-09-10T10:05:00.000Z', dismissedAt: '2026-09-10T10:10:00.000Z' },
        { id: 'r3', hotelId: 'h1', userId: 'user-a', announcementId: 'a2', dismissedAt: '2026-09-10T11:00:00.000Z' },
      ])
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), reads, fakeAuth)

      // El propio admin cerró a1: lo sigue viendo.
      await svc.dismiss('a1', adminUser)
      const result = await svc.list({}, adminUser)

      expect(result.data.map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
      const byId = (id: string) => result.data.find((a) => a.id === id) as AnnouncementWithReads
      expect(byId('a1').reads).toBe(3) // 2 usuarios + el propio admin
      expect(byId('a2').reads).toBe(1)
      expect(byId('a3').reads).toBe(0)
    })
  })
})
