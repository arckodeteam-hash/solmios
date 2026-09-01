// canales/usecases/rate-plans.ts — Matcheo plan del hotel → rate plan de Channex.
//
// El CATÁLOGO de planes (qué planes tiene el hotel y a qué precio) se movió a
// `shared/utils/rate-plans.ts` porque `pricing` también lo necesita — ver la cabecera de ese
// archivo. Acá queda solo lo que es de Channex: resolver, entre los rate plans de un room type
// de la propiedad, cuál corresponde a cada plan del hotel. Se re-exporta el catálogo para no
// tocar a los callers ni a sus tests.

export { DEFAULT_RATE_PLANS, readRatePlans, planPrice, type RatePlanDef } from '../../../shared/utils/rate-plans'
import type { RatePlanDef } from '../../../shared/utils/rate-plans'

/**
 * El RP de Channex que corresponde a un plan, entre los rate plans de un room type.
 * Keywords sobre el título; si nada matchea: BAR → el primero (retrocompatibilidad con
 * properties de 1 solo "Standard"); otros planes → undefined (ese plan no se publica
 * para ese room type, sin romper el push del resto).
 */
export function matchRatePlan(rps: Array<{ id: string; title?: string }>, plan: RatePlanDef): string | undefined {
  const lower = (s?: string) => String(s || '').toLowerCase()
  for (const keyword of plan.keywords) {
    const hit = rps.find((rp) => lower(rp.title).includes(keyword))
    if (hit) return hit.id
  }
  return plan.code === 'bar' ? rps[0]?.id : undefined
}
