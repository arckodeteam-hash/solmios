import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock del service: el store no debe pegarle a la API real en tests.
vi.mock('@/services/Auth.service', () => ({
  AuthService: {
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    me: vi.fn(),
  },
}))

// auth.store importa modules.store (logout lo resetea) → mockear su service también.
vi.mock('@/services/Platform.service', () => ({
  ModulesService: {
    enabled: vi.fn(),
  },
}))

import { useAuthStore } from './auth.store'
import { useModulesStore } from './modules.store'
import { AuthService } from '@/services/Auth.service'
import type { User } from '@/types'

const makeUser = (role: string): User =>
  ({ id: 'u1', name: 'Test', email: 't@h.com', role, hotelName: 'Hotel Demo' } as unknown as User)

describe('auth.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('arranca sin sesión', () => {
    const store = useAuthStore()
    expect(store.isAuthenticated).toBe(false)
    expect(store.userRole).toBeNull()
    expect(store.isSuperAdmin).toBe(false)
  })

  it('login setea token, user y persiste en localStorage', async () => {
    vi.mocked(AuthService.login).mockResolvedValue({
      token: 'tok', refreshToken: 'ref', user: makeUser('hotel_admin'),
    } as any)
    const store = useAuthStore()

    await store.login('t@h.com', 'pw')

    expect(store.isAuthenticated).toBe(true)
    expect(store.userRole).toBe('hotel_admin')
    expect(store.isHotelAdmin).toBe(true)
    expect(localStorage.getItem('token')).toBe('tok')
    expect(localStorage.getItem('refreshToken')).toBe('ref')
  })

  it('getters de rol reflejan el usuario actual', () => {
    const store = useAuthStore()
    store.user = makeUser('super_admin')
    expect(store.isSuperAdmin).toBe(true)
    expect(store.isReceptionist).toBe(false)
    expect(store.currentHotel).toBe('Hotel Demo')
  })

  it('canAccessSuperAdmin es false mientras se impersona', () => {
    const store = useAuthStore()
    store.user = makeUser('super_admin')
    expect(store.canAccessSuperAdmin).toBe(true)

    store.loginAs(makeUser('hotel_admin'))
    expect(store.impersonating).toBe(true)
    expect(store.userRole).toBe('hotel_admin')
    expect(store.canAccessSuperAdmin).toBe(false)
  })

  it('loginAs es no-op si el usuario no es super_admin (regla de negocio)', () => {
    const store = useAuthStore()
    store.user = makeUser('hotel_admin')
    store.loginAs(makeUser('receptionist'))
    expect(store.impersonating).toBe(false)
    expect(store.userRole).toBe('hotel_admin')
  })

  it('stopImpersonation restaura el usuario original', () => {
    const store = useAuthStore()
    store.user = makeUser('super_admin')
    store.loginAs(makeUser('hotel_admin'))
    store.stopImpersonation()
    expect(store.impersonating).toBe(false)
    expect(store.userRole).toBe('super_admin')
  })

  it('setTokens actualiza token y autenticación', () => {
    const store = useAuthStore()
    store.setTokens('a', 'b')
    expect(store.isAuthenticated).toBe(true)
    expect(localStorage.getItem('token')).toBe('a')
  })

  it('logout limpia estado y localStorage aunque el service falle', async () => {
    vi.mocked(AuthService.logout).mockRejectedValueOnce(new Error('network'))
    const store = useAuthStore()
    store.setTokens('a', 'b')
    store.user = makeUser('hotel_admin')

    await store.logout()

    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('logout resetea el store de módulos (el menú del hotel viejo no sobrevive al login siguiente)', async () => {
    const store = useAuthStore()
    const modules = useModulesStore()
    // Estado stale del hotel anterior: CRM apagado para ese hotel/plan.
    modules.state = { crm: false }
    expect(modules.enabled('crm')).toBe(false)

    await store.logout()

    // Sin reset, un login en otro hotel (o con otro plan) heredaba este estado hasta recargar.
    expect(modules.enabled('crm')).toBe(true)
  })
})
