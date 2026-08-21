// payment-requests/usecases/payment-port.ts — Puerto hacia el módulo de pagos.
//
// Un cobro por Stripe Checkout escribe TRES cosas, con roles distintos:
//   1. `payment_requests.status = 'paid'`   → estado de la solicitud
//   2. reserva + línea en `folio_charges`   → libro auxiliar: baja el saldo del huésped
//   3. una fila en `payments`               → asiento del dinero: conciliación bancaria
//
// La tercera faltaba: el webhook parcheaba reserva y folio con repos crudos, así que un cobro por
// Stripe nunca aparecía en `payments` y quedaba invisible para la conciliación. (Deuda F10.)
//
// No impacta caja: `payments-caja` solo asienta el efectivo. Un cobro Stripe ya está bancarizado.
//
// `payment-requests` no importa `payments`: el conector `payment-requests-payments` inyecta la
// implementación.

import type { Logger } from 'arckode-framework'

export interface RecordStripePaymentInput {
  hotelId: string
  amount: number
  currency: string
  /** Sesión de Checkout: identidad del cobro, y clave de deduplicación entre reintentos. */
  stripeSessionId: string
  stripePaymentId?: string
  folioId?: string
  /**
   * RTC-0.5. Vínculo DIRECTO del asiento con la reserva. Hasta acá el cobro de un Link de Pago
   * entraba a `payments` con `folioId` y nada más — y sin folio abierto (lo normal antes del
   * check-in) quedaba SIN ninguno de los tres vínculos que `shared/usecases/reservation-paid.ts`
   * sabe recorrer. Esa fila era invisible para `paidForReservation`, para
   * `syncPendingAfterPayment` y para cualquier reporte que pregunte "¿qué cobré de esta reserva?":
   * el único rastro era `reservations.deposit`, que se va con la reserva si alguien la borra.
   * Es exactamente la misma clase de bug que el cobro de reprogramación por el que se agregó la
   * columna `payments.reservationId` (BUG-ceiling-bypass), por otra ruta.
   */
  reservationId?: string
  description?: string
  reference?: string
}

export interface RecordedPayment {
  id: string
  status: string
}

/** La fila de `payments` que asienta un cobro por Stripe Checkout. */
export interface StripeChargeDto {
  hotelId: string
  folioId?: string
  reservationId?: string
  type: 'charge'
  method: 'link'
  status: 'completed'
  amount: number
  currency: string
  description?: string
  reference?: string
  stripeSessionId: string
  stripePaymentId?: string
}

/**
 * Traduce el cobro a la fila de `payments`, en UN solo lugar.
 *
 * Vivía escrito a mano dentro de `connectors/payment-requests-payments.ts` y copiado a mano en el
 * doble de `tests/ceiling-world.ts`, y las dos copias se desincronizaron: al agregar
 * `reservationId` (RTC-0.5) sólo se actualizó el connector, así que en el banco de pruebas el
 * asiento seguía naciendo sin vínculo con la reserva y `assertNoSettledCharge` no lo encontraba.
 * Eso no es un detalle del test: un doble que no espeja al connector deja de ser evidencia de
 * nada. Un campo nuevo se agrega acá y las dos rutas lo toman juntas.
 */
export function stripeChargeDto(input: RecordStripePaymentInput): StripeChargeDto {
  return {
    hotelId: input.hotelId,
    folioId: input.folioId ?? undefined,
    // RTC-0.5: sin esto el asiento no cuelga de nada cuando no hay folio abierto.
    reservationId: input.reservationId ?? undefined,
    type: 'charge',
    // El cobro entra por un Link de Pago, no por una tarjeta pasada en el mostrador.
    method: 'link',
    // Stripe ya confirmó el cobro: es dinero recibido, no una intención de pago.
    status: 'completed',
    amount: input.amount,
    currency: input.currency,
    description: input.description,
    reference: input.reference,
    stripeSessionId: input.stripeSessionId,
    stripePaymentId: input.stripePaymentId,
  }
}

export interface StripePaymentPort {
  recordPayment(input: RecordStripePaymentInput): Promise<RecordedPayment>
  findBySession(hotelId: string, stripeSessionId: string): Promise<RecordedPayment | null>
}

export interface RecordStripePaymentResult {
  payment: RecordedPayment | null
  /** true si el cobro ya estaba asentado: es un reintento del webhook, no un cobro nuevo. */
  alreadyRecorded: boolean
}

/**
 * NO es best-effort: si el dinero no se puede asentar, el webhook falla y Stripe reintenta. Un cobro
 * que baja el saldo del folio pero no aparece en la conciliación es peor que un webhook fallido.
 */
export async function recordStripePayment(
  port: StripePaymentPort | null,
  logger: Logger,
  input: RecordStripePaymentInput,
): Promise<RecordStripePaymentResult> {
  if (!port) {
    logger.warn('Cobro Stripe sin asentar: el conector payment-requests-payments no está registrado', {
      stripeSessionId: input.stripeSessionId, amount: input.amount,
    })
    return { payment: null, alreadyRecorded: false }
  }

  const existing = await port.findBySession(input.hotelId, input.stripeSessionId)
  if (existing) {
    logger.info('Cobro Stripe ya asentado, se omite', { paymentId: existing.id, stripeSessionId: input.stripeSessionId })
    return { payment: existing, alreadyRecorded: true }
  }

  const payment = await port.recordPayment(input)
  logger.info('Cobro Stripe registrado en payments', {
    paymentId: payment.id, stripeSessionId: input.stripeSessionId, amount: input.amount,
  })
  return { payment, alreadyRecorded: false }
}
