// El clima es decorativo: ningún fallo suyo puede tumbar el render del dashboard. Estos tests
// fijan los caminos de error, que son la razón por la que este service existe separado del
// componente (antes era un fetch() inline sin cobertura posible).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { WeatherService } from './Weather.service'

function mockFetch(impl: () => unknown) {
  vi.stubGlobal('fetch', vi.fn(impl as never))
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('WeatherService.current', () => {
  it('no llama al proveedor si el hotel no tiene coordenadas', async () => {
    const spy = vi.fn()
    mockFetch(spy)
    expect(await WeatherService.current(undefined, undefined)).toBeNull()
    expect(await WeatherService.current(null, null)).toBeNull()
    expect(await WeatherService.current('', '')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('trata lat/lon = 0 como "sin localizar", no como el Golfo de Guinea', async () => {
    // 0 es el default de la columna en el modelo `hotels`: significa que nadie cargó la
    // ubicación, no que el hotel esté en el ecuador.
    const spy = vi.fn()
    mockFetch(spy)
    expect(await WeatherService.current(0, 0)).toBeNull()
    expect(await WeatherService.current('0', '0')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('devuelve el clima cuando el proveedor responde bien (acepta lat/lon string)', async () => {
    mockFetch(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ current_weather: { temperature: 29.4, weathercode: 2 } }),
    }))
    const w = await WeatherService.current('18.47', '-69.89')
    expect(w).toEqual({ temp: 29.4, label: 'Parcialmente nublado', icon: '⛅' })
  })

  it('degrada a una condición genérica si el código WMO es desconocido', async () => {
    mockFetch(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ current_weather: { temperature: 20, weathercode: 999 } }),
    }))
    const w = await WeatherService.current(18.47, -69.89)
    expect(w?.temp).toBe(20)
    expect(w?.label).toBe('Clima')
  })

  it('devuelve null —sin tirar— ante error de red, HTTP no-OK o payload roto', async () => {
    mockFetch(() => Promise.reject(new Error('offline')))
    expect(await WeatherService.current(18.47, -69.89)).toBeNull()

    mockFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
    expect(await WeatherService.current(18.47, -69.89)).toBeNull()

    mockFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
    expect(await WeatherService.current(18.47, -69.89)).toBeNull()

    // temperatura ausente o no numérica: mostrar "NaN°C" en el header sería peor que no mostrar nada
    mockFetch(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ current_weather: { weathercode: 0 } }),
    }))
    expect(await WeatherService.current(18.47, -69.89)).toBeNull()

    mockFetch(() => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) }))
    expect(await WeatherService.current(18.47, -69.89)).toBeNull()
  })
})
