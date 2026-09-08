// services/currency.test.ts — Tests de la resolución de tasa del PMS (issue #83).
//
// Lo que se prueba: que `getCurrencyConfig` use la tasa AUTOMÁTICA del cron
// (`configuration(hotelId='platform', key='currency_rates')`) y deje la manual como override, con
// la MISMA precedencia que `GET /api/tasa-cambio`. Dobles inline, sin red ni base.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { getCurrencyConfig, convertAmount, formatCurrency, getCurrencySymbol } from './currency'

const HOTEL = 'hotel-1'
const FETCHED_AT = '2026-09-08T06:00:00.000Z'
const NOW = new Date('2026-09-08T12:00:00.000Z')

interface Row { hotelId: string; key: string; value: any }

/** Doble del repo de `Configuration`: `findOne` lo usa `currency_config`, `findMany` las rates. */
function repoWith(rows: Row[]): RepositoryAdapter<any> {
  const match = (r: Row, f: any) => r.hotelId === f.hotelId && r.key === f.key
  return {
    findOne: async (f: any) => rows.find(r => match(r, f)) ?? null,
    findMany: async (f: any) => rows.filter(r => match(r, f)),
  } as any
}

/** Fila de tasas tal como la deja `currency-rates-cron`. */
function ratesRow(rates: Record<string, number>, extra: Record<string, any> = {}): Row {
  return {
    hotelId: 'platform',
    key: 'currency_rates',
    value: { base: 'USD', rates, fetchedAt: FETCHED_AT, source: 'exchangerate-api', ...extra },
  }
}

function currencyConfigRow(value: any): Row {
  return { hotelId: HOTEL, key: 'currency_config', value }
}

describe('getCurrencyConfig — tasa automática (issue #83)', () => {
  it('sin tasa manual → devuelve la automática con source auto y fetchedAt', async () => {
    const repo = repoWith([
      currencyConfigRow({ secondaryCurrency: 'DOP' }),
      ratesRow({ USD: 1, DOP: 59.193349 }),
    ])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.secondaryCurrency).toBe('DOP')
    expect(config.exchangeRate).toBe(59.193349)
    expect(config.source).toBe('auto')
    expect(config.fetchedAt).toBe(FETCHED_AT)
    expect(config.stale).toBe(false)
  })

  it('exchangeRate en 0 cuenta como "sin manual" → usa la automática', async () => {
    const repo = repoWith([
      currencyConfigRow({ secondaryCurrency: 'DOP', exchangeRate: 0 }),
      ratesRow({ USD: 1, DOP: 59.193349 }),
    ])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.exchangeRate).toBe(59.193349)
    expect(config.source).toBe('auto')
  })

  it('override manual gana sobre la automática cargada', async () => {
    const repo = repoWith([
      currencyConfigRow({ secondaryCurrency: 'DOP', exchangeRate: 62.5 }),
      ratesRow({ USD: 1, DOP: 59.193349 }),
    ])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.exchangeRate).toBe(62.5)
    expect(config.source).toBe('manual')
    expect(config.fetchedAt).toBeNull()
    expect(config.stale).toBe(false)
  })

  it('override manual como string numérico (viene del formulario) también gana', async () => {
    const repo = repoWith([
      currencyConfigRow({ secondaryCurrency: 'DOP', exchangeRate: '62.5' }),
      ratesRow({ USD: 1, DOP: 59.193349 }),
    ])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.exchangeRate).toBe(62.5)
    expect(config.source).toBe('manual')
  })

  it('moneda base distinta de USD → tasa cruzada, no la de USD', async () => {
    const repo = repoWith([
      currencyConfigRow({ secondaryCurrency: 'DOP' }),
      ratesRow({ USD: 1, EUR: 0.92, DOP: 59.193349 }),
    ])

    const config = await getCurrencyConfig(repo, HOTEL, 'EUR', { now: NOW })

    expect(config.exchangeRate).toBeCloseTo(59.193349 / 0.92, 9)
    expect(config.exchangeRate).not.toBeCloseTo(59.193349, 4)
    expect(config.source).toBe('auto')
  })

  it('base por defecto USD cuando el caller no la pasa (retrocompatible)', async () => {
    const repo = repoWith([
      currencyConfigRow({ secondaryCurrency: 'DOP' }),
      ratesRow({ USD: 1, DOP: 59.193349 }),
    ])

    const config = await getCurrencyConfig(repo, HOTEL)

    expect(config.exchangeRate).toBe(59.193349)
    expect(config.source).toBe('auto')
  })

  it('tasas del cron vencidas → devuelve la tasa igual, marcada stale', async () => {
    const repo = repoWith([
      currencyConfigRow({ secondaryCurrency: 'DOP' }),
      ratesRow({ USD: 1, DOP: 59.193349 }, { fetchedAt: '2026-08-01T00:00:00.000Z' }),
    ])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.exchangeRate).toBe(59.193349)
    expect(config.stale).toBe(true)
  })
})

describe('getCurrencyConfig — degradación', () => {
  it('sin currency_config → default {secondaryCurrency:"", exchangeRate:0}', async () => {
    const repo = repoWith([ratesRow({ USD: 1, DOP: 59.193349 })])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.secondaryCurrency).toBe('')
    expect(config.exchangeRate).toBe(0)
    expect(config.source).toBeNull()
    expect(config.fetchedAt).toBeNull()
  })

  it('sin tasas automáticas y sin manual → exchangeRate 0 conservando la secundaria', async () => {
    const repo = repoWith([currencyConfigRow({ secondaryCurrency: 'DOP' })])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.secondaryCurrency).toBe('DOP')
    expect(config.exchangeRate).toBe(0)
    expect(config.source).toBeNull()
  })

  it('moneda secundaria ausente de la tabla de tasas → exchangeRate 0', async () => {
    const repo = repoWith([
      currencyConfigRow({ secondaryCurrency: 'DOP' }),
      ratesRow({ USD: 1, EUR: 0.92 }),
    ])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.exchangeRate).toBe(0)
    expect(config.source).toBeNull()
  })

  it('el repo tira → no explota, devuelve el default', async () => {
    const repo = {
      findOne: async () => { throw new Error('db caída') },
      findMany: async () => { throw new Error('db caída') },
    } as any

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config).toEqual({ secondaryCurrency: '', exchangeRate: 0, source: null, fetchedAt: null, stale: false })
  })

  it('value como string JSON (adapter crudo) se parsea igual que el objeto', async () => {
    const repo = repoWith([
      currencyConfigRow(JSON.stringify({ secondaryCurrency: 'DOP' })),
      { hotelId: 'platform', key: 'currency_rates', value: JSON.stringify({ base: 'USD', rates: { USD: 1, DOP: 59.193349 }, fetchedAt: FETCHED_AT }) },
    ])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config.secondaryCurrency).toBe('DOP')
    expect(config.exchangeRate).toBe(59.193349)
    expect(config.source).toBe('auto')
  })

  it('value string ilegible → default sin romper', async () => {
    const repo = repoWith([currencyConfigRow('{no es json')])

    const config = await getCurrencyConfig(repo, HOTEL, 'USD', { now: NOW })

    expect(config).toEqual({ secondaryCurrency: '', exchangeRate: 0, source: null, fetchedAt: null, stale: false })
  })
})

describe('convertAmount / formato (comportamiento conservado)', () => {
  it('misma moneda → no convierte', () => {
    expect(convertAmount(100, 'USD', 'USD', 59.193349)).toBe(100)
  })

  it('tasa 0 → devuelve el monto original', () => {
    expect(convertAmount(100, 'USD', 'DOP', 0)).toBe(100)
  })

  it('convierte y redondea a 2 decimales', () => {
    expect(convertAmount(100, 'USD', 'DOP', 59.193349)).toBe(5919.33)
    expect(convertAmount(10.005, 'USD', 'DOP', 1)).toBe(10.01)
  })

  it('formatCurrency y getCurrencySymbol sin cambios', () => {
    expect(formatCurrency(1234.5, 'DOP')).toBe('RD$1,234.50')
    expect(getCurrencySymbol('DOP')).toBe('RD$')
    expect(getCurrencySymbol('XYZ')).toBe('XYZ ')
  })
})
