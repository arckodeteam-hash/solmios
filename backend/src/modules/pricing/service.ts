import { AuthError } from 'arckode-framework'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { hotelIdOfUserLegacy } from '../../shared/usecases/hotel-of-legacy'
import { composeSockets } from '../../shared/usecases/compose-sockets'
import type { PricingQueries } from './usecases/pricing-queries'
import { applyActiveSeason, listSeasonsSeeded } from './usecases/season-catalog'
import { DEFAULT_RATE_PLANS, type RatePlanDef } from '../../shared/utils/rate-plans'
import type { PricingSockets } from './sockets'
import { listBlocks, createBlocks, deleteBlock } from './usecases/blocks'
import {
  auditSafely, rateChangeEntry, rateCopyEntry, seasonsChangeEntry,
  restrictionsChangeEntry, blockDeleteEntry,
  type AuditEntry, type AuditPort, type Actor, type RateChange,
} from './usecases/audit'

export class PricingService {
  private auditPort: AuditPort | null = null
  private sockets: PricingSockets = {}
  setSockets(s: Partial<PricingSockets>): void { composeSockets(this.sockets as any, s as any) }

  constructor(
    private readonly seasonsRepo: RepositoryAdapter<any>,
    private readonly ratesRepo: RepositoryAdapter<any>,
    private readonly blocksRepo: RepositoryAdapter<any>,
    private readonly restrictionsRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly queries?: PricingQueries,
    private readonly usersRepo?: RepositoryAdapter<any>,
  ) {}

  /** Conecta el audit log. Lo inyecta el connector `pricing-auditlog`. */
  setAuditDeps(port: AuditPort): void {
    this.auditPort = port
  }

  /** Ver shared/usecases/hotel-of-legacy.ts — fallback de hotelOf() con tokens legacy. */
  hotelIdOfUser(userId?: string): Promise<string | undefined> {
    return hotelIdOfUserLegacy(this.usersRepo, userId)
  }

  private audit(entry: AuditEntry): Promise<void> {
    return auditSafely(this.auditPort, this.logger, entry)
  }

  listSeasons(hotelId: string): Promise<any[]> { return listSeasonsSeeded(this.seasonsRepo, hotelId) }

  async updateSeasons(hotelId: string, seasons: any[], actor?: Actor): Promise<number> {
    const existing = await this.seasonsRepo.findMany({ hotelId }) as any[]
    for (const ex of existing) await this.seasonsRepo.delete(ex.id)
    // A lo sumo una activa: la 1ª marcada active en el payload; si ninguna, la primera.
    let activeIdx = seasons.findIndex((s) => s?.active)
    if (activeIdx === -1 && seasons.length > 0) activeIdx = 0
    for (let i = 0; i < seasons.length; i++) {
      const s = seasons[i]
      await this.seasonsRepo.create({
        id: crypto.randomUUID(), hotelId, name: s.name || `season-${i}`, label: s.label || '',
        startDate: s.startDate || '', endDate: s.endDate || '',
        color: s.color || '#3b82f6', sortOrder: i, active: i === activeIdx ? 1 : 0,
      })
    }
    await this.audit(seasonsChangeEntry(hotelId, seasons.length, actor))
    await this.sockets.onSeasonsUpdated?.(hotelId, seasons.length)
    return seasons.length
  }

  /** Cambia la temporada activa del hotel (por nombre). Solo una queda activa. #148 */
  async activateSeason(hotelId: string, name: string, actor?: Actor): Promise<any[]> {
    const seasons = await this.listSeasons(hotelId) // garantiza que haya data seedeada
    await applyActiveSeason(this.seasonsRepo, seasons, name)
    await this.audit(seasonsChangeEntry(hotelId, seasons.length, actor))
    return this.listSeasons(hotelId)
  }

  /** Modo de tarificación del hotel (per_room | per_person) — config PMS por cliente. */
  async getPricingMode(hotelId: string): Promise<'per_room' | 'per_person'> {
    return this.queries ? this.queries.getPricingMode(hotelId) : 'per_room'
  }
  async setPricingMode(hotelId: string, mode: string): Promise<'per_room' | 'per_person'> {
    const m = mode === 'per_person' ? 'per_person' : 'per_room'
    return this.queries ? this.queries.setPricingMode(hotelId, m) : m
  }

  /** Base y por-canal delegan a `queries` (ver `listBaseRates`/`listChannelRates` ahí — nunca
   *  vacío, derivan de los room types + pricing_mode si no hay filas guardadas). Fallback
   *  defensivo a filtrar `all` si no hay queries inyectadas. */
  async listRates(hotelId: string, channel?: string): Promise<any[]> {
    const all = await this.ratesRepo.findMany({ hotelId }) as any[]
    if (!channel) return this.queries ? this.queries.listBaseRates(hotelId, all) : all.filter((r) => !r.channel)
    return this.queries ? this.queries.listChannelRates(hotelId, channel, all) : all.filter((r) => r.channel === channel)
  }

  async updateRates(hotelId: string, rates: any[], actor?: Actor): Promise<number> {
    let saved = 0
    const changes: RateChange[] = []
    for (const r of rates) {
      if (!r.roomType || !r.season || r.occupancy === undefined) continue
      const channel = typeof r.channel === 'string' ? r.channel : ''
      const basePrice = r.basePrice ?? 0; const percentage = r.percentage ?? 0
      const price = Math.round(basePrice * (1 + percentage / 100) * 100) / 100
      const closed = r.closed ? 1 : 0
      const minStay = Number(r.minStay) || 0; const maxStay = Number(r.maxStay) || 0
      const existing = (await this.ratesRepo.findMany({ hotelId, roomType: r.roomType, occupancy: r.occupancy, season: r.season, channel }))[0] as any
      const change: RateChange = { roomType: r.roomType, season: r.season, occupancy: r.occupancy, from: null, to: price, closed }
      if (existing) {
        await this.ratesRepo.update(existing.id, { basePrice, percentage, price, closed, minStay, maxStay })
        // El grid manda TODAS las celdas en cada guardado: solo se audita lo que realmente cambió.
        const moved = Number(existing.price ?? 0) !== price || Number(existing.closed ?? 0) !== closed
        if (moved) changes.push({ ...change, from: Number(existing.price ?? 0) })
      } else {
        await this.ratesRepo.create({ id: crypto.randomUUID(), hotelId, roomType: r.roomType, occupancy: r.occupancy, season: r.season, channel, basePrice, percentage, price, closed, minStay, maxStay })
        changes.push(change)
      }
      saved++
    }
    if (changes.length > 0) {
      await this.audit(rateChangeEntry(hotelId, changes, actor))
      // Tarifas cambiaron → push a OTAs. Los canales con override van al evento (el push sin canal solo toma la base).
      const channels = [...new Set(rates.map((r) => (typeof r.channel === 'string' ? r.channel : '')).filter(Boolean))]
      await this.sockets.onRatesUpdated?.(hotelId, saved, channels)
    }
    return saved
  }

  async copyRatesNextYear(hotelId: string, actor?: Actor): Promise<{ copied: number; total: number }> {
    const rates = await this.ratesRepo.findMany({ hotelId }) as any[]
    let copied = 0
    for (const r of rates) {
      const nextYear = String(r.season || '').replace(/\d{4}/, String(new Date().getFullYear() + 1))
      const exists = (await this.ratesRepo.findMany({ hotelId, roomType: r.roomType, occupancy: r.occupancy, season: nextYear }))[0]
      if (!exists) { await this.ratesRepo.create({ id: crypto.randomUUID(), hotelId, roomType: r.roomType, occupancy: r.occupancy, season: nextYear, price: r.price, basePrice: r.basePrice, percentage: r.percentage }); copied++ }
    }
    if (copied > 0) {
      await this.audit(rateCopyEntry(hotelId, copied, rates.length, actor))
      await this.sockets.onRatesCopied?.(hotelId, copied)
    }
    return { copied, total: rates.length }
  }

  async listBlocks(hotelId: string, startDate?: string, endDate?: string): Promise<any[]> {
    return listBlocks(this.blocksRepo, hotelId, startDate, endDate)
  }

  async createBlocks(hotelId: string, userId: string, roomIds: string[], reason: string, startDate: string, endDate: string): Promise<any[]> {
    const created = await createBlocks(this.blocksRepo, hotelId, userId, roomIds, reason, startDate, endDate)
    await this.sockets.onBlocksChanged?.(hotelId, roomIds)
    return created
  }

  async deleteBlock(id: string, hotelId: string, actor?: Actor): Promise<void> {
    const block = await deleteBlock(this.blocksRepo, id, hotelId)
    await this.audit(blockDeleteEntry(block, actor))
    await this.sockets.onBlocksChanged?.(hotelId, [block.roomId])
  }

  /** Días pintados con temporada (el controller lo llama tras assignSeason). */
  async notifySeasonAssignmentsUpdated(hotelId: string, count: number): Promise<void> { await this.sockets.onSeasonAssignmentsUpdated?.(hotelId, count) }
  /** Grilla de tarifas por fecha → push delta a las OTAs (connector pricing-canales). */
  async notifyRateOverridesUpdated(hotelId: string, saved: Array<Record<string, unknown>>, removed: number): Promise<void> { await this.sockets.onRateOverridesUpdated?.(hotelId, saved, removed) }

  /** Ejes de la grilla de tarifas por fecha (planes + tipos reales). Detalle en usecases/pricing-queries.ts. */
  rateGridAxes(hotelId: string): Promise<{ plans: RatePlanDef[]; roomTypes: string[] }> { return this.queries ? this.queries.rateGridAxes(hotelId) : Promise.resolve({ plans: DEFAULT_RATE_PLANS, roomTypes: [] }) }

  async listRateRestrictions(hotelId: string): Promise<any[]> {
    return await this.restrictionsRepo.findMany({ hotelId }) as any[]
  }

  async updateRateRestrictions(hotelId: string, restrictions: any[], actor?: Actor): Promise<number> {
    let saved = 0
    for (const r of restrictions) {
      if (!r.roomType || !r.season) continue
      const patch = { minStay: r.minStay ?? 0, maxStay: r.maxStay ?? 0, cta: r.cta ?? 0, ctd: r.ctd ?? 0, closedToArrival: r.closedToArrival ?? 0, closedToDeparture: r.closedToDeparture ?? 0, minStayThrough: r.minStayThrough ?? 0 }
      const existing = (await this.restrictionsRepo.findMany({ hotelId, roomType: r.roomType, season: r.season }))[0] as any
      if (existing) await this.restrictionsRepo.update(existing.id, patch)
      else await this.restrictionsRepo.create({ id: crypto.randomUUID(), hotelId, roomType: r.roomType, season: r.season, ...patch })
      saved++
    }
    if (saved > 0) {
      await this.audit(restrictionsChangeEntry(hotelId, saved, actor))
      await this.sockets.onRateRestrictionsUpdated?.(hotelId, saved) // → push a OTAs (pricing-canales)
    }
    return saved
  }

  async getChannelMetrics(hotelId: string): Promise<any[]> {
    if (!this.queries) throw new Error('Queries no disponible')
    return this.queries.getChannelMetrics(hotelId)
  }
}
