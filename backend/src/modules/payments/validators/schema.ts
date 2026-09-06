// payments/validators/schema.ts — Validación de entrada

import type { ValidationRule } from 'arckode-framework'

export const CreatePaymentSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  folioId: { type: 'string' as const },
  invoiceId: { type: 'string' as const },
  guestId: { type: 'string' as const },
  type: { type: 'string' as const, required: true },
  method: { type: 'string' as const, required: true },
  amount: { type: 'number' as const, required: true },
  currency: { type: 'string' as const },
  description: { type: 'string' as const },
  reference: { type: 'string' as const },
}

export const ChargeCardSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  amount: { type: 'number' as const, required: true },
  currency: { type: 'string' as const },
  description: { type: 'string' as const, required: true },
  folioId: { type: 'string' as const },
  guestId: { type: 'string' as const },
  successUrl: { type: 'string' as const, required: true },
  cancelUrl: { type: 'string' as const, required: true },
}

export const CreateDepositSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  reservationId: { type: 'string' as const },
  guestId: { type: 'string' as const },
  roomId: { type: 'string' as const },
  amount: { type: 'number' as const, required: true },
  currency: { type: 'string' as const },
  paymentMethod: { type: 'string' as const },
  holdReason: { type: 'string' as const },
  notes: { type: 'string' as const },
}

export const RefundDepositSchema: Record<string, ValidationRule> = {
  // min: un refund negativo pasaba el guard de over-refund (−500 < deposit) y envenenaba el
  // ledger de refundAmount. Mismo min que RefundSchema (refund de pago).
  amount: { type: 'number' as const, min: 0.01 },
  reason: { type: 'string' as const },
}

// `hotelId` sale del JWT, no del body. `entries` es un array: validateSchema no tiene tipo `array`,
// así que el controller lo estrecha a mano y el usecase descarta las filas sin monto numérico.
export const ReconcileSchema: Record<string, ValidationRule> = {
  from: { type: 'date' as const },
  to: { type: 'date' as const },
}

export const RefundSchema: Record<string, ValidationRule> = {
  amount: { type: 'number' as const, min: 0.01 },
}

export const PaymentsValidator = {
  createPayment: CreatePaymentSchema,
  chargeCard: ChargeCardSchema,
  createDeposit: CreateDepositSchema,
  refundDeposit: RefundDepositSchema,
  reconcile: ReconcileSchema,
}
