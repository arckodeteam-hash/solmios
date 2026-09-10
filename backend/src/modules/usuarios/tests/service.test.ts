// usuarios/tests/service.test.ts — Tests del servicio (con RepositoryAdapter mock)
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth, Logger } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { UsuariosService } from '../service'

/* ---------- helpers ---------- */

const log: Logger = silentLogger()
const cache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

function makeAuth(overrides: Partial<Auth> = {}): Auth {
  return {
    createToken: () => 'jwt-token-fake',
    createRefreshToken: () => 'jwt-refresh-fake',
    assertOwnership: () => {},
    authenticate: () => [],
    hashPassword: async (p: string) => p,
    verifyPassword: async () => true,
    ...overrides,
  } as unknown as Auth
}

function makeRepo(overrides: Partial<RepositoryAdapter<any>> = {}): RepositoryAdapter<any> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (d: any) => ({ ...d, id: 'u1' }),
    update: async (id: string, d: any) => ({ ...d, id }),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

/** Pre-computed bcrypt hash for 'secreto'. Evita llamar Bun.password.hash en cada test. */
const HASH_SECRETO = '$2b$10$nT4qXtfUE5ghTmmDBYyYS.JR.cA6Nbvvyhetyw1OzkEYxnezyUmhi'

function mockUser(overrides: Record<string, any> = {}) {
  return {
    id: 'u1',
    name: 'Ana',
    email: 'ana@test.com',
    password: HASH_SECRETO,
    role: 'hotel_admin',
    hotelId: 'h1',
    token: null,
    resetToken: null,
    resetExpires: null,
    active: 1,
    ...overrides,
  }
}

/* ================================================================
   Tests
   ================================================================ */

describe('UsuariosService', () => {

  // ── LOGIN ─────────────────────────────────────────────────────

  describe('login', () => {
    it('exitoso: usuario existe, password correcto, retorna token', async () => {
      const svc = new UsuariosService(
        makeRepo({ findOne: async () => mockUser() }),
        log,
        cache,
        makeAuth(),
      )
      const u = await svc.login('ana@test.com', 'secreto')
      expect(u.token).toBe('jwt-token-fake')
      expect(u.user.id).toBe('u1')
      expect(u.user.email).toBe('ana@test.com')
    })

    it('falla si el usuario no existe', async () => {
      const svc = new UsuariosService(makeRepo(), log, cache, makeAuth())
      await expect(svc.login('noexiste@test.com', 'p')).rejects.toThrow()
    })

    it('falla si la password es incorrecta', async () => {
      const svc = new UsuariosService(
        makeRepo({ findOne: async () => mockUser() }),
        log,
        cache,
        makeAuth(),
      )
      await expect(svc.login('ana@test.com', 'wrong')).rejects.toThrow()
    })

    it('falla si el usuario está inactivo (active === 0)', async () => {
      const svc = new UsuariosService(
        makeRepo({ findOne: async () => mockUser({ active: 0 }) }),
        log,
        cache,
        makeAuth(),
      )
      await expect(svc.login('ana@test.com', 'secreto')).rejects.toThrow()
    })

    it('normaliza el email: trim + lowercase', async () => {
      const emails: string[] = []
      const svc = new UsuariosService(
        makeRepo({
          findOne: async (q: any) => {
            emails.push(q.email)
            return mockUser()
          },
        }),
        log,
        cache,
        makeAuth(),
      )
      await svc.login('  ANA@Test.COM  ', 'secreto')
      expect(emails[0]).toBe('ana@test.com')
    })
  })

  // ── LOGIN POR TELÉFONO ────────────────────────────────────────

  describe('login por teléfono', () => {
    /** Como en producción: la base guarda el teléfono normalizado (solo dígitos). */
    const conTelefono = () =>
      makeRepo({ findOne: async (filters: any) => {
        if (filters.phone === '8095550001') return mockUser({ phone: '8095550001' })
        return null
      }})

    for (const escrito of [
      '8095550001',
      '809-555-0001',
      '809 555 0001',
      '(809) 555-0001',
      '+18095550001',
      '+1 809 555 0001',
      '18095550001',
      '+1 (809) 555-0001',
    ]) {
      it(`entra escribiendo "${escrito}"`, async () => {
        const svc = new UsuariosService(conTelefono(), log, cache, makeAuth())
        const u = await svc.login(escrito, 'secreto')
        expect(u.user.id).toBe('u1')
      })
    }

    it('falla con un teléfono que no existe', async () => {
      const svc = new UsuariosService(conTelefono(), log, cache, makeAuth())
      await expect(svc.login('8095559999', 'secreto')).rejects.toThrow('Credenciales inválidas')
    })

    it('una entrada sin dígitos no matchea a un usuario sin teléfono', async () => {
      // `+` pasa el test de "parece teléfono" y normaliza a ''. Antes eso coincidía
      // con cualquier usuario cuyo phone fuera null → se elegía un usuario arbitrario.
      const svc = new UsuariosService(
        makeRepo({ findMany: async () => [mockUser({ phone: null })] }),
        log,
        cache,
        makeAuth(),
      )
      await expect(svc.login('+', 'secreto')).rejects.toThrow('Credenciales inválidas')
    })

    it('un usuario sin teléfono nunca matchea por teléfono', async () => {
      const svc = new UsuariosService(
        makeRepo({ findMany: async () => [mockUser({ phone: '' })] }),
        log,
        cache,
        makeAuth(),
      )
      await expect(svc.login('8095550001', 'secreto')).rejects.toThrow('Credenciales inválidas')
    })

    it('sigue exigiendo la password correcta', async () => {
      const svc = new UsuariosService(conTelefono(), log, cache, makeAuth())
      await expect(svc.login('+1 809 555 0001', 'wrong')).rejects.toThrow('Credenciales inválidas')
    })

    it('un teléfono de usuario inactivo no entra', async () => {
      const svc = new UsuariosService(
        makeRepo({ findMany: async () => [mockUser({ phone: '809-555-0001', active: 0 })] }),
        log,
        cache,
        makeAuth(),
      )
      await expect(svc.login('+18095550001', 'secreto')).rejects.toThrow('Credenciales inválidas')
    })
  })

  // ── LOGOUT ────────────────────────────────────────────────────

  describe('logout', () => {
    it('limpia el token del usuario', async () => {
      let captured: any = null
      const svc = new UsuariosService(
        makeRepo({
          update: async (id: string, data: any) => { captured = { id, ...data }; return data },
        }),
        log,
        cache,
        makeAuth(),
      )
      await svc.logout('u1')
      expect(captured.id).toBe('u1')
      expect(captured.token).toBeNull()
    })
  })

  // ── CHANGE PASSWORD ───────────────────────────────────────────

  describe('changePassword', () => {
    it('exitoso: hashea nueva password y limpia token', async () => {
      let captured: any = null
      const svc = new UsuariosService(
        makeRepo({
          findById: async () => mockUser(),
          update: async (id: string, data: any) => { captured = { id, ...data }; return data },
        }),
        log,
        cache,
        makeAuth(),
      )
      await svc.changePassword('u1', 'secreto', 'nueva123')
      expect(captured.id).toBe('u1')
      expect(captured.token).toBeNull()
      expect(captured.password).not.toBe('nueva') // hasheado
    })

    it('falla si la password actual es incorrecta', async () => {
      const svc = new UsuariosService(
        makeRepo({ findById: async () => mockUser() }),
        log,
        cache,
        makeAuth(),
      )
      await expect(svc.changePassword('u1', 'wrong', 'nueva123')).rejects.toThrow()
    })

    it('lanza NotFound si el usuario no existe', async () => {
      const svc = new UsuariosService(makeRepo(), log, cache, makeAuth())
      await expect(svc.changePassword('no-id', 'secreto', 'nueva')).rejects.toThrow('Usuario no encontrado')
    })
  })

  // ── FORGOT PASSWORD ───────────────────────────────────────────

  describe('forgotPassword', () => {
    it('retorna void sin importar si el usuario existe', async () => {
      const svc = new UsuariosService(makeRepo(), log, cache, makeAuth())
      const result = await svc.forgotPassword('noexiste@test.com')
      expect(result).toBeUndefined()
    })

    it('no lanza error para usuario inexistente (evita enumeración)', async () => {
      const updates: any[] = []
      const svc = new UsuariosService(
        makeRepo({
          update: async (id: string, data: any) => { updates.push({ id, ...data }); return data },
        }),
        log,
        cache,
        makeAuth(),
      )
      await expect(svc.forgotPassword('fantasma@test.com')).resolves.toBeUndefined()
      expect(updates).toHaveLength(0)
    })

    it('forgotPassword sets resetToken and resetExpires when user exists', async () => {
      let updatedData: any = null
      const mockUser = { id: 'u1', email: 'test@test.com', resetToken: null, resetExpires: null }
      const repo = makeRepo({
        findOne: async () => mockUser,
        update: async (id: string, data: any) => { updatedData = data; return { ...mockUser, ...data } }
      })
      const svc = new UsuariosService(repo, log, cache, makeAuth())
      await svc.forgotPassword('test@test.com')
      expect(updatedData).not.toBeNull()
      expect(updatedData.resetToken).toBeDefined()
      expect(updatedData.resetExpires).toBeGreaterThan(Date.now())
    })
  })

  // ── RESET PASSWORD ────────────────────────────────────────────

  describe('resetPassword', () => {
    it('exitoso: hashea password y limpia token, resetToken y resetExpires', async () => {
      let captured: any = null
      const svc = new UsuariosService(
        makeRepo({
          findOne: async () => mockUser({ resetToken: 'valid-token', resetExpires: Date.now() + 3600_000 }),
          update: async (id: string, data: any) => { captured = { id, ...data }; return data },
        }),
        log,
        cache,
        makeAuth(),
      )
      await svc.resetPassword('valid-token', 'nuevaPass123')
      expect(captured.id).toBe('u1')
      expect(captured.password).not.toBe('nuevaPass123') // hasheado
      expect(captured.token).toBeNull()
      expect(captured.resetToken).toBeNull()
      expect(captured.resetExpires).toBeNull()
    })

    it('falla si el token está expirado', async () => {
      const svc = new UsuariosService(
        makeRepo({
          findOne: async () => mockUser({ resetToken: 'expired', resetExpires: Date.now() - 1000 }),
        }),
        log,
        cache,
        makeAuth(),
      )
      await expect(svc.resetPassword('expired', 'nuevaPass')).rejects.toThrow('Token inválido o expirado')
    })

    it('falla si el token es inválido (usuario no encontrado)', async () => {
      const svc = new UsuariosService(makeRepo(), log, cache, makeAuth())
      await expect(svc.resetPassword('invalid-token', 'nuevaPass')).rejects.toThrow('Token inválido o expirado')
    })
  })

  // ── LIST ──────────────────────────────────────────────────────

  describe('list', () => {
    it('filtra password, token, resetToken y resetExpires de los resultados', async () => {
      const svc = new UsuariosService(
        makeRepo({
          findMany: async () => [
            mockUser({ password: HASH_SECRETO, token: 'tok1', resetToken: 'rt1', resetExpires: 999 }),
          ],
        }),
        log,
        cache,
        makeAuth(),
      )
      const users = await svc.list('h1')
      expect(users).toHaveLength(1)
      expect(users[0]).not.toHaveProperty('password')
      expect(users[0]).not.toHaveProperty('token')
      expect(users[0]).not.toHaveProperty('resetToken')
      expect(users[0]).not.toHaveProperty('resetExpires')
      expect(users[0].id).toBe('u1')
      expect(users[0].name).toBe('Ana')
    })
  })

  // ── CREATE ────────────────────────────────────────────────────

  describe('create', () => {
    it('hashea el password y retorna usuario sin campos sensibles', async () => {
      const svc = new UsuariosService(makeRepo(), log, cache, makeAuth())
      const u = await svc.create({ name: 'Ana', email: 'ana@test.com', password: 'secreto', hotelId: 'h1' })
      expect(u.id).toBe('u1')
      expect(u.password).toBeUndefined()
      expect(u.token).toBeUndefined()
    })

    it('lanza error si no se provee password', async () => {
      const svc = new UsuariosService(makeRepo(), log, cache, makeAuth())
      await expect(svc.create({ name: 'Ana', email: 'ana@test.com' })).rejects.toThrow('Password is required')
    })

    it('persiste el teléfono como dígitos planos', async () => {
      let captured: any = null
      const svc = new UsuariosService(
        makeRepo({ create: async (d: any) => { captured = d; return { ...d, id: 'u1' } } }),
        log,
        cache,
        makeAuth(),
      )
      await svc.create({ name: 'Ana', email: 'a@t.com', password: 'secreto', phone: '+1 (809) 555-0001' })
      expect(captured.phone).toBe('8095550001')
    })
  })

  // ── UPDATE ────────────────────────────────────────────────────

  describe('update', () => {
    it('whitelist filtra hotelId del update pero permite role (FC-B2 gestión de equipo)', async () => {
      let capturedData: any = null
      const svc = new UsuariosService(
        makeRepo({
          update: async (id: string, data: any) => { capturedData = data; return { ...data, id } },
        }),
        log,
        cache,
        makeAuth(),
      )
      await svc.update('u1', { name: 'Ana Updated', email: 'nuevo@test.com', role: 'receptionist', hotelId: 'h2' })
      expect(capturedData.name).toBe('Ana Updated')
      expect(capturedData.email).toBe('nuevo@test.com')
      expect(capturedData.role).toBe('receptionist')
      // hotelId nunca debe poder cambiarse desde el service.update (multi-tenant protection)
      expect(capturedData).not.toHaveProperty('hotelId')
    })

    it('filtra campos sensibles de la respuesta', async () => {
      const svc = new UsuariosService(
        makeRepo({
          update: async (id: string, data: any) => ({
            ...data, id, token: 'tok', resetToken: 'rt', resetExpires: 999,
          }),
        }),
        log,
        cache,
        makeAuth(),
      )
      const result = await svc.update('u1', { name: 'Ana' })
      expect(result).not.toHaveProperty('password')
      expect(result).not.toHaveProperty('token')
      expect(result).not.toHaveProperty('resetToken')
      expect(result).not.toHaveProperty('resetExpires')
      expect(result.id).toBe('u1')
    })

    it('persiste el teléfono como dígitos planos', async () => {
      let captured: any = null
      const svc = new UsuariosService(
        makeRepo({ update: async (id: string, d: any) => { captured = d; return { ...d, id } } }),
        log,
        cache,
        makeAuth(),
      )
      await svc.update('u1', { phone: '+1 809 555 0001' })
      expect(captured.phone).toBe('8095550001')
    })

    it('un update sin phone no toca el teléfono guardado', async () => {
      let captured: any = null
      const svc = new UsuariosService(
        makeRepo({ update: async (id: string, d: any) => { captured = d; return { ...d, id } } }),
        log,
        cache,
        makeAuth(),
      )
      await svc.update('u1', { name: 'Ana' })
      expect(captured.phone).toBeUndefined()
    })
  })

  // ── ME ────────────────────────────────────────────────────────

  describe('me', () => {
    it('retorna datos del usuario existente', async () => {
      const svc = new UsuariosService(
        makeRepo({ findById: async () => mockUser() }),
        log,
        cache,
        makeAuth(),
      )
      const u = await svc.me('u1')
      expect(u.id).toBe('u1')
      expect(u.name).toBe('Ana')
      expect(u.email).toBe('ana@test.com')
    })

    it('lananza NotFound si el usuario no existe', async () => {
      const svc = new UsuariosService(makeRepo(), log, cache, makeAuth())
      await expect(svc.me('no-existe')).rejects.toThrow('Usuario no encontrado')
    })
  })

  // ── DELETE ────────────────────────────────────────────────────

  describe('delete', () => {
    it('retorna true', async () => {
      const svc = new UsuariosService(makeRepo(), log, cache, makeAuth())
      expect(await svc.delete('x')).toBe(true)
    })
  })
})
