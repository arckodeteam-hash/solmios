// reservas/usecases/cancel.ts — Cancelación de reserva POR UN USUARIO del panel (F2 plan #627).
//
// Este archivo es SÓLO la capa de autorización del camino "usuario logueado": findById →
// assertOwnership. Todo lo demás (idempotencia, state machine, política, snapshot, evento
// onReservationCancelled, cache) vive en ./cancel-core.ts, compartido con el camino de
// SISTEMA (./cancel-system.ts: ingesta OTA, ai-recepcionista, ai-gerente).
//
// La lógica de cálculo vive en shared/usecases/cancellation-math.ts (F1). NO re-implementar
// computePenalty: la semántica CORRECTA es deadlineHours <= horasRestantes (tier cuya
// anticipación requerida es menor al tiempo restante aplica). "Corregirlo" a >= reintroduce
// el bug que F1 documenta y testea.
import { NotFoundError } from 'arckode-framework'
import type { Auth } from 'arckode-framework'
import { applyCancellation, type CancelCoreDeps } from './cancel-core'

/** Entrada del historial de la reserva (`audit_log`, entity `Reservations`, action `cancel`). */
export interface CancelAuditEntry {
  hotelId: string
  userId: string
  detail: string
}

export type CancelDeps = CancelCoreDeps & {
  /**
   * Deja la cancelación en el historial de la reserva: quién, por qué y con qué montos. Sin esto el
   * historial mostraba "Reserva creada" / "Actualizada" y nada decía que la reserva se había
   * cancelado (verificado en el panel el 2026-09-15). Best-effort: si falla, la cancelación ya
   * persistida no se deshace.
   */
  audit?: (entry: CancelAuditEntry) => Promise<unknown> | unknown
  /**
   * Correo "reserva cancelada" al huésped (plantilla `reservation_cancelled_guest`). Sólo si el
   * operador lo pidió (`dto.notifyGuest`). Best-effort: un fallo del correo no deshace nada.
   */
  notifyGuest?: (reservationId: string, hotelId: string) => Promise<unknown>
}

/**
 * Cancela una reserva aplicando la política de cancelación del hotel.
 *
 * Idempotente: si la reserva ya está `cancelled`, la devuelve sin recalcular ni re-emitir
 * (evita doble socket / doble release de depósito). Lanza 409 si viene de `checked_in`/
 * `checked_out` (state machine). Persiste el snapshot del cálculo (fee/refund/policyApplied)
 * para auditoría y para que F4 (bookingengine) y el release de depósitos tengan el monto
 * exacto sin recalcular.
 */
export async function cancelReservation(
  deps: CancelDeps,
  id: string,
  dto: { reason?: string; notifyGuest?: boolean },
  currentUser: { id: string; role: string; hotelId?: string },
  auth: Auth,
): Promise<any> {
  const item = await deps.repo.findById(id)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings (mem
  // ownership-bug: pasar objetos rompe el === y lanza Forbidden siempre). Post-findById
  // obligatorio (regla CLAUDE.md + analyzer textual).
  auth.assertOwnership(item.hotelId, currentUser.hotelId ?? '', currentUser.role, 'super_admin')

  const { reservation, penalty, idempotent } = await applyCancellation(deps, item, { reason: dto.reason })
  if (idempotent) return item
  if (!reservation) throw new NotFoundError('Reserva no encontrada')

  try {
    await deps.audit?.({
      hotelId: String(item.hotelId),
      userId: currentUser.id,
      detail: JSON.stringify({
        previousStatus: item.status,
        reason: dto.reason ?? '',
        cancellationFee: penalty.cancellationFee,
        refundAmount: penalty.refundAmount,
        policy: penalty.policyApplied?.label ?? '',
      }),
    })
  } catch (e) {
    deps.logger.warn('[cancel] no se pudo registrar la cancelación en el historial', {
      reservationId: id,
      error: e instanceof Error ? e.message : String(e),
    })
  }
  if (dto.notifyGuest === true && deps.notifyGuest) {
    try {
      await deps.notifyGuest(String(item.id), String(item.hotelId))
    } catch (e) {
      deps.logger.warn('[cancel] no se pudo avisar al huésped por correo', {
        reservationId: id,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return reservation
}
