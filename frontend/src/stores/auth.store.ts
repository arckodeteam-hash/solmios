import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, UserRole } from '@/types'
import { AuthService } from '@/services/Auth.service'
import { useModulesStore } from './modules.store'

// Claves donde se aparca la sesión del SUPER ADMIN mientras dura la impersonación: es lo único
// que permite volver a su cuenta sin re-loguearse, y sobrevive a un F5.
const IMP_TOKEN = 'imp.adminToken'
const IMP_REFRESH = 'imp.adminRefreshToken'
const IMP_USER = 'imp.adminUser'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))
  const refreshToken = ref<string | null>(localStorage.getItem('refreshToken'))
  const loading = ref(false)
  const impersonating = ref(false)
  const originalUser = ref<User | null>(null)

  const isAuthenticated = computed(() => !!token.value)
  const userRole = computed(() => user.value?.role ?? null)
  const isSuperAdmin = computed(() => user.value?.role === 'super_admin')
  const isHotelAdmin = computed(() => user.value?.role === 'hotel_admin')
  const isReceptionist = computed(() => user.value?.role === 'receptionist')
  const canAccessSuperAdmin = computed(() => user.value?.role === 'super_admin' && !impersonating.value)
  const currentHotel = computed(() => user.value?.hotelName ?? '')

  async function login(email: string, password: string) {
    loading.value = true
    try {
      const { token: tkn, refreshToken: rt, user: usr } = await AuthService.login(email, password)
      token.value = tkn
      refreshToken.value = rt
      user.value = usr
      localStorage.setItem('token', tkn)
      localStorage.setItem('refreshToken', rt)
      localStorage.setItem('user', JSON.stringify(usr))
    } finally {
      loading.value = false
    }
  }

  function setTokens(newToken: string, newRefreshToken: string) {
    token.value = newToken
    refreshToken.value = newRefreshToken
    localStorage.setItem('token', newToken)
    localStorage.setItem('refreshToken', newRefreshToken)
  }

  async function restoreSession() {
    if (!token.value) return
    const savedUser = localStorage.getItem('user')
    if (savedUser) {
      try {
        user.value = JSON.parse(savedUser)
      } catch {
        logout()
        return
      }
    }
    try {
      user.value = await AuthService.me()
      localStorage.setItem('user', JSON.stringify(user.value))
    } catch {
      // token invalid — keep cached user but don't force logout on transient errors
    }
    // El claim viene firmado en el token, así que el backend es la fuente de verdad de si esto
    // es una impersonación: una bandera del navegador podría estar stale tras un F5.
    impersonating.value = !!user.value?.impersonatedBy
    if (impersonating.value && !originalUser.value) {
      const savedAdmin = localStorage.getItem(IMP_USER)
      if (savedAdmin) {
        try {
          originalUser.value = JSON.parse(savedAdmin)
        } catch {
          originalUser.value = null
        }
      }
    }
  }

  /**
   * Entra a la cuenta de un cliente pidiendo al backend un token de impersonación real: sin esto
   * el JWT seguía siendo el del super admin y la API nunca devolvía los datos del cliente.
   * El error de la API se propaga a propósito para que la pantalla pueda mostrar un toast.
   */
  async function loginAs(targetUserId: string) {
    if (!isSuperAdmin.value || impersonating.value) return
    const { token: tkn, user: usr } = await AuthService.impersonate(targetUserId)
    // Guardar la sesión del admin ANTES de pisarla: es lo único que permite volver sin re-loguearse.
    if (token.value) localStorage.setItem(IMP_TOKEN, token.value)
    if (refreshToken.value) localStorage.setItem(IMP_REFRESH, refreshToken.value)
    if (user.value) localStorage.setItem(IMP_USER, JSON.stringify(user.value))
    originalUser.value = user.value ? { ...user.value } : null

    token.value = tkn
    localStorage.setItem('token', tkn)
    // El token de impersonación no tiene refresh. Dejar el refresh del ADMIN en su lugar sería peor
    // que no tener ninguno: al vencer el access token, http.ts renovaría con él y la sesión volvería
    // a ser la del super admin en silencio, con la franja todavía diciendo que es la del cliente.
    refreshToken.value = null
    localStorage.removeItem('refreshToken')
    user.value = usr
    localStorage.setItem('user', JSON.stringify(usr))
    impersonating.value = true
    // El menú/módulos del admin no valen para el hotel del cliente.
    useModulesStore().reset()
  }

  /** Vuelve a la sesión del super admin guardada en las claves `imp.*`. */
  async function stopImpersonation() {
    if (!impersonating.value) return
    const adminToken = localStorage.getItem(IMP_TOKEN)
    // Sin a dónde volver, la salida honesta es desloguear: dejar al admin atrapado en la cuenta
    // del cliente es el bug que estamos arreglando.
    if (!adminToken) {
      await logout()
      return
    }
    const adminRefresh = localStorage.getItem(IMP_REFRESH)
    const adminUser = localStorage.getItem(IMP_USER)

    token.value = adminToken
    localStorage.setItem('token', adminToken)
    refreshToken.value = adminRefresh
    if (adminRefresh) localStorage.setItem('refreshToken', adminRefresh)
    else localStorage.removeItem('refreshToken')
    if (adminUser) {
      try {
        user.value = JSON.parse(adminUser)
      } catch {
        // JSON corrupto: el /auth/me de abajo repone el perfil real.
      }
      localStorage.setItem('user', adminUser)
    }

    localStorage.removeItem(IMP_TOKEN)
    localStorage.removeItem(IMP_REFRESH)
    localStorage.removeItem(IMP_USER)
    originalUser.value = null
    impersonating.value = false
    useModulesStore().reset()

    // Revalidar contra el backend con el token del admin ya restaurado: confirma que la sesión
    // sigue viva y devuelve los permisos reales (si el token venció, http.ts renueva con el refresh).
    try {
      user.value = await AuthService.me()
      localStorage.setItem('user', JSON.stringify(user.value))
    } catch {
      // El user cacheado alcanza para seguir operando.
    }
  }

  async function logout() {
    try {
      await AuthService.logout()
    } catch {
      // ignore — clear local state regardless
    }
    token.value = null
    refreshToken.value = null
    user.value = null
    originalUser.value = null
    impersonating.value = false
    // El menú/rutas gateadas del hotel ANTERIOR no sobrevive al logout: sin esto, un login
    // en otro hotel (o plan distinto) heredaba el estado stale de módulos hasta recargar.
    useModulesStore().reset()
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
    // Sin esto, la sesión del super admin quedaba tirada en el navegador después de salir.
    localStorage.removeItem(IMP_TOKEN)
    localStorage.removeItem(IMP_REFRESH)
    localStorage.removeItem(IMP_USER)
  }

  return {
    user, token, refreshToken, loading, impersonating,
    isAuthenticated, userRole, isSuperAdmin, isHotelAdmin, isReceptionist,
    canAccessSuperAdmin, currentHotel,
    login, loginAs, stopImpersonation, logout, restoreSession, setTokens
  }
})
