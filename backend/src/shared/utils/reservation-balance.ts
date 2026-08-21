// shared/utils/reservation-balance.ts — FUENTE ÚNICA del total cobrable de una reserva.
//
// Regresión (bug 2026-08-19): `reservas/usecases/detail.ts` devolvía
// `pendingAmount = totalAmount - deposit`, ignorando los addons (`reservation_addons`) y
// `otherCharges`. El modal de reserva mostraba ese número en "Pendiente de cobro" y
// `requirePayment()` creaba la Checkout Session de Stripe por ese mismo monto → con extras
// cargados se le cobraba de MENOS al huésped, y el documento impreso mezclaba criterios
// (conceptos con extras, "Pendiente" sin extras).
//
// Regla: el total cobrable de una reserva es UNO solo —
//   chargeableTotal = totalAmount + otherCharges + Σ(addons con signo)
//   pending         = max(0, chargeableTotal - deposit)
// Cualquier lugar que necesite el pendiente usa estas funciones. NO re-derivar a mano.

import { round2 } from './money'

/** Fila de `reservation_addons` (shared/models.ts). `kind:'discount'` resta. */
export interface ReservationAddonLike {
  amount?: number | null
  quantity?: number | null
  kind?: string | null
}

/** Campos monetarios de la fila `reservations` que participan del total cobrable. */
export interface ReservationAmountsLike {
  totalAmount?: number | null
  otherCharges?: number | null
  deposit?: number | null
}

// STR-1: `round2` NO se re-exporta desde acá. Tres rutas de import para el mismo símbolo hacían
// que un `rg 'utils/money'` no encontrara a todos los consumidores. Quien lo necesite lo importa
// de `shared/utils/money.ts`, que es su único origen.

/** Suma con signo de los addons: `service` suma, `discount` resta. Cantidad por defecto 1. */
export function addonsTotal(addons: readonly ReservationAddonLike[] | null | undefined): number {
  if (!addons?.length) return 0
  return round2(
    addons.reduce((sum, a) => {
      const sign = a?.kind === 'discount' ? -1 : 1
      const qty = Number(a?.quantity ?? 1) || 0
      return sum + sign * (Number(a?.amount) || 0) * qty
    }, 0),
  )
}

/** Total cobrable: alojamiento + otros cobros + extras. Es lo que debe pagar el huésped. */
export function chargeableTotal(
  reservation: ReservationAmountsLike | null | undefined,
  addons?: readonly ReservationAddonLike[] | null,
): number {
  const base = Number(reservation?.totalAmount) || 0
  const other = Number(reservation?.otherCharges) || 0
  return round2(base + other + addonsTotal(addons))
}

/**
 * Saldo pendiente de cobro: total cobrable menos lo ya pagado. Nunca negativo.
 *
 * `paidAmount` es LO COBRADO DE VERDAD y hay que pasarlo siempre que se pueda resolver
 * (`shared/usecases/reservation-paid.ts` lo deriva de `payments`, la única fuente de verdad del
 * dinero segun CLAUDE.md). Sin él se cae a `reservation.deposit`, que es un espejo PARCIAL: lo
 * mueven el motor de reservas y el webhook de Stripe, pero NO `folios.applyPayment` ni
 * `facturas.pay` — quien pagó $300 en efectivo por folio sigue con `deposit = 0`. Ese número es el
 * techo de autorización de `payment-requests/usecases/charge-ceiling.ts`: con el fallback se
 * autoriza cobrar por Stripe plata YA cobrada.
 */
export function pendingBalance(
  reservation: ReservationAmountsLike | null | undefined,
  addons?: readonly ReservationAddonLike[] | null,
  paidAmount?: number | null,
): number {
  const paid = resolvePaid(reservation, paidAmount)
  return Math.max(0, round2(chargeableTotal(reservation, addons) - paid))
}

/** Lo pagado que usa la fórmula: `paidAmount` si es un número usable, si no `deposit`. */
function resolvePaid(
  reservation: ReservationAmountsLike | null | undefined,
  paidAmount?: number | null,
): number {
  const explicit = Number(paidAmount)
  if (paidAmount !== undefined && paidAmount !== null && Number.isFinite(explicit) && explicit >= 0) {
    return explicit
  }
  return Number(reservation?.deposit) || 0
}
