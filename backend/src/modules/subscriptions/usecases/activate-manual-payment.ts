// subscriptions/usecases/activate-manual-payment.ts — REQ-BIL-06.
//
// Un hotel sin tarjeta paga por transferencia; el super-admin lo registra desde /admin/billing y
// la suscripción tiene que quedar EXACTAMENTE como la deja un cobro de Stripe. No alcanza con
// poner `status: 'active'`: si el hotel venía de `past_due`/`suspended` arrastra `graceEndsAt`,
// `suspendedAt` y `suspendedReason`, y esa basura sigue mintiendo en el detalle del admin.
//
// La regla es la MISMA que `handle-stripe-event.ts` aplica en `invoice.paid` — se repite acá a
// propósito y no se comparte una función: son dos puertas de entrada distintas (el webhook de
// Stripe y la mano del admin) sobre el mismo modelo. Si la regla cambia, cambian las dos.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { compareSubscriptions } from './resolve-plan'

export interface ActivateManualPaymentDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  logger: Logger
}

export interface ActivateManualPaymentResult {
  activated: boolean
  subscriptionId?: string
  previousStatus?: string
}

/**
 * Deja la suscripción del hotel `active` hasta `periodEnd`. Devuelve `activated:false` (sin
 * lanzar) si el hotel no tiene suscripción: el pago ya se registró y no se puede deshacer, así
 * que el llamador informa y sigue.
 */
export async function activateAfterManualPayment(
  deps: ActivateManualPaymentDeps, hotelId: string, periodEnd: string,
): Promise<ActivateManualPaymentResult> {
  const rows = ((await deps.subscriptionsRepo.findMany({ hotelId })) as any[]) ?? []
  // Mismo orden determinista que el resto del módulo (R3-4a): con dos filas por hotel (doble alta
  // o migración) hay que tocar la MISMA que resuelve el gate, no la primera que devuelva la base.
  const sub = [...rows].sort(compareSubscriptions)[0]
  if (!sub) {
    deps.logger.warn('Pago manual: el hotel no tiene suscripción local que activar', { hotelId })
    return { activated: false }
  }

  await deps.subscriptionsRepo.update(sub.id, {
    status: 'active',
    currentPeriodEnd: periodEnd,
    graceEndsAt: null,
    suspendedAt: null,
    suspendedReason: null,
  })
  deps.logger.info('Suscripción activada por pago manual', { hotelId, subscriptionId: sub.id, periodEnd })
  return { activated: true, subscriptionId: String(sub.id), previousStatus: String(sub.status ?? '') }
}
