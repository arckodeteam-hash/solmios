// payment-requests/validators/schema.ts — Validación de entrada (validateSchema en POST/PUT).
// Schemas planos, sin dependencias externas.

import type { ValidationRule } from 'arckode-framework'
import { PAYMENT_REQUEST_STATUSES } from '../types'

export const CreatePaymentRequestSchema: Record<string, ValidationRule> = {
  reservationId: { type: 'string' as const, required: true },
  amount: { type: 'number' as const, required: true, min: 0 },
  currency: { type: 'string' as const },
  sentTo: { type: 'string' as const },
  sentVia: { type: 'string' as const },
  hotelId: { type: 'string' as const }, // opcional: se fuerza del JWT en el service (IDOR)
}

/**
 * Whitelist de campos actualizables por el CLIENTE. Sólo lo que un humano decide desde el panel:
 * cuánto cobrar, en qué estado está el cobro y a quién/por dónde se mandó el link.
 *
 * BUG-ceiling-bypass: `stripeSessionId`, `stripePaymentUrl` y `paidAt` estaban acá y NO son datos
 * del usuario — son ESTADO INTERNO del servidor. Los escriben `usecases/create-checkout.ts` (al
 * emitir la sesión) y `usecases/stripe-webhook.ts` (al asentar el cobro), por repo directo, nunca
 * por este PUT. Mientras el cliente podía escribirlos, el invariante que sostiene el techo agregado
 * ("una fila `pending` tiene a lo sumo una sesión abierta", `usecases/charge-ceiling.ts:18-24`) era
 * indefendible: `PUT {"stripeSessionId": ""}` no trae `status`, así que `releasesCeiling` daba
 * `false` y no se expiraba nada, la fila perdía el puntero y la sesión quedaba `open` en Stripe; el
 * `PUT {"status":"cancelled"}` siguiente salía por `if (!pr.stripeSessionId) return 'none'` y
 * liberaba el techo con el link vivo y pagable. Cubierto en `tests/ceiling-bypass.test.ts`.
 *
 * `validateSchema` construye la salida SÓLO con los campos declarados acá (kernel/validator.ts), así
 * que un campo ausente de esta lista se descarta en el borde HTTP. La segunda barrera —para los
 * callers que entran por el service sin pasar por el controller— es `PATCHABLE` en
 * `usecases/update-request.ts`, que espeja esta lista.
 */
export const UpdatePaymentRequestSchema: Record<string, ValidationRule> = {
  amount: { type: 'number' as const, min: 0 },
  // SEC-1: sin `enum`, un usuario con `billing:edit` mandaba `PUT {status:'x'}` y el link dejaba de
  // contar como `pending` en `committedPending` (usecases/charge-ceiling.ts). El enum cierra los
  // valores basura, NADA MÁS: `'cancelled'` y `'expired'` son valores VÁLIDOS que sacan la fila del
  // techo agregado igual. Que eso no libere saldo con el link todavía vivo lo garantiza
  // `usecases/live-session.ts` (expira la Checkout Session antes de mover el estado), no este enum.
  status: { type: 'string' as const, enum: [...PAYMENT_REQUEST_STATUSES] },
  sentTo: { type: 'string' as const },
  sentVia: { type: 'string' as const },
}

export const PaymentRequestsValidator = {
  create: CreatePaymentRequestSchema,
  update: UpdatePaymentRequestSchema,
}
