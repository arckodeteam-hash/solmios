// impersonate.test.ts — Impersonación real del super admin.
import { describe, it, expect, vi, beforeEach } from 'bun:test'
import { Router } from 'arckode-framework'
import { jwtTokenAdapter } from 'arckode-framework/adapters/jwt'
import { impersonateUser, IMPERSONATION_TTL } from '../usecases/impersonate'
import { HotelAuth } from '../../../infrastructure/auth/hotel-auth'
import { UsuariosModule } from '../index'
import { fakeLogger, makeAuth } from '../../../infrastructure/auth/tests/route-permission-helpers'

const ADMIN = { id: 'admin-1', role: 'super_admin' }
const TARGET = { id: 'u1', name: 'Ana', email: 'ana@hotel.com', role: 'hotel_admin', hotelId: 'h1', active: 1 }

describe('impersonateUser', () => {
  let repo: any
  let hotelRepo: any
  let auth: any

  beforeEach(() => {
    repo = { findById: vi.fn().mockResolvedValue({ ...TARGET }), update: vi.fn() }
    hotelRepo = { findMany: vi.fn().mockResolvedValue([{ id: 'h1', name: 'Hotel Caribe' }]) }
    auth = { createToken: vi.fn().mockReturnValue('jwt-impersonado'), createRefreshToken: vi.fn() }
  })

  it('emite un token acotado al hotel del target, con impersonatedBy y TTL corto', async () => {
    const result = await impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'u1')

    expect(result.token).toBe('jwt-impersonado')
    expect(auth.createToken).toHaveBeenCalledWith({
      id: 'u1',
      role: 'hotel_admin',
      hotelId: 'h1',
      userType: 'merchant',
      impersonatedBy: 'admin-1',
    }, IMPERSONATION_TTL)
    expect(IMPERSONATION_TTL).toBe('2h')
  })

  it('el token NO lleva super_admin: de ese valor dependen los chequeos de aislamiento por hotel de todo el backend', async () => {
    // ~30 services deciden si saltean el filtro por hotel con `currentUser.role !== 'super_admin'`.
    // Un token de impersonación con ese rol convertía la sesión de soporte en acceso de lectura Y
    // ESCRITURA a cualquier otro hotel (crear una API key o un webhook para un hotel ajeno, que
    // además sobreviven a las 2h del token). El rol viaja como el del cliente, siempre.
    repo.findById.mockResolvedValue({ ...TARGET, role: 'receptionist' })
    await impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'u1')

    const payload = auth.createToken.mock.calls[0][0]
    expect(payload.role).toBe('receptionist')
    expect(payload.role).not.toBe('super_admin')
    // Los permisos totales del admin no salen del rol: los da loadPermissions por este claim.
    expect(payload.impersonatedBy).toBe('admin-1')
    expect(payload.hotelId).toBe('h1')
  })

  it('devuelve el rol REAL del target (no el del token), permisos totales y el nombre del hotel', async () => {
    const result = await impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'u1')

    // El rol real es el que muestra la franja de aviso en la UI, y es también el que
    // viaja en el token; los permisos totales llegan aparte, por `impersonatedBy`.
    expect(result.user.role).toBe('hotel_admin')
    expect(result.user.permissions).toEqual(['*:*'])
    expect(result.user).toMatchObject({ id: 'u1', name: 'Ana', email: 'ana@hotel.com', hotelId: 'h1', hotelName: 'Hotel Caribe' })
  })

  it('sin hotelRepo (o sin hotelId) el hotelName queda vacío', async () => {
    repo.findById.mockResolvedValue({ ...TARGET, hotelId: null })
    const result = await impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'u1')
    expect(result.user.hotelName).toBe('')
    expect(result.user.hotelId).toBeNull()
  })

  it('NO emite refresh token NI escribe users.token del target', async () => {
    await impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'u1')
    // Ésta es la regla que protege la sesión del cliente: `users.token` guarda el jti del
    // refresh vigente y el refresh es single-session. Emitir un refresh acá o pisar ese
    // campo desloguearía al cliente real mientras el admin mira su cuenta.
    expect(auth.createRefreshToken).not.toHaveBeenCalled()
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('rechaza a un actor que no es super_admin', async () => {
    await expect(impersonateUser({ repo, hotelRepo, auth }, { id: 'x', role: 'hotel_admin' }, 'u1'))
      .rejects.toThrow('Solo un super admin puede impersonar')
    expect(auth.createToken).not.toHaveBeenCalled()
  })

  it('rechaza si el target no existe', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'nope'))
      .rejects.toThrow('Usuario no encontrado')
  })

  it('rechaza impersonar a otro super admin', async () => {
    repo.findById.mockResolvedValue({ ...TARGET, id: 'sa2', role: 'super_admin' })
    await expect(impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'sa2'))
      .rejects.toThrow('otro super admin')
  })

  it('rechaza a un usuario inactivo', async () => {
    repo.findById.mockResolvedValue({ ...TARGET, active: 0 })
    await expect(impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'u1'))
      .rejects.toThrow('inactivo')
  })

  it('rechaza impersonarse a uno mismo', async () => {
    repo.findById.mockResolvedValue({ ...TARGET, id: 'admin-1', role: 'hotel_admin' })
    await expect(impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'admin-1'))
      .rejects.toThrow('vos mismo')
  })
})

describe('HotelAuth: claim impersonatedBy', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as any
  const auth = new HotelAuth(jwtTokenAdapter, 'test-secret', logger, '1h', '7d')

  it('un token creado con impersonatedBy lo devuelve verifyToken', () => {
    const jwt = auth.createToken({ id: 'u1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant', impersonatedBy: 'admin-1' }, '2h')
    expect(auth.verifyToken(jwt).impersonatedBy).toBe('admin-1')
  })

  it('un token normal devuelve impersonatedBy undefined', () => {
    const jwt = auth.createToken({ id: 'u1', role: 'hotel_admin', hotelId: 'h1' })
    expect(auth.verifyToken(jwt).impersonatedBy).toBeUndefined()
  })
})

// REQ-SOP-04: POST /api/auth/impersonate/:id deja rastro de auditoría (auth.impersonate).
// A nivel de RUTA REAL (router.resolve) — el audit se cablea inline en index.ts, no en el
// usecase puro de arriba. Módulo REAL montado sobre Router/HotelAuth reales con un ORM fake.
describe('POST /api/auth/impersonate/:id — auditoría (REQ-SOP-04)', () => {
  const ADMIN_ROW = { id: 'admin-1', name: 'Super Admin', email: 'sa@x.com', role: 'super_admin', userType: 'admin', hotelId: null, active: 1 }
  const TARGET_ROW = { id: 'u1', name: 'Ana', email: 'ana@hotel.com', role: 'hotel_admin', userType: 'merchant', hotelId: 'h1', active: 1 }

  /** ORM fake con una tabla Users real (findById) — impersonateUser depende de eso. */
  function ormWithUsers(users: any[], hotels: any[] = []): any {
    const orm: any = {
      define() { return orm },
      findMany: async (table: string, filters?: any) => {
        const rows = table === 'Hotels' ? hotels : table === 'Users' ? users : []
        return rows.filter((r: any) => Object.entries(filters ?? {}).every(([k, v]) => r[k] === v))
      },
      findById: async (table: string, id: string) => (table === 'Users' ? users.find((u: any) => u.id === id) ?? null : null),
      findOne: async () => null,
      create: async (_t: string, d: any) => d,
      update: async (_t: string, id: string, d: any) => ({ id, ...d }),
      delete: async () => true,
      count: async () => 0,
      paginate: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
      transaction: async (fn: any) => fn(orm),
    }
    return orm
  }

  function mount() {
    const router = new Router()
    const auth = makeAuth()
    const orm = ormWithUsers([ADMIN_ROW, TARGET_ROW], [{ id: 'h1', name: 'Hotel Caribe' }])
    const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
    const mod = UsuariosModule() as any
    const service = mod.create({ logger: fakeLogger(), orm, router, auth, cache })
    return { router, auth, service }
  }

  const adminHeaders = (auth: any) => ({
    authorization: `Bearer ${auth.createToken({ id: 'admin-1', role: 'super_admin', hotelId: null, userType: 'admin' })}`,
  })

  it('con ticketId en el body → fila de auditoría con el ticket en detail', async () => {
    const { router, auth, service } = mount()
    const records: any[] = []
    service.setAuditDeps({ record: async (entry: any) => { records.push(entry) } })

    const res = await router.resolve('POST', '/api/auth/impersonate/u1', { headers: adminHeaders(auth), body: { ticketId: 'tk-42' } })

    expect(res.status).toBe(200)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ userId: 'admin-1', hotelId: 'h1', action: 'auth.impersonate', entity: 'user', entityId: 'u1' })
    expect(records[0].detail).toContain('tk-42')
  })

  it('sin body → fila de auditoría sin ticket', async () => {
    const { router, auth, service } = mount()
    const records: any[] = []
    service.setAuditDeps({ record: async (entry: any) => { records.push(entry) } })

    const res = await router.resolve('POST', '/api/auth/impersonate/u1', { headers: adminHeaders(auth) })

    expect(res.status).toBe(200)
    expect(records).toHaveLength(1)
    expect(records[0].detail).toBe('Impersonación')
  })

  it('si el audit log lanza, la impersonación igual responde 200', async () => {
    const { router, auth, service } = mount()
    service.setAuditDeps({ record: async () => { throw new Error('audit log caído') } })

    const res = await router.resolve('POST', '/api/auth/impersonate/u1', { headers: adminHeaders(auth), body: { ticketId: 'tk-1' } })

    expect(res.status).toBe(200)
    expect((res.body as any).token).toBeDefined()
  })

  it('sin conectar el audit port (nadie llamó setAuditDeps) igual responde 200', async () => {
    const { router, auth } = mount()
    const res = await router.resolve('POST', '/api/auth/impersonate/u1', { headers: adminHeaders(auth) })
    expect(res.status).toBe(200)
  })
})
