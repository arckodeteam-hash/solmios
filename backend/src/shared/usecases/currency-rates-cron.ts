// shared/usecases/currency-rates-cron.ts — Cron nightly de tasas de cambio (F2 2.7, D10).
//
// Fetcha `https://open.er-api.com/v6/latest/{BASE}` (ExchangeRate-API, endpoint Open Access) y
// guarda el resultado en `configuration(key='currency_rates', hotelId='platform')`.
//
// Por qué ExchangeRate-API Open Access (ver docs/comparativa-apis-tasas-cambio.md): es gratuito
// y NO pide credencial (nada que rotar ni que se venza en prod), cubre DOP —la moneda del
// mercado del PMS— y acepta CUALQUIER moneda base en la URL, cosa que los planes gratuitos de
// los otros proveedores fijan en USD. Actualiza una vez por día, así que el tick de 24h alcanza.
//
// La plataforma comparte las rates con TODOS los hoteles (son tasas globales del día, no hay
// razón de fetchear por hotel). El endpoint público /rates las consume para conversión display.
//
// Schedule: el cron vive como factory + setInterval en composition-root (mismo molde que
// night-audit-cron / referral-credits-cron). Período: 24h. Primera corrida a los 10s
// (anti-restart).
//
// Idempotente: re-correr pisa configuration.currency_rates con el valor más reciente. Si la API
// falla (timeout, 429, red, response inválido), conserva las últimas tasas buenas SIN tocarlas y
// solo agrega `lastError`/`lastErrorAt` al valor existente, para que el fallo quede registrado y
// auditable sin dejar a los consumidores sin tasas.
//
// Anti-patrón ORM: NO toca modelos — usa orm crudo sobre `Configuration` (registrado en
// shared/models.ts). Mismo molde que los otros crones shared/* (recorre datos globales, no hay
// req.user, no hay repos inyectados por módulo).
const PLATFORM = 'platform'
const CONFIG_KEY = 'currency_rates'
const EXCHANGERATE_API_ENDPOINT = 'https://open.er-api.com/v6/latest'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** Timeout duro del fetch: sin él un proveedor que no responde deja la promesa colgada. */
export const REQUEST_TIMEOUT_MS = 10_000

export interface CurrencyRatesResult {
  /** true si actualizó las rates; false si skipeó (fetch falló, response inválido, persist falló). */
  updated: boolean
  /** Cantidad de monedas en la nueva versión (0 si no actualizó). */
  count: number
  /** Base de las rates guardadas. */
  base: string
  /** Timestamp ISO de la actualización (o del intento si falló). */
  fetchedAt: string
  /** Motivo del skip cuando updated=false (para telemetría). */
  reason?: 'fetch_failed' | 'invalid_response' | 'persist_failed'
}

/** Payload normalizado que devuelve el fetcher (los timestamps son los del proveedor). */
export interface RatesPayload {
  base: string
  rates: Record<string, number>
  /** ISO de `time_last_update_utc` — cuándo el proveedor calculó estas tasas. */
  providerUpdatedAt?: string
  /** ISO de `time_next_update_unix` — cuándo las vuelve a recalcular. */
  nextUpdateAt?: string
}

/**
 * Inyeccion del fetcher para testear sin tocar la red. En prod se usa `fetch` global (Bun lo
 * expone). Mismo truco que referral-credits-cron con `now`.
 */
export type RatesFetcher = () => Promise<RatesPayload>

/** Fetcher default: llama a ExchangeRate-API. Exportado para tests puntuales si hiciera falta. */
export function createDefaultFetcher(baseCurrency = 'USD'): RatesFetcher {
  return async () => {
    const base = String(baseCurrency || 'USD').toUpperCase()
    const url = `${EXCHANGERATE_API_ENDPOINT}/${encodeURIComponent(base)}`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (res.status === 429) {
      // El Open Access tiene rate limit con ventana de recuperación de ~20 min: nombrarlo
      // explícito para que el log diga qué esperar en vez de "responded 429".
      throw new Error('exchangerate-api rate limit (HTTP 429) — reintentar tras la ventana de 20 min')
    }
    if (!res.ok) {
      throw new Error(`exchangerate-api responded ${res.status}: ${await res.text().catch(() => '')}`)
    }
    const json = await res.json() as {
      result?: string
      'error-type'?: string
      base_code?: string
      rates?: Record<string, number>
      time_last_update_utc?: string
      time_next_update_unix?: number
    }
    if (!json || typeof json !== 'object') throw new Error('exchangerate-api response vacío')
    // El proveedor devuelve los errores con HTTP 200 y result='error'.
    if (json.result !== 'success') {
      throw new Error(`exchangerate-api result=${json.result ?? 'desconocido'}: ${json['error-type'] ?? 'sin error-type'}`)
    }
    if (!json.rates || typeof json.rates !== 'object') {
      throw new Error('exchangerate-api response sin campo rates')
    }
    return {
      base: String(json.base_code || base).toUpperCase(),
      rates: json.rates,
      providerUpdatedAt: toIso(json.time_last_update_utc),
      nextUpdateAt: toIso(json.time_next_update_unix),
    }
  }
}

/** Fetcher default con base USD (el que usa el cron si no le pasan otra). */
export const defaultFetcher: RatesFetcher = createDefaultFetcher()

/** Normaliza un timestamp del proveedor (string UTC o epoch en segundos) a ISO. `undefined` si no vino o es basura. */
function toIso(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Factory del cron. Devuelve la función que composition-root engancha a setInterval.
 *
 * @param orm           ORM del framework (lee/escribe Configuration).
 * @param logger        Logger del system.
 * @param fetcher       Fetcher inyectable (default = fetch a ExchangeRate-API).
 * @param baseCurrency  Moneda base de las tasas (default 'USD'); solo aplica al fetcher default.
 */
export function createCurrencyRatesCron(
  orm: any,
  logger: any,
  fetcher?: RatesFetcher,
  baseCurrency = 'USD',
): () => Promise<CurrencyRatesResult> {
  const base = String(baseCurrency || 'USD').toUpperCase()
  const fetchRates = fetcher ?? createDefaultFetcher(base)

  /**
   * Registra el error EN la fila existente sin tocar rates/base/fetchedAt: la última tasa buena
   * se conserva y el fallo queda auditable. Si nunca hubo tasas no crea nada — una config con
   * solo el error (sin `rates`) rompería a los consumidores de public-rates/public-calendar.
   */
  const recordError = async (message: string, at: string) => {
    try {
      const existing = (await orm.findMany('Configuration', { hotelId: PLATFORM, key: CONFIG_KEY })) as any[]
      const row = existing?.[0]
      if (!row) return
      // La columna `value` es type:'json' y el ORM la deserializa sola, pero un adapter crudo
      // podría devolver el texto: aceptamos las dos formas (mismo criterio que config-kv).
      const raw = row.value
      const current = (typeof raw === 'string' ? JSON.parse(raw) : raw) ?? {}
      await orm.update('Configuration', row.id, { value: { ...current, lastError: message, lastErrorAt: at } })
    } catch (e: any) {
      logger.warn('currency-rates-cron: no pudo registrar lastError', { error: e?.message })
    }
  }

  return async (): Promise<CurrencyRatesResult> => {
    const fetchedAt = new Date().toISOString()

    let payload: RatesPayload
    try {
      payload = await fetchRates()
    } catch (e: any) {
      const message = e?.message || String(e)
      logger.warn('currency-rates-cron: fetch falló — conserva rates anteriores', { error: message })
      await recordError(message, fetchedAt)
      return { updated: false, count: 0, base, fetchedAt, reason: 'fetch_failed' }
    }

    // Sanity-check: rates tiene que traer la base y un par más. Si el payload es basura, no
    // pisamos la config (mejor rates viejas que rates rotas).
    if (!payload?.rates || typeof payload.rates !== 'object' || Object.keys(payload.rates).length < 2) {
      const message = 'exchangerate-api devolvió un response sin rates utilizables'
      logger.warn('currency-rates-cron: response inválido — conserva rates anteriores')
      await recordError(message, fetchedAt)
      return { updated: false, count: 0, base: payload?.base || base, fetchedAt, reason: 'invalid_response' }
    }

    const value = {
      base: payload.base || base,
      rates: payload.rates,
      fetchedAt,
      // source para auditoría: confirma que venimos del proveedor y no de un seeder manual.
      source: 'exchangerate-api',
      providerUpdatedAt: payload.providerUpdatedAt,
      nextUpdateAt: payload.nextUpdateAt,
      // Una corrida buena limpia el error viejo para que no quede pegado de una corrida anterior.
      lastError: undefined as string | undefined,
      lastErrorAt: undefined as string | undefined,
    }

    try {
      // Upsert idempotente: si existe la fila, update; si no, create. Mismo patrón que
      // admin/usecases/modules.ts:setModulesState / referrals/program-settings.
      const existing = (await orm.findMany('Configuration', { hotelId: PLATFORM, key: CONFIG_KEY })) as any[]
      if (existing?.[0]) {
        await orm.update('Configuration', existing[0].id, { value })
      } else {
        await orm.create('Configuration', { id: crypto.randomUUID(), hotelId: PLATFORM, key: CONFIG_KEY, value })
      }
      const count = Object.keys(payload.rates).length
      logger.info('currency-rates-cron: rates actualizadas', { base: value.base, count, fetchedAt })
      return { updated: true, count, base: value.base, fetchedAt }
    } catch (e: any) {
      logger.warn('currency-rates-cron: no pudo persistir configuration.currency_rates', { error: e?.message })
      return { updated: false, count: 0, base: value.base, fetchedAt, reason: 'persist_failed' }
    }
  }
}

/** Período del cron exportado para que composition-root use la misma constante. */
export const CURRENCY_RATES_TICK_MS = ONE_DAY_MS
