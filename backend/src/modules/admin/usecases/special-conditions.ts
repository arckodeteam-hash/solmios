// admin/usecases/special-conditions.ts — El botón "Condiciones especiales" del Super Admin
// (PLAN-SUSCRIPCIONES.md §6). Recibe `orm` crudo, NO un RepositoryAdapter: el cupo de
// Fundador/Pionero necesita CAS (compare-and-swap por igualdad sobre `occupiedCount`), la única
// forma atómica que el framework permite sin SQL manual (`orm.updateMany`, no expuesto por
// RepositoryAdapter/OrmRepository). Mismo criterio que DashboardQueries (admin/usecases/dashboard-queries.ts):
// vive en usecases/, nunca `orm` inyectado directo en admin/service.ts.
import { ValidationError, NotFoundError } from 'arckode-framework'
import { addMonths } from '../../../shared/utils/add-months'

export type ApplyType = 'category' | 'percentage' | 'free_month'
export type SpecialCategoryKey = 'founder_one' | 'founder_two' | 'pioneer'

export interface ApplySpecialConditionsInput {
  type: ApplyType
  category?: SpecialCategoryKey | null
  discountPct?: number
  durationMonths?: number | null
  reason?: string
}

const SETTINGS_KEY = 'subscription_settings'
const PLATFORM = 'platform'
const DEFAULT_MAX_MANUAL_DISCOUNT_PCT = 100
const DEFAULT_FOUNDER_CHURN_BLOCKS_RETURN = true

export class SpecialConditionsUseCase {
  constructor(private readonly orm: any) {}

  async apply(hotelId: string, input: ApplySpecialConditionsInput, actor: { id?: string }): Promise<any> {
    const sub = (await this.orm.findMany('Subscriptions', { hotelId }))[0]
    if (!sub) throw new NotFoundError('El hotel no tiene una suscripción registrada')

    // Objeto plano, sin envolver en {data:...}: el controller pasa esto tal cual como `body`,
    // y buildEnvelope (kernel/http/server.ts) ya envuelve TODO body no-lista en `data` — envolver
    // acá de nuevo produce `{data:{data:{...}}}` doble-anidado (bug real, visto al integrar el
    // frontend). Mismo criterio que admin/service.ts createPlan/updatePlan (devuelven la fila plana).
    if (input.type === 'category') {
      await this.assignCategory(sub, input.category ?? null, hotelId, actor)
      return this.orm.findById('Subscriptions', sub.id)
    }

    const discountPct = input.type === 'free_month' ? 100 : Number(input.discountPct ?? 0)
    const durationMonths = input.type === 'free_month' ? 1 : (input.durationMonths ?? null)
    if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
      throw new ValidationError('discountPct fuera de rango (0-100)')
    }

    const settings = await this.readSettings()
    if (discountPct > settings.maxManualDiscountPct) {
      throw new ValidationError(`El descuento máximo permitido es ${settings.maxManualDiscountPct}%`)
    }

    const now = new Date()
    // `addMonths` y no `new Date(y, m + n, d)`: el constructor desborda al mes siguiente cuando
    // el día no existe en el destino (mes gratis dado un 31/08 vencía el 01/10).
    const endsAt = durationMonths ? addMonths(now, durationMonths).toISOString() : null
    const discount = await this.orm.create('SubscriptionDiscounts', {
      id: crypto.randomUUID(),
      hotelId, subscriptionId: sub.id, type: input.type, discountPct,
      startAt: now.toISOString(), endsAt, appliedByUserId: actor.id ?? null,
      reason: input.reason ?? null, status: 'active',
    })
    return discount
  }

  /** `detail(hotelId)` — usado por GET /:hotelId y por el modal de "Condiciones especiales" al abrir. */
  async detail(hotelId: string): Promise<any> {
    const sub = (await this.orm.findMany('Subscriptions', { hotelId }))[0]
    if (!sub) throw new NotFoundError('El hotel no tiene una suscripción registrada')
    const discounts = await this.orm.findMany('SubscriptionDiscounts', { hotelId })
    const founderHistory = await this.orm.findMany('FounderHistory', { hotelId })
    const plan = sub.planId ? await this.orm.findById('Plans', sub.planId) : null
    return { subscription: sub, plan, discounts, founderHistory }
  }

  async searchByEmail(email: string): Promise<any> {
    const user = (await this.orm.findMany('Users', { email }))[0]
    if (!user?.hotelId) throw new NotFoundError('No se encontró ninguna cuenta con ese email')
    const hotel = await this.orm.findById('Hotels', user.hotelId)
    if (!hotel) throw new NotFoundError('Hotel no encontrado')
    const sub = (await this.orm.findMany('Subscriptions', { hotelId: hotel.id }))[0]
    const plan = sub?.planId ? await this.orm.findById('Plans', sub.planId) : null
    return {
      hotelId: hotel.id, hotelName: hotel.name,
      planId: sub?.planId ?? null, planSortOrder: plan?.sortOrder ?? null,
      status: sub?.status ?? 'none', specialCategory: sub?.specialCategory ?? null,
    }
  }

  async suspendManual(hotelId: string): Promise<any> {
    const sub = (await this.orm.findMany('Subscriptions', { hotelId }))[0]
    if (!sub) throw new NotFoundError('El hotel no tiene una suscripción registrada')
    // 'manual' (a diferencia de 'grace_period_expired') NO dispara founder_history: es una
    // decisión del admin, no mora del hotel — no debe costarle la categoría a quien sí paga.
    return this.orm.update('Subscriptions', sub.id, {
      status: 'suspended', suspendedAt: new Date().toISOString(), suspendedReason: 'manual',
    })
  }

  async reactivateManual(hotelId: string): Promise<any> {
    const sub = (await this.orm.findMany('Subscriptions', { hotelId }))[0]
    if (!sub) throw new NotFoundError('El hotel no tiene una suscripción registrada')
    return this.orm.update('Subscriptions', sub.id, {
      status: 'active', graceEndsAt: null, suspendedAt: null, suspendedReason: null,
    })
  }

  private async assignCategory(sub: any, category: SpecialCategoryKey | null, hotelId: string, actor: { id?: string }): Promise<void> {
    if (!category) {
      if (sub.specialCategory) {
        await this.releaseSlot(sub.specialCategory)
        await this.revokeCategoryDiscount(sub.id)
      }
      await this.orm.update('Subscriptions', sub.id, { specialCategory: null, specialCategoryGrantedAt: null })
      return
    }

    const config = (await this.orm.findMany('SpecialCategoryConfig', { key: category }))[0]
    if (!config) throw new ValidationError(`Categoría "${category}" no configurada`)
    if (config.status !== 'open') throw new ValidationError(`La categoría "${category}" no está abierta`)
    if (config.occupiedCount >= config.totalSlots) throw new ValidationError(`Sin cupo disponible en "${category}"`)

    // Plan mínimo por sortOrder — nunca comparar contra un slug/nombre hardcodeado.
    if (config.minPlanSortOrder != null) {
      const plan = sub.planId ? await this.orm.findById('Plans', sub.planId) : null
      if (!plan || (plan.sortOrder ?? 0) < config.minPlanSortOrder) {
        throw new ValidationError(`Este hotel necesita un plan de sortOrder >= ${config.minPlanSortOrder} para calificar a "${category}"`)
      }
    }

    // Anti-recuperación (§9): un hotel que ya tuvo y perdió esta categoría no puede volver,
    // aunque haya cupo. Solo aplica a las categorías con historial (Fundador Uno/Dos).
    // Gateado por `founderChurnBlocksReturn` (Grupo B, default true) — antes se rechazaba
    // SIEMPRE aunque el admin apagara el toggle en /admin/subscriptions/founders-pioneers,
    // que es justo el "cero hardcode" que prohíbe PLAN-SUSCRIPCIONES.md §0.
    const settings = await this.readSettings()
    if (settings.founderChurnBlocksReturn) {
      const history = await this.orm.findMany('FounderHistory', { hotelId, category })
      if (history.length > 0) {
        throw new ValidationError(`Este hotel ya tuvo "${category}" y lo perdió — no puede volver a calificar`)
      }
    }

    if (sub.specialCategory && sub.specialCategory !== category) {
      await this.releaseSlot(sub.specialCategory)
      await this.revokeCategoryDiscount(sub.id)
    }

    const ok = await this.claimSlot(category, config.occupiedCount, config.totalSlots)
    if (!ok) throw new ValidationError(`Sin cupo disponible en "${category}" (lo tomó otro admin en simultáneo, reintentá)`)

    await this.orm.update('Subscriptions', sub.id, {
      specialCategory: category, specialCategoryGrantedAt: new Date().toISOString(),
    })
    // La categoría trae su propio % — queda registrado como discount auditable (snapshot).
    await this.orm.create('SubscriptionDiscounts', {
      id: crypto.randomUUID(),
      hotelId, subscriptionId: sub.id, type: 'category_bonus', discountPct: config.discountPct,
      startAt: new Date().toISOString(), endsAt: null, appliedByUserId: actor.id ?? null,
      reason: `Categoría ${category}`, status: 'active',
    })
  }

  /**
   * Cierra el discount `category_bonus` vigente al perder/cambiar de categoría — encontrado en
   * QA manual: sin esto, `SubscriptionDiscounts.status` quedaba 'active' para siempre y
   * `statusOf().activeDiscountPct` seguía mostrando el % de una categoría que el hotel ya no tiene.
   */
  private async revokeCategoryDiscount(subscriptionId: string): Promise<void> {
    const active = ((await this.orm.findMany('SubscriptionDiscounts', {
      subscriptionId, type: 'category_bonus', status: 'active',
    })) as any[])
    const now = new Date().toISOString()
    for (const d of active) {
      await this.orm.update('SubscriptionDiscounts', d.id, { status: 'revoked', endsAt: d.endsAt ?? now })
    }
  }

  /** CAS: solo avanza si `occupiedCount` sigue siendo exactamente `expected`. 0 filas afectadas = perdió la carrera con otro admin. */
  private async claimSlot(key: string, expected: number, totalSlots: number): Promise<boolean> {
    const next = expected + 1
    const changed = await this.orm.updateMany('SpecialCategoryConfig', { key, occupiedCount: expected },
      { occupiedCount: next, status: next >= totalSlots ? 'full' : 'open' })
    return changed > 0
  }

  private async releaseSlot(key: string): Promise<void> {
    const row = (await this.orm.findMany('SpecialCategoryConfig', { key }))[0]
    if (!row || row.occupiedCount <= 0) return
    await this.orm.updateMany('SpecialCategoryConfig', { key, occupiedCount: row.occupiedCount },
      { occupiedCount: row.occupiedCount - 1, status: row.status === 'full' ? 'open' : row.status })
  }

  private async readSettings(): Promise<{ maxManualDiscountPct: number; founderChurnBlocksReturn: boolean }> {
    const row = (await this.orm.findMany('Configuration', { hotelId: PLATFORM, key: SETTINGS_KEY }))[0]
    if (!row) return { maxManualDiscountPct: DEFAULT_MAX_MANUAL_DISCOUNT_PCT, founderChurnBlocksReturn: DEFAULT_FOUNDER_CHURN_BLOCKS_RETURN }
    const v = typeof row.value === 'string' ? JSON.parse(row.value) : (row.value ?? {})
    return {
      maxManualDiscountPct: v.maxManualDiscountPct ?? DEFAULT_MAX_MANUAL_DISCOUNT_PCT,
      founderChurnBlocksReturn: v.founderChurnBlocksReturn ?? DEFAULT_FOUNDER_CHURN_BLOCKS_RETURN,
    }
  }
}
