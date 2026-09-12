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
// Idempotente: una reserva ya `done` responde 200 con lo que hay, sin tocar la pasarela.
// Sin puerto: fail-closed (mismo criterio que `requireManualPaymentPort` en mark-paid.ts).

import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { Auth, RepositoryAdapter } from 'arckode-framework'

/** Lo que el connector le devuelve a reservas tras intentar el reembolso. */
export interface RetryWebRefundOutcome {
  status: string
  refundPaymentId?: string
  error?: string
}

export type RetryWebRefundPort = (input: { reservationId: string; hotelId: string; refundAmount: number }) => Promise<RetryWebRefundOutcome>

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

/**
 * 404 si no existe · 403 si es de otro hotel · 409 si no está cancelada o no le corresponde plata
 * · 400 si el reembolso web no está cableado · 200 con el estado actual si ya se reembolsó.
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
  if (!deps.port) throw new ValidationError('Reembolso no disponible (payments no conectado)')

  await deps.port({ reservationId: String(item.id), hotelId: String(item.hotelId), refundAmount })
  // Relectura de la MISMA fila ya autorizada por assertOwnership arriba: el estado lo escribió el usecase compartido.
  const fresh = await deps.repo.findById(id)
  return resultOf(fresh ?? item)
}
