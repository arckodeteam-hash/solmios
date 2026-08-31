// subscriptions/usecases/apply-stripe-discount.ts — Cupón real de Stripe sobre la
// suscripción del hotel (F6 de PLAN-SUSCRIPCIONES.md). Igual que create-checkout-session.ts,
// `StripeService.getClient()` SIN hotelId = cuenta de la PLATAFORMA.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { StripeService } from '../../../services/stripe-service'
import { addMonths } from '../../../shared/utils/add-months'

export interface ApplyStripeDiscountDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  /** `subscription_discounts` — opcional: sin cablear, el cupón igual se aplica en Stripe pero
   *  no queda auditado localmente (no se refleja en `activeDiscountPct` de /panel/suscripcion). */
  discountsRepo?: RepositoryAdapter<any>
  logger: Logger
}

export interface ApplyStripeDiscountResult {
  applied: boolean
  reason?: string
}

/** Quién pide el descuento y por qué — queda auditado en `subscription_discounts.type`/`reason`. */
export interface ApplyStripeDiscountMeta {
  /** 'category_bonus' | 'percentage' | 'free_month' | 'referral_credit' | ... */
  type: string
  reason?: string
  appliedByUserId?: string
}

/**
 * Best-effort: si el hotel todavía no pagó nunca (sin `stripeSubscriptionId`) o Stripe no
 * está configurado, no aplica nada pero tampoco tira. Cuando SÍ se aplica y viene `meta`,
 * además crea el registro auditable local en `subscription_discounts` — mismo criterio que
 * ya usa `admin/usecases/special-conditions.ts` para las condiciones especiales, así el origen
 * del descuento (categoría, manual, crédito de referido) no importa para `activeDiscountPct`.
 */
export async function applyStripeDiscount(
  deps: ApplyStripeDiscountDeps,
  hotelId: string,
  discountPct: number,
  durationMonths: number | null,
  meta?: ApplyStripeDiscountMeta,
): Promise<ApplyStripeDiscountResult> {
  const { subscriptionsRepo, discountsRepo, logger } = deps
  const sub = (await subscriptionsRepo.findMany({ hotelId }))[0] as any
  if (!sub?.stripeSubscriptionId) {
    return { applied: false, reason: 'sin suscripción de Stripe activa' }
  }

  const stripe = await StripeService.getClient()
  if (!stripe) {
    return { applied: false, reason: 'Stripe no está configurado en la plataforma' }
  }

  try {
    const coupon = await stripe.coupons.create({
      percent_off: discountPct,
      duration: durationMonths ? 'repeating' : 'forever',
      duration_in_months: durationMonths ?? undefined,
    })
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      discounts: [{ coupon: coupon.id }],
    })
    logger.info('Cupón de Stripe aplicado a la suscripción', { hotelId, discountPct, durationMonths })

    if (meta && discountsRepo) {
      const now = new Date()
      // Mismo criterio que admin/special-conditions: `addMonths` recorta al último día del mes
      // destino en vez de desbordarse al siguiente (31/08 + 1 mes = 30/09, no 01/10).
      const endsAt = durationMonths ? addMonths(now, durationMonths).toISOString() : null
      await discountsRepo.create({
        id: crypto.randomUUID(),
        hotelId, subscriptionId: sub.id, type: meta.type, discountPct,
        startAt: now.toISOString(), endsAt, appliedByUserId: meta.appliedByUserId ?? null,
        reason: meta.reason ?? null, status: 'active',
      } as any)
    }

    return { applied: true }
  } catch (e: any) {
    logger.warn('No se pudo aplicar el cupón de Stripe', { hotelId, error: e.message })
    return { applied: false, reason: e.message }
  }
}
