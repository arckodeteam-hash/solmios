// payments/model.ts — Schema de base de datos
// Tablas: Payments (transacciones), PaymentMethods (métodos guardados), PaymentLinks (enlaces)

import type { ModelDefinition, ORM } from 'arckode-framework'

export const PaymentModel: ModelDefinition = {
  table: 'payments',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    folioId: { type: 'string', indexed: true },
    invoiceId: { type: 'string', indexed: true },
    // BUG-ceiling-bypass: TERCER vínculo reserva → dinero. `payments` sólo se alcanzaba por folio o
    // factura (`shared/usecases/reservation-paid.ts`), y `shared/usecases/charge-reschedule-diff.ts`
    // asienta el cobro de una reprogramación SIN ninguno de los dos (efectivo/tarjeta sueltos, la
    // reserva viajaba únicamente en `metadata`, que es JSON y no se puede filtrar por WHERE). Esa
    // plata era invisible para el techo de `payment-requests`, que autorizaba recobrarla por Stripe.
    // NO está en `validators/schema.ts`: lo escribe el servidor, no llega por el body.
    reservationId: { type: 'string', indexed: true },
    guestId: { type: 'string', indexed: true },
    type: { type: 'string', required: true }, // charge | refund | deposit | withdrawal
    method: { type: 'string', required: true }, // card | cash | transfer | link | deposit | other
    status: { type: 'string', default: 'pending' }, // pending | processing | completed | failed | refunded
    amount: { type: 'number', required: true },
    currency: { type: 'string', default: 'USD' },
    description: { type: 'string', default: '' },
    reference: { type: 'string', default: '' }, // external ref (stripe session, bank ref, etc)
    stripePaymentId: { type: 'string', default: '' },
    stripeSessionId: { type: 'string', default: '' },
    metadata: { type: 'json', default: {} },
    processedAt: { type: 'string' },
  },
}

export const PaymentLinkModel: ModelDefinition = {
  table: 'payment_links',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    guestId: { type: 'string' },
    folioId: { type: 'string' },
    amount: { type: 'number', required: true },
    currency: { type: 'string', default: 'USD' },
    description: { type: 'string', default: '' },
    status: { type: 'string', default: 'active' }, // active | used | expired | cancelled
    token: { type: 'string', required: true, indexed: true },
    expiresAt: { type: 'string' },
    maxUses: { type: 'number', default: 1 },
    useCount: { type: 'number', default: 0 },
    paymentId: { type: 'string' }, // linked payment after use
  },
}

export const DepositModel: ModelDefinition = {
  table: 'deposits',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    reservationId: { type: 'string', indexed: true },
    guestId: { type: 'string', indexed: true },
    roomId: { type: 'string' },
    amount: { type: 'number', required: true },
    currency: { type: 'string', default: 'USD' },
    status: { type: 'string', default: 'held' }, // held | partially_refunded | fully_refunded | released
    paymentMethod: { type: 'string', default: 'card' },
    stripePaymentId: { type: 'string', default: '' },
    holdReason: { type: 'string', default: 'reservation_guarantee' },
    releasedAt: { type: 'string' },
    refundAmount: { type: 'number', default: 0 },
    notes: { type: 'string', default: '' },
  },
}

export function registerPaymentsModels(orm: ORM): void {
  orm.define('Payment', PaymentModel)
  orm.define('PaymentLink', PaymentLinkModel)
  orm.define('Deposit', DepositModel)
}
