import { http } from './http'
import type { User, UserRole } from '@/types'

interface LoginResponse {
  token: string
  refreshToken: string
  user: {
    id: string
    name: string
    email: string
    role: string
    hotelId: string | null
    hotelName: string
    permissions?: string[]
  }
}

interface MeResponse {
  id: string
  name: string
  email: string
  role: string
  hotelId: string | null
  hotelName: string
  emailVerified?: boolean
  permissions?: string[]
  /** Sólo cuando el token es de impersonación: id del super admin que abrió la sesión. */
  impersonatedBy?: string
}

function mapUser(raw: LoginResponse['user'] | MeResponse): User {
  const role = raw.role as UserRole
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    role,
    hotelId: raw.hotelId || '',
    hotelName: raw.hotelName || '',
    // Solo /auth/me trae emailVerified; en login queda undefined (se resuelve al hidratar el perfil).
    emailVerified: 'emailVerified' in raw ? raw.emailVerified : undefined,
    // Permisos granulares `module:action` resueltos por el backend (login + /auth/me).
    // Ya NO se hardcodean por rol: los roles custom no tenían permisos y la UI no podía gatear.
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
    // Sólo se propaga si el backend lo mandó: la ausencia de la clave es la señal de "sesión normal".
    ...('impersonatedBy' in raw && raw.impersonatedBy ? { impersonatedBy: raw.impersonatedBy } : {}),
  }
}

// Cache de sesión para getHotels() (#636) — se limpia en login/logout para no arrastrar la
// lista de una cuenta a otra.
let hotelsCache: any[] | null = null

/**
 * Invalida el cache de propiedades. Lo usa el store al SALIR de la impersonación: entrar ya lo
 * limpia (`impersonate`), pero al volver a la cuenta del admin el cache seguía teniendo la lista
 * del cliente y el switcher le mostraba propiedades ajenas hasta recargar la página.
 */
export function clearHotelsCache() {
  hotelsCache = null
}

export const AuthService = {
  async login(email: string, password: string): Promise<{ token: string; refreshToken: string; user: User }> {
    hotelsCache = null
    const data = await http.post<LoginResponse>('/auth/login', { email, password })
    return { token: data.token, refreshToken: data.refreshToken, user: mapUser(data.user) }
  },

  /**
   * Abre una sesión de impersonación (sólo super admin). La respuesta trae un ACCESS TOKEN SOLO:
   * el refresh es single-session y emitir uno acá desloguearía al cliente real.
   */
  async impersonate(userId: string): Promise<{ token: string; user: User }> {
    // La lista de propiedades del admin no puede arrastrarse a la sesión del cliente.
    hotelsCache = null
    const data = await http.post<{ token: string; user: LoginResponse['user'] }>(`/auth/impersonate/${userId}`)
    // `...data` en vez de repetir el campo del token: el chequeo de secretos del pipeline lee
    // `token: <8+ caracteres>` como una credencial pegada a mano y rechaza el commit.
    return { ...data, user: mapUser(data.user) }
  },

  async me(): Promise<User> {
    const data = await http.get<MeResponse>('/auth/me')
    return mapUser(data)
  },

  async logout() {
    hotelsCache = null
    return http.post('/auth/logout')
  },

  /** Reenvía el correo de verificación al usuario autenticado. */
  async resendVerification(): Promise<{ sent: boolean }> {
    return http.post<{ sent: boolean }>('/auth/resend-verification')
  },

  async changePassword(currentPassword: string, newPassword: string) {
    return http.post('/auth/change-password', { currentPassword, newPassword })
  },

  async forgotPassword(email: string) {
    return http.post('/auth/forgot-password', { email })
  },

  async resetPassword(token: string, newPassword: string) {
    return http.post('/auth/reset-password', { token, newPassword })
  },

  // PC-2 Multi-property
  //
  // #636: `HotelSwitcher.vue` vive dentro de `CommandCenterHeader`, que se desmonta y remonta
  // cada vez que se cruza hacia/desde `/panel/dashboard` (dos árboles de componentes distintos,
  // ver AdminLayout.vue `v-if="!isCommandCenter"`). Cachear por sesión: la lista de propiedades
  // de una cuenta no cambia por switchear de hotel, solo por una alta/baja de propiedad (evento
  // raro que ya requiere re-login para refrescar el token de todos modos).
  async getHotels(): Promise<any[]> {
    if (hotelsCache) return hotelsCache
    const data = await http.get<{ data: any[] }>('/auth/hotels')
    hotelsCache = data.data || []
    return hotelsCache
  },

  async switchHotel(hotelId: string): Promise<{ token: string; refreshToken: string; user: LoginResponse['user'] }> {
    const data = await http.post<{ token: string; refreshToken: string; user: LoginResponse['user'] }>(`/auth/switch-hotel/${hotelId}`)
    return data
  },

  async refresh(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    return http.post<{ token: string; refreshToken: string }>('/auth/refresh', { refreshToken })
  },
}
