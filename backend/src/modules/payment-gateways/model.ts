// payment-gateways/model.ts — Schema de base de datos

import type { ModelDefinition, ORM } from 'arckode-framework'

/**
 * Credenciales de pasarela POR HOTEL. Cada dueño cobra a su propia cuenta.
 * `credentials` va cifrado (AES-256-GCM) — nunca en texto plano: es la llave que mueve el dinero.
 */
export const PaymentGatewaysModel: ModelDefinition = {
  table: 'payment_gateways',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    provider: { type: 'string', required: true }, // stripe | paypal | azul | cardnet
    // Columna explícita, NO inferida del prefijo de la llave: Stripe se distingue por
    // sk_test_/sk_live_, pero Azul separa test y producción por host y credenciales distintas.
    mode: { type: 'string', required: true, default: 'test' }, // test | live
    credentials: { type: 'string', required: true }, // cifrado AES-256-GCM
    enabled: { type: 'boolean', default: false },
    isDefault: { type: 'boolean', default: false },
  },
  timestamps: true,
}

/**
 * Anti-replay. Stripe reintenta webhooks; CardNet reintenta hasta recibir 200; el huésped puede
 * recargar la página de retorno de Azul. El mismo cobro VA a llegar más de una vez. Sin esta
 * tabla, un reintento asienta el dinero dos veces.
 */
export const PaymentEventsModel: ModelDefinition = {
  table: 'payment_events',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    provider: { type: 'string', required: true },
    eventId: { type: 'string', required: true, indexed: true }, // id del evento en el proveedor
    providerRef: { type: 'string' },
    reference: { type: 'string' },
    status: { type: 'string' },
    amountMinor: { type: 'number', default: 0 },
    currency: { type: 'string' },
    processedAt: { type: 'string' },
  },
  timestamps: true,
}

/**
 * Sesiones de cobro de los proveedores 'pull' (sin webhook). CardNet devuelve la session-key UNA
 * sola vez, al crear la sesión; el navegador vuelve trayendo sólo la SESSION, y la consulta de
 * estado no trae ni el monto ni nuestra referencia. Sin esta tabla no hay cómo saber qué
 * consultar ni con qué llave: el adapter la escribe en createCharge() y la lee en confirm().
 * `sessionKey` (la session-key) va cifrado con el mismo AES-256-GCM que `payment_gateways.credentials`.
 */
export const PaymentGatewaySessionsModel: ModelDefinition = {
  table: 'payment_gateway_sessions',
  fields: {
    id: { type: 'string', required: true }, // SESSION del proveedor (`sess-...` en CardNet)
    hotelId: { type: 'string', required: true, indexed: true },
    provider: { type: 'string', required: true }, // cardnet (único 'pull' hoy)
    reference: { type: 'string', required: true }, // nuestra referencia (reserva/folio)
    sessionKey: { type: 'string', required: true }, // la session-key de CardNet, cifrada AES-256-GCM (ver registry.ts)
    amountMinor: { type: 'number', default: 0 },
    currency: { type: 'string' },
    mode: { type: 'string' }, // test | live
  },
  timestamps: true,
}

/**
 * Bitácora de TODO outcome de la pasarela: checkout creado, pagado, rechazado, expirado,
 * reembolsado, pendiente. Los rechazos y las expiraciones también se registran: sin esta tabla
 * el hotel nunca ve por qué una reserva web quedó sin cobrar (REQ-RWP-01).
 *
 * NO reemplaza a `payment_events`: esa tabla es la barrera de idempotencia del cobro (un evento
 * del proveedor se asienta una sola vez); esta es historial y se escribe best-effort.
 *
 * NUNCA guarda el payload crudo del proveedor ni datos del tarjetahabiente más allá de la marca
 * de la tarjeta y sus últimos 4 dígitos.
 */
export const PaymentAttemptsModel: ModelDefinition = {
  table: 'payment_attempts',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    reservationId: { type: 'string', indexed: true },
    source: { type: 'string', required: true }, // booking_engine | payment_request | pos
    provider: { type: 'string', required: true }, // stripe | azul | cardnet | ...
    mode: { type: 'string' }, // test | live
    providerRef: { type: 'string', indexed: true }, // id del cobro/sesión en el proveedor
    eventId: { type: 'string' }, // id del evento en el proveedor (si lo hay)
    kind: { type: 'string', required: true }, // checkout_created | paid | failed | expired | refunded | pending
    amountMinor: { type: 'number', default: 0 },
    currency: { type: 'string' },
    failureCode: { type: 'string' }, // código del proveedor (card_declined, insufficient_funds, ...)
    failureMessage: { type: 'string' },
    cardBrand: { type: 'string' },
    cardLast4: { type: 'string' },
    receiptUrl: { type: 'string' },
    occurredAt: { type: 'string' }, // cuándo pasó en el proveedor (no cuándo lo guardamos)
  },
  timestamps: true,
}

export function registerPaymentGatewaysModels(orm: ORM): void {
  orm.define('PaymentGateways', PaymentGatewaysModel)
  orm.define('PaymentEvents', PaymentEventsModel)
  orm.define('PaymentGatewaySessions', PaymentGatewaySessionsModel)
  orm.define('PaymentAttempts', PaymentAttemptsModel)
}
