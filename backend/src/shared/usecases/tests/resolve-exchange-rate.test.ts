// Cubre el usecase compartido de tasa de cambio: la matemática cruzada (que NO asume USD como
// base), la lectura tolerante de `configuration.currency_rates` y la degradación cuando el cron
// no corrió o la moneda no está en la tabla. Sin red y sin base: doble de repo inline, mismo
// molde que folios/tests/tax-rate-fallback.test.ts.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import {
  RATES_MAX_AGE_MS,
  convertWithRates,
  crossRate,
  readCurrencyRatesConfig,
  resolveExchangeRate,
} from '../resolve-exchange-rate'

const RATES = { USD: 1, DOP: 59.193349, EUR: 0.86103, MXN: 16.932921 }

const CONFIG = {
  base: 'USD',
  rates: RATES,
  fetchedAt: '2026-09-08T22:40:00.000Z',
  source: 'exchangerate-api',
  providerUpdatedAt: '2026-09-08T00:02:31.000Z',
  nextUpdateAt: '2026-09-09T00:34:21.000Z',
}

function fakeRepo(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async (filter: any) => rows.filter((r) =>
      Object.entries(filter || {}).every(([k, v]) => r[k] === v)),
  } as unknown as RepositoryAdapter<any>
}

function throwingRepo(): RepositoryAdapter<any> {
  return {
    findMany: async () => { throw new Error('db caída') },
  } as unknown as RepositoryAdapter<any>
}

function configRow(value: any) {
  return { id: 'c1', hotelId: 'platform', key: 'currency_rates', value }
}

describe('crossRate — tasa cruzada entre cualquier par', () => {
  it('USD → DOP con tabla base USD', () => {
    expect(crossRate(RATES, 'USD', 'DOP')).toBeCloseTo(59.193349, 6)
  })

  it('DOP → EUR: no está atado a USD como base', () => {
    expect(crossRate(RATES, 'DOP', 'EUR')).toBeCloseTo(0.86103 / 59.193349, 10)
  })

  it('EUR → DOP es el inverso de DOP → EUR', () => {
    expect(crossRate(RATES, 'EUR', 'DOP')).toBeCloseTo(59.193349 / 0.86103, 8)
    const ida = crossRate(RATES, 'DOP', 'EUR') as number
    const vuelta = crossRate(RATES, 'EUR', 'DOP') as number
    expect(ida * vuelta).toBeCloseTo(1, 10)
  })

  // Regresión: dos códigos vacíos NO son "la misma moneda". Sin el guard, el atajo `from === to`
  // devolvía 1 y el caller lo leía como una conversión válida 1:1 en vez de degradar.
  it('códigos vacíos → null (no una tasa 1:1 fantasma)', () => {
    expect(crossRate(RATES, '', '')).toBeNull()
    expect(crossRate(RATES, '', 'DOP')).toBeNull()
    expect(crossRate(RATES, 'USD', '')).toBeNull()
    expect(crossRate(RATES, undefined as any, undefined as any)).toBeNull()
  })

  // Regresión: un código en blanco tampoco es una moneda. Antes del trim, ' ' y ' ' eran
  // "iguales" y el atajo de identidad devolvía 1.
  it('códigos en blanco → null', () => {
    expect(crossRate(RATES, ' ', ' ')).toBeNull()
    expect(crossRate(RATES, '  ', 'DOP')).toBeNull()
    expect(crossRate(RATES, 'USD', '   ')).toBeNull()
  })

  it('espacios alrededor de un código válido no rompen la conversión', () => {
    expect(crossRate(RATES, ' USD ', 'DOP')).toBeCloseTo(59.193349, 6)
  })

  it('misma moneda → 1', () => {
    expect(crossRate(RATES, 'DOP', 'DOP')).toBe(1)
  })

  it('moneda ausente en la tabla → null', () => {
    expect(crossRate(RATES, 'DOP', 'JPY')).toBeNull()
    expect(crossRate(RATES, 'JPY', 'DOP')).toBeNull()
  })

  it('rate 0 o negativo → null (dividir por eso da Infinity o signo invertido)', () => {
    expect(crossRate({ ...RATES, DOP: 0 }, 'DOP', 'EUR')).toBeNull()
    expect(crossRate({ ...RATES, EUR: -1 }, 'DOP', 'EUR')).toBeNull()
  })

  it('rates null o undefined → null', () => {
    expect(crossRate(null, 'USD', 'DOP')).toBeNull()
    expect(crossRate(undefined, 'USD', 'DOP')).toBeNull()
  })
})

describe('convertWithRates', () => {
  it('convierte y redondea a 2 decimales', () => {
    expect(convertWithRates(100, 'USD', 'DOP', RATES)).toBe(5919.33)
    expect(convertWithRates(1000, 'DOP', 'EUR', RATES)).toBe(14.55)
  })

  it('sin tasa devuelve el monto original (degradación graceful)', () => {
    expect(convertWithRates(123.45, 'DOP', 'JPY', RATES)).toBe(123.45)
    expect(convertWithRates(123.45, 'USD', 'DOP', null)).toBe(123.45)
  })
})

describe('readCurrencyRatesConfig', () => {
  it('value como objeto (el ORM deserializa la columna json)', async () => {
    const config = await readCurrencyRatesConfig(fakeRepo([configRow(CONFIG)]))
    expect(config?.rates?.DOP).toBeCloseTo(59.193349, 6)
    expect(config?.fetchedAt).toBe('2026-09-08T22:40:00.000Z')
    expect(config?.source).toBe('exchangerate-api')
  })

  it('value como string JSON (adapter crudo)', async () => {
    const config = await readCurrencyRatesConfig(fakeRepo([configRow(JSON.stringify(CONFIG))]))
    expect(config?.rates?.EUR).toBeCloseTo(0.86103, 6)
    expect(config?.providerUpdatedAt).toBe('2026-09-08T00:02:31.000Z')
  })

  it('sin fila → null', async () => {
    expect(await readCurrencyRatesConfig(fakeRepo([]))).toBeNull()
  })

  it('el repo tira → null, no propaga', async () => {
    expect(await readCurrencyRatesConfig(throwingRepo())).toBeNull()
  })

  it('JSON corrupto → null', async () => {
    expect(await readCurrencyRatesConfig(fakeRepo([configRow('{no-json')]))).toBeNull()
  })
})

describe('resolveExchangeRate', () => {
  const now = new Date('2026-09-09T00:00:00.000Z')

  it('caso feliz: rate, fetchedAt, providerUpdatedAt, source y available', async () => {
    const res = await resolveExchangeRate(fakeRepo([configRow(CONFIG)]), 'USD', 'DOP', { now })
    expect(res.rate).toBeCloseTo(59.193349, 6)
    expect(res.from).toBe('USD')
    expect(res.to).toBe('DOP')
    expect(res.fetchedAt).toBe('2026-09-08T22:40:00.000Z')
    expect(res.providerUpdatedAt).toBe('2026-09-08T00:02:31.000Z')
    expect(res.source).toBe('exchangerate-api')
    expect(res.available).toBe(true)
    expect(res.stale).toBe(false)
    expect(res.lastError).toBeNull()
  })

  it('normaliza las monedas a mayúsculas', async () => {
    const res = await resolveExchangeRate(fakeRepo([configRow(CONFIG)]), 'dop', 'eur', { now })
    expect(res.from).toBe('DOP')
    expect(res.to).toBe('EUR')
    expect(res.rate).toBeCloseTo(0.86103 / 59.193349, 10)
  })

  it('sin config: rate null, available false, no tira', async () => {
    const res = await resolveExchangeRate(fakeRepo([]), 'USD', 'DOP', { now })
    expect(res.rate).toBeNull()
    expect(res.available).toBe(false)
    expect(res.fetchedAt).toBeNull()
    expect(res.source).toBeNull()
    expect(res.stale).toBe(true)
  })

  it('moneda no soportada por la tabla: available false', async () => {
    const res = await resolveExchangeRate(fakeRepo([configRow(CONFIG)]), 'DOP', 'JPY', { now })
    expect(res.rate).toBeNull()
    expect(res.available).toBe(false)
    // La config se leyó igual: el caller puede decir de cuándo son las tasas que sí hay.
    expect(res.fetchedAt).toBe('2026-09-08T22:40:00.000Z')
  })

  it('fetchedAt viejo: stale true PERO con la tasa igual presente', async () => {
    const viejo = new Date(Date.parse(CONFIG.fetchedAt) + RATES_MAX_AGE_MS + 60_000)
    const res = await resolveExchangeRate(fakeRepo([configRow(CONFIG)]), 'USD', 'DOP', { now: viejo })
    expect(res.stale).toBe(true)
    expect(res.available).toBe(true)
    expect(res.rate).toBeCloseTo(59.193349, 6)
  })

  it('fetchedAt reciente: stale false', async () => {
    const reciente = new Date(Date.parse(CONFIG.fetchedAt) + RATES_MAX_AGE_MS - 60_000)
    const res = await resolveExchangeRate(fakeRepo([configRow(CONFIG)]), 'USD', 'DOP', { now: reciente })
    expect(res.stale).toBe(false)
  })

  // Regresión del mismo bug, a nivel del caso de uso: resolveExchangeRate normaliza undefined a ''
  // y sin el guard devolvía {rate:1, available:true} con una tabla de tasas real cargada.
  it('monedas ausentes → available:false, no una tasa 1:1', async () => {
    const res = await resolveExchangeRate(fakeRepo([configRow(CONFIG)]), undefined as any, undefined as any, { now })
    expect(res.rate).toBeNull()
    expect(res.available).toBe(false)
  })

  it('monedas en blanco → available:false, no una tasa 1:1', async () => {
    const res = await resolveExchangeRate(fakeRepo([configRow(CONFIG)]), ' ', ' ', { now })
    expect(res.rate).toBeNull()
    expect(res.available).toBe(false)
  })

  it('config con lastError del cron: lo expone en el resultado', async () => {
    const conError = configRow({ ...CONFIG, lastError: 'HTTP 429', lastErrorAt: '2026-09-09T00:10:00.000Z' })
    const res = await resolveExchangeRate(fakeRepo([conError]), 'USD', 'DOP', { now })
    expect(res.lastError).toBe('HTTP 429')
    // La última tasa buena sigue disponible aunque la última corrida haya fallado.
    expect(res.available).toBe(true)
    expect(res.rate).toBeCloseTo(59.193349, 6)
  })
})
