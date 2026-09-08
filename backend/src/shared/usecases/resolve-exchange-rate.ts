// shared/usecases/resolve-exchange-rate.ts — Resolución de tasa de cambio entre CUALQUIER par de
// monedas, a partir de las rates que deja el cron en
// `configuration(key='currency_rates', hotelId='platform')`.
//
// Por qué existe: hasta ahora la conversión vivía SOLO adentro del booking engine
// (`bookingengine/usecases/public-rates.ts`), encerrada en el handler de `/rates`. El PMS —que
// muestra los mismos montos en folios, facturas y pantallas de settings— no tenía de dónde sacar
// el número y terminaba con una tasa manual cargada a mano. Este usecase extrae esa capacidad a
// `shared/` para que backend PMS y booking engine hablen del MISMO valor y de la misma tabla.
//
// El booking engine NO se toca: conserva su propia lectura (`readCurrencyRates`) y su propio
// criterio de degradación. Este archivo es el que consume el PMS.
//
// Matemática: tasa cruzada `rates[to] / rates[from]`, exactamente la misma que hace public-rates
// pasando por la base (`amount / rates[from] * rates[to]`), pero expresada como tasa. Al ser
// cruzada NO asume USD ni DOP: sirve entre cualquier par mientras las dos monedas estén en la
// tabla, que es lo que pide "soportar distintas monedas base según el país/hotel".
//
// Degradación: nunca tira. Sin config, con la moneda ausente o con la corrida del cron caída,
// devuelve `rate: null` / `available: false` y el caller decide (el criterio "conservar la última
// tasa válida" se cumple porque una tasa vieja se devuelve igual, solo marcada con `stale`).
import type { RepositoryAdapter } from 'arckode-framework'

const PLATFORM = 'platform'
const CONFIG_KEY = 'currency_rates'

/**
 * Antigüedad máxima antes de marcar la tasa como `stale`. El cron corre cada 24h: 48h deja
 * margen para UNA corrida fallida sin marcar como vieja una tabla que sigue siendo la buena.
 */
export const RATES_MAX_AGE_MS = 48 * 60 * 60 * 1000

/** Valor guardado por `currency-rates-cron` en la fila de configuración de la plataforma. */
export interface CurrencyRatesConfig {
  base?: string
  rates?: Record<string, number>
  /** ISO de cuándo fetcheamos NOSOTROS las tasas. */
  fetchedAt?: string
  source?: string
  /** ISO de cuándo el proveedor recalculó las tasas. */
  providerUpdatedAt?: string
  nextUpdateAt?: string
  /** Error de la última corrida del cron, si la última falló. */
  lastError?: string
  lastErrorAt?: string
}

export interface ResolvedExchangeRate {
  /** Tasa `to` por unidad de `from`. `null` si no se pudo resolver. */
  rate: number | null
  from: string
  to: string
  fetchedAt: string | null
  providerUpdatedAt: string | null
  source: string | null
  /** true si no hay `fetchedAt` o si es más viejo que `maxAgeMs`. La tasa igual se devuelve. */
  stale: boolean
  available: boolean
  lastError: string | null
}

export interface ResolveExchangeRateOptions {
  /** Inyectable para testear sin reloj real. */
  now?: Date
  maxAgeMs?: number
}

/**
 * Lee la fila `{hotelId:'platform', key:'currency_rates'}` y devuelve el valor ENTERO (no solo
 * `rates`): el PMS necesita también `fetchedAt`/`source` para mostrar de cuándo es el número.
 *
 * `Configuration.value` es `type:'json'` y el ORM lo deserializa solo, pero un adapter crudo
 * puede devolver el texto: aceptamos objeto o string, igual que `config-kv.ts` y `public-rates`.
 * Cualquier excepción degrada a `null` — una tasa que no se pudo leer no puede romper la pantalla.
 */
export async function readCurrencyRatesConfig(
  configRepo: RepositoryAdapter<any>,
): Promise<CurrencyRatesConfig | null> {
  try {
    const rows = await configRepo.findMany({ hotelId: PLATFORM, key: CONFIG_KEY })
    const raw = rows?.[0]?.value
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as CurrencyRatesConfig
  } catch {
    return null
  }
}

/** Función pura: tasa cruzada `from → to` sobre una tabla con base arbitraria. */
export function crossRate(
  rates: Record<string, number> | null | undefined,
  from: string,
  to: string,
): number | null {
  // Un código vacío, ausente o en blanco NO es una conversión válida. Sin este guard caerían en el
  // atajo `from === to` de abajo y devolverían 1, o sea una tasa 1:1 fantasma que el caller leería
  // como `available:true` y mostraría como monto convertido en vez de degradar.
  const a1 = typeof from === 'string' ? from.trim() : ''
  const b1 = typeof to === 'string' ? to.trim() : ''
  if (!a1 || !b1) return null
  // Identidad: convertir una moneda a sí misma es 1 por definición, esté o no en la tabla. Es un
  // caso normal acá — un hotel cuya moneda secundaria es la propia entra por acá — y devolver 1
  // es la respuesta correcta, no una tasa inventada.
  if (a1 === b1) return 1
  if (!rates || typeof rates !== 'object') return null
  const a = rates[a1]
  const b = rates[b1]
  if (!isPositiveNumber(a) || !isPositiveNumber(b)) return null
  return b / a
}

/**
 * Convierte `amount` con la tasa cruzada. Sin tasa devuelve el monto ORIGINAL (misma degradación
 * graceful que el booking engine: mejor mostrar el monto en su moneda que no mostrar nada).
 */
export function convertWithRates(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number> | null | undefined,
): number {
  const rate = crossRate(rates, from, to)
  if (rate === null) return amount
  return round2(amount * rate)
}

/**
 * Caso de uso principal: resuelve la tasa `from → to` leyendo la config de la plataforma.
 * Nunca tira — siempre devuelve el objeto, con `available:false` cuando no hay número.
 */
export async function resolveExchangeRate(
  configRepo: RepositoryAdapter<any>,
  from: string,
  to: string,
  opts: ResolveExchangeRateOptions = {},
): Promise<ResolvedExchangeRate> {
  const fromCode = String(from || '').trim().toUpperCase()
  const toCode = String(to || '').trim().toUpperCase()
  const maxAgeMs = opts.maxAgeMs ?? RATES_MAX_AGE_MS
  const now = opts.now ?? new Date()

  const config = await readCurrencyRatesConfig(configRepo)
  const fetchedAt = typeof config?.fetchedAt === 'string' ? config.fetchedAt : null
  const rate = crossRate(config?.rates, fromCode, toCode)

  return {
    rate,
    from: fromCode,
    to: toCode,
    fetchedAt,
    providerUpdatedAt: typeof config?.providerUpdatedAt === 'string' ? config.providerUpdatedAt : null,
    source: typeof config?.source === 'string' ? config.source : null,
    stale: isStale(fetchedAt, now, maxAgeMs),
    available: rate !== null,
    lastError: typeof config?.lastError === 'string' ? config.lastError : null,
  }
}

function isStale(fetchedAt: string | null, now: Date, maxAgeMs: number): boolean {
  if (!fetchedAt) return true
  const ts = Date.parse(fetchedAt)
  if (!Number.isFinite(ts)) return true
  return now.getTime() - ts > maxAgeMs
}

function isPositiveNumber(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
