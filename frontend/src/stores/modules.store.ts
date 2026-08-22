import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ModulesService, type ModuleState } from '@/services/Platform.service'
import { isRouteEnabled } from '@/config/module-map'

// Estado EFECTIVO de módulos/submódulos del hotel actual (global ∩ plan). Cacheado por hotelId.
// Lo consumen el menú (AdminLayout) y el guard de rutas (router). Fuente: GET /api/modules.
export const useModulesStore = defineStore('modules', () => {
  const state = ref<ModuleState>({})
  const loadedHotel = ref<string | null>(null)
  const loading = ref<Promise<void> | null>(null)
  const loadingHotel = ref<string | null>(null)

  /** Trae el estado. Devuelve false si el fetch falló (sin throw: el caller no se rompe). */
  async function fetchState(): Promise<boolean> {
    try {
      state.value = (await ModulesService.enabled()).state || {}
      return true
    } catch {
      state.value = {} // sin datos: no bloquear nada (todo visible)
      return false
    }
  }

  /** Carga el estado una vez por hotel. Si cambió el hotel (login/impersonación), recarga. */
  async function ensure(hotelId?: string | null): Promise<void> {
    const hid = hotelId ?? null
    if (loadedHotel.value === hid && !loading.value) return
    // Fetch en curso del MISMO hotel: compartirlo (menú + guard de rutas montan a la vez).
    if (loading.value && loadingHotel.value === hid) return loading.value
    // `loadedHotel` SOLO se setea si el fetch tuvo éxito: si no, un fallo puntual dejaba el
    // hotel "cargado" con estado vacío y el fail-open quedaba congelado TODA la sesión —
    // el siguiente ensure() tiene que poder reintentar.
    const p: Promise<void> = fetchState()
      .then((ok) => { if (ok) loadedHotel.value = hid })
      .finally(() => { if (loading.value === p) { loading.value = null; loadingHotel.value = null } })
    loadingHotel.value = hid
    loading.value = p
    return p
  }

  function reset(): void {
    state.value = {}
    loadedHotel.value = null
    loading.value = null
    loadingHotel.value = null
  }

  function enabled(key?: string): boolean {
    return !key || state.value[key] !== false
  }

  function routeEnabled(path: string): boolean {
    return isRouteEnabled(path, state.value)
  }

  return { state, enabled, routeEnabled, ensure, reset }
})
