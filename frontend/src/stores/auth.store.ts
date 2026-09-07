import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, UserRole } from '@/types'
import { AuthService, clearHotelsCache } from '@/services/Auth.service'
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
  // Cerrojo NO reactivo de `loginAs`: sólo coordina llamadas concurrentes, no lo mira ninguna vista.
  let loginAsInFlight = false

  const isAuthenticated = computed(() => !!token.value)
  const userRole = computed(() => user.value?.role ?? null)
  const isSuperAdmin = computed(() => user.value?.role === 'super_admin')
  const isHotelAdmin = computed(() => user.value?.role === 'hotel_admin')
  const isReceptionist = computed(() => user.value?.role === 'receptionist')
  const canAccessSuperAdmin = computed(() => user.value?.role === 'super_admin' && !impersonating.value)
  /** Acceso de nivel hotel_admin: los dos roles que lo tienen, más el super admin que está
   *  DENTRO de la cuenta de un cliente (su token conserva role super_admin y permisos ['*:*'],
   *  así que el backend se lo autoriza igual — gatearlo por el nombre del rol del cliente le
   *  escondería lo que sí puede hacer). Único criterio para todas las pantallas y el router:
   *  antes estaba reescrito a mano en cada una y se olvidaba la impersonación en la mitad. */
  const canActAsHotelAdmin = computed(() => isSuperAdmin.value || isHotelAdmin.value || impersonating.value)
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
    // La sesión guardada del admin existe exactamente mientras dura la impersonación; el claim
    // de /auth/me la confirma cuando la red responde, pero no puede ser la ÚNICA fuente: si esa
    // llamada falla, `user.value` queda con el cache y la franja y el botón de salir tienen que
    // seguir ahí igual — si no, el admin opera la cuenta del cliente sin saberlo ni poder volver.
    impersonating.value = !!localStorage.getItem(IMP_TOKEN) || !!user.value?.impersonatedBy
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
    // `impersonating` recién se pone en true DESPUÉS del await, así que no sirve de cerrojo: dos
    // clicks seguidos (el botón de la pantalla se deshabilita por fila, no globalmente) pasaban
    // los dos y la segunda llamada pisaba `imp.adminToken` con el token de impersonación de la
    // primera → la sesión real del super admin se perdía y no había forma de volver. Esta marca
    // se levanta SINCRÓNICAMENTE, antes de cualquier await, así la segunda llamada sale sin hacer
    // nada: encadenarla no tendría sentido —entrar a dos cuentas a la vez no existe— y descartarla
    // deja al usuario en la primera que pidió, que es la que ya está cargando.
    if (loginAsInFlight) return
    if (!isSuperAdmin.value || impersonating.value) return
    loginAsInFlight = true
    try {
      await doLoginAs(targetUserId)
    } finally {
      // También cuando la API falla: si no, un error dejaba el botón muerto hasta recargar.
      loginAsInFlight = false
    }
  }

  async function doLoginAs(targetUserId: string) {
    const { token: tkn, user: usr } = await AuthService.impersonate(targetUserId)
    // El id del admin, antes de pisar `user.value`: es lo que marca el perfil cacheado como
    // impersonado (ver más abajo).
    const adminId = user.value?.id
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
    // El body de /auth/impersonate/:id trae sólo el perfil del cliente: el claim vive en el JWT.
    // Cachear el perfil pelado hacía que restoreSession hidratara un user SIN `impersonatedBy`, así
    // que un /auth/me caído apagaba la franja con el token de impersonación todavía activo.
    const impersonatedProfile: User = adminId ? { ...usr, impersonatedBy: adminId } : usr
    user.value = impersonatedProfile
    localStorage.setItem('user', JSON.stringify(impersonatedProfile))
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
    // El snapshot del admin se PARSEA antes de persistirlo: guardarlo crudo en localStorage['user']
    // dejaba un JSON inválido si venía corrupto, y el restoreSession() siguiente lo castigaba con un
    // logout() completo (el admin perdía la sesión por un dato que ni hacía falta).
    const savedAdmin = localStorage.getItem(IMP_USER)
    let parsedAdmin: User | null = null
    if (savedAdmin) {
      try {
        parsedAdmin = JSON.parse(savedAdmin) as User
      } catch {
        parsedAdmin = null
      }
    }
    // Respaldo en memoria de lo que guardó loginAs. Lo único inaceptable es quedarse con el perfil
    // del CLIENTE bajo el token del ADMIN: la UI mostraría una cuenta que ya no es la de la sesión.
    const restoredAdmin = parsedAdmin ?? originalUser.value

    token.value = adminToken
    localStorage.setItem('token', adminToken)
    refreshToken.value = adminRefresh
    if (adminRefresh) localStorage.setItem('refreshToken', adminRefresh)
    else localStorage.removeItem('refreshToken')
    if (restoredAdmin) {
      user.value = restoredAdmin
      localStorage.setItem('user', JSON.stringify(restoredAdmin))
    }

    localStorage.removeItem(IMP_TOKEN)
    localStorage.removeItem(IMP_REFRESH)
    localStorage.removeItem(IMP_USER)
    originalUser.value = null
    impersonating.value = false
    useModulesStore().reset()
    // Las propiedades cacheadas son las del CLIENTE: sin esto el admin volvía a su cuenta con el
    // switcher mostrando los hoteles ajenos hasta la próxima recarga.
    clearHotelsCache()

    // Revalidar contra el backend con el token del admin ya restaurado: confirma que la sesión
    // sigue viva y devuelve los permisos reales (si el token venció, http.ts renueva con el refresh).
    try {
      user.value = await AuthService.me()
      localStorage.setItem('user', JSON.stringify(user.value))
    } catch {
      // Con perfil del admin restaurado, el cacheado alcanza para seguir operando. Sin él, la
      // sesión quedaría con el usuario del cliente y el token del admin: se sale desde cero.
      if (!restoredAdmin) await logout()
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
    canAccessSuperAdmin, canActAsHotelAdmin, currentHotel,
    login, loginAs, stopImpersonation, logout, restoreSession, setTokens
  }
})
