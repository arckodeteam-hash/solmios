// connectors/admin-subscriptions-billing.ts — REQ-BIL-06.
//
// El super-admin registra un pago hecho fuera de Stripe (transferencia, efectivo) desde
// /admin/billing. Registrar el cobro es del módulo `admin`; mover la suscripción es del módulo
// `subscriptions` —y solo él sabe qué implica: `active`, `currentPeriodEnd` nuevo y limpiar la
// gracia y la suspensión, exactamente lo mismo que hace `invoice.paid`. Los módulos no se
// importan entre sí: `admin` declara el puerto (`setBillingSubscriptionDeps`) y este connector
// inyecta la implementación. Solo DELEGA.
//
// Sin este connector el pago manual igual se registra, pero el hotel queda pagando y sin acceso;
// por eso el usecase devuelve un aviso explícito en vez de fingir que todo salió bien.
import type { ConnectorContext } from 'arckode-framework'

interface SubscriptionsModule {
  activateAfterManualPayment: (hotelId: string, periodEnd: string) => Promise<{ activated: boolean; previousStatus?: string }>
}

export function adminSubscriptionsBillingConnector(ctx: ConnectorContext): void {
  const admin = ctx.resolveModule<{ setBillingSubscriptionDeps: (port: any) => void }>('admin')
  const subscriptions = ctx.resolveModule<SubscriptionsModule>('subscriptions')

  admin.setBillingSubscriptionDeps({
    activateAfterManualPayment: (hotelId: string, periodEnd: string) =>
      subscriptions.activateAfterManualPayment(hotelId, periodEnd),
  })
}
