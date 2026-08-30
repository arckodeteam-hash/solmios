// shared/utils/payment-status.ts — Fuente ÚNICA del "¿esta reserva está pagada?".
//
// Por qué existe (2026-08-30, reporte de cliente "no se ve que pagó"):
// `reservations` NO tiene columna `paymentStatus` — la operacional es `depositStatus` más los
// montos. El dashboard ya lo derivaba bien, pero con la fórmula copiada en dos archivos, y el
// endpoint público leía `reservation.paymentStatus`, un campo que no existe: devolvía SIEMPRE
// 'unpaid', incluso para una reserva cobrada al 100%. Por eso la pantalla de confirmación no
// mostraba el pago del huésped.
//
// REGLA: nadie deriva el estado de pago por su cuenta. Se importa de acá.

import { round2 } from './money'

/**
 * Vocabulario alineado con `reservations.depositStatus` (la columna REAL: 'unpaid'|'partial'|'paid')
 * y con el contrato ya publicado del endpoint público. El dashboard expone 'pending' en vez de
 * 'unpaid' en SU API; mapea al salir para no romper a su frontend.
 */
export type PaymentStatus = 'paid' | 'partial' | 'unpaid'

export interface PaidAmounts {
  status: PaymentStatus
  /** Lo efectivamente cobrado. */
  paid: number
  /** Lo que falta cobrar. Nunca negativo. */
  pending: number
}

/**
 * Estado de pago a partir del total cobrable y lo realmente cobrado.
 *
 * - `paid`: cubre el total (con tolerancia de centavo por redondeo de conversión/impuestos).
 * - `partial`: pagó algo pero no todo.
 * - `unpaid`: no pagó nada.
 *
 * Total 0 con algo pagado cuenta como `paid` (una reserva de cortesía ya saldada); total 0 sin
 * pagos es `unpaid`, no `paid`: no se anuncia como cobrada una reserva que nunca se cobró.
 */
export function paymentStatusOf(totalAmount: unknown, paidAmount: unknown): PaymentStatus {
  const total = toAmount(totalAmount)
  const paid = toAmount(paidAmount)
  if (paid <= 0) return 'unpaid'
  // Tolerancia de un centavo: un total de 613.60 cobrado como 613.6 no puede quedar 'partial'.
  if (paid + 0.01 >= total) return 'paid'
  return 'partial'
}

/** Estado + montos redondeados, listos para mostrarle al huésped. */
export function paymentAmountsOf(totalAmount: unknown, paidAmount: unknown): PaidAmounts {
  const total = toAmount(totalAmount)
  const paid = toAmount(paidAmount)
  return {
    status: paymentStatusOf(total, paid),
    paid: round2(paid),
    pending: Math.max(0, round2(total - paid)),
  }
}

function toAmount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}
