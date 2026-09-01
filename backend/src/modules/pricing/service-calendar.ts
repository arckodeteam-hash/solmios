// pricing/service-calendar.ts — Overrides por FECHA del planning (extraídos de service.ts para no
// convertirlo en God Object): la fila "Días Mínimos" (estadía mínima por fecha) y la "Asignación de
// temporadas" (temporada por fecha, estilo MrPlan). Delega en los usecases; sin lógica propia.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import {
  listDateRestrictions, upsertDateRestrictions,
  type DateRestrictionRow, type DateRestrictionInput,
} from './usecases/date-restrictions'
import {
  listSeasonAssignments, assignSeason,
  type SeasonAssignmentRow, type AssignSeasonInput,
} from './usecases/season-assignments'
import {
  listRateOverrides, upsertRateOverrides, deleteRateOverride,
  type RateOverrideRow, type RateOverrideInput, type SavedRateOverride,
} from './usecases/rate-overrides'

export class PricingCalendarService {
  constructor(
    private readonly dateRestrictionsRepo: RepositoryAdapter<any>,
    private readonly seasonAssignmentsRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly rateOverridesRepo?: RepositoryAdapter<any>,
  ) {}

  /** El repo es opcional en la firma para no romper a quien construya el service sin él (tests). */
  private overridesRepo(): RepositoryAdapter<any> {
    if (!this.rateOverridesRepo) throw new Error('pricing: rateOverridesRepo no configurado')
    return this.rateOverridesRepo
  }

  // ── Días Mínimos por fecha ──
  listDateRestrictions(hotelId: string, from?: string, to?: string): Promise<DateRestrictionRow[]> {
    return listDateRestrictions(this.dateRestrictionsRepo, hotelId, from, to)
  }

  updateDateRestrictions(hotelId: string, items: DateRestrictionInput[]): Promise<number> {
    return upsertDateRestrictions(this.dateRestrictionsRepo, hotelId, items)
  }

  // ── Temporada por fecha ──
  listSeasonAssignments(hotelId: string, from?: string, to?: string): Promise<SeasonAssignmentRow[]> {
    return listSeasonAssignments(this.seasonAssignmentsRepo, hotelId, from, to)
  }

  assignSeason(hotelId: string, input: AssignSeasonInput): Promise<number> {
    this.logger.info('Asignando temporada por fecha', { hotelId, from: input.from, to: input.to, season: input.season })
    return assignSeason(this.seasonAssignmentsRepo, hotelId, input)
  }

  // ── Tarifa y restricciones por rango de fechas (grilla "Tarifas por fecha") ──
  listRateOverrides(hotelId: string, from?: string, to?: string): Promise<RateOverrideRow[]> {
    return listRateOverrides(this.overridesRepo(), hotelId, from, to)
  }

  async updateRateOverrides(
    hotelId: string, items: RateOverrideInput[],
  ): Promise<{ saved: SavedRateOverride[]; removed: number }> {
    const { saved, removed } = await upsertRateOverrides(this.overridesRepo(), hotelId, items)
    this.logger.info('Tarifas por fecha guardadas', { hotelId, saved: saved.length, removed: removed.length })
    return { saved, removed: removed.length }
  }

  deleteRateOverride(hotelId: string, id: string): Promise<RateOverrideRow | null> {
    return deleteRateOverride(this.overridesRepo(), hotelId, id)
  }
}
