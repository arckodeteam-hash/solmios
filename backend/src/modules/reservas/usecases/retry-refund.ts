// reservas/usecases/retry-refund.ts — Reintentar el reembolso de una cancelación web (#272).
//
// Cuando el huésped cancela desde la web, `shared/usecases/web-booking-refund` devuelve la plata en
// Stripe y deja `refundStatus` en la reserva. Si la pasarela falló queda `failed` y el hotel recibe
// una campanita: desde la ficha reintenta con `POST /api/reservas/:id/retry-refund`, que cae acá.
//
// `reservas` no importa `payments`: el reembolso real entra por el puerto `retryWebRefund` que
// cablea `connectors/bookingengine-refunds.ts`. Acá sólo se valida (ownership, estado, monto),
// se delega y se relee la reserva para responder el estado verdadero.
//
// Idempotente: una reserva ya `done` responde 200 con lo que hay, sin tocar la pasarela. Un
// `pending` FRESCO (`isRefundInFlight`: reembolso en vuelo esperando a Stripe) responde 409: el
// hotel apretando "Reintentar" durante el primer intento no puede disparar un segundo refund.
// Sin puerto: fail-closed (mismo criterio que `requireManualPaymentPort` en mark-paid.ts).
// Mueve plata → se audita `reservation.refund_retry` con quién lo disparó y el resultado.

import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { Auth, Logger, RepositoryAdapter } from 'arckode-framework'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import { isRefundInFlight } from '../../../shared/usecases/web-booking-refund'

/** Lo que el connector le devuelve a reservas tras intentar el reembolso. */
export interface RetryWebRefundOutcome {
  status: string
  refundPaymentId?: string
  error?: string
}

/** `actor`: el usuario que apretó "Reintentar"; con él `payments` asienta el refund a nombre del humano y no de SYSTEM. */
export type RetryWebRefundPort = (input: { reservationId: string; hotelId: string; refundAmount: number; actor?: { id?: string; role?: string } }) => Promise<RetryWebRefundOutcome>

/** Únicos campos que el reembolso puede escribir en la reserva (ver reservas/model.ts). */
export interface RefundStatePatch {
  refundStatus?: string
  refundedAt?: string | null
  refundPaymentId?: string | null
}

/** Filtra el patch del connector a los campos del reembolso: nada más entra por esta puerta. */
export function refundStatePatch(patch: Record<string, unknown>): RefundStatePatch {
  const out: RefundStatePatch = {}
  if ('refundStatus' in patch) out.refundStatus = String(patch.refundStatus ?? '')
  if ('refundedAt' in patch) out.refundedAt = patch.refundedAt == null ? null : String(patch.refundedAt)
  if ('refundPaymentId' in patch) out.refundPaymentId = patch.refundPaymentId == null ? null : String(patch.refundPaymentId)
  return out
}

export interface RetryRefundDeps {
  repo: RepositoryAdapter<any>
  auth: Auth
  port: RetryWebRefundPort | undefined
  /** Auditoría `reservation.refund_retry` (SC-05). Opcional: sin puerto no se registra, nunca tumba. */
  audit?: AuditPort | null
  logger?: Logger
}

export interface RetryRefundResult {
  reservationId: string
  refundStatus: string
  refundPaymentId: string | null
  refundedAt: string | null
  refundAmount: number
}

const resultOf = (item: any): RetryRefundResult => ({
  reservationId: String(item.id),
  refundStatus: String(item.refundStatus ?? 'none'),
  refundPaymentId: item.refundPaymentId ?? null,
  refundedAt: item.refundedAt ?? null,
  refundAmount: Number(item.refundAmount) || 0,
})

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger

/**
 * 404 si no existe · 403 si es de otro hotel · 409 si no está cancelada, no le corresponde plata o
 * hay un reembolso en curso · 400 si el reembolso web no está cableado · 200 con el estado actual
 * si ya se reembolsó.
 */
export async function retryRefund(
  deps: RetryRefundDeps,
  id: string,
  currentUser: { id: string; role: string; hotelId?: string },
): Promise<RetryRefundResult> {
  const item = await deps.repo.findById(id)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings. Post-findById
  // obligatorio (regla CLAUDE.md + analyzer): el reembolso mueve plata del hotel.
  deps.auth.assertOwnership(item.hotelId, currentUser.hotelId ?? '', currentUser.role, 'super_admin')

  if (item.status !== 'cancelled') throw new ConflictError('Sólo se puede reintentar el reembolso de una reserva cancelada')
  if (item.refundStatus === 'done') return resultOf(item)
  const refundAmount = Number(item.refundAmount) || 0
  if (refundAmount <= 0) throw new ConflictError('La reserva no tiene reembolso pendiente')
  if (isRefundInFlight(item)) throw new ConflictError('Ya hay un reembolso en curso para esta reserva; esperá unos minutos')
  if (!deps.port) throw new ValidationError('Reembolso no disponible (payments no conectado)')

  const outcome = await deps.port({ reservationId: String(item.id), hotelId: String(item.hotelId), refundAmount, actor: { id: currentUser.id, role: currentUser.role } })
  // Relectura de la MISMA fila ya autorizada por assertOwnership arriba: el estado lo escribió el usecase compartido.
  const fresh = await deps.repo.findById(id)
  const result = resultOf(fresh ?? item)
  await auditSafely(deps.audit ?? null, deps.logger ?? noopLogger, {
    hotelId: item.hotelId,
    userId: currentUser.id,
    action: 'reservation.refund_retry',
    entity: 'reservation',
    entityId: id,
    detail: `resultado=${outcome.status} monto=${refundAmount} refundPaymentId=${outcome.refundPaymentId ?? result.refundPaymentId ?? '-'}`,
  })
  return result
}
