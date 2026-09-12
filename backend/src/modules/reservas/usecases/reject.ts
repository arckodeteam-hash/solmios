// reservas/usecases/reject.ts — Rechazo de una reserva pública pendiente de aprobación (#271, MR-06).
//
// Es la contracara de `approve.ts`: la reserva nació con `approvalStatus: 'pending'` (hotel con
// "Confirmación instantánea" apagada), YA cobró por Stripe y YA ocupa la habitación. Rechazarla
// tiene tres consecuencias que van en este orden y no en otro:
//
//   1. Reembolso PRIMERO, fail-loud. El huésped no hizo nada mal: se le devuelve el 100% de lo
//      que pagó por el checkout web. Si Stripe no responde, la reserva NO se rechaza — el
//      operador reintenta. Rechazar sin devolver dejaría plata del huésped retenida sin reserva.
//   2. Cancelación por el núcleo compartido (`cancel-core.ts`): state machine, sesiones de cobro
//      muertas, snapshot `hotel_rejected` (fee 0, refund = lo devuelto), evento
//      `onReservationCancelled` (libera depósito, promo, channel manager) y cache. En el MISMO
//      update va `approvalStatus: 'rejected'` para que el KPI "Por aprobar" baje sin ventana.
//   3. Efectos blandos: disponibilidad a Channex, grupo `cancelled`, email al huésped. Si fallan
//      se loguean; el rechazo ya está hecho y es correcto.
//
// Grupos: el cobro web de una reserva de grupo vive SOLO en la líder (`reservations[0]`, ver
// bookingengine/usecases/public-booking-group.ts), por el total del grupo. Rechazar cualquiera
// rechaza a todas las hermanas pendientes: no tiene sentido devolver el total y dejar dos
// habitaciones ocupadas sin cobro.
import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { Auth, RepositoryAdapter } from 'arckode-framework'
import { applyCancellation, type CancelCoreDeps } from './cancel-core'

/** Mínimo de caracteres del motivo: el huésped lo lee en el email, "no" no le sirve a nadie. */
const MIN_REASON_LENGTH = 10

/** connectors/reservas-payments.ts → `payments.refundPayment` (Stripe, asiento + audit + evento). */
export interface ApprovalRefundPort {
  refundPayment(
    paymentId: string,
    amount: number,
    user: { id: string; role: string; hotelId?: string },
  ): Promise<{ id: string; amount: number }>
}

/** Lo que necesita el email al huésped. La implementación real es `usecases/approval-email.ts`. */
export interface RejectNotifyInput {
  reservationId: string
  hotelId: string
  guestId?: string
  roomId?: string
  checkIn: string
  checkOut: string
  /** Evento de notificación (`reservation_rejected`); lo tipa approval-email.ts, acá viaja como string. */
  event: string
  variables: Record<string, string | number>
}
export type RejectNotifyPort = (input: RejectNotifyInput) => Promise<void>

export interface RejectReservationDeps extends CancelCoreDeps {
  /** Filas de `payments` de la reserva (service.paymentsOfReservation). */
  paymentsOf: (hotelId: string, reservationId: string) => Promise<Record<string, any>[]>
  /** Sin cablear → no se puede rechazar una reserva con cobro (fail-closed). */
  refund?: ApprovalRefundPort
  pushAvailability?: (hotelId: string, roomId: string) => void
  /** Tabla `groups`: se marca `cancelled` cuando cae el grupo entero. */
  groupRepo?: RepositoryAdapter<any>
  /** Email al huésped, fire-and-forget. Hasta que approval-email.ts exista, el service pasa `undefined`. */
  notifyGuest?: RejectNotifyPort
}

export interface RejectReservationResult extends Record<string, any> {
  /** Total devuelto por Stripe (sumando las hermanas del grupo). 0 si pagó fuera de Stripe. */
  refundedAmount: number
  /** Cuántas reservas quedaron `cancelled` + `rejected` (1 sin grupo). */
  rejectedCount: number
}

/** Cobros web reembolsables: cargo completado con referencia de Stripe (sesión o PI). */
function refundableRows(rows: Record<string, any>[]): Record<string, any>[] {
  return rows.filter((p) =>
    p.type === 'charge' && p.status === 'completed' && Boolean(p.stripeSessionId || p.stripePaymentId),
  )
}

/** `100.00 USD` — mismo formato que shared/usecases/booking-paid-email.ts, pero el 0 se muestra. */
function money(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`
}

/**
 * Rechaza una reserva pendiente de aprobación del hotel: reembolsa, cancela y avisa.
 *
 * 404 si no existe; ownership por hotel (super_admin pasa); 409 si no está pendiente de
 * aprobación o ya está cancelada; 400 si el motivo es demasiado corto.
 */
export async function rejectReservation(
  deps: RejectReservationDeps,
  id: string,
  dto: { reason?: string },
  currentUser: { id: string; role: string; hotelId?: string },
  auth: Auth,
): Promise<RejectReservationResult> {
  const item = await deps.repo.findById(id)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings (mem
  // ownership-bug). Post-findById obligatorio (regla CLAUDE.md + analyzer).
  // Criterio del issue: de otro hotel → 404, no 403. Ownership post-findById (regla CLAUDE.md +
  // analyzer), y el Forbidden se traduce a "no existe": no se confirma a un tercero que el id es real.
  try {
    auth.assertOwnership(item.hotelId, currentUser.hotelId ?? '', currentUser.role, 'super_admin')
  } catch {
    throw new NotFoundError('Reserva no encontrada')
  }

  if (item.approvalStatus !== 'pending') {
    throw new ConflictError('Esta reserva no tiene una aprobación pendiente')
  }
  if (item.status === 'cancelled') {
    throw new ConflictError('Esta reserva ya está cancelada')
  }
  // El controller ya validó el body; se re-chequea acá porque el usecase también lo llaman
  // caminos sin HTTP (tests, bots) y el motivo llega al huésped tal cual.
  const reason = String(dto.reason ?? '').trim()
  if (reason.length < MIN_REASON_LENGTH) {
    throw new ValidationError(`El motivo del rechazo debe tener al menos ${MIN_REASON_LENGTH} caracteres`)
  }

  const affected = await affectedReservations(deps.repo, item)

  // 1. Reembolso primero (fail-loud). Se recorre cada afectada porque, aunque hoy el cobro de
  //    grupo vive en la líder, una hermana podría tener un cobro propio (extras, reprogramación).
  const refundedBy = new Map<string, number>()
  let refundedAmount = 0
  for (const r of affected) {
    const rows = refundableRows(await deps.paymentsOf(String(r.hotelId), String(r.id)))
    if (rows.length > 0 && !deps.refund) {
      throw new Error('reservas: no hay puerto de reembolso cableado (connectors/reservas-payments.ts) — no se rechaza una reserva cobrada sin devolver el dinero')
    }
    let sum = 0
    for (const row of rows) {
      const out = await deps.refund!.refundPayment(String(row.id), Number(row.amount), currentUser)
      sum += Number(out?.amount ?? row.amount)
    }
    refundedBy.set(String(r.id), sum)
    refundedAmount += sum
  }

  // 2. Cancelación real por el núcleo compartido, con el snapshot de lo YA devuelto.
  for (const r of affected) {
    await applyCancellation(deps, r, {
      reason,
      penaltyMode: 'hotel-rejected',
      refundAmount: refundedBy.get(String(r.id)) ?? 0,
      patch: { approvalStatus: 'rejected' },
    })
  }

  // 3. Efectos blandos: nada de esto deshace el rechazo.
  for (const r of affected) {
    if (r.roomId) deps.pushAvailability?.(String(r.hotelId), String(r.roomId))
  }
  if (item.groupId && deps.groupRepo) {
    try {
      await deps.groupRepo.update(String(item.groupId), { status: 'cancelled' })
    } catch (e: any) {
      deps.logger.warn(`reject: no se pudo marcar el grupo ${item.groupId} como cancelled: ${e?.message ?? e}`)
    }
  }
  // Un solo email por rechazo (la líder), con el total devuelto del grupo.
  deps.notifyGuest?.({
    reservationId: String(item.id),
    hotelId: String(item.hotelId),
    guestId: item.guestId ?? undefined,
    roomId: item.roomId ?? undefined,
    checkIn: String(item.checkIn ?? ''),
    checkOut: String(item.checkOut ?? ''),
    event: 'reservation_rejected',
    variables: {
      rejection_reason: reason,
      refund_amount: money(refundedAmount, String(item.currency || 'USD').toUpperCase()),
    },
  }).catch((e: any) => deps.logger.warn(`reject: falló el email al huésped de ${item.id}: ${e?.message ?? e}`))

  const updated = (await deps.repo.findById(id)) ?? item
  return { ...updated, refundedAmount, rejectedCount: affected.length }
}

/**
 * La reserva y —si es de grupo— sus hermanas del mismo hotel. Sólo entran las que todavía
 * están pendientes de aprobación y no canceladas: una hermana ya cancelada por otro camino no
 * se toca ni se reembolsa dos veces.
 */
async function affectedReservations(repo: RepositoryAdapter<any>, item: any): Promise<any[]> {
  if (!item.groupId) return [item]
  const siblings = await repo.findMany({ hotelId: item.hotelId, groupId: item.groupId })
  const byId = new Map<string, any>(siblings.map((r: any) => [String(r.id), r]))
  byId.set(String(item.id), item)
  return [...byId.values()].filter((r) => r.approvalStatus === 'pending' && r.status !== 'cancelled')
}
