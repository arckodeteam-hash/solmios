// hoteles/tests/exchange-rate.test.ts — GET /api/tasa-cambio
// Se prueba la función del usecase directo (el repo no tiene tests HTTP): la ruta de index.ts es
// un adaptador de una línea y el HttpRequest del framework trae `query` como propiedad top-level,
// así que un objeto plano alcanza como request.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { getExchangeRate, type ExchangeRateDeps } from '../usecases/exchange-rate'

const HOTEL_ID = 'h1'
const AHORA = new Date('2026-03-10T12:00:00.000Z')

function fakeRepo(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async (filter: any = {}) => rows.filter((r) =>
      Object.entries(filter).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
  } as unknown as RepositoryAdapter<any>
}

function ratesRow(value: any) {
  return { id: 'cfg-rates', hotelId: 'platform', key: 'currency_rates', value }
}

function currencyConfigRow(value: any) {
  return { id: 'cfg-cur', hotelId: HOTEL_ID, key: 'currency_config', value }
}

const TASAS_FRESCAS = {
  base: 'USD',
  rates: { USD: 1, DOP: 60, EUR: 0.9 },
  fetchedAt: '2026-03-10T06:00:00.000Z',
  providerUpdatedAt: '2026-03-10T00:00:02.000Z',
  source: 'exchangerate-api',
}

function deps(opts: { hoteles?: any[]; configs?: any[] } = {}): ExchangeRateDeps {
  const hoteles = opts.hoteles ?? [{ id: HOTEL_ID, name: 'Hotel Uno', currency: 'USD' }]
  return {
    configRepo: fakeRepo(opts.configs ?? []),
    hotelRepo: fakeRepo(hoteles),
    resolveHotelId: async () => HOTEL_ID,
    now: AHORA,
  }
}

describe('getExchangeRate — tasa automática para el PMS', () => {
  it('hotel USD con secondaryCurrency DOP: devuelve la tasa guardada', async () => {
    const res = await getExchangeRate(
      deps({ configs: [ratesRow(TASAS_FRESCAS), currencyConfigRow({ secondaryCurrency: 'DOP' })] }),
      { query: {} },
    )
    expect(res.status).toBe(200)
    expect(res.body.from).toBe('USD')
    expect(res.body.to).toBe('DOP')
    expect(res.body.rate).toBe(60)
    expect(res.body.available).toBe(true)
    expect(res.body.stale).toBe(false)
    expect(res.body.fetchedAt).toBe('2026-03-10T06:00:00.000Z')
    expect(res.body.source).toBe('exchangerate-api')
  })

  it('moneda base distinta de USD (EUR → DOP): convierte por tasa cruzada', async () => {
    const res = await getExchangeRate(
      deps({
        hoteles: [{ id: HOTEL_ID, name: 'Hotel Euro', currency: 'EUR' }],
        configs: [ratesRow(TASAS_FRESCAS), currencyConfigRow({ secondaryCurrency: 'DOP' })],
      }),
      { query: {} },
    )
    expect(res.status).toBe(200)
    expect(res.body.from).toBe('EUR')
    expect(res.body.to).toBe('DOP')
    expect(res.body.rate).toBeCloseTo(60 / 0.9, 10)
    expect(res.body.available).toBe(true)
  })

  it('los query params from y to ganan sobre los defaults del hotel', async () => {
    const res = await getExchangeRate(
      deps({ configs: [ratesRow(TASAS_FRESCAS), currencyConfigRow({ secondaryCurrency: 'DOP' })] }),
      { query: { from: 'dop', to: 'eur' } },
    )
    expect(res.status).toBe(200)
    expect(res.body.from).toBe('DOP')
    expect(res.body.to).toBe('EUR')
    expect(res.body.rate).toBeCloseTo(0.9 / 60, 10)
  })

  it('sin tasas guardadas: 200 degradado (rate null, available false), NO 500', async () => {
    const res = await getExchangeRate(
      deps({ configs: [currencyConfigRow({ secondaryCurrency: 'DOP' })] }),
      { query: {} },
    )
    expect(res.status).toBe(200)
    expect(res.body.rate).toBeNull()
    expect(res.body.available).toBe(false)
    expect(res.body.from).toBe('USD')
    expect(res.body.to).toBe('DOP')
  })

  it('sin ?to y sin secondaryCurrency configurada: 400 con mensaje claro', async () => {
    const res = await getExchangeRate(deps({ configs: [ratesRow(TASAS_FRESCAS)] }), { query: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('moneda destino')
  })

  it('override manual: currency_config.exchangeRate gana sobre la tasa automática', async () => {
    const res = await getExchangeRate(
      deps({ configs: [ratesRow(TASAS_FRESCAS), currencyConfigRow({ secondaryCurrency: 'DOP', exchangeRate: 62.5 })] }),
      { query: {} },
    )
    expect(res.status).toBe(200)
    expect(res.body.rate).toBe(62.5)
    expect(res.body.source).toBe('manual')
    expect(res.body.stale).toBe(false)
    expect(res.body.available).toBe(true)
  })

  it('tasas viejas: stale true pero la tasa se devuelve igual', async () => {
    const viejas = { ...TASAS_FRESCAS, fetchedAt: '2026-03-01T06:00:00.000Z' }
    const res = await getExchangeRate(
      deps({ configs: [ratesRow(viejas), currencyConfigRow({ secondaryCurrency: 'DOP' })] }),
      { query: {} },
    )
    expect(res.status).toBe(200)
    expect(res.body.stale).toBe(true)
    expect(res.body.rate).toBe(60)
    expect(res.body.available).toBe(true)
  })

  it('el lastError de la última corrida del cron viaja en la respuesta', async () => {
    const conError = { ...TASAS_FRESCAS, lastError: 'HTTP 429 rate limited' }
    const res = await getExchangeRate(
      deps({ configs: [ratesRow(conError), currencyConfigRow({ secondaryCurrency: 'DOP' })] }),
      { query: {} },
    )
    expect(res.body.lastError).toBe('HTTP 429 rate limited')
    expect(res.body.rate).toBe(60)
  })

  it('config guardada como string JSON (adapter crudo): se parsea igual', async () => {
    const res = await getExchangeRate(
      deps({
        configs: [ratesRow(JSON.stringify(TASAS_FRESCAS)), currencyConfigRow(JSON.stringify({ secondaryCurrency: 'DOP' }))],
      }),
      { query: {} },
    )
    expect(res.status).toBe(200)
    expect(res.body.to).toBe('DOP')
    expect(res.body.rate).toBe(60)
  })

  it('sin hotel resuelto: 404, mismo criterio que el resto del módulo', async () => {
    const res = await getExchangeRate({ ...deps(), resolveHotelId: async () => undefined }, { query: {} })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Sin hotel')
  })
})
