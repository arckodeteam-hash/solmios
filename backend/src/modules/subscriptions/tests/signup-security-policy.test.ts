// REQ-CFG-05: la política de contraseña configurable por el admin (configuration
// hotelId='platform', key='security_policy') también rige el alta pública. Se SUMA al
// piso estático de `shared/password-policy` (10 caracteres + composición): puede exigir
// más, nunca relajarlo.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { SignupUseCase } from '../usecases/signup'
import type { RepositoryAdapter } from 'arckode-framework'

const NOW = new Date('2026-07-19T12:00:00Z')

/** `policy` es el objeto tal cual lo guarda la columna json (no string). `undefined` = sin cablear. */
function setup(policy?: Record<string, unknown>) {
  const hotels: any[] = []
  const users: any[] = []
  const calls = { hotelsCreate: 0, usersCreate: 0 }
  const repo = (store: any[], onCreate?: () => void): RepositoryAdapter<any> => ({
    create: async (row: any) => { onCreate?.(); store.push(row); return row },
    findMany: async (f: any = {}) => store.filter(r =>
      Object.entries(f).every(([k, v]) => r[k] === v)),
  } as unknown as RepositoryAdapter<any>)

  const configRepo = policy === undefined ? undefined : ({
    findMany: async () => [{ value: policy }],
  } as unknown as RepositoryAdapter<any>)

  const uc = new SignupUseCase({
    hotelsRepo: repo(hotels, () => { calls.hotelsCreate++ }),
    usersRepo: repo(users, () => { calls.usersCreate++ }),
    rolesRepo: repo([]),
    subscriptionsRepo: repo([]),
    plansRepo: repo([]),
    hashPassword: async (p: string) => `hashed:${p}`,
    logger: silentLogger(),
    configRepo,
  })
  return { uc, calls }
}

/** 10 caracteres exactos, con mayúscula/minúscula/número: pasa el piso estático justo. */
const INPUT = { hotelName: 'Hotel Prueba', email: 'dueño@ejemplo.com', password: 'Abcdefghi1' }

describe('SignupUseCase — política de contraseña configurable (REQ-CFG-05)', () => {
  it('con minLength 12 rechaza una clave de 10 que sí pasa el piso estático, sin crear nada', async () => {
    const { uc, calls } = setup({ minLength: 12, requireNumbers: true })
    await expect(uc.signup(INPUT, NOW)).rejects.toThrow('al menos 12 caracteres')
    expect(calls.hotelsCreate).toBe(0)
    expect(calls.usersCreate).toBe(0)
  })

  it('con minLength 10 + requireNumbers la misma clave procede', async () => {
    const { uc, calls } = setup({ minLength: 10, requireNumbers: true })
    await uc.signup(INPUT, NOW)
    expect(calls.usersCreate).toBe(1)
  })

  it('sin configRepo cableado rige el default: no agrega nada al piso estático', async () => {
    const { uc, calls } = setup(undefined)
    await uc.signup(INPUT, NOW)
    expect(calls.usersCreate).toBe(1)
  })

  it('una política más floja que el piso (minLength 6) NO relaja los 10 del alta', async () => {
    const { uc, calls } = setup({ minLength: 6 })
    await expect(uc.signup({ ...INPUT, password: 'Abcdef' }, NOW)).rejects.toThrow('no es segura')
    expect(calls.usersCreate).toBe(0)
  })
})
