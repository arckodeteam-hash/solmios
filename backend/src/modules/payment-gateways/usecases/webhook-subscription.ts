// payment-gateways/usecases/webhook-subscription.ts — qué eventos le faltan al webhook de Stripe.
//
// #308: en el recorrido de prod, el rechazo con la tarjeta 4000 0000 0000 0002 NO dejó fila
// 'failed' en payment_attempts. El código lo contempla (stripe-gateway.ts mapStatus → 'failed',
// bookingengine recordOutcome), pero Stripe solo manda los eventos tildados en el endpoint del
// Dashboard, y `payment_intent.payment_failed` no estaba. El PMS no crea el endpoint por API
// (lo registra el hotel a mano), así que lo mejor que puede hacer es LISTARLOS con su propia
// secret key y avisar en "Probar conexión". Puro, sin red: el caller trae los endpoints.

/**
 * Eventos que mapean las tres rutas de webhook por hotel (bookingengine
 * /api/public/webhook/stripe/:hotelId, payments /api/webhooks/stripe/:hotelId, payment-requests
 * /api/stripe/webhook/:hotelId; ver stripe-gateway.ts mapStatus). Sin alguno, el PMS no se entera.
 */
export const REQUIRED_STRIPE_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'charge.refunded',
] as const

export interface StripeWebhookEndpointInfo {
  id: string
  url: string
  status: string
  enabledEvents: string[]
}

/** Pathname sin query ni trailing slash. Si la URL no parsea, se usa el string tal cual. */
function pathOf(url: string): string {
  let path = url
  try { path = new URL(url).pathname } catch { /* no es URL absoluta: se compara como vino */ }
  return path.replace(/\/+$/, '')
}

function isHotelEndpoint(ep: StripeWebhookEndpointInfo, hotelId: string): boolean {
  const path = pathOf(ep.url)
  return path.includes('/webhook') && path.endsWith(`/${hotelId}`)
}

/** Avisos (en español, sin secretos) sobre los endpoints de Stripe que apuntan a este hotel. */
export function stripeWebhookWarnings(hotelId: string, endpoints: StripeWebhookEndpointInfo[]): string[] {
  const own = endpoints.filter(ep => isHotelEndpoint(ep, hotelId))
  if (own.length === 0) {
    return [
      'No hay endpoint de webhook en Stripe apuntando a este hotel: registrá uno en el Dashboard ' +
      `con el path /api/public/webhook/stripe/${hotelId} y tildá los eventos ${REQUIRED_STRIPE_WEBHOOK_EVENTS.join(', ')}.`,
    ]
  }

  const warnings: string[] = []
  for (const ep of own) {
    if (ep.enabledEvents.includes('*')) continue
    if (ep.status !== 'enabled') {
      warnings.push(`El webhook ${ep.url} está deshabilitado en Stripe (status: ${ep.status}).`)
    }
    const missing = REQUIRED_STRIPE_WEBHOOK_EVENTS.filter(ev => !ep.enabledEvents.includes(ev))
    if (missing.length) {
      warnings.push(
        `Al webhook ${ep.url} le faltan los eventos ${missing.join(', ')}: sin ellos el PMS no se ` +
        'entera (por ejemplo, de una tarjeta rechazada).',
      )
    }
  }
  return warnings
}
