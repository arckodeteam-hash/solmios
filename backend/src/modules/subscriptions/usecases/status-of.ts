// subscriptions/usecases/status-of.ts — Lo que el hotel ve de su propia suscripción.
//
// Junta tres cosas que viven separadas: el veredicto de acceso (`access.ts`, la única fuente del
// corte de servicio), la fila de `subscriptions` con sus descuentos vigentes, y la identidad del
// plan contratado (`plans`). El frontend NO recompone esto: recibe el estado ya resuelto, así no
// hay dos criterios sobre qué está vencido.
import type { RepositoryAdapter } from 'arckode-framework'
import type { AccessResult } from './access'

export interface SubscriptionStatus {
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  planId: string
  allowed: boolean
  reason: string | null
  daysLeft: number | null
  /** Ya tiene Customer de Stripe → se le puede ofrecer el Billing Portal. */
  hasStripeCustomer: boolean
  specialCategory: string | null
  activeDiscountPct: number | null
  /**
   * Nombre y precio del plan contratado, resueltos acá contra `plans`.
   *
   * Antes esto salía solo con `planId` y el panel resolvía el nombre cruzando contra
   * `/public/plans`. Eso fallaba en dos casos reales: un plan retirado del catálogo público
   * (`isActive: 0`) dejaba al hotel viendo su propio plan como "—", y cualquier lugar que
   * quisiera nombrarlo (la barra superior, el menú) tenía que pedir el catálogo entero para
   * mostrar una palabra. `null` cuando no hay plan o el id ya no existe en la tabla.
   */
  planName: string | null
  planPrice: number | null
  planCurrency: string | null
}

export interface StatusOfDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  /** `subscription_discounts`. Opcional: sin él no se informa descuento activo, pero no rompe. */
  discountsRepo?: RepositoryAdapter<any>
  /** `plans`. Opcional por el mismo motivo: sin él el estado viaja sin nombre de plan. */
  plansRepo?: RepositoryAdapter<any>
}

/**
 * El mayor % vigente entre los descuentos activos: puede venir de una categoría
 * (`category_bonus`) o de uno manual (`percentage`/`free_month`). Una fila `active` con `endsAt`
 * pasado ya no cuenta — el cron que las expira corre después, y el número que se muestra tiene
 * que ser el que se cobra hoy.
 */
async function maxActiveDiscount(
  discountsRepo: RepositoryAdapter<any> | undefined,
  hotelId: string,
  now: Date,
): Promise<number | null> {
  if (!discountsRepo) return null
  const rows = (await discountsRepo.findMany({ hotelId, status: 'active' })) as any[]
  const vigentes = rows.filter((d) => !d.endsAt || new Date(d.endsAt) > now)
  if (vigentes.length === 0) return null
  return Math.max(...vigentes.map((d) => Number(d.discountPct) || 0))
}

/** El plan contratado, si todavía existe en la tabla. Un plan borrado no es un error: el hotel
 *  sigue teniendo su suscripción y su acceso, solo que sin nombre que mostrar. */
async function planOf(
  plansRepo: RepositoryAdapter<any> | undefined,
  planId: string,
): Promise<any | null> {
  if (!plansRepo || !planId) return null
  try {
    return (await plansRepo.findMany({ id: planId }))[0] ?? null
  } catch {
    return null // el estado de la suscripción no se cae por no poder nombrar el plan
  }
}

export async function statusOf(
  deps: StatusOfDeps,
  access: AccessResult,
  hotelId: string,
  now: Date = new Date(),
): Promise<SubscriptionStatus> {
  const { subscriptionsRepo, discountsRepo, plansRepo } = deps
  const sub = (await subscriptionsRepo.findMany({ hotelId }))[0] as any
  const planId = sub?.planId ?? ''
  const plan = await planOf(plansRepo, planId)
  return {
    status: sub?.status ?? 'none',
    trialEndsAt: sub?.trialEndsAt ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    planId,
    allowed: access.allowed,
    reason: access.reason ?? null,
    daysLeft: access.daysLeft ?? null,
    hasStripeCustomer: !!sub?.stripeCustomerId,
    specialCategory: sub?.specialCategory ?? null,
    activeDiscountPct: sub ? await maxActiveDiscount(discountsRepo, hotelId, now) : null,
    planName: plan?.name ?? null,
    planPrice: plan ? Number(plan.price) : null,
    planCurrency: plan?.currency ?? null,
  }
}
