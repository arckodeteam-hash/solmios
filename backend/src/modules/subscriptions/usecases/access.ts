// access.ts — ¿Este hotel puede usar el sistema hoy?
//
// Es la única fuente de verdad del corte de servicio. La responde el login y el
// middleware que protege las rutas, para que no haya dos criterios distintos.
//
// El vencimiento se resuelve al CONSULTAR, no con un cron: si el trial terminó
// hace un minuto, el acceso se corta ese minuto aunque ningún proceso lo haya
// marcado todavía. El cron nocturno existe igual, pero solo para avisar y dejar
// los estados prolijos — nunca para decidir si alguien entra.
import type { RepositoryAdapter } from 'arckode-framework'

/** Motivo por el que se corta el acceso. El frontend decide qué mostrar con esto. */
export type DenyReason =
  | 'payment_method_required'
  | 'trial_expired'
  | 'subscription_expired'
  | 'hotel_suspended'
  | 'hotel_inactive'
  | 'subscription_suspended'

export interface AccessResult {
  allowed: boolean
  reason?: DenyReason
  /** Días que faltan para que se venza (para avisar antes de cortar). */
  daysLeft?: number
  status?: string
  trialEndsAt?: string
}

/**
 * Estados de suscripción que dejan trabajar. ÚNICA fuente (antes `resolve-plan.ts` duplicaba
 * la lista en `ACTIVE_SUBSCRIPTION_STATUSES`): el gate de módulos la importa para elegir la
 * fila activa del hotel — si los dos conjuntos discreparan, un hotel podría estar cortado
 * del login y a la vez gateado con la matriz de una suscripción muerta (o al revés).
 */
export const WORKING_STATUSES = new Set(['trialing', 'active', 'past_due'])

const MS_PER_DAY = 24 * 60 * 60 * 1000

export class SubscriptionAccess {
  constructor(
    private readonly subscriptionsRepo: RepositoryAdapter<any>,
    private readonly hotelsRepo: RepositoryAdapter<any>,
    /**
     * Política de alta de la plataforma (#28). OPCIONAL a propósito: sin cablear, el acceso se
     * comporta como antes de que existiera el switch — un trial sin tarjeta entra igual. Así el
     * corte nuevo solo aparece donde la plataforma pidió explícitamente exigir tarjeta, y un
     * fallo de wiring no puede dejar afuera a todos los hoteles en prueba.
     */
    private readonly readPolicy?: () => Promise<{ requireCardOnTrial: boolean }>,
  ) {}

  /** Un fallo leyendo la config NO puede cortar accesos: ante la duda, se deja entrar. */
  private async requiresCard(): Promise<boolean> {
    if (!this.readPolicy) return false
    try {
      return (await this.readPolicy()).requireCardOnTrial === true
    } catch {
      return false
    }
  }

  /**
   * Un hotel sin suscripción registrada NO se bloquea: son los hoteles que ya
   * existían antes de que esto se creara, y cortarles el servicio por una
   * migración sería el peor estreno posible. Se los trata como al día.
   */
  async check(hotelId: string, now: Date = new Date()): Promise<AccessResult> {
    if (!hotelId || hotelId === 'platform') return { allowed: true }

    const hotel = await this.hotelsRepo.findById(hotelId)
    if (hotel?.status === 'suspended') return { allowed: false, reason: 'hotel_suspended' }
    if (hotel?.status === 'inactive') return { allowed: false, reason: 'hotel_inactive' }

    const sub = (await this.subscriptionsRepo.findMany({ hotelId }))[0]
    if (!sub) return { allowed: true }

    if (sub.status === 'trialing') {
      // #28: con la política en `requireCardOnTrial`, la prueba NO empieza hasta que Stripe
      // confirmó la tarjeta (`paymentMethodAddedAt`). Va ANTES del chequeo de vencimiento: si
      // alguien abandonó el Checkout, el motivo real es que falta el método de pago, no que se
      // le venció un trial que nunca llegó a correr.
      //
      // Se exige `awaitingPaymentMethodSince`: sólo se bloquea a quien EFECTIVAMENTE fue mandado
      // al Checkout. Un hotel al que nunca se le pudo pedir la tarjeta (plan sin `stripePriceId`,
      // altas anteriores a esta política) entra normal — si no, prender el switch con Stripe a
      // medio configurar dejaba afuera a todo el mundo sin forma de pagar.
      if (sub.awaitingPaymentMethodSince && !sub.paymentMethodAddedAt && (await this.requiresCard())) {
        return { allowed: false, reason: 'payment_method_required', status: sub.status, trialEndsAt: sub.trialEndsAt }
      }
      const endsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null
      if (endsAt && endsAt.getTime() <= now.getTime()) {
        // Se deja asentado para que el super-admin lo vea, pero la decisión ya
        // se tomó con la fecha: el estado guardado es una consecuencia, no la causa.
        await this.markExpired(sub.id)
        return { allowed: false, reason: 'trial_expired', status: 'expired', trialEndsAt: sub.trialEndsAt }
      }
      return {
        allowed: true,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        daysLeft: endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / MS_PER_DAY)) : undefined,
      }
    }

    if (sub.status === 'active' || sub.status === 'past_due') {
      const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null
      if (periodEnd && periodEnd.getTime() <= now.getTime()) {
        await this.markExpired(sub.id)
        return { allowed: false, reason: 'subscription_expired', status: 'expired' }
      }
      return { allowed: true, status: sub.status }
    }

    // Gracia agotada sin pagar (subscription-suspension-cron) o suspensión manual del admin.
    // Va ANTES del chequeo genérico: sin esto caería en el 'trial_expired' de abajo, que no
    // es el motivo real y confunde al hotel sobre qué le pasó.
    if (sub.status === 'suspended') {
      return { allowed: false, reason: 'subscription_suspended', status: 'suspended' }
    }

    if (!WORKING_STATUSES.has(sub.status)) {
      return {
        allowed: false,
        reason: sub.status === 'canceled' ? 'subscription_expired' : 'trial_expired',
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
      }
    }
    return { allowed: true, status: sub.status }
  }

  private async markExpired(id: string): Promise<void> {
    await this.subscriptionsRepo.update(id, { status: 'expired' }).catch(() => {})
  }
}
