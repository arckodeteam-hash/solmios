// crm/usecases/loyalty-config.ts — Configuración de fidelización por hotel.
//
// Antes el ratio y los umbrales de tier estaban HARDCADEADOS en usecases/loyalty.ts
// (POINTS_PER_CURRENCY_UNIT=10, THRESHOLDS fijos): todos los hoteles fidelizaban igual.
// Ahora viven en `configuration(key='crm_loyalty')` con defaults = los valores históricos,
// así un hotel sin configurar sigue comportándose exactamente como antes (rollback gratis).
//
// Shape (objeto JSON, NUNCA array — ver deuda electronic_invoicing de CLAUDE.md):
//   { enabled, pointsPerCurrencyUnit, pointValue, promoValidDays,
//     tiers: [{ tier, stays, spent }] }   // por estadías O gasto, lo que ocurra primero
import type { RepositoryAdapter } from 'arckode-framework'

export interface LoyaltyTierConfig {
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'
  /** Estadías acumuladas que alcanzan el tier (O el gasto). */
  stays: number
  /** Gasto acumulado que alcanza el tier (O las estadías). */
  spent: number
}

export interface LoyaltyConfig {
  /** Apaga el award automático y el canje→promo sin deploy (rollback). */
  enabled: boolean
  /** Puntos por unidad de moneda gastada (semántica histórica de pointsForStay). */
  pointsPerCurrencyUnit: number
  /** Valor monetario de 1 punto al canjear (para el promo code del canje). */
  pointValue: number
  /** Días de vigencia del promo code generado al canjar. */
  promoValidDays: number
  tiers: LoyaltyTierConfig[]
}

/** Defaults = los valores históricos hardcodeados. Un hotel sin key no cambia su comportamiento. */
export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  enabled: true,
  pointsPerCurrencyUnit: 10,
  pointValue: 1,
  promoValidDays: 90,
  tiers: [
    { tier: 'diamond', stays: 20, spent: 50000 },
    { tier: 'platinum', stays: 10, spent: 20000 },
    { tier: 'gold', stays: 5, spent: 8000 },
    { tier: 'silver', stays: 2, spent: 3000 },
  ],
}

const CONFIG_KEY = 'crm_loyalty'

const positive = (v: unknown, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Lee y valida la config del hotel. Cualquier campo inválido/faltante cae al default
 * (fail-safe: un JSON mal guardado no puede tirar el award del checkout).
 */
export async function readLoyaltyConfig(
  configRepo: Pick<RepositoryAdapter<any>, 'findMany'>,
  hotelId: string,
): Promise<LoyaltyConfig> {
  try {
    const rows = await configRepo.findMany({ hotelId, key: CONFIG_KEY })
    const raw = rows?.[0]?.value
    if (!raw) return DEFAULT_LOYALTY_CONFIG
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_LOYALTY_CONFIG

    const tiers = Array.isArray(parsed.tiers) && parsed.tiers.length > 0
      ? parsed.tiers
          .filter((t: any) => t && typeof t.tier === 'string')
          .map((t: any) => ({
            tier: t.tier as LoyaltyTierConfig['tier'],
            stays: positive(t.stays, 1),
            spent: positive(t.spent, 1),
          }))
      : DEFAULT_LOYALTY_CONFIG.tiers

    return {
      enabled: parsed.enabled !== false,
      pointsPerCurrencyUnit: positive(parsed.pointsPerCurrencyUnit, DEFAULT_LOYALTY_CONFIG.pointsPerCurrencyUnit),
      pointValue: positive(parsed.pointValue, DEFAULT_LOYALTY_CONFIG.pointValue),
      promoValidDays: positive(parsed.promoValidDays, DEFAULT_LOYALTY_CONFIG.promoValidDays),
      tiers,
    }
  } catch {
    // JSON roto, repo caído: defaults. El checkout no se entera.
    return DEFAULT_LOYALTY_CONFIG
  }
}
