import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./http', () => ({
  http: { post: vi.fn(), get: vi.fn() },
}))

import { ConfigService } from './Platform.service'
import { http } from './http'

// #80: `ConfigService.set` defaulteaba `hotelId` a 'platform'. Un super_admin con hotel que
// guardaba desde /panel/settings escribía la fila de plataforma (200 + toast de éxito) y al
// recargar `get` traía la fila del hotel: el valor "desaparecía" y pisaba el default global.
// Ahora `hotelId` sólo viaja cuando el caller lo pasa; el backend resuelve el hotel del token.
describe('Config.service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('set sin hotelId NO manda la clave hotelId (el backend resuelve el hotel del token)', async () => {
    vi.mocked(http.post).mockResolvedValue(undefined as any)
    await ConfigService.set('automation_config', { a: 1 })
    expect(http.post).toHaveBeenCalledTimes(1)
    expect(http.post).toHaveBeenCalledWith('/configuracion', { clave: 'automation_config', valor: { a: 1 } })
    const body = vi.mocked(http.post).mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('hotelId')
  })

  it("set con 'platform' explícito manda hotelId: 'platform'", async () => {
    vi.mocked(http.post).mockResolvedValue(undefined as any)
    await ConfigService.set('google_maps', { apiKey: 'x' }, 'platform')
    expect(http.post).toHaveBeenCalledWith('/configuracion', {
      clave: 'google_maps', valor: { apiKey: 'x' }, hotelId: 'platform',
    })
  })

  it('set con hotelId de un hotel lo manda tal cual', async () => {
    vi.mocked(http.post).mockResolvedValue(undefined as any)
    await ConfigService.set('k', 'v', 'h1')
    expect(http.post).toHaveBeenCalledWith('/configuracion', { clave: 'k', valor: 'v', hotelId: 'h1' })
  })

  it('get pega a /configuracion/:key y devuelve valor; con hotelId agrega el query', async () => {
    vi.mocked(http.get).mockResolvedValue({ valor: { enabled: true } } as any)
    const v = await ConfigService.get('k')
    expect(http.get).toHaveBeenCalledWith('/configuracion/k')
    expect(v).toEqual({ enabled: true })

    vi.mocked(http.get).mockResolvedValue({ valor: 'p' } as any)
    const vp = await ConfigService.get('k', 'platform')
    expect(http.get).toHaveBeenCalledWith('/configuracion/k?hotelId=platform')
    expect(vp).toBe('p')
  })

  it('set propaga el error si el POST falla (la UI muestra el toast de error sólo si la promesa rechaza)', async () => {
    vi.mocked(http.post).mockRejectedValue(new Error('403 Forbidden'))
    await expect(ConfigService.set('k', 'v')).rejects.toThrow('403 Forbidden')
  })
})
