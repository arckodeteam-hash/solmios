// shared/usecases/tests/currency-rates-cron.test.ts — F2 2.7 (spec booking-widget, D10).
//
// Cubre el cron de tasas de cambio contra ExchangeRate-API (Open Access, sin credencial).
// Tests a nivel factory + fetcher inyectable (sin red); el único que toca `fetch` lo mockea
// guardando y restaurando el global.
//
// Aceptancia (tasks.md 2.7 + criterios del issue):
//  - tras correr el cron, configuration('currency_rates') tiene {base, rates, fetchedAt, source}.
//  - si la API falla (5xx, 429, timeout), conserva la última tasa válida y registra el error.
//
// Casos:
//  (1) Happy path — fetch OK → upsert con {base, rates, fetchedAt, source, providerUpdatedAt}.
//  (2) Error del proveedor (HTTP 500) → updated=false, reason='fetch_failed', rates viejas
//      intactas + lastError/lastErrorAt escritos.
//  (3) Timeout (TimeoutError) → mismo tratamiento, el mensaje queda en lastError.
//  (4) Rate limit (429) → updated=false, rates conservadas.
//  (5) Response inválido (menos de 2 monedas) → reason='invalid_response', no pisa.
//  (6) Sin fila previa + fetch fallido → NO crea fila (una config sin rates rompe consumidores).
//  (7) Fetch OK después de un error previo → lastError queda limpio.
//  (8) Idempotente — 2da corrida hace UPDATE (no CREATE duplicado).
//  (9) defaultFetcher — arma la URL con la base recibida y pasa un `signal` (timeout) al fetch.
import { describe, it, expect } from 'bun:test'
import { createCurrencyRatesCron, createDefaultFetcher, REQUEST_TIMEOUT_MS } from '../currency-rates-cron'

function makeOrm(existingConfigRow: any | null) {
  const state: { row: any | null } = { row: existingConfigRow }
  const created: any[] = []
  const updated: any[] = []
  const orm: any = {
    findMany: async () => (state.row ? [state.row] : []),
    create: async (_model: string, payload: any) => {
      const row = { id: 'cfg-1', ...payload }
      created.push(row)
      state.row = row
      return row
    },
    update: async (_model: string, id: string, patch: any) => {
      updated.push({ id, patch })
      if (state.row) Object.assign(state.row, patch)
      return null
    },
  }
  return { orm, created, updated, state }
}

const fakeLogger = { info: () => {}, warn: () => {} }

/** Payload tal cual lo normaliza el fetcher desde open.er-api.com. */
const okPayload = () => ({
  base: 'USD',
  rates: { USD: 1, EUR: 0.86, DOP: 59.193349 },
  providerUpdatedAt: '2026-09-08T00:02:31.000Z',
  nextUpdateAt: '2026-09-09T00:34:21.000Z',
})

/** Fila previa con tasas buenas, para verificar que un fallo no las pisa. */
const goodRow = () => ({
  id: 'old-1',
  hotelId: 'platform',
  key: 'currency_rates',
  value: { base: 'USD', rates: { USD: 1, EUR: 0.9 }, fetchedAt: '2020-01-01', source: 'exchangerate-api' },
})

describe('createCurrencyRatesCron — F2 2.7', () => {
  it('(1) happy path: fetch OK → upsert configuration(currency_rates)', async () => {
    const { orm, created, updated } = makeOrm(null)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => okPayload())
    const result = await cron()

    expect(result.updated).toBe(true)
    expect(result.count).toBe(3)
    expect(result.base).toBe('USD')
    expect(created).toHaveLength(1)
    expect(updated).toHaveLength(0) // no existía → create, no update
    expect(created[0].key).toBe('currency_rates')
    expect(created[0].hotelId).toBe('platform')
    expect(created[0].value.base).toBe('USD')
    expect(created[0].value.rates.DOP).toBe(59.193349)
    expect(created[0].value.source).toBe('exchangerate-api')
    expect(typeof created[0].value.fetchedAt).toBe('string')
    expect(created[0].value.providerUpdatedAt).toBe('2026-09-08T00:02:31.000Z')
    expect(created[0].value.nextUpdateAt).toBe('2026-09-09T00:34:21.000Z')
  })

  it('(2) error del proveedor (HTTP 500) → conserva rates viejas y registra lastError', async () => {
    const row = goodRow()
    const { orm, created, updated } = makeOrm(row)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => {
      throw new Error('exchangerate-api responded 500: upstream down')
    })
    const result = await cron()

    expect(result.updated).toBe(false)
    expect(result.reason).toBe('fetch_failed')
    expect(created).toHaveLength(0)
    // Las rates buenas siguen ahí, con su fetchedAt original.
    expect(row.value.rates).toEqual({ USD: 1, EUR: 0.9 })
    expect(row.value.fetchedAt).toBe('2020-01-01')
    expect(row.value.base).toBe('USD')
    // …y el fallo quedó registrado sobre el valor existente.
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('old-1')
    expect(updated[0].patch.value.lastError).toContain('500')
    expect(typeof updated[0].patch.value.lastErrorAt).toBe('string')
    expect(updated[0].patch.value.rates).toEqual({ USD: 1, EUR: 0.9 })
  })

  it('(3) timeout del proveedor → no pisa rates y deja el mensaje en lastError', async () => {
    const row = goodRow()
    const { orm, created, updated } = makeOrm(row)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => {
      const err = new Error('The operation timed out.')
      err.name = 'TimeoutError'
      throw err
    })
    const result = await cron()

    expect(result.updated).toBe(false)
    expect(result.reason).toBe('fetch_failed')
    expect(created).toHaveLength(0)
    expect(row.value.rates).toEqual({ USD: 1, EUR: 0.9 })
    expect(row.value.fetchedAt).toBe('2020-01-01')
    expect(updated[0].patch.value.lastError).toBe('The operation timed out.')
    expect(typeof updated[0].patch.value.lastErrorAt).toBe('string')
  })

  it('(4) rate limit 429 → updated=false y rates conservadas', async () => {
    const row = goodRow()
    const { orm, created, updated } = makeOrm(row)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => {
      throw new Error('exchangerate-api rate limit (HTTP 429) — reintentar tras la ventana de 20 min')
    })
    const result = await cron()

    expect(result.updated).toBe(false)
    expect(result.reason).toBe('fetch_failed')
    expect(created).toHaveLength(0)
    expect(row.value.rates).toEqual({ USD: 1, EUR: 0.9 })
    expect(updated[0].patch.value.lastError).toContain('429')
  })

  it('(5) response inválido (menos de 2 monedas) → invalid_response, no pisa', async () => {
    const row = goodRow()
    const { orm, created, updated } = makeOrm(row)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => ({ base: 'USD', rates: { USD: 1 } }))
    const result = await cron()

    expect(result.updated).toBe(false)
    expect(result.reason).toBe('invalid_response')
    expect(created).toHaveLength(0)
    expect(row.value.rates).toEqual({ USD: 1, EUR: 0.9 })
    expect(updated[0].patch.value.lastError).toContain('rates')
  })

  it('(5b) acepta el value existente serializado como string (columna json del ORM)', async () => {
    const row = {
      id: 'old-1',
      value: JSON.stringify({ base: 'USD', rates: { USD: 1, EUR: 0.9 }, fetchedAt: '2020-01-01' }),
    }
    const { orm, updated } = makeOrm(row)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => { throw new Error('network down') })
    await cron()

    expect(updated).toHaveLength(1)
    expect(updated[0].patch.value.rates).toEqual({ USD: 1, EUR: 0.9 })
    expect(updated[0].patch.value.lastError).toBe('network down')
  })

  it('(6) sin fila previa + fetch fallido → no crea ninguna fila', async () => {
    const { orm, created, updated } = makeOrm(null)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => { throw new Error('network down') })
    const result = await cron()

    expect(result.updated).toBe(false)
    expect(result.reason).toBe('fetch_failed')
    expect(created.length).toBe(0) // una config con solo el error (sin rates) rompe a los consumidores
    expect(updated).toHaveLength(0)
  })

  it('(7) fetch OK después de un error previo → lastError queda limpio', async () => {
    const row = {
      id: 'old-1',
      value: { base: 'USD', rates: { USD: 1, EUR: 0.9 }, fetchedAt: '2020-01-01', lastError: 'network down', lastErrorAt: '2020-01-02' },
    }
    const { orm, updated } = makeOrm(row)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => okPayload())
    const result = await cron()

    expect(result.updated).toBe(true)
    expect(updated).toHaveLength(1)
    expect(updated[0].patch.value.lastError).toBeUndefined()
    expect(updated[0].patch.value.lastErrorAt).toBeUndefined()
    expect(updated[0].patch.value.rates.DOP).toBe(59.193349)
  })

  it('(8) idempotente: 2da corrida hace UPDATE (no CREATE duplicado)', async () => {
    const { orm, created, updated } = makeOrm(null)
    const cron = createCurrencyRatesCron(orm, fakeLogger, async () => okPayload())

    await cron()
    expect(created).toHaveLength(1)
    expect(updated).toHaveLength(0)

    await cron()
    expect(created).toHaveLength(1) // no se creó otro
    expect(updated).toHaveLength(1) // esta vez hizo update
    expect(updated[0].patch.value.rates.EUR).toBe(0.86)
  })

  it('funciona con la firma que usa composition-root (orm, logger) sin fetcher explícito', async () => {
    const { orm } = makeOrm(null)
    expect(typeof createCurrencyRatesCron(orm, fakeLogger)).toBe('function')
  })
})

describe('createDefaultFetcher — ExchangeRate-API Open Access', () => {
  it('(9) arma la URL con la base recibida y pasa un signal con timeout al fetch', async () => {
    const orig = globalThis.fetch
    const calls: Array<{ url: string; opts: any }> = []
    globalThis.fetch = (async (url: any, opts: any) => {
      calls.push({ url: String(url), opts })
      return new Response(JSON.stringify({
        result: 'success',
        base_code: 'DOP',
        rates: { DOP: 1, USD: 0.0169 },
        time_last_update_utc: 'Tue, 08 Sep 2026 00:02:31 +0000',
        time_next_update_unix: 1788914061,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as any
    try {
      const payload = await createDefaultFetcher('DOP')()

      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe('https://open.er-api.com/v6/latest/DOP')
      expect(calls[0].opts.signal).toBeDefined()
      expect(typeof calls[0].opts.signal.aborted).toBe('boolean')
      expect(REQUEST_TIMEOUT_MS).toBe(10_000)
      expect(payload.base).toBe('DOP')
      expect(payload.rates.USD).toBe(0.0169)
      expect(payload.providerUpdatedAt).toBe('2026-09-08T00:02:31.000Z')
      expect(payload.nextUpdateAt).toBe(new Date(1788914061 * 1000).toISOString())
    } finally {
      globalThis.fetch = orig
    }
  })

  it('(9b) result=error con HTTP 200 → tira con el error-type del proveedor', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ result: 'error', 'error-type': 'unsupported-code' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as any
    try {
      await expect(createDefaultFetcher('XXX')()).rejects.toThrow('unsupported-code')
    } finally {
      globalThis.fetch = orig
    }
  })

  it('(9c) HTTP 429 → error que nombra el rate limit', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async () => new Response('rate limited', { status: 429 })) as any
    try {
      await expect(createDefaultFetcher()()).rejects.toThrow('429')
    } finally {
      globalThis.fetch = orig
    }
  })
})
