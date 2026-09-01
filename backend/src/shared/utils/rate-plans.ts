// shared/utils/rate-plans.ts — Catálogo de RATE PLANS del hotel (BAR, Bed & Breakfast, …).
//
// Vive en `shared` y no en un módulo porque lo necesitan DOS que no se pueden importar entre sí:
// `canales` (para saber a qué rate plan de Channex publicar cada precio) y `pricing` (para que la
// grilla de tarifas por fecha ofrezca los planes reales del hotel y no una lista hardcodeada).
// Mismo precedente que `rate-resolution.ts` y `daily-availability.ts`.
//
// La certificación de Channex exige al menos 2 rate plans por room type (BAR $100 +
// Bed & Breakfast $120 en su setup). El PMS no modela planes "de canal" como entidad
// propia: los define como AJUSTES sobre la tarifa base del room type, por hotel, en
// configuration(key='rate_plans'). El precio de un plan = precio base × (1 + markupPct/100).
//
// Default: BAR (+0%) + Bed & Breakfast (+20%) — con base $100 da $100/$120, el setup
// exacto del examen. El matcheo plan local → rate plan de Channex es por keywords en el
// título (los RPs del examen se llaman "Twin - Best Available Rate" / "Twin - Bed &
// Breakfast"), con fallback: BAR siempre cae al primer RP del room type (retrocompatible
// con properties sincronizadas con un solo "X Standard").

export interface RatePlanDef {
  code: string
  label: string
  /** Ajuste sobre el precio base del room type, en %. */
  markupPct: number
  /** Subcadenas (case-insensitive) que identifican este plan en el título del RP de Channex. */
  keywords: string[]
}

export const DEFAULT_RATE_PLANS: RatePlanDef[] = [
  { code: 'bar', label: 'BAR', markupPct: 0, keywords: ['bar', 'available', 'standard'] },
  { code: 'bb', label: 'Bed & Breakfast', markupPct: 20, keywords: ['breakfast', 'b&b', 'bb'] },
]

/** Lee los planes del hotel desde configuration; si no hay nada (o está malformado), el default. */
export async function readRatePlans(
  findMany: (model: string, query: any) => Promise<any[]>,
  hotelId: string,
): Promise<RatePlanDef[]> {
  try {
    const rows = await findMany('Configuration', { hotelId, key: 'rate_plans' })
    const raw = (rows as any[])?.[0]?.value
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_RATE_PLANS
    const plans = parsed.filter((p): p is RatePlanDef =>
      !!p && typeof p.code === 'string' && typeof p.label === 'string' && typeof p.markupPct === 'number')
    return plans.length ? plans : DEFAULT_RATE_PLANS
  } catch {
    return DEFAULT_RATE_PLANS
  }
}

/** Precio de un plan (centavos) a partir del precio base del room type (centavos). */
export function planPrice(baseCents: number, markupPct: number): number {
  return Math.round(baseCents * (1 + markupPct / 100))
}
