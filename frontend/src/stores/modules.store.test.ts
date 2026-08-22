import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock del service: el store no debe pegarle a la API real en tests.
vi.mock('@/services/Platform.service', () => ({
  ModulesService: {
    enabled: vi.fn(),
  },
}))

import { useModulesStore } from './modules.store'
import { ModulesService } from '@/services/Platform.service'

describe('modules.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
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
