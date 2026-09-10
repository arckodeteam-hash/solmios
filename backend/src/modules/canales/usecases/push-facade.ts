// canales/usecases/push-facade.ts — Los dos pushes de TARIFAS, con su rastro en sync_log.
//
// Es armado de dependencias, no lógica: `pushSeasonalRatesToChannex` y `pushRateOverridesFor` ya
// tienen la lógica. Vive fuera del service porque el service es el punto donde el analyzer corta
// (>200 líneas = God Object) y este bloque es el que menos pierde al salir: sacado de acá, el
// service queda con dos delegaciones de una línea como el resto de sus métodos.

import type { RepositoryAdapter } from 'arckode-framework'
import type { CanalesDTO, PushRatesResultDTO } from '../types'
import type { ChannexUseCase } from './channex'
import { withRatesTrail } from './ari-tasks'
import { pushSeasonalRatesToChannex } from './push-rates'
import { pushRateOverridesFor, type OverridePushItem, type OverridePushResult } from './push-overrides'
import { readRatePlans } from '../../../shared/utils/rate-plans'

export interface RatePushDeps {
  getConfig: (hotelId: string) => Promise<CanalesDTO | undefined>
  findMany: (model: string, query: any) => Promise<any[]>
  channex: ChannexUseCase
  syncLogRepo?: RepositoryAdapter<any>
}

/** Tarifas por temporada de TODO el hotel (o de un canal). `per_person` → OBP (#404). */
export function pushSeasonalRates(deps: RatePushDeps, hotelId: string, channel?: string): Promise<PushRatesResultDTO> {
  return withRatesTrail(deps.syncLogRepo, hotelId, 'push_rates', () => pushSeasonalRatesToChannex({
    getConfig: deps.getConfig,
    findMany: deps.findMany,
    pushSeasonalRates: (c, r, s, a, plans, restrictions, overrides) => deps.channex.pushSeasonalRates(c, r, s, a, plans, restrictions, overrides),
  }, hotelId, channel))
}

/** Push DELTA de la grilla por fecha: una llamada, solo lo que se tocó (ver push-overrides.ts). */
export function pushRateOverrides(deps: RatePushDeps, hotelId: string, items: OverridePushItem[]): Promise<OverridePushResult> {
  return withRatesTrail(deps.syncLogRepo, hotelId, 'push_rate_overrides', () => pushRateOverridesFor({
    getConfig: deps.getConfig,
    getRatePlans: (h) => readRatePlans(deps.findMany, h),
    push: (cfg, i, plans) => deps.channex.pushRateOverrides(cfg, i, plans),
  }, hotelId, items))
}
