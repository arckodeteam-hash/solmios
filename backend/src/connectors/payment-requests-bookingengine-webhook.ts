// connectors/payment-requests-bookingengine-webhook.ts — Una sola URL de webhook para el hotel.
//
// El hotel configura UN endpoint en su cuenta de Stripe, pero el sistema tiene DOS flujos de cobro
// con handlers distintos: los links de pago (`payment-requests`) y el motor de reservas público
// (`bookingengine`). Antes, el panel publicaba sólo la URL de payment-requests
// (`pages/pagos/index.vue`), así que TODO evento del motor aterrizaba en el handler equivocado,
// que respondía 200 sin aplicar nada. Stripe da el 200 por entregado y no reintenta: el huésped
// pagaba, se le cobraba, y la reserva quedaba `pending` para siempre, sin un solo log.
//
// Este connector los cruza: cada handler, al recibir un evento del otro flujo, se lo reenvía a su
// dueño. Cualquiera de las dos URLs sirve para los dos flujos, y ya no importa cuál configuró el
// hotel. El ruteo se decide por el `metadata` del evento y NO otorga autoridad: quien recibe el
// reenvío vuelve a verificar la firma con el secreto del hotel.
import type { ConnectorContext } from 'arckode-framework'

type WebhookFn = (hotelId: string, rawBody: string | Buffer, signature: string) => Promise<unknown>

export function paymentRequestsBookingengineWebhookConnector(ctx: ConnectorContext): void {
  const paymentRequests = ctx.resolveModule<{
    setBookingWebhookPort: (fn: WebhookFn) => void
    handleWebhook: WebhookFn
  }>('payment-requests')
  const bookingengine = ctx.resolveModule<{
    setPaymentRequestWebhookPort: (fn: WebhookFn) => void
    handleStripeWebhook: WebhookFn
  }>('bookingengine')

  // Evento del motor que entró por la URL de los links de pago → al motor.
  paymentRequests.setBookingWebhookPort((hotelId, rawBody, signature) =>
    bookingengine.handleStripeWebhook(hotelId, rawBody, signature))

  // Evento de un link de pago que entró por la URL del motor → a los links de pago.
  bookingengine.setPaymentRequestWebhookPort((hotelId, rawBody, signature) =>
    paymentRequests.handleWebhook(hotelId, rawBody, signature))
}
