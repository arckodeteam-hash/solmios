import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { MantenimientoService } from '../service'
import type { MantenimientoDTO } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const mockAuth = { assertOwnership: () => {} } as unknown as Auth
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const adminUser = { id: 'admin1', role: 'super_admin', hotelId: undefined }
const hotelAdmin = { id: 'user1', role: 'hotel_admin', hotelId: 'h1' }
const otherAdmin = { id: 'user2', role: 'hotel_admin', hotelId: 'h2' }

function makeRepo(overrides: Partial<RepositoryAdapter<MantenimientoDTO>> = {}): RepositoryAdapter<MantenimientoDTO> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => ({ id: 'maint-1', ...data } as MantenimientoDTO),
    update: async (id, data) => ({ id, ...data } as MantenimientoDTO),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

function makeUserRepo() {
  return {
    findById: async () => ({ id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }),
    // Por defecto el técnico existe y es del hotel (validateAssignee lo acepta).
    findOne: async () => ({ id: 'tech', hotelId: 'h1', role: 'maintenance' }),
  } as unknown as RepositoryAdapter<any>
}

function makeAuditRepo(): RepositoryAdapter<any> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => data,
    update: async (id, data) => ({ id, ...data }),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
  }
}

const mockUser = { id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }

describe('MantenimientoService', () => {
  describe('list', () => {
    it('returns paginated tickets', async () => {
      const tickets = [{ id: 't1', hotelId: 'h1', title: 'Leak' }] as MantenimientoDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: tickets, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      const result = await svc.list({}, adminUser)
      expect(result.data).toHaveLength(1)
    })

    it('filters by hotelId for hotel_admin', async () => {
      const tickets = [{ id: 't1', hotelId: 'h1', title: 'Leak' }] as MantenimientoDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: tickets, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(1)
    })

    it('throws when no hotelId assigned', async () => {
      const noHotel = { id: 'u1', role: 'hotel_admin', hotelId: undefined }
      const userRepoWithoutHotel = { findById: async () => ({}) } as unknown as RepositoryAdapter<any>
      const svc = new MantenimientoService(makeRepo(), log, silentCache, userRepoWithoutHotel, fakeAuth, makeAuditRepo())
      await expect(svc.list({}, noHotel)).rejects.toThrow('No hotel assigned')
    })

    // El técnico pide `?assignedTo=<su id>`. Antes se ignoraba y veía todo el hotel.
    it('filtra por assignedTo cuando se lo pasan', async () => {
      let captured: Record<string, unknown> = {}
      const repo = makeRepo({
        paginate: async (filters: any) => {
          captured = filters
          return { data: [], total: 0, limit: 20, offset: 0, pages: 0 }
        },
      })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await svc.list({ assignedTo: 'tech-1' }, hotelAdmin)

      expect(captured.assignedTo).toBe('tech-1')
    })
  })

  describe('getById', () => {
    it('returns ticket for super_admin', async () => {
      const ticket = { id: 't1', hotelId: 'h1', title: 'Leak' } as MantenimientoDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      const result = await svc.getById('t1', adminUser)
      expect(result.title).toBe('Leak')
    })

    it('rejects other hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h2', title: 'Leak' } as MantenimientoDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await expect(svc.getById('t1', hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  describe('create', () => {
    it('creates ticket in own hotel', async () => {
      const svc = new MantenimientoService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      const result = await svc.create({ hotelId: 'h1', title: 'Leak' }, hotelAdmin)
      expect(result.id).toBe('maint-1')
    })

    it('rejects ticket in other hotel', async () => {
      const svc = new MantenimientoService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await expect(svc.create({ hotelId: 'h2', title: 'Leak' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  describe('update', () => {
    it('updates own hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h1', title: 'Leak', status: 'open' } as MantenimientoDTO
      const repo = makeRepo({ findById: async () => ticket, update: async (id, data) => ({ id, ...data } as MantenimientoDTO) })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      const result = await svc.update('t1', { status: 'in_progress' }, hotelAdmin)
      expect(result.status).toBe('in_progress')
    })

    it('rejects update to other hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h2', title: 'Leak', status: 'open' } as MantenimientoDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await expect(svc.update('t1', { status: 'in_progress' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    // Feedback #420: los estados no podían revertirse a "abierta" de forma consistente.
    // Toda orden que todavía no se cerró debe poder volver a open (se asignó por error,
    // el técnico no puede tomarla, el repuesto nunca llegó).
    it.each(['in_progress', 'waiting', 'resolved', 'closed'])('allows reverting %s -> open', async (from) => {
      const ticket = { id: 't1', hotelId: 'h1', title: 'Leak', status: from } as MantenimientoDTO
      const repo = makeRepo({ findById: async () => ticket, update: async (id, data) => ({ id, ...data } as MantenimientoDTO) })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      const result = await svc.update('t1', { status: 'open' }, hotelAdmin)
      expect(result.status).toBe('open')
    })
  })

  // Un ticket tiene UN dueño: técnico interno (assignedTo) O servicio externo
  // (providerId), nunca ambos. La exclusividad se garantiza en el servidor, no
  // en el diálogo de la app: asignar uno desaloja al otro.
  describe('exclusividad técnico ↔ servicio externo', () => {
    function captureUpdate(existing: MantenimientoDTO) {
      let patch: Record<string, unknown> = {}
      const repo = makeRepo({
        findById: async () => existing,
        update: async (id, data) => { patch = data as Record<string, unknown>; return { id, ...data } as MantenimientoDTO },
      })
      return { repo, patch: () => patch }
    }

    it('pasar a un servicio externo desaloja al técnico interno', async () => {
      const existing = { id: 't1', hotelId: 'h1', title: 'Leak', status: 'open', assignedTo: 'tech-9' } as MantenimientoDTO
      const cap = captureUpdate(existing)
      const svc = new MantenimientoService(cap.repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await svc.update('t1', { providerId: 'prov-1' }, hotelAdmin)
      expect(cap.patch().providerId).toBe('prov-1')
      expect(cap.patch().assignedTo).toBe('')
    })

    it('asignar un técnico interno desaloja al servicio externo', async () => {
      const existing = { id: 't1', hotelId: 'h1', title: 'Leak', status: 'open', providerId: 'prov-1' } as MantenimientoDTO
      const cap = captureUpdate(existing)
      const svc = new MantenimientoService(cap.repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await svc.update('t1', { assignedTo: 'tech-9' }, hotelAdmin)
      expect(cap.patch().assignedTo).toBe('tech-9')
      expect(cap.patch().providerId).toBe('')
    })

    it('un update que no toca la asignación no pisa a ninguno de los dos', async () => {
      const existing = { id: 't1', hotelId: 'h1', title: 'Leak', status: 'open', assignedTo: 'tech-9' } as MantenimientoDTO
      const cap = captureUpdate(existing)
      const svc = new MantenimientoService(cap.repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await svc.update('t1', { priority: 'high' }, hotelAdmin)
      expect(cap.patch().assignedTo).toBeUndefined()
      expect(cap.patch().providerId).toBeUndefined()
    })

    it('crear ya asignado a un servicio externo nace sin técnico', async () => {
      let created: Record<string, unknown> = {}
      const repo = makeRepo({ create: async (data) => { created = data as Record<string, unknown>; return { id: 'maint-1', ...data } as MantenimientoDTO } })
      // providerRepo (8º arg) con el proveedor existente, para que validateAssignee lo acepte.
      const providerRepo = { findOne: async () => ({ id: 'prov-1', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo(), undefined, providerRepo)
      await svc.create({ hotelId: 'h1', title: 'Leak', providerId: 'prov-1' } as any, hotelAdmin)
      expect(created.providerId).toBe('prov-1')
      expect(created.assignedTo).toBe('')
    })
  })

  // #392: no se asigna un ticket a un técnico/proveedor inexistente o de otro hotel.
  describe('validación de asignación', () => {
    it('rechaza un técnico que no pertenece al hotel', async () => {
      const userRepo = { findById: async () => ({ id: 'u', hotelId: 'h1' }), findOne: async () => null } as unknown as RepositoryAdapter<any>
      const svc = new MantenimientoService(makeRepo(), log, silentCache, userRepo, fakeAuth, makeAuditRepo())
      await expect(svc.create({ hotelId: 'h1', title: 'Leak', assignedTo: 'ajeno' } as any, hotelAdmin))
        .rejects.toThrow('no pertenece a este hotel')
    })

    it('rechaza un proveedor que no pertenece al hotel', async () => {
      const providerRepo = { findOne: async () => null } as unknown as RepositoryAdapter<any>
      const svc = new MantenimientoService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo(), undefined, providerRepo)
      await expect(svc.create({ hotelId: 'h1', title: 'Leak', providerId: 'ajeno' } as any, hotelAdmin))
        .rejects.toThrow('no pertenece a este hotel')
    })

    it('acepta un técnico del propio hotel', async () => {
      const svc = new MantenimientoService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      const r = await svc.create({ hotelId: 'h1', title: 'Leak', assignedTo: 'tech' } as any, hotelAdmin)
      expect(r.assignedTo).toBe('tech')
    })
  })

  describe('delete', () => {
    it('super_admin can delete', async () => {
      const ticket = { id: 't1', hotelId: 'h1', title: 'Leak' } as MantenimientoDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await expect(svc.delete('t1', adminUser)).resolves.toBeUndefined()
    })

    it('hotel_admin can delete own hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h1', title: 'Leak' } as MantenimientoDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await expect(svc.delete('t1', hotelAdmin)).resolves.toBeUndefined()
    })

    it('rejects delete of other hotel ticket', async () => {
      const ticket = { id: 't1', hotelId: 'h2', title: 'Leak' } as MantenimientoDTO
      const repo = makeRepo({ findById: async () => ticket })
      const svc = new MantenimientoService(repo, log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo())
      await expect(svc.delete('t1', hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  // ─── Servicios externos (proveedores) ─────────────────────────────────────
  // Los tres tests reproducen bugs reales del monitor (2026-08-17): el checkbox
  // "activo" del alta era decorativo (el usecase hardcodeaba true) y los dados de
  // baja eran invisibles para siempre (list() los filtraba sin escape).
  describe('providers', () => {
    type ProviderRepo = RepositoryAdapter<import('../types').MaintenanceProviderDTO>

    function makeProviderRepo(rows: Array<import('../types').MaintenanceProviderDTO> = []): ProviderRepo {
      return {
        findMany: async () => rows,
        findById: async (id: string) => rows.find(r => r.id === id) ?? null,
        findOne: async () => null,
        create: async (data: any) => ({ id: 'prov-new', ...data }),
        update: async (id: string, data: any) => ({ ...rows.find(r => r.id === id), ...data }),
        delete: async () => true,
        count: async () => rows.length,
        paginate: async () => ({ data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 }),
      } as ProviderRepo
    }

    function makeSvc(providerRepo: ProviderRepo) {
      return new MantenimientoService(
        makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, makeAuditRepo(), undefined, providerRepo,
      )
    }

    it('create respeta active:false del alta (antes lo ignoraba y creaba activo)', async () => {
      const created: any[] = []
      const repo = makeProviderRepo()
      repo.create = async (data: any) => { created.push(data); return { id: 'prov-new', ...data } }
      const svc = makeSvc(repo)

      const item = await svc.createProvider({ name: 'Plomero', active: false }, hotelAdmin)
      expect(item.active).toBe(false)
      expect(created[0].active).toBe(false)
    })

    it('create sin active defaultea a true (compatibilidad con app/selector de tickets)', async () => {
      const svc = makeSvc(makeProviderRepo())
      const item = await svc.createProvider({ name: 'Plomero' }, hotelAdmin)
      expect(item.active).toBe(true)
    })

    it('list oculta los de baja por defecto y los incluye con includeInactive', async () => {
      const rows = [
        { id: 'p1', hotelId: 'h1', name: 'Activo', active: true },
        { id: 'p2', hotelId: 'h1', name: 'De baja', active: false },
      ] as Array<import('../types').MaintenanceProviderDTO>
      const svc = makeSvc(makeProviderRepo(rows))

      const visible = await svc.listProviders(hotelAdmin)
      expect(visible.map(p => p.id)).toEqual(['p1'])

      const all = await svc.listProviders(hotelAdmin, true)
      expect(all.map(p => p.id)).toEqual(['p1', 'p2'])
    })

    it('reactivar es un update de active — el camino que usa la vista de administración', async () => {
      const repo = makeProviderRepo([{ id: 'p2', hotelId: 'h1', name: 'De baja', active: false } as import('../types').MaintenanceProviderDTO])
      const svc = makeSvc(repo)

      const item = await svc.updateProvider('p2', { active: true }, hotelAdmin)
      expect(item.active).toBe(true)
    })
  })
})
