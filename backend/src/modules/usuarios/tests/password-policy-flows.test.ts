// usuarios/tests/password-policy-flows.test.ts — La política configurable (REQ-CFG-05) gatea
// TODOS los flujos que fijan contraseña: alta, edición, reset por token y cambio propio.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth, Logger } from 'arckode-framework'
import { AuthError } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { UsuariosService } from '../service'
import { resetPassword, changePassword } from '../usecases/password'
import { passwordPolicyHandler } from '../../../shared/usecases/password-policy'

/* ---------- helpers (mismos dobles que service.test.ts) ---------- */

const log: Logger = silentLogger()
const cache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

function makeAuth(): Auth {
  return {
    createToken: () => 'jwt-token-fake',
    createRefreshToken: () => 'jwt-refresh-fake',
    assertOwnership: () => {},
    authenticate: () => [],
    hashPassword: async (p: string) => p,
    verifyPassword: async () => true,
  } as unknown as Auth
}

/** Repo con contadores: lo que importa es que un rechazo NO llegue a escribir. */
function makeRepo(overrides: Partial<RepositoryAdapter<any>> = {}) {
  const calls = { create: [] as any[], update: [] as any[] }
  const repo: RepositoryAdapter<any> = {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (d: any) => { calls.create.push(d); return { ...d, id: 'u1' } },
    update: async (id: string, d: any) => { calls.update.push({ id, d }); return { ...d, id } },
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
  return { repo, calls }
}

/** Política guardada por el admin: 10 caracteres y al menos un número. */
const configRepo = {
  findMany: async () => [{ value: JSON.stringify({ minLength: 10, requireNumbers: true }) }],
} as unknown as RepositoryAdapter<any>

function mockUser(overrides: Record<string, any> = {}) {
  return { id: 'u1', name: 'Ana', email: 'ana@test.com', password: 'actual', role: 'hotel_admin', hotelId: 'h1', token: null, resetToken: null, resetExpires: null, active: 1, ...overrides }
}

function makeService(repo: RepositoryAdapter<any>) {
  return new UsuariosService(repo, log, cache, makeAuth(), undefined, configRepo)
}

describe('password policy en los flujos de contraseña', () => {
  describe('service.create', () => {
    it('rechaza una clave sin número y no crea el usuario', async () => {
      const { repo, calls } = makeRepo()
      const svc = makeService(repo)
      await expect(svc.create({ name: 'Ana', email: 'ana@test.com', password: 'abcdefghij', role: 'receptionist' }))
        .rejects.toThrow(/al menos un número/)
      expect(calls.create.length).toBe(0)
    })

    it('acepta una clave que cumple y la guarda hasheada', async () => {
      const { repo, calls } = makeRepo()
      const svc = makeService(repo)
      const out = await svc.create({ name: 'Ana', email: 'ana@test.com', password: 'Abcdefghi1', role: 'receptionist' })
      expect(calls.create.length).toBe(1)
      expect(calls.create[0].password).not.toBe('Abcdefghi1')
      expect(calls.create[0].password.startsWith('$2')).toBe(true)
      expect(out.password).toBeUndefined()
    })
  })

  describe('service.update', () => {
    it('rechaza una clave que viola la política y no escribe', async () => {
      const { repo, calls } = makeRepo({ findById: async () => mockUser() })
      const svc = makeService(repo)
      await expect(svc.update('u1', { password: 'abcdefghij' }, { id: 'u1', role: 'hotel_admin' }))
        .rejects.toThrow(/al menos un número/)
      expect(calls.update.length).toBe(0)
    })
  })

  describe('resetPassword', () => {
    const validReset = () => mockUser({ resetToken: 'tok', resetExpires: Date.now() + 60_000 })

    it('rechaza la clave nueva que viola la política y no escribe', async () => {
      const { repo, calls } = makeRepo({ findOne: async () => validReset() })
      await expect(resetPassword(repo, 'tok', 'abcdefghij', configRepo)).rejects.toThrow(/al menos un número/)
      expect(calls.update.length).toBe(0)
    })

    it('acepta la clave nueva que cumple', async () => {
      const { repo, calls } = makeRepo({ findOne: async () => validReset() })
      await resetPassword(repo, 'tok', 'Abcdefghi1', configRepo)
      expect(calls.update.length).toBe(1)
      expect(calls.update[0].d.resetToken).toBeNull()
    })
  })

  describe('changePassword', () => {
    it('rechaza la clave nueva que viola la política', async () => {
      const { repo, calls } = makeRepo({ findById: async () => mockUser() })
      await expect(changePassword(repo, 'u1', 'actual', 'abcdefghij', configRepo)).rejects.toThrow(/al menos un número/)
      expect(calls.update.length).toBe(0)
    })

    it('con la clave actual incorrecta lanza AuthError antes de mirar la política', async () => {
      const { repo, calls } = makeRepo({ findById: async () => mockUser() })
      await expect(changePassword(repo, 'u1', 'otra', 'abcdefghij', configRepo)).rejects.toBeInstanceOf(AuthError)
      expect(calls.update.length).toBe(0)
    })

    it('sin configRepo rige el default (6 caracteres)', async () => {
      const { repo, calls } = makeRepo({ findById: async () => mockUser() })
      await changePassword(repo, 'u1', 'actual', 'abcdef')
      expect(calls.update.length).toBe(1)
      await expect(changePassword(repo, 'u1', 'actual', 'abcde')).rejects.toThrow(/al menos 6 caracteres/)
      expect(calls.update.length).toBe(1)
    })
  })

  describe('passwordPolicyHandler', () => {
    it('devuelve la política normalizada (público, sin secretos)', async () => {
      expect(await passwordPolicyHandler(configRepo)).toEqual({
        status: 200,
        body: { minLength: 10, requireUppercase: false, requireNumbers: true, requireSpecial: false },
      })
    })
  })
})
