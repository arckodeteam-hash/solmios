// crm/usecases/loyalty.ts — Puntos y niveles de fidelidad. Funciones puras.
//
// El ORM del framework NO soporta `{ increment: n }`: su `update()` copia el valor tal cual al campo
// (kernel/db/orm.ts). Pasarle un objeto a una columna numérica no suma nada y tampoco falla, así que
// el saldo del huésped quedaba en 0 para siempre: el canje siempre respondía "Insufficient points",
// y el nivel nunca subía porque `totalStays`/`totalSpent` se actualizaban igual.
//
// Acá vive la matemática. El service lee, calcula con esto, y escribe.

/** Puntos que gana el huésped por cada unidad de moneda gastada. */
export const POINTS_PER_CURRENCY_UNIT = 10

export type LoyaltyTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'

/** De menor a mayor. El orden importa: un nivel nunca baja. */
const TIERS: readonly LoyaltyTier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const

/** Se alcanza un nivel por estadías O por gasto: lo que ocurra primero. Default histórico;
 *  el service pasa los del hotel cuando los configuró (`loyalty-config.ts`). */
const THRESHOLDS: ReadonlyArray<{ tier: LoyaltyTier; stays: number; spent: number }> = [
  { tier: 'diamond', stays: 20, spent: 50000 },
  { tier: 'platinum', stays: 10, spent: 20000 },
  { tier: 'gold', stays: 5, spent: 8000 },
  { tier: 'silver', stays: 2, spent: 3000 },
]

export type TierThreshold = { tier: LoyaltyTier; stays: number; spent: number }

export const tierOrder = (tier: string): number => {
  const index = TIERS.indexOf(tier as LoyaltyTier)
  return index === -1 ? 0 : index
}

export function calculateTier(stays: number, spent: number, thresholds: readonly TierThreshold[] = THRESHOLDS): LoyaltyTier {
  const reached = thresholds.find((t) => stays >= t.stays || spent >= t.spent)
  return reached?.tier ?? 'bronze'
}

/** Un nivel nunca baja: un huésped que llegó a `gold` no vuelve a `silver` si le anulan una estadía. */
export function nextTier(current: string | undefined, stays: number, spent: number, thresholds: readonly TierThreshold[] = THRESHOLDS): LoyaltyTier {
  const candidate = calculateTier(stays, spent, thresholds)
  const now = (current ?? 'bronze') as LoyaltyTier
  return tierOrder(candidate) > tierOrder(now) ? candidate : (TIERS[tierOrder(now)] ?? 'bronze')
}

/** Puntos que otorga una estadía. Se redondea hacia abajo: no se regalan fracciones. */
export const pointsForStay = (totalAmount: number, pointsPerCurrencyUnit: number = POINTS_PER_CURRENCY_UNIT): number =>
  Math.max(0, Math.floor((Number(totalAmount) || 0) * pointsPerCurrencyUnit))

/** Saldo tras aplicar un movimiento. Nunca queda negativo. */
export const applyPoints = (balance: number | undefined, delta: number): number =>
  Math.max(0, (Number(balance) || 0) + delta)
