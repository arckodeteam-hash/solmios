// auditlog/tests/service.test.ts — Tests del servicio (append-only: list/getById/create).

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AuditlogService } from '../service'
import type { AuditlogDTO } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const mockAuth = {
  assertOwnership: (rid: string, uid: string, role?: string, admin = 'admin') => {
    if (rid === uid) return; if (role === admin) return; throw new Error('Forbidden')
  },
} as unknown as Auth
const user = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

const emptyRepo = (): RepositoryAdapter<any> => ({
  findMany: async () => [], findById: async () => null, findOne: async () => null,
  create: async (d: any) => ({ id: 'test-id', ...d }), update: async (id: string, d: any) => ({ id, ...d }),
  delete: async () => true, count: async () => 0,
  paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
})

function makeService(repoOver: Partial<RepositoryAdapter<AuditlogDTO>> = {}, userHotel = 'h1') {
  const repo = { ...emptyRepo(), ...repoOver } as RepositoryAdapter<AuditlogDTO>
  const userRepo = { ...emptyRepo(), findById: async () => ({ id: 'u1', hotelId: userHotel }) } as RepositoryAdapter<any>
  return new AuditlogService(repo, userRepo, log, silentCache, mockAuth)
}

describe('AuditlogService', () => {
  it('lanza NotFound si el item no existe', async () => {
    const service = makeService()
    await expect(service.getById('no-existe', user)).rejects.toThrow('Auditlog no encontrado')
  })

  it('retorna el item si existe y es del hotel del usuario', async () => {
    const item = { id: '1', hotelId: 'h1' } as AuditlogDTO
    const service = makeService({ findById: async () => item })
    const result = await service.getById('1', user)
    expect(result.id).toBe('1')
  })

  it('rechaza acceso a log de otro hotel (IDOR)', async () => {
    const item = { id: '1', hotelId: 'otro' } as AuditlogDTO
    const service = makeService({ findById: async () => item })
    await expect(service.getById('1', user)).rejects.toThrow()
  })

  it('crea y retorna el item', async () => {
    const service = makeService()
    const result = await service.create({ hotelId: 'h1' } as any)
    expect(result.id).toBe('test-id')
  })
})

// ─── Filtros del panel (M3 qa-ui config-2026-08-22) ────

describe('AuditlogService.list — filtros userId/action/rango de fechas', () => {
  const entry = (id: string, over: Partial<AuditlogDTO> = {}): AuditlogDTO =>
    ({ id, hotelId: 'h1', action: 'room.delete', createdAt: '2026-08-10T12:00:00.000Z', ...over } as AuditlogDTO)

  /** Repo que graba los filtros/options con los que fue llamado y devuelve `rows`
   *  aplicando igualdad simple (como buildWhere real, para userId/action). */
  function spyRepo(rows: AuditlogDTO[]) {
    const seen: Array<{ filters: any; options: any }> = []
    const eq = (list: AuditlogDTO[], filters: any) =>
      list.filter((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v))
    const repo = {
      ...emptyRepo(),
      findMany: async (filters: any, options?: any) => { seen.push({ filters, options }); return eq(rows, filters) },
      paginate: async (filters: any, options: any) => {
        seen.push({ filters, options })
        const data = eq(rows, filters)
        return { data: data.slice(options.offset, options.offset + options.limit), total: data.length, limit: options.limit, offset: options.offset, pages: 1 }
      },
      count: async (filters: any) => eq(rows, filters).length,
    } as any
    return { repo, seen }
  }

  it('userId y action viajan como filtros de igualdad al repo', async () => {
    const { repo, seen } = spyRepo([])
    const service = makeService(repo)
    await service.list({ hotelId: 'h1', userId: 'u9', action: 'room.delete' } as any)
    expect(seen[0].filters.userId).toBe('u9')
    expect(seen[0].filters.action).toBe('room.delete')
  })

  it('ordena por createdAt DESC (paginación determinística: página 1 = lo más reciente)', async () => {
    const { repo, seen } = spyRepo([])
    const service = makeService(repo)
    await service.list({ hotelId: 'h1' } as any)
    expect(seen[0].options.orderBy).toEqual([{ field: 'createdAt', dir: 'DESC' }])
  })

  it('rango from/to filtra en memoria con límites inclusivos', async () => {
    const rows = [
      entry('a', { createdAt: '2026-08-01T00:00:00.000Z' }), // borde from, entra
      entry('b', { createdAt: '2026-08-15T23:59:59.999Z' }), // borde to, entra
      entry('c', { createdAt: '2026-07-31T23:59:59.999Z' }), // antes del from, afuera
      entry('d', { createdAt: '2026-08-16T00:00:00.000Z' }), // después del to, afuera
    ]
    const { repo } = spyRepo(rows)
    const service = makeService(repo)
    const res = await service.list({ hotelId: 'h1', from: '2026-08-01', to: '2026-08-15' } as any)
    expect(res.total).toBe(2)
    expect(res.data.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('solo `from` (hasta hoy) y pagina el resultado filtrado', async () => {
    const rows = [
      entry('old', { createdAt: '2026-01-01T00:00:00.000Z' }),
      ...Array.from({ length: 25 }, (_, i) => entry(`n${i}`, { createdAt: `2026-08-01T00:00:0${i % 10}.000Z` })),
    ]
    const { repo } = spyRepo(rows)
    const service = makeService(repo)
    const res = await service.list({ hotelId: 'h1', from: '2026-07-01', limit: 10, page: 1 } as any)
    expect(res.total).toBe(25) // solo los de agosto; 'old' quedó afuera
    expect(res.data.length).toBe(10)
  })

  it('combina rango de fechas con filtro de usuario (van juntas al repo)', async () => {
    const rows = [
      entry('mine', { userId: 'u9', createdAt: '2026-08-02T00:00:00.000Z' }),
      entry('other', { userId: 'u8', createdAt: '2026-08-02T00:00:00.000Z' }),
    ]
    const { repo, seen } = spyRepo(rows)
    const service = makeService(repo)
    const res = await service.list({ hotelId: 'h1', from: '2026-08-01', to: '2026-08-31', userId: 'u9' } as any)
    expect(seen[0].filters.userId).toBe('u9') // el filtro de usuario viajó al WHERE
    expect(res.total).toBe(1)
    expect(res.data[0].id).toBe('mine')
  })
})
