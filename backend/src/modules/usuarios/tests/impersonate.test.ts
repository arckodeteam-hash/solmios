// impersonate.test.ts — Impersonación real del super admin.
import { describe, it, expect, vi, beforeEach } from 'bun:test'
import { jwtTokenAdapter } from 'arckode-framework/adapters/jwt'
import { impersonateUser, IMPERSONATION_TTL } from '../usecases/impersonate'
import { HotelAuth } from '../../../infrastructure/auth/hotel-auth'

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
      role: 'super_admin',
      hotelId: 'h1',
      userType: 'merchant',
      impersonatedBy: 'admin-1',
    }, IMPERSONATION_TTL)
    expect(IMPERSONATION_TTL).toBe('2h')
  })

  it('devuelve el rol REAL del target (no el del token), permisos totales y el nombre del hotel', async () => {
    const result = await impersonateUser({ repo, hotelRepo, auth }, ADMIN, 'u1')

    // El token va con role super_admin (bypass de permisos), pero el user devuelto
    // lleva el rol real: es lo que muestra la franja de aviso en la UI.
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
    const token = auth.createToken({ id: 'u1', role: 'super_admin', hotelId: 'h1', userType: 'merchant', impersonatedBy: 'admin-1' }, '2h')
    expect(auth.verifyToken(token).impersonatedBy).toBe('admin-1')
  })

  it('un token normal devuelve impersonatedBy undefined', () => {
    const token = auth.createToken({ id: 'u1', role: 'hotel_admin', hotelId: 'h1' })
    expect(auth.verifyToken(token).impersonatedBy).toBeUndefined()
  })
})
