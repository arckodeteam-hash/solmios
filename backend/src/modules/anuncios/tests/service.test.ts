// anuncios/tests/service.test.ts — Tests del servicio con ownership, paginacion y seguridad
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Postgres.
// 18 tests: list, getById, create, update, delete, setSockets, cache, sockets, auth.

import { describe, it, expect, setSystemTime, afterEach } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AnunciosService } from '../service'
import type { AnunciosDTO, AnnouncementType, AnunciosPaginated } from '../types'
import type { AnnouncementReadDTO, AnnouncementWithReads } from '../service'

const log = silentLogger()
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth
/** Lecturas vacías: los tests de listado no miran marcas por usuario (eso va en su propio describe). */
const readsStub = {
  findMany: async () => [], count: async () => 0, findById: async () => null, findOne: async () => null,
  create: async (d: any) => d, update: async () => null, delete: async () => true,
} as unknown as RepositoryAdapter<any>

const adminUser = { id: 'admin1', role: 'super_admin', hotelId: undefined }
const hotelAdmin = { id: 'user1', role: 'hotel_admin', hotelId: 'h1' }
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

/**
 * Repo falso que filtra por IGUALDAD y nada más, igual que `buildWhere` del ORM real
 * (`kernel/db/orm-utils.ts`). Es deliberado: si el doble entendiera `OR` o `IS NULL` —que el ORM
 * no tiene— el test aprobaría un service que en producción no devuelve nada.
 */
function makeRepoFrom(
  rows: AnunciosDTO[],
  overrides: Partial<RepositoryAdapter<AnunciosDTO>> = {},
): RepositoryAdapter<AnunciosDTO> {
  const matches = (row: any, filters: Record<string, unknown>) =>
    Object.entries(filters).every(([k, v]) => row[k] === v)
  return makeRepo({
    findMany: async (filters = {}) => rows.filter((r) => matches(r, filters)),
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    ...overrides,
  })
}

/** Caché en memoria de verdad: sin esto no se puede probar que la invalidación invalide algo. */
function memoryCache(): CacheAdapter & { keys: () => string[] } {
  const store = new Map<string, unknown>()
  return {
    get: (async (key: string) => (store.has(key) ? store.get(key) : null)) as CacheAdapter['get'],
    set: (async (key: string, value: unknown) => { store.set(key, value) }) as CacheAdapter['set'],
    delete: async (key: string) => { store.delete(key) },
    flush: async () => { store.clear() },
    keys: () => [...store.keys()],
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

// ==================== list ====================

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
      const svc = new AnunciosService(makeRepoFrom(items), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.list({}, adminUser)
      expect(result.data).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
    })

    // ESTE es el bug que motivó el cambio: un anuncio de plataforma se guarda sin hotelId, y el
    // listado filtraba `hotelId = <hotel>` por igualdad. NULL no matchea, así que el mensaje del
    // dueño de la plataforma no le llegaba a NINGÚN hotel.
    it('entrega el anuncio de plataforma a todos los hoteles y respeta el aislamiento', async () => {
      const rows = [
        makeAnuncio({ id: 'global', hotelId: undefined, audience: 'all', title: 'Mantenimiento del sábado' }),
        makeAnuncio({ id: 'de-h1', hotelId: 'h1', audience: 'hotel' }),
        makeAnuncio({ id: 'de-h2', hotelId: 'h2', audience: 'hotel' }),
      ]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)

      const h1 = await svc.list({}, hotelAdmin)
      expect(h1.data.map((a) => a.id).sort()).toEqual(['de-h1', 'global'])

      const h2 = await svc.list({}, { id: 'u2', role: 'hotel_admin', hotelId: 'h2' })
      expect(h2.data.map((a) => a.id).sort()).toEqual(['de-h2', 'global'])
    })

    it('trata hotelId vacío igual que ausente: también es de plataforma', async () => {
      const rows = [makeAnuncio({ id: 'vacio', hotelId: '', audience: 'all' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      expect(result.data.map((a) => a.id)).toEqual(['vacio'])
    })

    it('un anuncio para administradores no le llega a recepción', async () => {
      const rows = [makeAnuncio({ id: 'solo-admins', hotelId: undefined, audience: 'admins' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)

      const recepcion = await svc.list({}, { id: 'u3', role: 'receptionist', hotelId: 'h1' })
      expect(recepcion.data).toHaveLength(0)

      const admin = await svc.list({}, hotelAdmin)
      expect(admin.data.map((a) => a.id)).toEqual(['solo-admins'])
    })

    it('no entrega un anuncio programado para mañana: su texto no viaja al navegador', async () => {
      const manana = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      const rows = [makeAnuncio({ id: 'futuro', hotelId: 'h1', startsAt: manana, title: 'Corte de luz' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      // Sobre el payload SERIALIZADO: lo que importa es que el título no salga del servidor.
      expect(JSON.stringify(result)).not.toContain('Corte de luz')
      expect(result.total).toBe(0)
    })

    it('no entrega un anuncio vencido aunque siga activo', async () => {
      const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const rows = [makeAnuncio({ id: 'vencido', hotelId: 'h1', endsAt: ayer, active: 1 })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(0)
    })

    it('un anuncio sin ventana se sigue entregando: los ya creados no cambian', async () => {
      const rows = [makeAnuncio({ id: 'sin-ventana', hotelId: 'h1' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      expect(result.data.map((a) => a.id)).toEqual(['sin-ventana'])
    })

    it('scope=all deja ver lo programado, y solo al super_admin', async () => {
      const manana = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      const rows = [makeAnuncio({ id: 'futuro', hotelId: 'h1', startsAt: manana })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)

      expect((await svc.list({ scope: 'all' }, adminUser)).total).toBe(1)
      // Un hotel que pide scope=all no puede adelantarse a la fecha de publicación.
      expect((await svc.list({ scope: 'all' }, hotelAdmin)).total).toBe(0)
    })

    it('throws AuthError when hotel_admin has no hotelId', async () => {
      const noHotel = { id: 'u1', role: 'hotel_admin', hotelId: undefined }
      const noHotelRepo = { findById: async () => ({ id: 'u1', hotelId: null, role: 'hotel_admin' }) } as unknown as RepositoryAdapter<any>
      const svc = new AnunciosService(makeRepo(), log, makeCache(), noHotelRepo, readsStub, fakeAuth)
      await expect(svc.list({}, noHotel)).rejects.toThrow('No hotel assigned')
    })

    it('applies pagination bounds correctly', async () => {
      const rows = Array.from({ length: 50 }, (_, i) => makeAnuncio({ id: `a${i}`, hotelId: 'h1' }))
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.list({ page: 3, limit: 10 }, hotelAdmin)
      expect(result.data).toHaveLength(10)
      expect(result.total).toBe(50)
      expect(result.pages).toBe(5)
    })

    it('clamps limit between 1 and 100', async () => {
      const rows = Array.from({ length: 120 }, (_, i) => makeAnuncio({ id: `a${i}`, hotelId: 'h1' }))
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.list({ limit: 999 }, hotelAdmin)
      expect(result.limit).toBe(100)
      expect(result.data).toHaveLength(100)
    })

    it('reads from cache on second call', async () => {
      let findManyCalls = 0
      const rows = [makeAnuncio({ id: 'a1', hotelId: 'h1' })]
      const repo = makeRepoFrom(rows, {
        findMany: async (filters: any = {}) => {
          findManyCalls++
          return rows.filter((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v))
        },
      })
      const svc = new AnunciosService(repo, log, memoryCache(), makeUserRepo(), readsStub, fakeAuth)
      await svc.list({}, hotelAdmin)
      const callsTrasPrimera = findManyCalls
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(1)
      expect(findManyCalls).toBe(callsTrasPrimera)
    })

    it('dos roles del mismo hotel no comparten entrada de caché', async () => {
      const rows = [makeAnuncio({ id: 'solo-admins', hotelId: undefined, audience: 'admins' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, memoryCache(), makeUserRepo(), readsStub, fakeAuth)
      // Recepción lista primero y deja su vista (vacía) cacheada.
      expect((await svc.list({}, { id: 'u3', role: 'receptionist', hotelId: 'h1' })).total).toBe(0)
      // El dueño no puede heredar ese recorte.
      expect((await svc.list({}, hotelAdmin)).total).toBe(1)
    })

    it('super_admin can filter by hotelId', async () => {
      const rows = [
        makeAnuncio({ id: 'global', hotelId: undefined, audience: 'all' }),
        makeAnuncio({ id: 'de-h5', hotelId: 'h5', audience: 'hotel' }),
        makeAnuncio({ id: 'de-h9', hotelId: 'h9', audience: 'hotel' }),
      ]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.list({ hotelId: 'h5' }, adminUser)
      expect(result.data.map((a) => a.id).sort()).toEqual(['de-h5', 'global'])
    })
  })

  // ==================== getById ====================

  describe('getById', () => {
    it('returns announcement for super_admin', async () => {
      const ann = makeAnuncio({ id: 'a1', title: 'Notice' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.getById('a1', adminUser)
      expect(result.title).toBe('Notice')
    })

    it('returns announcement for own hotel admin', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.getById('a1', hotelAdmin)
      expect(result.id).toBe('a1')
    })

    it('rejects hotel_admin accessing other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.getById('a1', hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError for missing announcement', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.getById('nonexistent', adminUser)).rejects.toThrow('Anuncio no encontrado')
    })
  })

  // ==================== create ====================

  describe('create', () => {
    it('creates announcement in own hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.create({ title: 'New notice', hotelId: 'h1' }, hotelAdmin)
      expect(result.id).toBe('ann-1')
      expect(result.title).toBe('New notice')
    })

    it('rejects hotel_admin creating in other hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.create({ title: 'X', hotelId: 'h2' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('super_admin can create in any hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.create({ title: 'Admin notice', hotelId: 'h99' }, adminUser)
      expect(result.title).toBe('Admin notice')
    })

    it('fires onAnunciosCreated socket', async () => {
      let firedWith: AnunciosDTO | null = null
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      svc.setSockets({ onAnunciosCreated: async (item) => { firedWith = item } })
      const result = await svc.create({ title: 'Socket test', hotelId: 'h1' }, hotelAdmin)
      expect(firedWith).not.toBeNull()
      expect(firedWith!.id).toBe(result.id)
    })

    // Antes esto verificaba que se borrara la clave `anuncios:list:h1`, que NO es la clave con la
    // que se cachea el listado (`...:p1:l20:{filtros}`). El test pasaba y la caché nunca se
    // invalidaba: el hotel podía tardar 300 s en ver un aviso urgente. Ahora se verifica la
    // propiedad, no la clave: publicar y volver a listar DENTRO del TTL trae lo nuevo.
    it('publicar invalida el listado ya cacheado', async () => {
      const rows: AnunciosDTO[] = [makeAnuncio({ id: 'viejo', hotelId: 'h1' })]
      const repo = makeRepoFrom(rows, {
        create: async (data: any) => {
          const item = { ...data, id: 'nuevo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as AnunciosDTO
          rows.push(item)
          return item
        },
      })
      const svc = new AnunciosService(repo, log, memoryCache(), makeUserRepo(), readsStub, fakeAuth)

      expect((await svc.list({}, hotelAdmin)).total).toBe(1)
      await svc.create({ title: 'Urgente', hotelId: 'h1' }, hotelAdmin)
      const despues = await svc.list({}, hotelAdmin)
      expect(despues.data.map((a) => a.id).sort()).toEqual(['nuevo', 'viejo'])
    })
  })

  // ==================== update ====================

  describe('update', () => {
    it('updates own hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1', title: 'Old' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const result = await svc.update('a1', { title: 'Updated' }, hotelAdmin)
      expect(result.title).toBe('Updated')
    })

    it('rejects hotel_admin updating other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.update('a1', { title: 'X' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError when item does not exist', async () => {
      const repo = makeRepo({ update: async () => null as any })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.update('ghost', { title: 'X' }, adminUser)).rejects.toThrow('Anuncio no encontrado')
    })

    it('editar invalida el listado ya cacheado', async () => {
      const rows: AnunciosDTO[] = [makeAnuncio({ id: 'a1', hotelId: 'h1', title: 'Viejo' })]
      const repo = makeRepoFrom(rows, {
        update: async (id: string, data: any) => {
          const i = rows.findIndex((r) => r.id === id)
          rows[i] = { ...rows[i], ...data }
          return rows[i]
        },
      })
      const svc = new AnunciosService(repo, log, memoryCache(), makeUserRepo(), readsStub, fakeAuth)

      expect((await svc.list({}, hotelAdmin)).data[0].title).toBe('Viejo')
      await svc.update('a1', { title: 'Corregido' }, hotelAdmin)
      expect((await svc.list({}, hotelAdmin)).data[0].title).toBe('Corregido')
    })
  })

  // ==================== delete ====================

  describe('delete', () => {
    it('super_admin can delete any announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.delete('a1', adminUser)).resolves.toBeUndefined()
    })

    it('hotel_admin can delete own hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.delete('a1', hotelAdmin)).resolves.toBeUndefined()
    })

    it('rejects hotel_admin deleting other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.delete('a1', hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError when deleting non-existent item', async () => {
      const svc = new AnunciosService(makeRepo({ delete: async () => false }), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.delete('ghost', adminUser)).rejects.toThrow('Anuncio no encontrado')
    })

    it('fires onAnunciosDeleted socket with the id', async () => {
      let firedId = ''
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      svc.setSockets({ onAnunciosDeleted: async (id) => { firedId = id } })
      await svc.delete('a1', adminUser)
      expect(firedId).toBe('a1')
    })

    it('borrar invalida el listado ya cacheado', async () => {
      const rows: AnunciosDTO[] = [makeAnuncio({ id: 'a1', hotelId: 'h1' })]
      const repo = makeRepoFrom(rows, {
        delete: async (id: string) => {
          const i = rows.findIndex((r) => r.id === id)
          if (i < 0) return false
          rows.splice(i, 1)
          return true
        },
      })
      const svc = new AnunciosService(repo, log, memoryCache(), makeUserRepo(), readsStub, fakeAuth)

      expect((await svc.list({}, hotelAdmin)).total).toBe(1)
      await svc.delete('a1', hotelAdmin)
      expect((await svc.list({}, hotelAdmin)).total).toBe(0)
    })
  })

  // ==================== audiencia ====================

  describe('audiencia', () => {
    it('un hotel NO puede publicarle a los demás hoteles', async () => {
      const repo = makeRepoFrom([])
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      let creados = 0
      const contador = makeRepoFrom([], { create: async (d: any) => { creados++; return { ...d, id: 'x' } as AnunciosDTO } })
      const svc2 = new AnunciosService(contador, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)

      await expect(svc.create({ title: 'A todos', audience: 'all' }, hotelAdmin))
        .rejects.toThrow('Solo la plataforma puede publicar anuncios para varios hoteles')
      await expect(svc2.create({ title: 'A todos', audience: 'all' }, hotelAdmin)).rejects.toThrow()
      // No alcanza con el rechazo: no puede haber quedado nada escrito.
      expect(creados).toBe(0)
    })

    it('el rechazo por audiencia es 403, no 401', async () => {
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const err = await svc.create({ title: 'A todos', audience: 'admins' }, hotelAdmin).catch((e) => e)
      expect((err as any).httpStatus).toBe(403)
    })

    it('audiencia "hotel" sin hotelId es un error de carga, no un anuncio global silencioso', async () => {
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const err = await svc.create({ title: 'Sin destino', audience: 'hotel' }, adminUser).catch((e) => e)
      expect((err as any).httpStatus).toBe(400)
      expect(String((err as any).message)).toContain('hotelId')
    })

    it('el super_admin publica a todos y la fila NO queda atada a un hotel', async () => {
      let guardado: any = null
      const repo = makeRepoFrom([], { create: async (d: any) => { guardado = d; return { ...d, id: 'g1' } as AnunciosDTO } })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await svc.create({ title: 'Mantenimiento', audience: 'all', hotelId: 'h1' }, adminUser)
      expect(guardado.audience).toBe('all')
      // Un anuncio de plataforma con hotelId sería un anuncio de un hotel disfrazado.
      expect(guardado.hotelId).toBeUndefined()
    })

    it('un hotel que crea sin decir nada publica para SU hotel', async () => {
      let guardado: any = null
      const repo = makeRepoFrom([], { create: async (d: any) => { guardado = d; return { ...d, id: 'x' } as AnunciosDTO } })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await svc.create({ title: 'Interno' }, hotelAdmin)
      expect(guardado.audience).toBe('hotel')
      expect(guardado.hotelId).toBe('h1')
    })
  })

  // ==================== vigencia ====================

  describe('vigencia', () => {
    it('rechaza endsAt anterior a startsAt', async () => {
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      const err = await svc.create({
        title: 'Ventana invertida', hotelId: 'h1',
        startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-01T00:00:00Z',
      }, hotelAdmin).catch((e) => e)
      expect((err as any).httpStatus).toBe(400)
      expect(String((err as any).message)).toContain('endsAt')
    })

    it('acepta una ventana coherente', async () => {
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      await expect(svc.create({
        title: 'Ventana OK', hotelId: 'h1',
        startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-10T00:00:00Z',
      }, hotelAdmin)).resolves.toBeDefined()
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
      // El listado une "lo del hotel" + "lo de plataforma" con findMany (no paginate).
      return makeRepoFrom(items, { findById: async () => items[0] })
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

  describe('setSockets', () => {
    it('accumulates multiple handlers for same event', async () => {
      const calls: string[] = []
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      svc.setSockets({ onAnunciosCreated: async () => { calls.push('first') } })
      svc.setSockets({ onAnunciosCreated: async () => { calls.push('second') } })
      await svc.create({ title: 'Accumulate', hotelId: 'h1' }, hotelAdmin)
      expect(calls).toEqual(['first', 'second'])
    })

    it('skips null handlers without error', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), readsStub, fakeAuth)
      svc.setSockets({ onAnunciosCreated: null as any, onAnunciosUpdated: undefined as any })
      await expect(svc.create({ title: 'No socket', hotelId: 'h1' }, hotelAdmin)).resolves.toBeDefined()
    })
  })
})
