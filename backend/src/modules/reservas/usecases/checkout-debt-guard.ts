// reservas/usecases/checkout-debt-guard.ts — No se cierra una estadía con deuda sin confirmarlo.
//
// La regla existía sólo en el panel web (`pages/checkin/index.vue`: el checkbox "el huésped se irá
// con saldo pendiente"). El endpoint la aceptaba igual, así que cualquier otro cliente —la app
// móvil, una integración por API, un curl— cerraba con deuda sin aviso y sin dejar constancia de
// quién lo autorizó. Una regla de plata que vive en el navegador no es una regla.
//
// Ahora el servidor la exige: si la cuenta queda con saldo y el checkout no trae un cobro que lo
// cubra, hay que mandar `acknowledgeDebt: true`. El 409 devuelve el importe exacto para que el
// cliente pueda mostrarlo — que es lo que el panel ya hace, y ahora también puede hacer el móvil.

import { ConflictError } from 'arckode-framework'
import { BALANCE_EPSILON } from '../../../shared/utils/money'
import type { OpenFolioBalance } from '../../../shared/usecases/open-folio-balance'
import type { SettleInput } from './settle-port'

export interface CheckoutDebtInput {
  /** Saldo del folio abierto, o `null` si la reserva no tiene cuenta abierta. */
  folio: OpenFolioBalance | null
  /** Cobro que viene en el checkout, si hay. */
  settle: SettleInput | null | undefined
  /** El cliente confirmó explícitamente cerrar con deuda. */
  acknowledgeDebt: boolean
}

/** Deuda que quedaría después de aplicar el cobro del checkout. 0 si no queda nada. */
export function remainingDebt(folio: OpenFolioBalance | null, settle: SettleInput | null | undefined): number {
  const balance = Number(folio?.balance) || 0
  if (balance <= BALANCE_EPSILON) return 0
  const paid = Number(settle?.amount) || 0
  const left = balance - paid
  return left > BALANCE_EPSILON ? Math.round(left * 100) / 100 : 0
}

/**
 * Corta el checkout con 409 si la estadía se cierra debiendo y nadie lo confirmó.
 *
 * Se llama ANTES del claim de `executeCheckout`: si corriera después, la reserva ya estaría en
 * `checked_out` y el 409 dejaría el estado movido con la operación "rechazada".
 */
export function assertDebtAcknowledged(input: CheckoutDebtInput): void {
  const debt = remainingDebt(input.folio, input.settle)
  if (debt <= 0 || input.acknowledgeDebt) return
  throw new ConflictError(
    `El huésped se iría con un saldo pendiente de $${debt.toFixed(2)}. `
    + 'Registrá el cobro o confirmá el check-out con deuda (acknowledgeDebt).',
  )
}
