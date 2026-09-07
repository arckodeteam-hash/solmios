import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock del service: el store no debe pegarle a la API real en tests.
vi.mock('@/services/Auth.service', () => ({
  AuthService: {
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    me: vi.fn(),
    impersonate: vi.fn(),
  },
  // El store la llama al salir de la impersonación (la lista de propiedades del cliente no
  // puede sobrevivir a la vuelta a la cuenta del admin).
  clearHotelsCache: vi.fn(),
}))

// auth.store importa modules.store (logout lo resetea) → mockear su service también.
vi.mock('@/services/Platform.service', () => ({
  ModulesService: {
    enabled: vi.fn(),
  },
}))

import { useAuthStore } from './auth.store'
import { useModulesStore } from './modules.store'
import { AuthService, clearHotelsCache } from '@/services/Auth.service'
import type { User } from '@/types'

const makeUser = (role: string): User =>
  ({ id: 'u1', name: 'Test', email: 't@h.com', role, hotelName: 'Hotel Demo' } as unknown as User)

const makeTarget = (): User =>
  ({ id: 'u-target', name: 'Cliente', email: 'c@h.com', role: 'hotel_admin', hotelName: 'Hotel Cliente', permissions: ['*:*'] } as unknown as User)

/** Deja al store con una sesión de super admin viva (token + refresh + user en localStorage). */
function seedSuperAdminSession(store: ReturnType<typeof useAuthStore>) {
  store.setTokens('admin-tok', 'admin-ref')
  store.user = makeUser('super_admin')
  localStorage.setItem('user', JSON.stringify(store.user))
}

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

  it('loginAs pide el token de impersonación al backend y pasa a la sesión del cliente', async () => {
    vi.mocked(AuthService.impersonate).mockResolvedValue({ token: 'imp-tok', user: makeTarget() })
    const store = useAuthStore()
    seedSuperAdminSession(store)
    expect(store.canAccessSuperAdmin).toBe(true)

    await store.loginAs('u-target')

    // El JWT tiene que ser el NUEVO: antes se pisaba sólo user.value y el backend seguía
    // respondiendo con los datos del super admin.
    expect(AuthService.impersonate).toHaveBeenCalledWith('u-target')
    expect(store.token).toBe('imp-tok')
    expect(localStorage.getItem('token')).toBe('imp-tok')
    expect(store.impersonating).toBe(true)
    expect(store.userRole).toBe('hotel_admin')
    expect(store.canAccessSuperAdmin).toBe(false)
  })

  it('loginAs borra el refreshToken del localStorage (el de impersonación no tiene refresh)', async () => {
    vi.mocked(AuthService.impersonate).mockResolvedValue({ token: 'imp-tok', user: makeTarget() })
    const store = useAuthStore()
    seedSuperAdminSession(store)

    await store.loginAs('u-target')

    // Si el refresh del ADMIN quedara en su lugar, al vencer el access token http.ts renovaría
    // con él y la sesión volvería a ser la del super admin en silencio, con la franja todavía
    // diciendo que es la del cliente.
    expect(store.refreshToken).toBeNull()
    expect(localStorage.getItem('refreshToken')).toBeNull()
  })

  it('loginAs guarda la sesión del admin en las claves imp.* (es la única forma de volver)', async () => {
    vi.mocked(AuthService.impersonate).mockResolvedValue({ token: 'imp-tok', user: makeTarget() })
    const store = useAuthStore()
    seedSuperAdminSession(store)

    await store.loginAs('u-target')

    expect(localStorage.getItem('imp.adminToken')).toBe('admin-tok')
    expect(localStorage.getItem('imp.adminRefreshToken')).toBe('admin-ref')
    expect(JSON.parse(localStorage.getItem('imp.adminUser')!).role).toBe('super_admin')
  })

  it('loginAs es no-op si el usuario no es super_admin (regla de negocio)', async () => {
    const store = useAuthStore()
    store.user = makeUser('hotel_admin')

    await store.loginAs('u-target')

    expect(AuthService.impersonate).not.toHaveBeenCalled()
    expect(store.impersonating).toBe(false)
    expect(store.userRole).toBe('hotel_admin')
  })

  it('stopImpersonation restaura la sesión del admin y limpia las claves imp.*', async () => {
    vi.mocked(AuthService.impersonate).mockResolvedValue({ token: 'imp-tok', user: makeTarget() })
    vi.mocked(AuthService.me).mockResolvedValue(makeUser('super_admin'))
    const store = useAuthStore()
    seedSuperAdminSession(store)
    await store.loginAs('u-target')

    await store.stopImpersonation()

    expect(store.impersonating).toBe(false)
    expect(store.userRole).toBe('super_admin')
    expect(store.token).toBe('admin-tok')
    expect(localStorage.getItem('token')).toBe('admin-tok')
    expect(store.refreshToken).toBe('admin-ref')
    expect(localStorage.getItem('refreshToken')).toBe('admin-ref')
    expect(localStorage.getItem('imp.adminToken')).toBeNull()
    expect(localStorage.getItem('imp.adminRefreshToken')).toBeNull()
    expect(localStorage.getItem('imp.adminUser')).toBeNull()
  })

  it('stopImpersonation sin sesión de admin guardada desloguea (no deja al usuario atrapado)', async () => {
    const store = useAuthStore()
    store.setTokens('imp-tok', 'x')
    store.user = makeUser('hotel_admin')
    store.impersonating = true
    localStorage.removeItem('imp.adminToken')

    await store.stopImpersonation()

    expect(AuthService.logout).toHaveBeenCalled()
    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
    expect(store.impersonating).toBe(false)
  })

  it('restoreSession deja impersonating en true si /auth/me trae impersonatedBy (sobrevive al F5)', async () => {
    vi.mocked(AuthService.me).mockResolvedValue({ ...makeTarget(), impersonatedBy: 'super-1' } as User)
    const store = useAuthStore()
    store.setTokens('imp-tok', 'x')
    localStorage.setItem('imp.adminUser', JSON.stringify(makeUser('super_admin')))

    await store.restoreSession()

    // El claim viene firmado en el token: es la fuente de verdad, no una bandera del navegador.
    expect(store.impersonating).toBe(true)
    expect(store.canAccessSuperAdmin).toBe(false)
  })

  it('restoreSession mantiene impersonating aunque /auth/me falle y el user cacheado no traiga impersonatedBy', async () => {
    // Camino real tras un F5 con la red con hipo. El cache de `user` es el perfil PELADO del
    // cliente —lo que dejaba una sesión vieja, sin `impersonatedBy`— y AuthService.me() rechaza:
    // la ÚNICA señal viva de que hay una impersonación en curso es la sesión del admin aparcada
    // en `imp.adminToken`. Sin la cláusula `!!localStorage.getItem(IMP_TOKEN)`, `impersonating`
    // cae a false con el token de impersonación todavía instalado: sin franja ni botón de salir,
    // el admin queda operando la cuenta del cliente sin saberlo ni poder volver.
    vi.mocked(AuthService.me).mockRejectedValue(new Error('network'))
    const store = useAuthStore()
    store.setTokens('imp-tok', 'x')
    localStorage.setItem('user', JSON.stringify(makeTarget()))
    localStorage.setItem('imp.adminToken', 'admin-tok')
    localStorage.setItem('imp.adminRefreshToken', 'admin-ref')
    localStorage.setItem('imp.adminUser', JSON.stringify(makeUser('super_admin')))

    await store.restoreSession()

    expect(store.user?.impersonatedBy).toBeUndefined()
    expect(store.impersonating).toBe(true)
    expect(store.canAccessSuperAdmin).toBe(false)
    expect(store.userRole).toBe('hotel_admin')
  })

  it('stopImpersonation sin imp.adminUser vuelve al perfil del admin en memoria, no al del cliente', async () => {
    // /auth/me caído + snapshot del admin ausente: si se dejara `user.value` como estaba, la UI
    // mostraría al CLIENTE con el token del ADMIN. `originalUser` (lo que guardó loginAs) es el respaldo.
    vi.mocked(AuthService.impersonate).mockResolvedValue({ token: 'imp-tok', user: makeTarget() })
    const store = useAuthStore()
    seedSuperAdminSession(store)
    await store.loginAs('u-target')
    localStorage.removeItem('imp.adminUser')
    vi.mocked(AuthService.me).mockRejectedValue(new Error('network'))

    await store.stopImpersonation()

    expect(store.impersonating).toBe(false)
    expect(store.userRole).toBe('super_admin')
    expect(store.token).toBe('admin-tok')
    expect(JSON.parse(localStorage.getItem('user')!).role).toBe('super_admin')
  })

  it('stopImpersonation desloguea si no hay perfil de admin reconstruible y /auth/me falla', async () => {
    // Store recién hidratado tras un F5 (sin `originalUser` en memoria), sin snapshot del admin y
    // con la red caída: no hay forma honesta de saber quién es el dueño del token → sesión desde cero.
    vi.mocked(AuthService.me).mockRejectedValue(new Error('network'))
    const store = useAuthStore()
    store.setTokens('imp-tok', 'x')
    store.user = makeTarget()
    store.impersonating = true
    localStorage.setItem('imp.adminToken', 'admin-tok')

    await store.stopImpersonation()

    expect(AuthService.logout).toHaveBeenCalled()
    expect(store.user).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(store.impersonating).toBe(false)
    expect(localStorage.getItem('user')).toBeNull()
  })

  it('stopImpersonation no persiste un imp.adminUser corrupto (no rompe el restoreSession siguiente)', async () => {
    // Antes se escribía el string crudo en localStorage['user']: el `JSON.parse` de restoreSession
    // reventaba y forzaba un logout() completo, o sea el admin perdía la sesión por un dato de más.
    vi.mocked(AuthService.me).mockResolvedValue(makeUser('super_admin'))
    const store = useAuthStore()
    store.setTokens('imp-tok', 'x')
    store.user = makeTarget()
    store.impersonating = true
    localStorage.setItem('imp.adminToken', 'admin-tok')
    localStorage.setItem('imp.adminUser', '{ esto no es json')

    await store.stopImpersonation()

    expect(store.userRole).toBe('super_admin')
    expect(() => JSON.parse(localStorage.getItem('user')!)).not.toThrow()
    expect(JSON.parse(localStorage.getItem('user')!).role).toBe('super_admin')
  })

  it('stopImpersonation limpia el cache de hoteles (el admin no vuelve viendo las propiedades del cliente)', async () => {
    vi.mocked(AuthService.impersonate).mockResolvedValue({ token: 'imp-tok', user: makeTarget() })
    vi.mocked(AuthService.me).mockResolvedValue(makeUser('super_admin'))
    const store = useAuthStore()
    seedSuperAdminSession(store)
    await store.loginAs('u-target')

    await store.stopImpersonation()

    expect(clearHotelsCache).toHaveBeenCalled()
  })

  it('restoreSession deja impersonating en false en una sesión normal', async () => {
    vi.mocked(AuthService.me).mockResolvedValue(makeUser('super_admin'))
    const store = useAuthStore()
    store.setTokens('tok', 'ref')

    await store.restoreSession()

    expect(store.impersonating).toBe(false)
    expect(store.canAccessSuperAdmin).toBe(true)
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

  it('logout borra también las claves imp.* (la sesión del admin no queda tirada en el navegador)', async () => {
    const store = useAuthStore()
    localStorage.setItem('imp.adminToken', 'admin-tok')
    localStorage.setItem('imp.adminRefreshToken', 'admin-ref')
    localStorage.setItem('imp.adminUser', JSON.stringify(makeUser('super_admin')))

    await store.logout()

    expect(localStorage.getItem('imp.adminToken')).toBeNull()
    expect(localStorage.getItem('imp.adminRefreshToken')).toBeNull()
    expect(localStorage.getItem('imp.adminUser')).toBeNull()
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
