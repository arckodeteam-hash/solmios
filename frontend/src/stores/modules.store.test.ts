import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock del service: el store no debe pegarle a la API real en tests.
vi.mock('@/services/Platform.service', () => ({
  ModulesService: {
    enabled: vi.fn(),
  },
}))

import { useModulesStore, MODULES_STALE_MS } from './modules.store'
import { ModulesService } from '@/services/Platform.service'

// Sólo se falsea Date (no setTimeout): así se puede envejecer el estado cacheado y a la vez
// vaciar la cola de microtareas con un setTimeout real para ver terminar la revalidación.
function envejecerEstado(): void {
  vi.setSystemTime(Date.now() + MODULES_STALE_MS + 1)
}
function flush(): Promise<void> {
  return new Promise((r) => { setTimeout(r, 0) })
}

describe('modules.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ensure exitoso cachea por hotel: dos llamadas al mismo hotel = un fetch', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()

    await store.ensure('h1')
    await store.ensure('h1')

    expect(ModulesService.enabled).toHaveBeenCalledTimes(1)
    expect(store.enabled('crm')).toBe(false)
  })

  it('ensure con OTRO hotel recarga (login/impersonación)', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: {} })
    const store = useModulesStore()

    await store.ensure('h1')
    await store.ensure('h2')

    expect(ModulesService.enabled).toHaveBeenCalledTimes(2)
  })

  it('ensure fallido NO congela el fail-open: el siguiente ensure reintenta', async () => {
    const store = useModulesStore()

    // Primer fetch revienta (caída de red): estado vacío = todo visible, sin throw.
    vi.mocked(ModulesService.enabled).mockRejectedValueOnce(new Error('network'))
    await store.ensure('h1')
    expect(store.enabled('crm')).toBe(true)
    expect(ModulesService.enabled).toHaveBeenCalledTimes(1)

    // El hotel NO quedó marcado como cargado: el ensure siguiente vuelve a intentar y
    // ahora el estado real llega (antes quedaba congelado en {} toda la sesión).
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    await store.ensure('h1')
    expect(ModulesService.enabled).toHaveBeenCalledTimes(2)
    expect(store.enabled('crm')).toBe(false)
  })

  it('ensure en curso del mismo hotel se comparte (no dispara doble fetch paralelo)', async () => {
    let resolveFetch: (v: { state: Record<string, boolean> }) => void = () => {}
    vi.mocked(ModulesService.enabled).mockImplementation(
      () => new Promise((r) => { resolveFetch = r }),
    )
    const store = useModulesStore()

    const p1 = store.ensure('h1')
    const p2 = store.ensure('h1')
    resolveFetch({ state: {} })
    await Promise.all([p1, p2])

    expect(ModulesService.enabled).toHaveBeenCalledTimes(1)
  })

  it('reset limpia el estado: el hotel siguiente vuelve a cargar', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()
    await store.ensure('h1')
    expect(store.enabled('crm')).toBe(false)

    store.reset()
    expect(store.enabled('crm')).toBe(true) // estado vacío = fail-open

    await store.ensure('h1') // mismo hotel: tras reset TIENE que refetchear
    expect(ModulesService.enabled).toHaveBeenCalledTimes(2)
  })


  it('estado fresco: dos ensure() seguidos NO revalidan de gusto (un solo fetch)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()

    await store.ensure('h1')
    vi.setSystemTime(Date.now() + MODULES_STALE_MS - 1) // todavía dentro del umbral
    await store.ensure('h1')
    await flush()

    expect(ModulesService.enabled).toHaveBeenCalledTimes(1)
  })

  it('estado viejo: ensure devuelve al toque con lo cacheado y revalida en segundo plano', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()
    await store.ensure('h1')

    // Revalidación que queda EN VUELO: si ensure esperara el fetch, el await de abajo no
    // volvería nunca (el guard de rutas lo llama en cada navegación y no puede bloquearse).
    let resolverRevalidacion: (v: { state: Record<string, boolean> }) => void = () => {}
    vi.mocked(ModulesService.enabled).mockImplementationOnce(
      () => new Promise((r) => { resolverRevalidacion = r }),
    )
    envejecerEstado()
    await store.ensure('h1')

    expect(ModulesService.enabled).toHaveBeenCalledTimes(2) // arrancó la revalidación
    expect(store.enabled('crm')).toBe(false) // mientras tanto sigue el estado cacheado

    resolverRevalidacion({ state: { crm: true } })
    await flush()
    expect(store.enabled('crm')).toBe(true) // al llegar, el estado se actualiza solo
  })

  it('#46: tras la revalidación el menú refleja la matriz del plan NUEVO sin cerrar sesión', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // Plan viejo: CRM apagado, canales encendido.
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false, channel: true } })
    const store = useModulesStore()
    await store.ensure('h1')
    expect(store.routeEnabled('/panel/crm')).toBe(false)

    // El super admin le cambia el plan al hotel mientras su dueño trabaja: la API ya devuelve
    // la matriz nueva (CRM incluido, canales fuera) y el menú tiene que seguirla.
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: true, channel: false } })
    envejecerEstado()
    await store.ensure('h1')
    await flush()

    expect(ModulesService.enabled).toHaveBeenCalledTimes(2)
    expect(store.enabled('crm')).toBe(true)
    expect(store.enabled('channel')).toBe(false)
    expect(store.routeEnabled('/panel/crm')).toBe(true)
  })

  it('revalidación en segundo plano FALLIDA conserva el estado bueno (no lo vacía)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()
    await store.ensure('h1')

    // Caída de red pasajera al revalidar: vaciar el estado dejaría al hotel viendo TODO el
    // panel, un fallo peor que el menú desactualizado que la revalidación venía a arreglar.
    vi.mocked(ModulesService.enabled).mockRejectedValueOnce(new Error('network'))
    envejecerEstado()
    await store.ensure('h1')
    await flush()

    expect(store.enabled('crm')).toBe(false) // se conserva la matriz que ya estaba
  })

  it('revalidación en curso: un ensure concurrente no dispara un segundo fetch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()
    await store.ensure('h1')

    let resolverRevalidacion: (v: { state: Record<string, boolean> }) => void = () => {}
    vi.mocked(ModulesService.enabled).mockImplementationOnce(
      () => new Promise((r) => { resolverRevalidacion = r }),
    )
    envejecerEstado()
    await store.ensure('h1') // menú
    await store.ensure('h1') // guard de rutas, en la misma navegación

    expect(ModulesService.enabled).toHaveBeenCalledTimes(2)
    resolverRevalidacion({ state: {} })
    await flush()
  })

  it('refresh fuerza el refetch aunque el estado esté fresco, y espera al resultado', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()
    await store.ensure('h1')

    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: true } })
    await store.refresh('h1')

    expect(ModulesService.enabled).toHaveBeenCalledTimes(2)
    expect(store.enabled('crm')).toBe(true) // ya actualizado al volver del await
  })

  it('refresh fallido conserva el estado bueno (mismo fail-safe que la revalidación)', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()
    await store.ensure('h1')

    vi.mocked(ModulesService.enabled).mockRejectedValueOnce(new Error('network'))
    await store.refresh('h1')
    expect(store.enabled('crm')).toBe(false)
  })

  it('cambiar de hotel recarga aunque el estado del anterior esté fresco (impersonación)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false } })
    const store = useModulesStore()
    await store.ensure('h1')

    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: true } })
    await store.ensure('h2')

    expect(ModulesService.enabled).toHaveBeenCalledTimes(2)
    expect(store.enabled('crm')).toBe(true)
  })

  it('routeEnabled usa module-map: ruta gateada OFF vs ruta CORE siempre ON', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { crm: false, 'settings.rates': false } })
    const store = useModulesStore()
    await store.ensure('h1')

    expect(store.routeEnabled('/panel/crm')).toBe(false)
    expect(store.routeEnabled('/panel/config/tarifas')).toBe(false)
    expect(store.routeEnabled('/panel/dashboard')).toBe(true) // CORE: sin clave en module-map
    expect(store.routeEnabled('/panel/referidos')).toBe(true) // CORE (growth): sin clave
  })
})
