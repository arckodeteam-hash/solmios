// folios/usecases/prepaid-credit.ts — Refleja en el folio plata que el hotel YA cobró.
//
// No es lo mismo que `applyPayment`: ese asienta un cobro NUEVO en `payments` (caja, conciliación).
// Acá el dinero ya está asentado —un anticipo del alta, un cobro de Stripe previo al check-in— y
// lo único que falta es que el folio lo sepa. Usar `applyPayment` para esto contaría la misma plata
// dos veces en los reportes.
//
// Por qué hace falta (verificado en dev, 2026-09-04): un huésped que pagó 195 por adelantado y
// después acortó la estadía a 65 llegaba al check-out con un folio de "cargos 76,70 · pagos 0 ·
// saldo 76,70". El sistema le pedía pagar otra vez algo que ya había pagado, y sus 130 a favor no
// entraban en la cuenta. El anticipo cargado a mano en el alta vive sólo en `reservations.deposit`
// y no genera fila en `payments`, así que `prepaid-folio-lines.ts` —que lee `payments`— no lo veía.
//
// Dos guardas que no son opcionales:
//   · Idempotente por `reference`: cerrar dos veces, o reintentar un settlement, no puede acreditar
//     dos veces. La referencia identifica el ORIGEN del dinero, no este asiento.
//   · Tope en el saldo: nunca deja el folio en negativo. Si el huésped pagó más de lo que consumió,
//     el sobrante NO se inventa como pago de este folio — queda a favor en la reserva
//     (`creditBalance`), que es donde se ve y desde donde se devuelve.

import { ValidationError } from 'arckode-framework'
import type { FolioChargeDTO, CurrentUser } from '../types'
import { computeTotals } from './folio-math'
import { assertOpenFolio, type FolioEntriesDeps } from './folio-entries'
import { round2 } from '../../../shared/utils/money'

export interface PrepaidCreditInput {
  /** Lo que el hotel ya cobró y el folio todavía no refleja. Se recorta al saldo. */
  amount: number
  /** Identifica el ORIGEN del dinero (ej. `prepaid:<reservationId>`). Clave de idempotencia. */
  reference: string
  description?: string
}

export interface PrepaidCreditResult {
  /** Lo efectivamente acreditado (0 si no hacía falta o ya estaba). */
  applied: number
  charge: FolioChargeDTO | null
  reason?: 'already-applied' | 'no-balance' | 'nothing-to-apply'
}

export async function postPrepaidCredit(
  deps: FolioEntriesDeps,
  folioId: string,
  input: PrepaidCreditInput,
  user: CurrentUser,
): Promise<PrepaidCreditResult> {
  // Mismo guardián que `postCharge`/`applyPayment`: existe, es del hotel del usuario, está abierto.
  const folio = await assertOpenFolio(deps, folioId, user)
  if (!input.reference) throw new ValidationError('La referencia es obligatoria: es lo que evita acreditar dos veces')

  const charges = await deps.chargeRepo.findMany({ folioId }) as FolioChargeDTO[]

  // Ya reflejado: se sale sin tocar nada. Es lo que hace seguro reintentar un cierre.
  if (charges.some((c) => String((c as any)?.reference ?? '') === input.reference)) {
    return { applied: 0, charge: null, reason: 'already-applied' }
  }

  const pedido = round2(Number(input.amount) || 0)
  if (pedido <= 0) return { applied: 0, charge: null, reason: 'nothing-to-apply' }

  const { balance } = computeTotals(charges)
  const acreditar = round2(Math.min(pedido, balance))
  if (acreditar <= 0) return { applied: 0, charge: null, reason: 'no-balance' }

  const charge = await deps.chargeRepo.create({
    folioId, hotelId: folio.hotelId,
    description: input.description || 'Pago anticipado de la reserva',
    category: 'payment', kind: 'payment', quantity: 1,
    amount: -acreditar, taxes: 0, total: -acreditar,
    source: 'prepaid', reference: input.reference,
    postedAt: new Date().toISOString(),
  } as any)

  deps.logger.info('Anticipo reflejado en el folio', {
    folioId, chargeId: (charge as any)?.id, pedido, acreditado: acreditar,
    balanceBefore: balance, balanceAfter: round2(balance - acreditar), reference: input.reference,
  })
  return { applied: acreditar, charge: charge as FolioChargeDTO }
}
