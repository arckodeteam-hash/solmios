import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ModulesService, type ModuleState } from '@/services/Platform.service'
import { isRouteEnabled } from '@/config/module-map'

// Antigüedad a partir de la cual un ensure() dispara revalidación en SEGUNDO PLANO.
// Compromiso: más chico = un request más seguido, y el guard de rutas llama a ensure() en
// CADA navegación (router/index.ts); más grande = el menú tarda más en ponerse al día.
// #46: si el super admin le cambia el plan a un hotel cuyo dueño está trabajando, la API ya
// corta en vivo pero el menú seguía mostrando el plan viejo hasta cerrar sesión. Con 60s el
// panel se acomoda solo dentro del minuto y el costo es, como mucho, un request por minuto.
export const MODULES_STALE_MS = 60_000

// Estado EFECTIVO de módulos/submódulos del hotel actual (global ∩ plan). Cacheado por hotelId.
// Lo consumen el menú (AdminLayout) y el guard de rutas (router). Fuente: GET /api/modules.
export const useModulesStore = defineStore('modules', () => {
  const state = ref<ModuleState>({})
  /** `undefined` = NUNCA se cargó · `null` = cargado para "sin hotel" (super admin sin impersonar).
   *  Distinguir los dos es necesario: con `null` para ambos, un store recién creado creía tener
   *  estado cargado para `ensure(undefined)` y, como `loadedAt` arranca en 0, disparaba una
   *  revalidación fantasma en CADA navegación del panel. */
  const loadedHotel = ref<string | null | undefined>(undefined)
  const loadedAt = ref(0)
  const loading = ref<Promise<void> | null>(null)
  const loadingHotel = ref<string | null>(null)
  /** Generación de la petición vigente. Toda respuesta que llega con una generación vieja se
   *  DESCARTA: sin esto, una revalidación en vuelo del hotel A que resuelve después de haber
   *  cambiado al hotel B (impersonación) pisaba el estado bueno de B con los módulos de A —
   *  y encima dejaba `loadedHotel` apuntando al hotel viejo. */
  let vigente = 0

  /**
   * Trae el estado. Devuelve false si el fetch falló o si quedó obsoleto (sin throw: el caller
   * no se rompe). `keepOnError`: al revalidar, el estado que YA está cargado es bueno — vaciarlo
   * por un error de red pasajero dejaría al hotel viendo TODO el panel, peor que el menú viejo.
   */
  async function fetchState(keepOnError: boolean, generacion: number): Promise<boolean> {
    try {
      const nuevo = (await ModulesService.enabled()).state || {}
      if (generacion !== vigente) return false // llegó tarde: ya hay otra petición vigente
      state.value = nuevo
      return true
    } catch {
      if (generacion !== vigente) return false
      if (!keepOnError) state.value = {} // sin datos: no bloquear nada (todo visible)
      return false
    }
  }

  /** Lanza el fetch y lo publica como "en curso" para que todos los callers lo compartan. */
  function startFetch(hid: string | null, keepOnError: boolean): Promise<void> {
    const generacion = ++vigente
    // `loadedHotel` SOLO se setea si el fetch tuvo éxito Y sigue vigente: si no, un fallo puntual
    // dejaba el hotel "cargado" con estado vacío y el fail-open quedaba congelado TODA la sesión —
    // el siguiente ensure() tiene que poder reintentar.
    const p: Promise<void> = fetchState(keepOnError, generacion)
      .then((ok) => { if (ok) { loadedHotel.value = hid; loadedAt.value = Date.now() } })
      .finally(() => { if (loading.value === p) { loading.value = null; loadingHotel.value = null } })
    loadingHotel.value = hid
    loading.value = p
    return p
  }

  /** Carga el estado una vez por hotel. Si cambió el hotel (login/impersonación), recarga. */
  async function ensure(hotelId?: string | null): Promise<void> {
    const hid = hotelId ?? null
    if (loadedHotel.value !== undefined && loadedHotel.value === hid) {
      // Ya hay estado usable: devolver AL TOQUE (el guard no puede esperar un fetch por clic).
      // Si quedó viejo y no hay otro fetch en curso, revalidar en segundo plano: así el menú
      // toma el plan nuevo sin que el dueño tenga que cerrar sesión. Si esa revalidación
      // falla, el estado bueno se conserva (keepOnError).
      if (!loading.value && Date.now() - loadedAt.value >= MODULES_STALE_MS) {
        void startFetch(hid, true)
      }
      return
    }
    // Fetch en curso del MISMO hotel: compartirlo (menú + guard de rutas montan a la vez).
    if (loading.value && loadingHotel.value === hid) return loading.value
    return startFetch(hid, false)
  }

  /**
   * Fuerza el refetch y ESPERA. Es lo que corresponde después de una acción del propio
   * usuario que le cambia el plan (mejora desde /panel/suscripcion): ahí no se puede
   * esperar al umbral de revalidación, el menú tiene que estar al día al volver.
   */
  async function refresh(hotelId?: string | null): Promise<void> {
    const hid = hotelId === undefined ? (loadedHotel.value ?? null) : (hotelId ?? null)
    // Si justo hay un fetch en curso del mismo hotel, esperar ese en vez de duplicarlo.
    if (loading.value && loadingHotel.value === hid) return loading.value
    return startFetch(hid, true)
  }

  function reset(): void {
    state.value = {}
    loadedHotel.value = undefined
    loadedAt.value = 0
    loading.value = null
    loadingHotel.value = null
    // Invalida lo que esté en vuelo: tras un logout / cambio de sesión, una respuesta vieja no
    // puede aterrizar sobre el estado del usuario nuevo.
    vigente++
  }

  function enabled(key?: string): boolean {
    return !key || state.value[key] !== false
  }

  function routeEnabled(path: string): boolean {
    return isRouteEnabled(path, state.value)
  }

  return { state, enabled, routeEnabled, ensure, refresh, reset }
})
