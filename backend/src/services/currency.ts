// services/currency.ts — Utilidad de conversión de moneda multi-tenant del PMS.
//
// De dónde sale la tasa: ya NO de un número cargado a mano. La tasa la deja el cron de
// `currency-rates-cron` en `configuration(hotelId='platform', key='currency_rates')` y se resuelve
// con el usecase compartido `shared/usecases/resolve-exchange-rate`, el MISMO que usa el endpoint
// `GET /api/tasa-cambio` (`hoteles/usecases/exchange-rate.ts`) y, a través de él, el frontend del
// PMS. Una sola fuente para los dos lados: si acá se resolviera distinto, la pantalla y el folio
// mostrarían números diferentes para el mismo monto, que es justo el bug que se está cerrando.
//
// Por qué el valor manual sigue teniendo prioridad: `currency_config.exchangeRate` es un campo que
// el hotelero edita a propósito en la pantalla de ajustes (acuerdos con el banco, tasa pactada con
// el huésped). Si lo dejó cargado, ESE gana sobre la automática — quien ya tenía una tasa propia no
// puede ver cambiar sus montos por esta mejora. Solo cuando no hay override (ausente, 0 o no
// numérico) se usa la automática. Sin ninguna de las dos, `exchangeRate: 0` y `convertAmount` no
// convierte. El criterio de precedencia es idéntico al del endpoint, a propósito.
//
// Esta función NO tira nunca: una tasa que no se pudo leer no puede romper una pantalla de
// operación que hoy funciona.

import type { RepositoryAdapter } from 'arckode-framework'
import { resolveExchangeRate } from '../shared/usecases/resolve-exchange-rate'

/** Mismo default que `hotels.currency` (hoteles/model.ts:14), por si el caller no la pasa. */
const DEFAULT_BASE_CURRENCY = 'USD'

export interface CurrencyConfig {
  secondaryCurrency: string
  exchangeRate: number
  /** De dónde salió `exchangeRate`: override del hotelero, tasa del cron, o ninguna. */
  source: 'manual' | 'auto' | null
  /** ISO de cuándo se fetchearon las tasas automáticas. `null` para manual y para "sin tasa". */
  fetchedAt: string | null
  /** Solo aplica a la tasa automática: `true` si las tasas del cron están vencidas. */
  stale: boolean
}

export interface CurrencyResult {
  amount: number
  currency: string
  convertedAmount?: number
  convertedCurrency?: string
  exchangeRate?: number
}

const EMPTY_CONFIG: CurrencyConfig = {
  secondaryCurrency: '', exchangeRate: 0, source: null, fetchedAt: null, stale: false,
}

/** `Configuration.value` es `type:'json'` y el ORM lo deserializa solo, pero un adapter crudo
 * puede devolver el texto — mismo criterio que `config-kv.ts` y el endpoint. */
function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

/** Override manual válido: número positivo (acepta el string que puede llegar del formulario). */
function positiveNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Obtiene la configuración de moneda del hotel, con la tasa ya resuelta.
 *
 * `baseCurrency` es la moneda base del hotel (`hotels.currency`): la tasa automática se resuelve
 * entre un par concreto (`baseCurrency → secondaryCurrency`) y la fila `currency_config` solo
 * guarda la secundaria. Es opcional para no romper a los llamadores existentes.
 */
export async function getCurrencyConfig(
  configRepo: RepositoryAdapter<any>,
  hotelId: string,
  baseCurrency: string = DEFAULT_BASE_CURRENCY,
  opts: { now?: Date } = {},
): Promise<CurrencyConfig> {
  try {
    const config = await configRepo.findOne({ hotelId, key: 'currency_config' })
    const val = safeParse(config?.value)
    if (!val || typeof val !== 'object') return EMPTY_CONFIG

    const secondaryCurrency = String(val.secondaryCurrency || '')

    // 1) Override manual: si el hotelero lo cargó, gana.
    const manual = positiveNumber(val.exchangeRate)
    if (manual !== null) {
      return { secondaryCurrency, exchangeRate: manual, source: 'manual', fetchedAt: null, stale: false }
    }

    // 2) Tasa automática del cron, entre la base del hotel y la secundaria configurada.
    const from = String(baseCurrency || DEFAULT_BASE_CURRENCY).trim().toUpperCase()
    const to = secondaryCurrency.trim().toUpperCase()
    const resolved = await resolveExchangeRate(configRepo, from, to, opts.now ? { now: opts.now } : {})
    if (resolved.available && resolved.rate !== null) {
      return {
        secondaryCurrency,
        exchangeRate: resolved.rate,
        source: 'auto',
        fetchedAt: resolved.fetchedAt,
        stale: resolved.stale,
      }
    }

    // 3) Sin tasa: 0, que `convertAmount` ya trata como "no convertir".
    return { ...EMPTY_CONFIG, secondaryCurrency }
  } catch { /* silent: la conversión degrada, nunca rompe al caller */ }
  return EMPTY_CONFIG
}

/**
 * Convierte un monto de una moneda a otra usando el tipo de cambio configurado.
 */
export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  exchangeRate: number,
): number {
  if (fromCurrency === toCurrency || !exchangeRate) return amount
  return Math.round((amount * exchangeRate + Number.EPSILON) * 100) / 100
}

/**
 * Formatea un monto con su moneda.
 */
export function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$', DOP: 'RD$', EUR: '€', COP: '$', MXN: '$', ARS: '$', CLP: '$',
  }
  const symbol = symbols[currency] || currency + ' '
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Obtiene el símbolo de una moneda.
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$', DOP: 'RD$', EUR: '€', COP: '$', MXN: '$', ARS: '$', CLP: '$',
  }
  return symbols[currency] || currency + ' '
}
