// composables/useCurrency.ts — Utilidad de conversión de moneda para frontend.
//
// De dónde sale la tasa: de `GET /api/tasa-cambio` (hoteles/usecases/exchange-rate.ts), el MISMO
// endpoint que resuelve la tasa del backend. Antes se leía `/configuracion/currency`, una key que
// nadie escribe (la pantalla de ajustes guarda bajo `currency_config`): el 404 silencioso dejaba
// `exchangeRate` en 0 para siempre y `convert()` devolvía el monto sin convertir. Además el número
// que se mostraba —cuando se mostraba— era un 60 escrito a mano que nadie actualizaba.
//
// Acá NO hay ninguna tasa ni moneda por defecto: si el endpoint falla o todavía no hay tasas
// (`available: false`, que el backend devuelve con 200, no como error), el estado queda en
// `exchangeRate: 0` y `convert()` devuelve el monto original — degradación sin romper pantallas.

import { ref, computed } from 'vue'
import { http } from '@/services/http'
import { CurrencyCode } from '@/types/currency'

export interface CurrencyConfig {
  secondaryCurrency: string
  /** Tasa base → secundaria. `0` = no hay tasa utilizable (no se convierte). */
  exchangeRate: number
  /** Cuándo se obtuvo la tasa (ISO), para que la UI pueda mostrar de cuándo es. */
  fetchedAt: string | null
  /** Proveedor de la tasa (`exchangerate-api`) o `manual` si el hotel cargó un override. */
  source: string | null
  /** La tasa existe pero está desactualizada: se usa igual, avisando. */
  stale: boolean
}

/** Respuesta de `GET /api/tasa-cambio`. */
interface ExchangeRateResponse {
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

const EMPTY: CurrencyConfig = { secondaryCurrency: '', exchangeRate: 0, fetchedAt: null, source: null, stale: false }

const currencyConfig = ref<CurrencyConfig>({ ...EMPTY })
const loaded = ref(false)

/**
 * Carga la tasa de cambio del hotel actual desde `GET /api/tasa-cambio`.
 *
 * Cachea a nivel de módulo (una sola petición por sesión de app). `force` la reemite: lo usa la
 * pantalla de ajustes después de guardar, donde el override manual puede haber cambiado la tasa.
 */
export async function loadCurrencyConfig(hotelId?: string, force = false): Promise<CurrencyConfig> {
  if (loaded.value && !force) return currencyConfig.value
  try {
    const params = hotelId ? `?hotelId=${hotelId}` : ''
    const rate = await http.get<ExchangeRateResponse | null>(`/tasa-cambio${params}`)
    currencyConfig.value = {
      secondaryCurrency: rate?.to || '',
      // `available: false` (todavía no hay tasas) llega como 200 con `rate: null` → 0, sin convertir.
      exchangeRate: rate?.available ? Number(rate.rate) || 0 : 0,
      fetchedAt: rate?.fetchedAt ?? null,
      source: rate?.source ?? null,
      stale: Boolean(rate?.stale),
    }
  } catch {
    // Sin tasa no se inventa ninguna: se deja el estado vacío y no se convierte.
    currencyConfig.value = { ...EMPTY }
  }
  loaded.value = true
  return currencyConfig.value
}

/**
 * Convierte un monto usando el tipo de cambio configurado.
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

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', DOP: 'RD$', EUR: '€', COP: '$', MXN: '$', ARS: '$', CLP: '$',
}

/**
 * Símbolo de la moneda. Se expone aparte de `formatCurrency` para los componentes que reciben
 * el prefijo y el número por separado (KpiHeroCard anima el valor, así que no puede recibirlo
 * ya formateado). Evita que las vistas hardcodeen '$' cuando el hotel factura en otra moneda.
 */
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] || currency + ' '
}

/**
 * Formatea un monto con su moneda.
 */
export function formatCurrency(amount: number, currency: string): string {
  return `${currencySymbol(currency)}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Composable para usar en componentes.
 */
export function useCurrency(hotelCurrency: string = CurrencyCode.USD) {
  const config = currencyConfig

  const secondaryCurrency = computed(() => config.value.secondaryCurrency)
  const exchangeRate = computed(() => config.value.exchangeRate)
  const fetchedAt = computed(() => config.value.fetchedAt)
  const source = computed(() => config.value.source)
  const stale = computed(() => config.value.stale)

  function convert(amount: number, toSecondary = true): number {
    if (!toSecondary || !secondaryCurrency.value || !exchangeRate.value) return amount
    return convertAmount(amount, hotelCurrency, secondaryCurrency.value, exchangeRate.value)
  }

  function format(amount: number, currency = hotelCurrency): string {
    return formatCurrency(amount, currency)
  }

  function formatSecondary(amount: number): string {
    if (!secondaryCurrency.value) return ''
    return formatCurrency(convert(amount), secondaryCurrency.value)
  }

  return {
    config,
    secondaryCurrency,
    exchangeRate,
    fetchedAt,
    source,
    stale,
    convert,
    format,
    formatSecondary,
    loadCurrencyConfig,
  }
}
