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
 * `secret` (la session-key) va cifrado con el mismo AES-256-GCM que `payment_gateways.credentials`.
 */
export const PaymentGatewaySessionsModel: ModelDefinition = {
  table: 'payment_gateway_sessions',
  fields: {
    id: { type: 'string', required: true }, // SESSION del proveedor (`sess-...` en CardNet)
    hotelId: { type: 'string', required: true, indexed: true },
    provider: { type: 'string', required: true }, // cardnet (único 'pull' hoy)
    reference: { type: 'string', required: true }, // nuestra referencia (reserva/folio)
    secret: { type: 'string', required: true }, // session-key, cifrada AES-256-GCM (ver registry.ts)
    amountMinor: { type: 'number', default: 0 },
    currency: { type: 'string' },
    mode: { type: 'string' }, // test | live
  },
  timestamps: true,
}

export function registerPaymentGatewaysModels(orm: ORM): void {
  orm.define('PaymentGateways', PaymentGatewaysModel)
  orm.define('PaymentEvents', PaymentEventsModel)
  orm.define('PaymentGatewaySessions', PaymentGatewaySessionsModel)
}
