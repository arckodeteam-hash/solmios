// AppHeader.channel-gate.test.ts — A9 (qa-ui habitaciones 2026-08-21, hallazgo 1).
//
// El header global del panel fetcheaba ChannelService.status en CADA vista sin mirar el plan:
// para hoteles sin el módulo `channel` era un 403 en consola que además dejaba el indicador
// en "Sin conexión" (apiOnline=false) sin estar desconectado.
//
// Lo que se protege acá:
//   1. Plan sin `channel` → NO se llama a /api/channels y el indicador queda "Operativo".
//   2. Plan con `channel` → se llama una vez y el lastSync llega al header.
//   3. `channel` on pero el status revienta → el indicador pasa a "Sin conexión" (semántica
//      previa intacta: el fetch SÍ es la señal de conectividad cuando el módulo existe).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/services/Hotel.service', () => ({
  HotelService: { settings: vi.fn().mockResolvedValue({ hotel: null }) },
}))
vi.mock('@/services/Channel.service', () => ({
  ChannelService: { status: vi.fn().mockResolvedValue({ lastSync: null, connectedCount: 0 }) },
}))
vi.mock('@/services/Weather.service', () => ({
  WeatherService: { current: vi.fn().mockResolvedValue(null) },
}))
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { hotelId: 'h1' }, currentHotel: 'Hotel Test' }),
}))
vi.mock('@/stores/dashboard.store', () => ({
  useDashboardStore: () => ({ stats: {} }),
}))
// ModulesService mockeado: usamos el modules.store REAL para probar la integración completa
// (AppHeader → ensure() → gate del fetch), igual que modules.store.test.ts.
vi.mock('@/services/Platform.service', () => ({
  ModulesService: { enabled: vi.fn() },
}))

import AppHeader from './AppHeader.vue'
import { ChannelService } from '@/services/Channel.service'
import { ModulesService } from '@/services/Platform.service'

function headerProps(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent({ name: 'CommandCenterHeader' }).props()
}

describe('AppHeader — gate de canales por plan (A9)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('plan SIN channel: no llama a /api/channels y el indicador queda Operativo', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { channel: false } } as any)
    const w = mount(AppHeader, { shallow: true })
    await flushPromises()

    expect(ChannelService.status).not.toHaveBeenCalled()
    expect(headerProps(w).apiOnline).toBe(true) // antes: false por el 403
    expect(headerProps(w).lastSync).toBeNull()
  })

  it('plan CON channel: llama una vez y el lastSync llega al header', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: { channel: true } } as any)
    vi.mocked(ChannelService.status).mockResolvedValue({ lastSync: '2026-08-21T10:00:00Z', connectedCount: 2 } as any)

    const w = mount(AppHeader, { shallow: true })
    await flushPromises()

    expect(ChannelService.status).toHaveBeenCalledTimes(1)
    expect(ChannelService.status).toHaveBeenCalledWith('h1')
    expect(headerProps(w).lastSync).toBe('2026-08-21T10:00:00Z')
    expect(headerProps(w).apiOnline).toBe(true)
  })

  it('channel ON pero status falla: el indicador pasa a Sin conexión (comportamiento previo)', async () => {
    vi.mocked(ModulesService.enabled).mockResolvedValue({ state: {} } as any)
    vi.mocked(ChannelService.status).mockRejectedValue(new Error('network'))

    const w = mount(AppHeader, { shallow: true })
    await flushPromises()

    expect(ChannelService.status).toHaveBeenCalledTimes(1)
    expect(headerProps(w).apiOnline).toBe(false)
  })
})
