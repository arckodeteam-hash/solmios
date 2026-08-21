// payment-requests/usecases/live-session.ts — INVARIANTE: un cobro, a lo sumo UNA Checkout
// Session viva.
//
// Hallazgo GH-0.3 (gate CHK-20260819, 2ª ronda). El techo agregado de `charge-ceiling.ts` cuenta
// FILAS `pending`, no sesiones de Stripe, y hasta acá nada expiraba una sesión (0 hits de
// `checkout.sessions.expire` en todo el repo). Eso dejaba dos agujeros por los que el huésped podía
// pagar dos veces el mismo saldo:
//
//   1. `PUT /api/payment-requests/:id {"status":"cancelled"}` — valor VÁLIDO del enum — sacaba el
//      link del filtro `r.status === 'pending'` y liberaba el techo, pero el link seguía vivo en
//      Stripe. Reserva con saldo $300 → `pr1 cancelled` con URL viva + `pr2 pending 300` = $600
//      cobrables. Ídem `'expired'` y ídem el `DELETE`.
//   2. `create-checkout` pisaba `stripeSessionId` con la sesión nueva sin tocar la anterior, así que
//      N clicks del botón del modal = N sesiones vivas por el mismo importe.
//
// La segunda liquidación moría en `stripe-webhook.ts` (`status === 'paid'` → salta) sin fila en
// `payments`, sin cargo de folio y sin audit: plata cobrada al huésped y fuera del libro.
//
// Este módulo es el único lugar que sabe pasar de "la fila dejó de comprometer saldo" a "la sesión
// de Stripe dejó de ser pagable". Regla: la sesión se mata ANTES de mutar la fila. Si Stripe falla,
// el error sube y el estado NO cambia — liberar el techo con el link vivo es el bug, no el
// contratiempo.

import { ConflictError } from 'arckode-framework'
import { StripeService } from '../../../services/stripe-service'
import { round2 } from '../../../shared/utils/money'
import type { PaymentRequestDTO, CheckoutResult } from '../types'

/** Estado en el que un cobro compromete saldo en el techo agregado. */
export const LIVE_STATUS = 'pending'

/** ¿Este cambio de estado deja de comprometer saldo (y por lo tanto libera el techo)? */
export function releasesCeiling(previousStatus: string, nextStatus: string | undefined): boolean {
  return nextStatus !== undefined && previousStatus === LIVE_STATUS && nextStatus !== LIVE_STATUS
}

/**
 * ¿Este patch deja a la sesión ya emitida desalineada con la fila?
 *
 * BUG-ceiling-bypass (puerta 2). La condición miraba SÓLO `dto.status`, y el techo agregado no lo
 * mueve nada más que el estado: lo mueve el IMPORTE. `PUT {"amount": 50}` sobre un `pending` de $300
 * con sesión viva bajaba `committedPending` de 300 a 50 sin expirar nada — el link de $300 seguía
 * pagable y el hueco de $250 lo llenaba un segundo cobro: dos sesiones vivas por $550 sobre un saldo
 * de $300.
 *
 * Se dispara con CUALQUIER cambio de importe, no sólo a la baja: el invariante que este módulo
 * sostiene es "la sesión abierta de un cobro es por el importe de la fila". Subir el importe no
 * libera techo, pero deja viva una sesión por menos plata de la que la fila dice comprometer, y el
 * huésped que paga el link viejo salda un cobro que ya no existe con ese número. `reusableSession`
 * ya aplica el mismo criterio al emitir (`sameAmount`); acá se aplica al editar, que es cuando el
 * desajuste nace.
 */
export function invalidatesSession(
  previous: Pick<PaymentRequestDTO, 'status' | 'amount'>,
  nextAmount: number | undefined,
): boolean {
  if (nextAmount === undefined) return false
  if (previous.status !== LIVE_STATUS) return false
  return round2(Number(nextAmount)) !== round2(Number(previous.amount) || 0)
}

/** Un error de Stripe por pedir algo imposible sobre un recurso (no un fallo de red/credenciales). */
function isStripeBadRequest(e: unknown): boolean {
  return (e as { type?: string } | null)?.type === 'StripeInvalidRequestError'
}

/**
 * Da de baja la sesión del cobro para que deje de ser pagable.
 *
 * `allowPaid` distingue los dos motivos por los que un cobro sale de `pending`:
 *  - marcarlo `paid` a mano (el dinero entró por otra vía): que la sesión ya se haya completado no
 *    es una contradicción;
 *  - cancelarlo / expirarlo / borrarlo: si la sesión YA se completó el huésped pagó, y liberar el
 *    techo autorizaría un segundo link por la misma plata. Ahí se corta con 409.
 */
export async function releaseSession(
  pr: Pick<PaymentRequestDTO, 'id' | 'hotelId' | 'stripeSessionId'>,
  opts: { allowPaid: boolean; action: string },
): Promise<'expired' | 'paid' | 'gone' | 'none'> {
  if (!pr.stripeSessionId) return 'none'
  const outcome = await StripeService.expireCheckoutSession(pr.stripeSessionId, pr.hotelId)
  if (outcome === 'paid' && !opts.allowPaid) {
    throw new ConflictError(
      `El link de pago ya fue abonado por el huésped: no se puede ${opts.action}. ` +
      'Esperá a que el webhook de Stripe lo asiente y, si hace falta, devolvé el cobro desde Pagos.',
    )
  }
  return outcome
}

/** Patch que acompaña a una baja de sesión: la URL muerta no se sigue mostrando ni compartiendo. */
export const DEAD_LINK_PATCH: Partial<PaymentRequestDTO> = { stripePaymentUrl: '' }

/**
 * Sesión REUTILIZABLE del cobro, si la hay: misma fila, mismo importe, todavía abierta.
 *
 * Es lo que hace verdadero el "mismo cobro, misma sesión de Stripe" del modal: el botón se puede
 * apretar N veces y sigue habiendo un solo link vivo. Si el importe cambió, la vieja se expira acá
 * mismo y el caller crea la nueva.
 */
export async function reusableSession(
  pr: Pick<PaymentRequestDTO, 'hotelId' | 'stripeSessionId' | 'amount'>,
): Promise<CheckoutResult | null> {
  if (!pr.stripeSessionId) return null
  let session
  try {
    session = await StripeService.getSession(pr.stripeSessionId, pr.hotelId)
  } catch (e) {
    // La sesión no existe en esta cuenta (p.ej. quedó de un tenant mal resuelto): no hay nada vivo
    // que reutilizar ni que expirar. Cualquier otro fallo sube — no se crea una 2ª sesión a ciegas.
    if (isStripeBadRequest(e)) return null
    throw e
  }
  if (!session || session.status !== 'open') return null
  const sameAmount = session.amount_total === Math.round(Number(pr.amount) * 100)
  if (sameAmount && session.url) return { url: session.url, sessionId: session.id }
  // Sigue abierta pero por otro importe: se mata antes de emitir la nueva.
  await StripeService.expireCheckoutSession(pr.stripeSessionId, pr.hotelId)
  return null
}
