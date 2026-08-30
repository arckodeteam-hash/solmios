// subscriptions/usecases/status-of.ts — Lo que el hotel ve de su propia suscripción.
//
// Junta dos cosas que viven separadas: el veredicto de acceso (`access.ts`, la única fuente del
// corte de servicio) y la fila de `subscriptions` con sus descuentos vigentes. El frontend NO
// recompone esto: recibe el estado ya resuelto, así no hay dos criterios sobre qué está vencido.
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

export async function statusOf(
  subscriptionsRepo: RepositoryAdapter<any>,
  discountsRepo: RepositoryAdapter<any> | undefined,
  access: AccessResult,
  hotelId: string,
  now: Date = new Date(),
): Promise<SubscriptionStatus> {
  const sub = (await subscriptionsRepo.findMany({ hotelId }))[0] as any
  return {
    status: sub?.status ?? 'none',
    trialEndsAt: sub?.trialEndsAt ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    planId: sub?.planId ?? '',
    allowed: access.allowed,
    reason: access.reason ?? null,
    daysLeft: access.daysLeft ?? null,
    hasStripeCustomer: !!sub?.stripeCustomerId,
    specialCategory: sub?.specialCategory ?? null,
    activeDiscountPct: sub ? await maxActiveDiscount(discountsRepo, hotelId, now) : null,
  }
}
