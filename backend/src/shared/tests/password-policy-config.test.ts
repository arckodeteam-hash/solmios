// La política configurable la fija el admin en Configuration. Si la lectura
// falla o el valor es basura, rige el default: nunca se queda sin política.
import { describe, it, expect } from 'bun:test'
import { ValidationError } from 'arckode-framework'
import {
  DEFAULT_PASSWORD_POLICY, SECURITY_POLICY_KEY,
  normalizePasswordPolicy, readPasswordPolicy, validatePassword,
  assertPasswordPolicy, passwordPolicyHandler,
} from '../usecases/password-policy'
import { PASSWORD_MAX } from '../password-policy'

const repoWith = (value: unknown) => ({
  findMany: async (f: any) => {
    expect(f).toEqual({ hotelId: 'platform', key: SECURITY_POLICY_KEY })
    return value === undefined ? [] : [{ id: '1', hotelId: 'platform', key: SECURITY_POLICY_KEY, value }]
  },
})

describe('readPasswordPolicy', () => {
  it('sin fila devuelve el default', async () => {
    expect(await readPasswordPolicy(repoWith(undefined))).toEqual(DEFAULT_PASSWORD_POLICY)
  })

  it('sin repo o con error de lectura devuelve el default', async () => {
    expect(await readPasswordPolicy(null)).toEqual(DEFAULT_PASSWORD_POLICY)
    expect(await readPasswordPolicy({ findMany: async () => { throw new Error('db caída') } })).toEqual(DEFAULT_PASSWORD_POLICY)
  })

  it('lee el value como string JSON y como objeto', async () => {
    const policy = { minLength: 10, requireUppercase: true, requireNumbers: false, requireSpecial: true }
    expect(await readPasswordPolicy(repoWith(JSON.stringify(policy)))).toEqual(policy)
    expect(await readPasswordPolicy(repoWith(policy))).toEqual(policy)
  })

  it('acota minLength a [6, 32]', async () => {
    expect((await readPasswordPolicy(repoWith({ minLength: 3 }))).minLength).toBe(6)
    expect((await readPasswordPolicy(repoWith({ minLength: 99 }))).minLength).toBe(32)
    expect((await readPasswordPolicy(repoWith({ minLength: 'abc' }))).minLength).toBe(6)
  })
})

describe('normalizePasswordPolicy', () => {
  it('con null o basura devuelve el default', () => {
    expect(normalizePasswordPolicy(null)).toEqual(DEFAULT_PASSWORD_POLICY)
    expect(normalizePasswordPolicy('no es json')).toEqual(DEFAULT_PASSWORD_POLICY)
    expect(normalizePasswordPolicy(42)).toEqual(DEFAULT_PASSWORD_POLICY)
    expect(normalizePasswordPolicy([1, 2])).toEqual(DEFAULT_PASSWORD_POLICY)
  })

  it('redondea y castea los booleanos', () => {
    expect(normalizePasswordPolicy({ minLength: '8.4', requireNumbers: 1 })).toEqual({
      minLength: 8, requireUppercase: false, requireNumbers: true, requireSpecial: false,
    })
  })
})

describe('validatePassword', () => {
  it('rechaza por largo mínimo', () => {
    expect(validatePassword('abc', { ...DEFAULT_PASSWORD_POLICY, minLength: 8 }))
      .toBe('La contraseña debe tener al menos 8 caracteres')
  })

  it('rechaza por largo máximo', () => {
    expect(validatePassword('x'.repeat(PASSWORD_MAX + 1)))
      .toBe(`La contraseña no puede superar los ${PASSWORD_MAX} caracteres`)
  })

  it('exige mayúscula si la política lo pide', () => {
    expect(validatePassword('abcdefgh', { ...DEFAULT_PASSWORD_POLICY, requireUppercase: true }))
      .toBe('La contraseña debe tener al menos una mayúscula')
    expect(validatePassword('abcdefgÑ', { ...DEFAULT_PASSWORD_POLICY, requireUppercase: true })).toBeNull()
  })

  it('exige número si la política lo pide', () => {
    expect(validatePassword('abcdefgh', { ...DEFAULT_PASSWORD_POLICY, requireNumbers: true }))
      .toBe('La contraseña debe tener al menos un número')
  })

  it('exige carácter especial si la política lo pide', () => {
    expect(validatePassword('abcdefg1', { ...DEFAULT_PASSWORD_POLICY, requireSpecial: true }))
      .toBe('La contraseña debe tener al menos un carácter especial')
    expect(validatePassword('abcdefg!', { ...DEFAULT_PASSWORD_POLICY, requireSpecial: true })).toBeNull()
  })

  it('con minLength 10 y números: rechaza sin número y acepta la que cumple', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 10, requireNumbers: true }
    expect(validatePassword('abcdefghij', policy)).toBe('La contraseña debe tener al menos un número')
    expect(validatePassword('Abcdefghi1', policy)).toBeNull()
  })

  it('el default acepta 6 caracteres y rechaza 5', () => {
    expect(validatePassword('abcdef')).toBeNull()
    expect(validatePassword('abcde')).toBe('La contraseña debe tener al menos 6 caracteres')
  })
})

describe('assertPasswordPolicy', () => {
  it('lanza ValidationError con el motivo', async () => {
    const repo = repoWith({ minLength: 10, requireNumbers: true })
    let err: any
    try { await assertPasswordPolicy(repo, 'abcdefghij') } catch (e) { err = e }
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toBe('La contraseña debe tener al menos un número')
  })

  it('no lanza si cumple', async () => {
    await assertPasswordPolicy(repoWith({ minLength: 10, requireNumbers: true }), 'Abcdefghi1')
  })
})

describe('passwordPolicyHandler', () => {
  it('devuelve la política pública sin campos extra', async () => {
    const repo = repoWith({ minLength: 10, requireNumbers: true, secret: 'nope' })
    expect(await passwordPolicyHandler(repo)).toEqual({
      status: 200,
      body: { minLength: 10, requireUppercase: false, requireNumbers: true, requireSpecial: false },
    })
  })
})
