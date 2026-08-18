// crm/service.ts — CRM engine: points, coupons (deprecados), segments, LTV.
// Fachada fina: la lógica vive en usecases/ (loyalty, loyalty-config, redeem-with-promo,
// tiers-recompute, segment-export, coupons, segments, ltv) — regla del analyzer (<200 líneas).

import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { ValidationError, NotFoundError } from 'arckode-framework'
import type {
  LoyaltyTransactionDTO, CouponDTO, CreateCouponDTO,
  GuestSegmentDTO, CreateSegmentDTO,
  GuestLTV, CrmDashboard,
} from './types'
import type { CrmSockets } from './sockets'
import { LtvUseCase } from './usecases/ltv'
import { CouponUseCase } from './usecases/coupons'
import { applyPoints, nextTier, pointsForStay, type TierThreshold } from './usecases/loyalty'
import { readLoyaltyConfig } from './usecases/loyalty-config'
import { redeemWithPromo } from './usecases/redeem-with-promo'
import { recomputeTiers } from './usecases/tiers-recompute'
import { segmentCsv, segmentFilename } from './usecases/segment-export'
import { buildDashboard } from './usecases/dashboard'
import { awardCheckoutStay } from './usecases/checkout-award'
import { SegmentUseCase } from './usecases/segments'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'

/** Puerto hacia el módulo promo-codes: el canje genera un código de descuento REAL.
 *  Lo cablea el connector `crm-promocodes` (el CRM no importa el módulo directo). */
export interface LoyaltyPromoPort {
  createForLoyalty(hotelId: string, code: string, value: number, validDays: number): Promise<{ id: string; code: string }>
}

const NO_CONFIG_REPO = { findMany: async () => [] as unknown[] }

export class CrmService {
  private sockets: CrmSockets = {}
  private ltvCalculator: LtvUseCase
  private coupons: CouponUseCase
  private segments: SegmentUseCase
  private auditPort: AuditPort | null = null
  private promoPort: LoyaltyPromoPort | null = null
  private configRepo: Pick<RepositoryAdapter<any>, 'findMany'> = NO_CONFIG_REPO

  /** Conecta el audit log. Lo inyecta el connector `crm-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  /** Conecta el generador de promos del canje. Lo inyecta el connector `crm-promocodes`. */
  setPromoPort(port: LoyaltyPromoPort): void { this.promoPort = port }

  /** Configuración KV (`configuration`): ratio/tiers/flag por hotel. */
  setConfigRepo(repo: Pick<RepositoryAdapter<any>, 'findMany'>): void { this.configRepo = repo }

  /** Config del hotel con defaults históricos (nunca null — fail-safe). */
  private async loyaltyConfig(hotelId: string) {
    return readLoyaltyConfig(this.configRepo, hotelId)
  }

  constructor(
    private readonly loyaltyRepo: RepositoryAdapter<LoyaltyTransactionDTO>,
    private readonly couponRepo: RepositoryAdapter<CouponDTO>,
    private readonly segmentRepo: RepositoryAdapter<GuestSegmentDTO>,
    private readonly guestRepo: RepositoryAdapter<any>,
    private readonly reservaRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    cache: CacheAdapter,
    private readonly auth?: Auth,
  ) {
    this.ltvCalculator = new LtvUseCase(guestRepo, reservaRepo, logger)
    this.coupons = new CouponUseCase({ repo: couponRepo, auth, onUsed: (id) => this.sockets.onCouponUsed?.(id) ?? Promise.resolve() })
    this.segments = new SegmentUseCase({ repo: segmentRepo, guestRepo, auth })
  }

  setSockets(s: Partial<CrmSockets>): void {
    const next = s as Record<string, any>; const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) { const h = next[key]; if (!h) continue; const prev = cur[key]; cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h }
  }

  // ─── Auto-checkout from connector ─────────────────────
  /** Best-effort desde `reservas-huespedes`; idempotente y respetando el flag. */
  async onCheckoutComplete(reserva: any): Promise<void> {
    const config = await this.loyaltyConfig(reserva.hotelId)
    await awardCheckoutStay(
      {
        loyaltyRepo: this.loyaltyRepo, guestRepo: this.guestRepo, logger: this.logger,
        awardPoints: (gid, hid, pts, desc, rid) => this.awardPoints(gid, hid, pts, desc, rid),
        checkTierUpgrade: (gid) => this.checkTierUpgrade(gid),
      },
      reserva, config,
    )
  }

  // ─── Points ───────────────────────────────────────────
  async awardPoints(guestId: string, hotelId: string, points: number, description: string, reservationId?: string, role?: string): Promise<LoyaltyTransactionDTO> {
    const guest = await this.guestRepo.findById(guestId)
    if (!guest) throw new NotFoundError('Guest not found')
    if (this.auth) this.auth.assertOwnership(guest.hotelId, hotelId, role, 'super_admin')
    if (points <= 0) throw new ValidationError('Los puntos a acreditar deben ser positivos')

    const txn = await this.loyaltyRepo.create({ guestId, hotelId, reservationId: reservationId ?? null, type: 'earn', points, description } as any)
    // Leer, sumar, escribir: el ORM no entiende `{ increment }` — ver usecases/loyalty.ts.
    const balance = applyPoints(guest.loyaltyPoints, points)
    await this.guestRepo.update(guestId, { loyaltyPoints: balance } as any)

    await this.sockets.onPointsAwarded?.(guestId, points)
    await this.checkTierUpgrade(guestId)
    return txn
  }

  async redeemPoints(guestId: string, hotelId: string, points: number, description: string, role?: string): Promise<LoyaltyTransactionDTO & { promoCode?: string; discountValue?: number }> {
    const config = await this.loyaltyConfig(hotelId)
    if (!config.enabled) throw new ValidationError('El programa de puntos está desactivado')
    return redeemWithPromo(
      { loyaltyRepo: this.loyaltyRepo, guestRepo: this.guestRepo, auth: this.auth, promoPort: this.promoPort, config, logger: this.logger },
      guestId, hotelId, points, description, role,
    )
  }

  async getPointsHistory(guestId: string, hotelId: string, role?: string): Promise<LoyaltyTransactionDTO[]> {
    const guest = await this.guestRepo.findById(guestId)
    if (!guest) throw new NotFoundError('Guest not found')
    if (this.auth) this.auth.assertOwnership(guest.hotelId, hotelId, role, 'super_admin')
    return this.loyaltyRepo.findMany({ guestId })
  }

  async getPointsBalance(guestId: string, hotelId: string, role?: string): Promise<number> {
    const guest = await this.guestRepo.findById(guestId)
    if (!guest) throw new NotFoundError('Guest not found')
    if (this.auth) this.auth.assertOwnership(guest.hotelId, hotelId, role, 'super_admin')
    return guest.loyaltyPoints ?? 0
  }

  // ─── Tier Management ──────────────────────────────────
  // Internal helper — only reached from awardPoints (ownership already asserted there)
  // or onCheckoutComplete (trusted reserva.guestId from connector). Not routed directly.
  /** Devuelve el nivel VIGENTE tras el cálculo. Antes devolvía el viejo, incluso si acababa de subir. */
  async checkTierUpgrade(guestId: string): Promise<string> {
    // @ignore IDOR_RISK — guestId already validated by caller (see comment above method)
    const guest = await this.guestRepo.findById(guestId)
    if (!guest) return 'bronze'

    const config = await this.loyaltyConfig(guest.hotelId)
    const thresholds: readonly TierThreshold[] = config.tiers
    const current = guest.tier ?? 'bronze'
    const upgraded = nextTier(current, Number(guest.totalStays ?? 0), Number(guest.totalSpent ?? 0), thresholds)
    if (upgraded !== current) {
      await this.guestRepo.update(guestId, { tier: upgraded } as any)
      await this.sockets.onTierUpgrade?.(guestId, current, upgraded)
    }
    return upgraded
  }

  /** Recompute masivo de tiers (backfill tras cambiar umbrales). Ratchet: nunca baja. */
  async recomputeTiers(hotelId: string): Promise<{ recomputed: number; upgraded: number }> {
    const config = await this.loyaltyConfig(hotelId)
    return recomputeTiers(this.guestRepo, hotelId, config.tiers, {
      onUpgrade: (guestId, from, to) => this.sockets.onTierUpgrade?.(guestId, from, to),
    })
  }

  // ─── Coupons (delegan a usecases/coupons; DEPRECADOS → 410 en las rutas) ──
  createCoupon(dto: CreateCouponDTO): Promise<CouponDTO> { return this.coupons.create(dto) }
  getCoupon(id: string, hotelId: string, role?: string): Promise<CouponDTO> { return this.coupons.getById(id, hotelId, role) }
  listCoupons(hotelId: string): Promise<CouponDTO[]> { return this.coupons.list(hotelId) }
  validateCoupon(code: string, hotelId: string, purchaseAmount: number): Promise<CouponDTO> { return this.coupons.validate(code, hotelId, purchaseAmount) }
  useCoupon(id: string, hotelId: string, role?: string): Promise<CouponDTO> { return this.coupons.use(id, hotelId, role) }
  /** Baja de cupón (lógica). Deja rastro en el audit log: quién lo dio de baja y cuál era (SC-05). */
  async deleteCoupon(id: string, hotelId: string, role?: string, actor?: { id?: string; role?: string }): Promise<void> {
    const coupon = await this.coupons.deactivate(id, hotelId, role)
    await auditSafely(this.auditPort, this.logger, { hotelId: coupon.hotelId, userId: actor?.id, action: 'coupon.delete',
      entity: 'coupon', entityId: id, detail: `Cupón "${coupon.code}" dado de baja (${coupon.useCount ?? 0} uso/s)` })
  }

  // ─── Segments (delegan a usecases/segments) ───────────
  createSegment(dto: CreateSegmentDTO): Promise<GuestSegmentDTO> { return this.segments.create(dto) }
  listSegments(hotelId: string): Promise<GuestSegmentDTO[]> { return this.segments.list(hotelId) }
  getGuestsInSegment(hotelId: string, segmentId: string, role?: string): Promise<any[]> { return this.segments.guestsIn(hotelId, segmentId, role) }

  /** CSV del segmento (spec crm-segments): contacto + fidelización, nada más. */
  async exportSegmentCsv(hotelId: string, segmentId: string, role?: string): Promise<{ filename: string; csv: string }> {
    const segments = await this.segmentRepo.findMany({ hotelId, active: 1 })
    const segment = segments.find((sg) => sg.id === segmentId)
    if (!segment) throw new NotFoundError('Segment not found')
    const members = await this.segments.guestsIn(hotelId, segmentId, role)
    return { filename: segmentFilename(segment.name), csv: segmentCsv(members) }
  }

  // ─── LTV ──────────────────────────────────────────────
  async calculateLTV(hotelId: string, limit = 50): Promise<GuestLTV[]> {
    return this.ltvCalculator.calculate(hotelId, limit)
  }

  // ─── Dashboard ────────────────────────────────────────
  getDashboard(hotelId: string): Promise<CrmDashboard> {
    return buildDashboard({ guestRepo: this.guestRepo, reservaRepo: this.reservaRepo, loyaltyRepo: this.loyaltyRepo, couponRepo: this.couponRepo }, hotelId)
  }
}
