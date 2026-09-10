// Espejo de backend/src/shared/usecases/password-policy.ts. Si estos tests y
// los del backend dejan de coincidir, el formulario muestra una regla y el
// servidor aplica otra: el usuario se entera recién al apretar el botón.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { httpGet } = vi.hoisted(() => ({ httpGet: vi.fn() }))

vi.mock('@/services/http', () => ({
  http: { get: httpGet },
  ApiError: class ApiError extends Error {},
}))

import {
  DEFAULT_PASSWORD_POLICY,
  describePasswordPolicy,
  checkPasswordPolicy,
  fetchPasswordPolicy,
  generateCompliantPassword,
  type PasswordPolicy,
} from './usePasswordPolicy'

const ALL: PasswordPolicy = { minLength: 12, requireUppercase: true, requireNumbers: true, requireSpecial: true }

describe('describePasswordPolicy', () => {
  it('con el default solo habla del largo', () => {
    expect(describePasswordPolicy(DEFAULT_PASSWORD_POLICY)).toBe('Mínimo 6 caracteres')
  })

  it('agrega los requisitos activos', () => {
    expect(describePasswordPolicy({ minLength: 10, requireUppercase: false, requireNumbers: true, requireSpecial: false }))
      .toBe('Mínimo 10 caracteres, con al menos un número')
    expect(describePasswordPolicy({ minLength: 10, requireUppercase: true, requireNumbers: true, requireSpecial: false }))
      .toBe('Mínimo 10 caracteres, con al menos una mayúscula y un número')
    expect(describePasswordPolicy(ALL))
      .toBe('Mínimo 12 caracteres, con al menos una mayúscula, un número y un carácter especial')
  })

  it('el piso de la pantalla manda si es mayor que la política', () => {
    expect(describePasswordPolicy({ ...DEFAULT_PASSWORD_POLICY, minLength: 6 }, 10)).toBe('Mínimo 10 caracteres')
    expect(describePasswordPolicy({ ...DEFAULT_PASSWORD_POLICY, minLength: 12 }, 10)).toBe('Mínimo 12 caracteres')
  })
})

describe('checkPasswordPolicy', () => {
  it('devuelve los mismos mensajes que el backend, en el mismo orden', () => {
    expect(checkPasswordPolicy('Ab1!', ALL)).toBe('La contraseña debe tener al menos 12 caracteres')
    expect(checkPasswordPolicy('a'.repeat(129), DEFAULT_PASSWORD_POLICY)).toBe('La contraseña no puede superar los 128 caracteres')
    expect(checkPasswordPolicy('abcdefghijk1!', ALL)).toBe('La contraseña debe tener al menos una mayúscula')
    expect(checkPasswordPolicy('Abcdefghijkl!', ALL)).toBe('La contraseña debe tener al menos un número')
    expect(checkPasswordPolicy('Abcdefghijk1', ALL)).toBe('La contraseña debe tener al menos un carácter especial')
    expect(checkPasswordPolicy('Abcdefghijk1!', ALL)).toBeNull()
  })

  it('acepta cuando cumple y señala lo que falta', () => {
    const p: PasswordPolicy = { minLength: 10, requireUppercase: false, requireNumbers: true, requireSpecial: false }
    expect(checkPasswordPolicy('abcdefghij', p)).toBe('La contraseña debe tener al menos un número')
    expect(checkPasswordPolicy('Abcdefghi1', p)).toBeNull()
  })

  it('el piso se aplica al largo mínimo', () => {
    expect(checkPasswordPolicy('Abc123', DEFAULT_PASSWORD_POLICY, 10)).toBe('La contraseña debe tener al menos 10 caracteres')
    expect(checkPasswordPolicy('Abc1234567', DEFAULT_PASSWORD_POLICY, 10)).toBeNull()
  })

  it('no exige mayúscula/número/especial si la política no lo pide', () => {
    expect(checkPasswordPolicy('abcdef', DEFAULT_PASSWORD_POLICY)).toBeNull()
  })
})

describe('fetchPasswordPolicy', () => {
  beforeEach(() => { httpGet.mockReset() })

  it('lee GET /auth/password-policy y normaliza', async () => {
    httpGet.mockResolvedValue({ minLength: 99, requireUppercase: 1, requireNumbers: 'yes', requireSpecial: 0 })
    const p = await fetchPasswordPolicy()
    expect(httpGet).toHaveBeenCalledWith('/auth/password-policy')
    expect(p).toEqual({ minLength: 32, requireUppercase: true, requireNumbers: true, requireSpecial: false })
  })

  it('recorta el largo hacia abajo también', async () => {
    httpGet.mockResolvedValue({ minLength: 2 })
    expect((await fetchPasswordPolicy()).minLength).toBe(6)
  })

  it('basura → default', async () => {
    httpGet.mockResolvedValue('nada')
    expect(await fetchPasswordPolicy()).toEqual(DEFAULT_PASSWORD_POLICY)
    httpGet.mockResolvedValue({ minLength: 'x' })
    expect(await fetchPasswordPolicy()).toEqual(DEFAULT_PASSWORD_POLICY)
  })

  it('si el backend falla rige el default: la pantalla no se rompe', async () => {
    httpGet.mockRejectedValue(new Error('500'))
    expect(await fetchPasswordPolicy()).toEqual(DEFAULT_PASSWORD_POLICY)
  })
})

describe('generateCompliantPassword', () => {
  it('cumple la política más estricta, siempre', () => {
    for (let i = 0; i < 50; i++) {
      const pwd = generateCompliantPassword(ALL)
      expect(pwd).toHaveLength(12)
      expect(checkPasswordPolicy(pwd, ALL)).toBeNull()
    }
  })

  it('con el default genera al menos 8 caracteres alfanuméricos', () => {
    const pwd = generateCompliantPassword(DEFAULT_PASSWORD_POLICY)
    expect(pwd).toHaveLength(8)
    expect(pwd).toMatch(/^[A-Za-z0-9]+$/)
    expect(checkPasswordPolicy(pwd, DEFAULT_PASSWORD_POLICY)).toBeNull()
  })

  it('respeta un largo pedido mayor que el mínimo', () => {
    expect(generateCompliantPassword(DEFAULT_PASSWORD_POLICY, 16)).toHaveLength(16)
  })
})
