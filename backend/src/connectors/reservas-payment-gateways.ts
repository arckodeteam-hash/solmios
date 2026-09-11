// connectors/reservas-payment-gateways.ts — REQ-RWP-02. El detalle de la reserva muestra el
// bloque "Pasarela de pago" (intentos de cobro: pagado / fallido / expirado, con link al
// dashboard del proveedor). La tabla `payment_attempts` es del módulo payment-gateways, así que
// reservas la lee por ESTE puerto y no por import directo entre módulos (regla del repo).
//
// Best-effort del lado de reservas (usecases/detail.ts): es bitácora, no dinero. Si el módulo no
// responde, el detalle sale con `paymentAttempts: []` en vez de romper.
import type { ConnectorContext } from 'arckode-framework'

interface PaymentGatewaysModule {
  listAttempts(hotelId: string, reservationId: string): Promise<Record<string, any>[]>
}

export function reservasPaymentGatewaysConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<{
    setOrchestrationDeps: (d: Record<string, unknown>) => void
  }>('reservas')
  // Lazy: payment-gateways se resuelve recién al primer uso, no al registrar el connector.
  const gateways = () => ctx.resolveModule<PaymentGatewaysModule>('payment-gateways')

  reservas.setOrchestrationDeps({
    listPaymentAttempts: (hotelId: string, reservationId: string) => gateways().listAttempts(hotelId, reservationId),
  })
}
