// payment-requests/usecases/clamp-to-ceiling.ts — SEC3-2/SEC3-3: cuando el techo BAJA, los links
// vivos lo siguen.
//
// Hallazgo SEC3-2 (gate, 3ª ronda): el lado "balance" del techo lo escribe el cliente —
// `PUT /api/reservas/:id` acepta `totalAmount` y `otherCharges` y la baja de un extra
// (`DELETE /api/reservations/:id/addons/:addonId`) resta del total cobrable — pero NADA expiraba
// las Checkout Sessions ya emitidas: inflar el total a 5000, emitir dos links de $300 y volver a
// 500 dejaba $600 abiertos sobre un saldo de $300. `releaseSession` sólo se llamaba desde el
// propio módulo (update/delete de un cobro).
//
// Este usecase es la contraparte del lado de la reserva: recalcula el saldo cobrable con la MISMA
// fórmula del techo (`pendingBalance` + `paidForReservation`) y da de baja los cobros `pending`
// que el nuevo techo ya no respalda — sesión de Stripe primero, fila después, igual que
// `update-request.ts`. Lo llaman `reservas` (update de totalAmount/otherCharges, baja de un extra)
// a través del connector `reservas-payment-requests`.
//
// SEC3-3 (borrado de la reserva): sin saldo no hay techo que sostener — se liberan TODOS los
// cobros `pending` de la reserva ANTES de borrarla. Si no, el link quedaba vivo y pagable sobre
// una reserva inexistente: el webhook no encontraba a quién aplicar el cobro pero la plata ya
// estaba asentada (cobro huérfano).

import type { Logger, RepositoryAdapter } from 'arckode-framework' // RepositoryAdapter: ClampDeps lo hereda
import { pendingBalance } from '../../../shared/utils/reservation-balance'
import { paidForReservation } from '../../../shared/usecases/reservation-paid'
import type { ChargeCeilingDeps } from './charge-ceiling'
import { round2, BALANCE_EPSILON } from '../../../shared/utils/money'
import { StripeService } from '../../../services/stripe-service'
import type { PaymentRequestDTO, CurrentUser } from '../types'
import type { PaymentRequestsSockets } from '../sockets'
import { statusChangeEntry, type AuditEntry } from './audit'
import { chargeLockKey } from './charge-ceiling'
import { withLock } from '../../../shared/utils/async-lock'

/** El techo + lo que hace falta para retirar un cobro. `paidRepos`: STR-A, ver `WebhookDeps`. */
export interface ClampDeps extends ChargeCeilingDeps {
  sockets: PaymentRequestsSockets
  audit: (entry: AuditEntry) => Promise<void>
  logger: Logger
}

/** Cobros `pending` de la reserva, el más antiguo primero: si hay que recortar, recorta el último
 *  en llegar — el huésped ya pudo recibir el link más viejo y lo más justo es respetarlo (FIFO). */
async function pendingRowsOf(deps: ClampDeps, hotelId: string, reservationId: string): Promise<PaymentRequestDTO[]> {
  const rows = (await deps.requestRepo.findMany({ hotelId, reservationId } as any)) as PaymentRequestDTO[]
  return rows
    .filter((r) => r.status === 'pending')
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id))
}

/**
 * Expira la sesión del cobro sin el 409 de `releaseSession`.
 *
 * A diferencia del update manual, acá la fila NO se está editando a propósito: si la sesión ya
 * resultara `paid`, la plata está en camino y el webhook la va a liquidar sobre esa misma fila —
 * así que se la deja `pending` (sigue contando para el techo, que es lo correcto: ese dinero está
 * comprometido) y se sigue con el siguiente cobro.
 */
async function expireSessionQuietly(pr: PaymentRequestDTO, logger: Logger): Promise<'expired' | 'paid' | 'gone' | 'none'> {
  if (!pr.stripeSessionId) return 'none'
  try {
    return await StripeService.expireCheckoutSession(pr.stripeSessionId, pr.hotelId)
  } catch (e) {
    // Sólo los "mal request" de Stripe cuentan como sesión inexistente (quedó de otra cuenta,
    // sandbox): no hay link vivo que proteger y se sigue con el resto. Cualquier OTRO fallo sube —
    // degradar acá dejaría el link pagable, que es exactamente el bug que este usecase cierra
    // (mismo criterio que `reusableSession` en live-session.ts).
    if ((e as { type?: string } | null)?.type !== 'StripeInvalidRequestError') throw e
    logger.warn('clamp-to-ceiling: la sesión del cobro no existe en la cuenta Stripe', {
      paymentRequestId: pr.id, sessionId: pr.stripeSessionId,
    })
    return 'gone'
  }
}

/** Marca el cobro fuera del techo: sesión muerta + fila `expired` + socket + audit. */
async function retireRow(
  deps: ClampDeps, pr: PaymentRequestDTO, user: CurrentUser, reason: string,
): Promise<PaymentRequestDTO | null> {
  const outcome = await expireSessionQuietly(pr, deps.logger)
  if (outcome === 'paid') return null // el webhook lo liquida sobre esta misma fila
  const retired = await deps.requestRepo.update(pr.id, { status: 'expired', stripePaymentUrl: '' } as Partial<PaymentRequestDTO>)
  if (!retired) return null
  await deps.sockets.onPaymentRequestUpdated?.(retired)
  await deps.audit({
    ...statusChangeEntry(retired, pr.status, user),
    detail: `${statusChangeEntry(retired, pr.status, user).detail} · ${reason}`,
  })
  return retired
}

/**
 * Recorta los cobros `pending` de la reserva al saldo cobrable ACTUAL. Devuelve cuántos se dieron
 * de baja. Idempotente: sin `pending` o con techo que respalda todo, no toca nada.
 */
export async function clampRequestsToCeiling(
  deps: ClampDeps, hotelId: string, reservationId: string, user: CurrentUser,
): Promise<number> {
  // Misma sección crítica que create/update: sin el lock, el clamp puede pelear con un alta.
  return withLock(chargeLockKey(hotelId, reservationId), () => clampUnlocked(deps, hotelId, reservationId, user))
}

async function clampUnlocked(
  deps: ClampDeps, hotelId: string, reservationId: string, user: CurrentUser,
): Promise<number> {
  const pending = await pendingRowsOf(deps, hotelId, reservationId)
  if (pending.length === 0) return 0

  // Reserva inexistente (o de otro hotel): no hay techo, todos los links quedan sin respaldo.
  const reservation = await deps.reservationRepo.findById(reservationId) as any
  if (!reservation || String(reservation.hotelId ?? '') !== hotelId) {
    return releaseUnlocked(deps, hotelId, reservationId, user)
  }

  const addons = await deps.addonRepo.findMany({ reservationId, hotelId } as any)
  // Mismo criterio que `charge-ceiling`: lo cobrado sale de `payments`, no de `deposit` (GH-0.2).
  const paid = await paidForReservation(deps.paidRepos, hotelId, reservationId, reservation)
  const balance = pendingBalance(reservation, addons as any[], paid)

  let committed = 0
  let retired = 0
  for (const pr of pending) {
    const amount = Number(pr.amount) || 0
    if (round2(committed + amount) > round2(balance) + BALANCE_EPSILON) {
      const done = await retireRow(deps, pr, user,
        `el total cobrable de la reserva bajó a ${balance.toFixed(2)} y el link (${amount.toFixed(2)}) ya no entra`)
      if (done) retired++
      else committed = round2(committed + amount) // sesión ya abonada: sigue comprometiendo el techo
    } else {
      committed = round2(committed + amount)
    }
  }
  if (retired > 0) {
    deps.logger.info('clamp-to-ceiling: cobros retirados del techo de la reserva', {
      hotelId, reservationId, retired, balance,
    })
  }
  return retired
}

/**
 * SEC3-3: libera TODOS los cobros `pending` de la reserva (la reserva se borra: no hay saldo que
 * respaldar). Se llama ANTES del borrado — si Stripe falla, la reserva NO se borra, igual que el
 * update de un cobro no cambia la fila si la sesión no se pudo expirar.
 */
export async function releaseRequestsOfReservation(
  deps: ClampDeps, hotelId: string, reservationId: string, user: CurrentUser,
): Promise<number> {
  return withLock(chargeLockKey(hotelId, reservationId), () => releaseUnlocked(deps, hotelId, reservationId, user))
}

/** Versión SIN lock: lo toma el caller (`clampUnlocked` ya lo tiene — withLock no es reentrante). */
async function releaseUnlocked(deps: ClampDeps, hotelId: string, reservationId: string, user: CurrentUser): Promise<number> {
  const pending = await pendingRowsOf(deps, hotelId, reservationId)
  let released = 0
  for (const pr of pending) {
    const done = await retireRow(deps, pr, user, 'la reserva fue eliminada')
    if (done) released++
  }
  return released
}
