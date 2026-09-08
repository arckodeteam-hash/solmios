/**
 * useCurrency — la tasa de conversión sale del backend, no de un número escrito a mano.
 *
 * El defecto original: el composable pedía `/configuracion/currency`, una key que NADIE escribe
 * (la pantalla de ajustes guarda bajo `currency_config`). El 404 silencioso dejaba `exchangeRate`
 * en 0 para siempre, así que `convert()` devolvía el monto sin convertir y la única tasa visible
 * en el producto era el 60 hardcodeado de la pantalla de ajustes.
 *
 * Ahora la fuente es `GET /api/tasa-cambio` (`hoteles/usecases/exchange-rate.ts`), el MISMO
 * endpoint que resuelve la tasa del backend: un solo número para los dos lados.
 *
 * El composable tiene estado a nivel de módulo (`currencyConfig`, `loaded`), así que cada caso
 * reimporta con `vi.resetModules()` para no arrastrar la tasa del test anterior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { httpGet } = vi.hoisted(() => ({ httpGet: vi.fn() }))

vi.mock('@/services/http', () => ({
  http: { get: httpGet },
  ApiError: class ApiError extends Error {},
}))

/** Respuesta real del endpoint (ver `ExchangeRateResponse` del usecase). */
const RATE_OK = {
  from: 'USD',
  to: 'DOP',
  rate: 59.193349,
  available: true,
  stale: false,
  fetchedAt: '2026-09-08T22:40:00.000Z',
  providerUpdatedAt: '2026-09-08T22:00:01.000Z',
  source: 'exchangerate-api',
  lastError: null,
}

/** Módulo recién importado: sin caché de módulo del test anterior. */
async function freshModule() {
  vi.resetModules()
  return await import('@/composables/useCurrency')
}

beforeEach(() => {
  httpGet.mockReset()
})

describe('loadCurrencyConfig — la tasa sale de GET /api/tasa-cambio', () => {
  it('pide /tasa-cambio y guarda la tasa que devuelve el backend', async () => {
    httpGet.mockResolvedValue(RATE_OK)
    const mod = await freshModule()

    const config = await mod.loadCurrencyConfig()

    expect(httpGet).toHaveBeenCalledTimes(1)
    expect(httpGet).toHaveBeenCalledWith('/tasa-cambio')
    expect(config.exchangeRate).toBe(59.193349)
    expect(config.secondaryCurrency).toBe('DOP')

    const { exchangeRate, secondaryCurrency, convert } = mod.useCurrency('USD')
    expect(exchangeRate.value).toBe(59.193349)
    expect(secondaryCurrency.value).toBe('DOP')
    // 100 USD × 59.193349 = 5919.3349 → dos decimales.
    expect(convert(100)).toBe(5919.33)
  })

  it('pasa el hotelId como query cuando se lo dan (super admin mirando otro hotel)', async () => {
    httpGet.mockResolvedValue(RATE_OK)
    const mod = await freshModule()

    await mod.loadCurrencyConfig('hotel-42')

    expect(httpGet).toHaveBeenCalledWith('/tasa-cambio?hotelId=hotel-42')
  })

  it('expone fetchedAt, source y stale para que la UI diga de cuándo es la tasa', async () => {
    httpGet.mockResolvedValue({ ...RATE_OK, stale: true, source: 'manual' })
    const mod = await freshModule()
    await mod.loadCurrencyConfig()

    const { fetchedAt, source, stale } = mod.useCurrency('USD')
    expect(fetchedAt.value).toBe('2026-09-08T22:40:00.000Z')
    expect(source.value).toBe('manual')
    expect(stale.value).toBe(true)
  })

  it('cachea la carga y `force` la vuelve a pedir (ajustes refresca tras guardar)', async () => {
    httpGet.mockResolvedValue(RATE_OK)
    const mod = await freshModule()

    await mod.loadCurrencyConfig()
    await mod.loadCurrencyConfig()
    expect(httpGet).toHaveBeenCalledTimes(1)

    httpGet.mockResolvedValue({ ...RATE_OK, rate: 62.5 })
    const config = await mod.loadCurrencyConfig(undefined, true)
    expect(httpGet).toHaveBeenCalledTimes(2)
    expect(config.exchangeRate).toBe(62.5)
  })
})

describe('loadCurrencyConfig — degradación sin tasa (no se inventa ninguna)', () => {
  it('available:false → tasa 0 y convert() devuelve el monto sin convertir', async () => {
    // El backend responde 200 con rate null cuando el cron todavía no guardó tasas: no es un error.
    httpGet.mockResolvedValue({ ...RATE_OK, rate: null, available: false, fetchedAt: null, source: null })
    const mod = await freshModule()

    const config = await mod.loadCurrencyConfig()
    expect(config.exchangeRate).toBe(0)

    const { convert } = mod.useCurrency('USD')
    expect(convert(100)).toBe(100)
  })

  it('si la petición falla, no explota y convert() devuelve el monto original', async () => {
    httpGet.mockRejectedValue(new Error('Error 500'))
    const mod = await freshModule()

    const config = await mod.loadCurrencyConfig()
    expect(config.exchangeRate).toBe(0)
    expect(config.secondaryCurrency).toBe('')

    const { convert } = mod.useCurrency('USD')
    expect(convert(100)).toBe(100)
  })

  it('no queda ninguna tasa por defecto antes de cargar', async () => {
    const mod = await freshModule()
    const { exchangeRate, convert } = mod.useCurrency('USD')

    expect(exchangeRate.value).toBe(0)
    expect(convert(100)).toBe(100)
    expect(httpGet).not.toHaveBeenCalled()
  })
})

describe('regresión — el formato de moneda no cambió', () => {
  it('currencySymbol devuelve el símbolo conocido y el código con espacio para el resto', async () => {
    const { currencySymbol } = await freshModule()
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('DOP')).toBe('RD$')
    expect(currencySymbol('EUR')).toBe('€')
    expect(currencySymbol('JPY')).toBe('JPY ')
  })

  it('formatCurrency mantiene dos decimales y separador de miles', async () => {
    const { formatCurrency } = await freshModule()
    expect(formatCurrency(1234.5, 'USD')).toBe('$1,234.50')
    expect(formatCurrency(0, 'DOP')).toBe('RD$0.00')
  })

  it('convertAmount no convierte si el par es la misma moneda o no hay tasa', async () => {
    const { convertAmount } = await freshModule()
    expect(convertAmount(100, 'USD', 'USD', 59.19)).toBe(100)
    expect(convertAmount(100, 'USD', 'DOP', 0)).toBe(100)
    expect(convertAmount(100, 'USD', 'DOP', 59.193349)).toBe(5919.33)
  })

  it('format() del composable usa la moneda base del hotel', async () => {
    const { useCurrency } = await freshModule()
    const { format } = useCurrency('DOP')
    expect(format(1500)).toBe('RD$1,500.00')
    expect(format(1500, 'USD')).toBe('$1,500.00')
  })
})
