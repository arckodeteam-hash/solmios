// anuncios/tests/service.test.ts — Tests del servicio con ownership, paginacion y seguridad
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Postgres.
// 18 tests: list, getById, create, update, delete, setSockets, cache, sockets, auth.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AnunciosService } from '../service'
import type { AnunciosDTO, AnnouncementType, AnunciosPaginated } from '../types'

const log = silentLogger()
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const adminUser = { id: 'admin1', role: 'super_admin', hotelId: undefined }
const hotelAdmin = { id: 'user1', role: 'hotel_admin', hotelId: 'h1' }

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

function makeUserRepo() {
  return { findById: async () => ({ id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }) } as unknown as RepositoryAdapter<any>
}

const mockUser = { id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }

describe('AnunciosService', () => {
  describe('list', () => {
    it('returns paginated results for super_admin', async () => {
      const items = [makeAnuncio({ id: 'a1' }), makeAnuncio({ id: 'a2' })]
      const svc = new AnunciosService(makeRepoFrom(items), log, makeCache(), makeUserRepo(), fakeAuth)
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
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)

      const h1 = await svc.list({}, hotelAdmin)
      expect(h1.data.map((a) => a.id).sort()).toEqual(['de-h1', 'global'])

      const h2 = await svc.list({}, { id: 'u2', role: 'hotel_admin', hotelId: 'h2' })
      expect(h2.data.map((a) => a.id).sort()).toEqual(['de-h2', 'global'])
    })

    it('trata hotelId vacío igual que ausente: también es de plataforma', async () => {
      const rows = [makeAnuncio({ id: 'vacio', hotelId: '', audience: 'all' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      expect(result.data.map((a) => a.id)).toEqual(['vacio'])
    })

    it('un anuncio para administradores no le llega a recepción', async () => {
      const rows = [makeAnuncio({ id: 'solo-admins', hotelId: undefined, audience: 'admins' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)

      const recepcion = await svc.list({}, { id: 'u3', role: 'receptionist', hotelId: 'h1' })
      expect(recepcion.data).toHaveLength(0)

      const admin = await svc.list({}, hotelAdmin)
      expect(admin.data.map((a) => a.id)).toEqual(['solo-admins'])
    })

    it('no entrega un anuncio programado para mañana: su texto no viaja al navegador', async () => {
      const manana = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      const rows = [makeAnuncio({ id: 'futuro', hotelId: 'h1', startsAt: manana, title: 'Corte de luz' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      // Sobre el payload SERIALIZADO: lo que importa es que el título no salga del servidor.
      expect(JSON.stringify(result)).not.toContain('Corte de luz')
      expect(result.total).toBe(0)
    })

    it('no entrega un anuncio vencido aunque siga activo', async () => {
      const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const rows = [makeAnuncio({ id: 'vencido', hotelId: 'h1', endsAt: ayer, active: 1 })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(0)
    })

    it('un anuncio sin ventana se sigue entregando: los ya creados no cambian', async () => {
      const rows = [makeAnuncio({ id: 'sin-ventana', hotelId: 'h1' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.list({}, hotelAdmin)
      expect(result.data.map((a) => a.id)).toEqual(['sin-ventana'])
    })

    it('scope=all deja ver lo programado, y solo al super_admin', async () => {
      const manana = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      const rows = [makeAnuncio({ id: 'futuro', hotelId: 'h1', startsAt: manana })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)

      expect((await svc.list({ scope: 'all' }, adminUser)).total).toBe(1)
      // Un hotel que pide scope=all no puede adelantarse a la fecha de publicación.
      expect((await svc.list({ scope: 'all' }, hotelAdmin)).total).toBe(0)
    })

    it('throws AuthError when hotel_admin has no hotelId', async () => {
      const noHotel = { id: 'u1', role: 'hotel_admin', hotelId: undefined }
      const noHotelRepo = { findById: async () => ({ id: 'u1', hotelId: null, role: 'hotel_admin' }) } as unknown as RepositoryAdapter<any>
      const svc = new AnunciosService(makeRepo(), log, makeCache(), noHotelRepo, fakeAuth)
      await expect(svc.list({}, noHotel)).rejects.toThrow('No hotel assigned')
    })

    it('applies pagination bounds correctly', async () => {
      const rows = Array.from({ length: 50 }, (_, i) => makeAnuncio({ id: `a${i}`, hotelId: 'h1' }))
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.list({ page: 3, limit: 10 }, hotelAdmin)
      expect(result.data).toHaveLength(10)
      expect(result.total).toBe(50)
      expect(result.pages).toBe(5)
    })

    it('clamps limit between 1 and 100', async () => {
      const rows = Array.from({ length: 120 }, (_, i) => makeAnuncio({ id: `a${i}`, hotelId: 'h1' }))
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)
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
      const svc = new AnunciosService(repo, log, memoryCache(), makeUserRepo(), fakeAuth)
      await svc.list({}, hotelAdmin)
      const callsTrasPrimera = findManyCalls
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(1)
      expect(findManyCalls).toBe(callsTrasPrimera)
    })

    it('dos roles del mismo hotel no comparten entrada de caché', async () => {
      const rows = [makeAnuncio({ id: 'solo-admins', hotelId: undefined, audience: 'admins' })]
      const svc = new AnunciosService(makeRepoFrom(rows), log, memoryCache(), makeUserRepo(), fakeAuth)
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
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.list({ hotelId: 'h5' }, adminUser)
      expect(result.data.map((a) => a.id).sort()).toEqual(['de-h5', 'global'])
    })
  })

  // ==================== getById ====================

  describe('getById', () => {
    it('returns announcement for super_admin', async () => {
      const ann = makeAnuncio({ id: 'a1', title: 'Notice' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.getById('a1', adminUser)
      expect(result.title).toBe('Notice')
    })

    it('returns announcement for own hotel admin', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.getById('a1', hotelAdmin)
      expect(result.id).toBe('a1')
    })

    it('rejects hotel_admin accessing other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.getById('a1', hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError for missing announcement', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.getById('nonexistent', adminUser)).rejects.toThrow('Anuncio no encontrado')
    })
  })

  // ==================== create ====================

  describe('create', () => {
    it('creates announcement in own hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.create({ title: 'New notice', hotelId: 'h1' }, hotelAdmin)
      expect(result.id).toBe('ann-1')
      expect(result.title).toBe('New notice')
    })

    it('rejects hotel_admin creating in other hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.create({ title: 'X', hotelId: 'h2' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('super_admin can create in any hotel', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.create({ title: 'Admin notice', hotelId: 'h99' }, adminUser)
      expect(result.title).toBe('Admin notice')
    })

    it('fires onAnunciosCreated socket', async () => {
      let firedWith: AnunciosDTO | null = null
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), fakeAuth)
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
      const svc = new AnunciosService(repo, log, memoryCache(), makeUserRepo(), fakeAuth)

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
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      const result = await svc.update('a1', { title: 'Updated' }, hotelAdmin)
      expect(result.title).toBe('Updated')
    })

    it('rejects hotel_admin updating other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.update('a1', { title: 'X' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError when item does not exist', async () => {
      const repo = makeRepo({ update: async () => null as any })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
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
      const svc = new AnunciosService(repo, log, memoryCache(), makeUserRepo(), fakeAuth)

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
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.delete('a1', adminUser)).resolves.toBeUndefined()
    })

    it('hotel_admin can delete own hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.delete('a1', hotelAdmin)).resolves.toBeUndefined()
    })

    it('rejects hotel_admin deleting other hotel announcement', async () => {
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h2' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.delete('a1', hotelAdmin)).rejects.toThrow('No autorizado')
    })

    it('throws NotFoundError when deleting non-existent item', async () => {
      const svc = new AnunciosService(makeRepo({ delete: async () => false }), log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.delete('ghost', adminUser)).rejects.toThrow('Anuncio no encontrado')
    })

    it('fires onAnunciosDeleted socket with the id', async () => {
      let firedId = ''
      const ann = makeAnuncio({ id: 'a1', hotelId: 'h1' })
      const repo = makeRepo({ findById: async () => ann })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
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
      const svc = new AnunciosService(repo, log, memoryCache(), makeUserRepo(), fakeAuth)

      expect((await svc.list({}, hotelAdmin)).total).toBe(1)
      await svc.delete('a1', hotelAdmin)
      expect((await svc.list({}, hotelAdmin)).total).toBe(0)
    })
  })

  // ==================== audiencia ====================

  describe('audiencia', () => {
    it('un hotel NO puede publicarle a los demás hoteles', async () => {
      const repo = makeRepoFrom([])
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      let creados = 0
      const contador = makeRepoFrom([], { create: async (d: any) => { creados++; return { ...d, id: 'x' } as AnunciosDTO } })
      const svc2 = new AnunciosService(contador, log, makeCache(), makeUserRepo(), fakeAuth)

      await expect(svc.create({ title: 'A todos', audience: 'all' }, hotelAdmin))
        .rejects.toThrow('Solo la plataforma puede publicar anuncios para varios hoteles')
      await expect(svc2.create({ title: 'A todos', audience: 'all' }, hotelAdmin)).rejects.toThrow()
      // No alcanza con el rechazo: no puede haber quedado nada escrito.
      expect(creados).toBe(0)
    })

    it('el rechazo por audiencia es 403, no 401', async () => {
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), fakeAuth)
      const err = await svc.create({ title: 'A todos', audience: 'admins' }, hotelAdmin).catch((e) => e)
      expect((err as any).httpStatus).toBe(403)
    })

    it('audiencia "hotel" sin hotelId es un error de carga, no un anuncio global silencioso', async () => {
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), fakeAuth)
      const err = await svc.create({ title: 'Sin destino', audience: 'hotel' }, adminUser).catch((e) => e)
      expect((err as any).httpStatus).toBe(400)
      expect(String((err as any).message)).toContain('hotelId')
    })

    it('el super_admin publica a todos y la fila NO queda atada a un hotel', async () => {
      let guardado: any = null
      const repo = makeRepoFrom([], { create: async (d: any) => { guardado = d; return { ...d, id: 'g1' } as AnunciosDTO } })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      await svc.create({ title: 'Mantenimiento', audience: 'all', hotelId: 'h1' }, adminUser)
      expect(guardado.audience).toBe('all')
      // Un anuncio de plataforma con hotelId sería un anuncio de un hotel disfrazado.
      expect(guardado.hotelId).toBeUndefined()
    })

    it('un hotel que crea sin decir nada publica para SU hotel', async () => {
      let guardado: any = null
      const repo = makeRepoFrom([], { create: async (d: any) => { guardado = d; return { ...d, id: 'x' } as AnunciosDTO } })
      const svc = new AnunciosService(repo, log, makeCache(), makeUserRepo(), fakeAuth)
      await svc.create({ title: 'Interno' }, hotelAdmin)
      expect(guardado.audience).toBe('hotel')
      expect(guardado.hotelId).toBe('h1')
    })
  })

  // ==================== vigencia ====================

  describe('vigencia', () => {
    it('rechaza endsAt anterior a startsAt', async () => {
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), fakeAuth)
      const err = await svc.create({
        title: 'Ventana invertida', hotelId: 'h1',
        startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-01T00:00:00Z',
      }, hotelAdmin).catch((e) => e)
      expect((err as any).httpStatus).toBe(400)
      expect(String((err as any).message)).toContain('endsAt')
    })

    it('acepta una ventana coherente', async () => {
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), fakeAuth)
      await expect(svc.create({
        title: 'Ventana OK', hotelId: 'h1',
        startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-10T00:00:00Z',
      }, hotelAdmin)).resolves.toBeDefined()
    })
  })

  // ==================== lecturas por usuario ====================

  function makeReadsRepo(rows: any[] = []) {
    let seq = 0
    return {
      findMany: async (filters: any = {}) => rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v)),
      findOne: async (filters: any) => rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null,
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      create: async (data: any) => { const row = { ...data, id: `r${++seq}` }; rows.push(row); return row },
      update: async (id: string, data: any) => {
        const i = rows.findIndex((r) => r.id === id)
        if (i < 0) return null
        rows[i] = { ...rows[i], ...data }
        return rows[i]
      },
      delete: async () => true,
      count: async () => rows.length,
      paginate: async () => ({ data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 }),
      _rows: rows,
    } as any
  }

  describe('lecturas', () => {
    it('marcar visto es idempotente y conserva la PRIMERA vez', async () => {
      const rows = [makeAnuncio({ id: 'a1', hotelId: 'h1' })]
      const reads = makeReadsRepo()
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth, reads)

      const primera = await svc.markSeen('a1', hotelAdmin)
      await new Promise((r) => setTimeout(r, 5))
      await svc.markSeen('a1', hotelAdmin)
      await svc.markSeen('a1', hotelAdmin)

      expect(reads._rows).toHaveLength(1)
      // No alcanza con contar filas: el seenAt tiene que seguir siendo el de la primera vista.
      expect(reads._rows[0].seenAt).toBe(primera!.seenAt)
    })

    it('cerrar el aviso es POR USUARIO: no se lo oculta a un compañero', async () => {
      const rows = [makeAnuncio({ id: 'a1', hotelId: 'h1' })]
      const reads = makeReadsRepo()
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth, reads)

      const recepcion = { id: 'u-recepcion', role: 'receptionist', hotelId: 'h1' }
      await svc.markDismissed('a1', recepcion)

      const vistaRecepcion = await svc.list({}, recepcion)
      const vistaDueno = await svc.list({}, hotelAdmin)
      expect(vistaRecepcion.data[0].dismissed).toBe(true)
      expect(vistaDueno.data[0].dismissed).toBe(false)
    })

    it('el "cerrado" NO se cachea entre usuarios', async () => {
      const rows = [makeAnuncio({ id: 'a1', hotelId: 'h1' })]
      const reads = makeReadsRepo()
      const cache = memoryCache()
      const svc = new AnunciosService(makeRepoFrom(rows), log, cache, makeUserRepo(), fakeAuth, reads)

      // El dueño lista primero y deja la entrada cacheada; DESPUÉS recepción cierra el aviso.
      await svc.list({}, hotelAdmin)
      const recepcion = { id: 'u-recepcion', role: 'hotel_admin', hotelId: 'h1' }
      await svc.markDismissed('a1', recepcion)

      expect((await svc.list({}, hotelAdmin)).data[0].dismissed).toBe(false)
      expect((await svc.list({}, recepcion)).data[0].dismissed).toBe(true)
    })

    it('un id inventado no ensucia la tabla de lecturas', async () => {
      const reads = makeReadsRepo()
      const svc = new AnunciosService(makeRepoFrom([]), log, makeCache(), makeUserRepo(), fakeAuth, reads)
      await expect(svc.markSeen('no-existe', hotelAdmin)).rejects.toThrow('Anuncio no encontrado')
      expect(reads._rows).toHaveLength(0)
    })

    it('si la tabla de lecturas falla, el anuncio se entrega igual', async () => {
      const rows = [makeAnuncio({ id: 'a1', hotelId: 'h1' })]
      const reads = makeReadsRepo()
      reads.findMany = async () => { throw new Error('DB caída') }
      const svc = new AnunciosService(makeRepoFrom(rows), log, makeCache(), makeUserRepo(), fakeAuth, reads)

      const result = await svc.list({}, hotelAdmin)
      expect(result.data.map((a) => a.id)).toEqual(['a1'])
    })
  })

  // ==================== setSockets ====================

  describe('setSockets', () => {
    it('accumulates multiple handlers for same event', async () => {
      const calls: string[] = []
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), fakeAuth)
      svc.setSockets({ onAnunciosCreated: async () => { calls.push('first') } })
      svc.setSockets({ onAnunciosCreated: async () => { calls.push('second') } })
      await svc.create({ title: 'Accumulate', hotelId: 'h1' }, hotelAdmin)
      expect(calls).toEqual(['first', 'second'])
    })

    it('skips null handlers without error', async () => {
      const svc = new AnunciosService(makeRepo(), log, makeCache(), makeUserRepo(), fakeAuth)
      svc.setSockets({ onAnunciosCreated: null as any, onAnunciosUpdated: undefined as any })
      await expect(svc.create({ title: 'No socket', hotelId: 'h1' }, hotelAdmin)).resolves.toBeDefined()
    })
  })
})
