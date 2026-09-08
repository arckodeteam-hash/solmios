// hoteles/usecases/exchange-rate.ts — GET /api/tasa-cambio
//
// Por qué existe: el PMS convertía con una tasa escrita a mano en `currency_config.exchangeRate`
// mientras el booking engine público ya mostraba tasas automáticas. Dos números distintos para el
// mismo monto. Este usecase le da al PMS la MISMA tasa que usa el motor —la que deja el cron en
// `configuration(hotelId='platform', key='currency_rates')`— resuelta con el usecase compartido
// `shared/usecases/resolve-exchange-rate`, que no está atado a USD→DOP: cruza cualquier par.
//
// Vive en usecases/ y no en el service: `hoteles/service.ts` está a 190 líneas y el check
// GOD_SERVICE de `arckode analyze` corta a 200. El controller llama acá directo.
import type { RepositoryAdapter } from 'arckode-framework'
import { resolveExchangeRate } from '../../../shared/usecases/resolve-exchange-rate'

/** Fila `configuration(hotelId, key='currency_config')` — la que edita la pantalla de ajustes. */
const CURRENCY_CONFIG_KEY = 'currency_config'
/** Mismo default que `hotels.currency` (model.ts:14), por si el hotel no lo tiene cargado. */
const DEFAULT_BASE_CURRENCY = 'USD'

export interface ExchangeRateDeps {
  /** Repo de `Configuration`: de acá salen las tasas del cron y el `currency_config` del hotel. */
  configRepo: RepositoryAdapter<any>
  /** Repo de `Hotels`: de acá sale la moneda base del hotel (`hotels.currency`). */
  hotelRepo: RepositoryAdapter<any>
  /**
   * Hotel del request. Lo inyecta el controller con su `resolveHotel` privado (el mismo que usan
   * `getConfig` y `getEmergencyContacts`): el hotel sale del token y solo super_admin puede
   * apuntar a otro con `?hotelId=`. Se reusa en vez de reimplementarse para no tener dos
   * criterios de aislamiento cross-tenant que puedan divergir.
   */
  resolveHotelId: (req: any) => Promise<string | undefined>
  /** Inyectable para testear sin reloj real (se pasa tal cual a `resolveExchangeRate`). */
  now?: Date
}

interface CurrencyConfig {
  secondaryCurrency?: string
  /** Override manual cargado a mano por el hotelero. Interpretado como base → secundaria. */
  exchangeRate?: number | string
}

export interface ExchangeRateResponse {
  from: string
  to: string
  rate: number | null
  available: boolean
  stale: boolean
  fetchedAt: string | null
  providerUpdatedAt: string | null
  source: string | null
  lastError: string | null
}

/** `Configuration.value` es `type:'json'` y el ORM lo deserializa solo, pero un adapter crudo
 * puede devolver el texto — mismo criterio que `config-kv.ts`. */
function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

async function readCurrencyConfig(configRepo: RepositoryAdapter<any>, hotelId: string): Promise<CurrencyConfig> {
  try {
    const rows = await configRepo.findMany({ hotelId, key: CURRENCY_CONFIG_KEY })
    const parsed = safeParse(rows?.[0]?.value)
    return parsed && typeof parsed === 'object' ? (parsed as CurrencyConfig) : {}
  } catch {
    return {}
  }
}

/** La moneda base del hotel. Si el hotel no se puede leer, la tasa no puede romper la pantalla. */
async function readBaseCurrency(hotelRepo: RepositoryAdapter<any>, hotelId: string): Promise<string> {
  try {
    const hotel = await hotelRepo.findById(hotelId)
    return String((hotel as any)?.currency || DEFAULT_BASE_CURRENCY)
  } catch {
    return DEFAULT_BASE_CURRENCY
  }
}

function normalize(code: unknown): string {
  return String(code ?? '').trim().toUpperCase()
}

function positiveNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Devuelve la tasa `from → to` para el hotel del request.
 *
 * `from` es por defecto la moneda base del hotel (`hotels.currency`) y `to` la secundaria de su
 * `currency_config`; ambas se pueden sobreescribir con los query params `from` y `to`.
 *
 * Degradación: sin tasas guardadas devuelve **200** con `rate: null, available: false`, nunca un
 * 500. El frontend muestra solo la moneda base, igual que hace hoy el booking engine; un error
 * acá rompería pantallas de operación (el detalle de reserva) que hoy funcionan.
 */
export async function getExchangeRate(
  deps: ExchangeRateDeps,
  req: { query?: Record<string, any> },
): Promise<{ status: number; body: any }> {
  const hotelId = await deps.resolveHotelId(req)
  if (!hotelId) return { status: 404, body: { error: 'Sin hotel' } }

  const [baseCurrency, config] = await Promise.all([
    readBaseCurrency(deps.hotelRepo, hotelId),
    readCurrencyConfig(deps.configRepo, hotelId),
  ])

  const query = req?.query ?? {}
  const secondary = normalize(config.secondaryCurrency)
  const from = normalize(query.from) || normalize(baseCurrency)
  const to = normalize(query.to) || secondary
  if (!to) {
    return { status: 400, body: { error: 'Falta la moneda destino: indicá ?to=XXX o configurá la moneda secundaria del hotel' } }
  }

  // Override manual: si el hotelero dejó una tasa cargada a mano, ESA gana sobre la automática —
  // la puso a propósito y quien ya la tenía no puede ver cambiar sus montos por este endpoint.
  // Se aplica solo al par que el override describe (base del hotel → secundaria configurada):
  // ese número no lleva monedas guardadas, y devolverlo para un par pedido a mano (?from=EUR)
  // sería inventar una tasa que nadie cargó.
  const manual = positiveNumber(config.exchangeRate)
  if (manual !== null && from === normalize(baseCurrency) && to === secondary) {
    const body: ExchangeRateResponse = {
      from, to, rate: manual, available: true, stale: false,
      fetchedAt: null, providerUpdatedAt: null, source: 'manual', lastError: null,
    }
    return { status: 200, body }
  }

  const resolved = await resolveExchangeRate(deps.configRepo, from, to, deps.now ? { now: deps.now } : {})
  const body: ExchangeRateResponse = {
    from: resolved.from,
    to: resolved.to,
    rate: resolved.rate,
    available: resolved.available,
    stale: resolved.stale,
    fetchedAt: resolved.fetchedAt,
    providerUpdatedAt: resolved.providerUpdatedAt,
    source: resolved.source,
    lastError: resolved.lastError,
  }
  return { status: 200, body }
}
