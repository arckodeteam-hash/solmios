// bookingengine/usecases/public-cancel.ts — F4 plan #627
//
// Auto-cancelación PÚBLICA del huésped. El huésped cancela su reserva desde la
// página de confirmación pública (/h/:slug/confirm) sin llamar al hotel, usando el
// `accessToken` (token HMAC) que recibió al crear la reserva por el widget público.
//
// Seguridad — MOLDE EXACTO de public-reservation.ts (anti-enumeración):
//   - Token = `accessToken` (UUID v4) seteado al crear por flujo público (F0 0.13).
//   - HMAC-SHA256 con secret por hotel + `timingSafeEqual` (anti timing attack).
//   - Reserva con `accessToken=null` (creada desde panel) → 404 mismo body.
//   - Sin token, token incorrecto, reserva inexistente → 404 MISMO body (anti-enumeración).
//
// Decisión 404 vs 409 para checked_in/checked_out:
//   409 (no 404). El huésped ya validó su token → sabe que la reserva existe; un 404
//   acá sería confuso ("recién la vi, ahora no existe"). 409 es semánticamente correcto
//   (conflict con el estado actual del recurso). El token HMAC ya protege contra
//   enumeración: nadie puede probar IDs aleatorios sin tener los tokens.
//
// Idempotencia: si la reserva ya está `cancelled`, se retorna 200 con el estado actual
// sin re-procesar (no se recomputa penalty, no se re-emite el evento).
//
// #272 — Grupo (N habitaciones, `groupId` + accessToken compartido): la cancelación es TODO O
// NADA. Se cancelan todas las filas del grupo, la penalidad se calcula sobre lo que pagó el
// huésped (el total del grupo, que vive en la líder), `groups.status` pasa a 'cancelled', se
// libera inventario habitación por habitación y se emite UN solo evento con `reservationIds`.

import crypto from 'node:crypto'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import type { CancellationPolicyDTO } from '../../cancellation/types'
import type { BookingCancelledEvent } from '../sockets'
import { resolvePolicy, computePenalty, hotelCancellationTypeOf } from '../../../shared/usecases/cancellation-math'

const NOT_FOUND = { status: 404, body: { error: 'Reservation not found' } } as const

function hotelSecret(hotelId: string): string {
  const base = process.env.BOOKING_TOKEN_SECRET || 'dev-fallback-booking-secret'
  return `${base}:${hotelId}`
}

function hmac(secret: string, value: string): Buffer {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest()
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Lo mínimo del orm que necesita la cascada: una transacción cuyo `tx` sabe `update(model, id, data)`. */
export interface CancelTransactionPort {
  transaction<T>(fn: (tx: { update(model: string, id: string, data: Record<string, unknown>): Promise<unknown> }) => Promise<T>): Promise<T>
}

export interface CancelPublicDeps {
  reservationsRepo: RepositoryAdapter<any>
  policyRepo: RepositoryAdapter<CancellationPolicyDTO>
  /**
   * #272 (revisión) — Cascada del grupo en UNA transacción: "todo o nada" era un `for` de `update`
   * sueltos, y si la 2ª fila fallaba la 1ª quedaba `cancelled` con las hermanas vivas (y sin
   * evento, sin reembolso). Opcional: sin él (tests, drivers sin tx) se escribe fila por fila.
   */
  orm?: CancelTransactionPort
  /** Hotels — `cancellationType` (nivel 3 de resolvePolicy). Opcional: fail-soft → default. */
  hotelsRepo?: RepositoryAdapter<any>
  logger: Logger
  /** #272 — `Groups`: marca el grupo entero como cancelled. Opcional, best-effort. */
  groupsRepo?: RepositoryAdapter<any>
  /** #272 — Libera inventario (Channex) por cada habitación cancelada. Opcional, best-effort. */
  pushAvailability?: (hotelId: string, roomId: string) => void
  /** Hook de sockets: onBookingCancelled. Opcional (resilient: no rompe si falla o no hay). */
  onCancelled?: (data: BookingCancelledEvent) => Promise<void>
}

const isCheckedIn = (r: any): boolean => r?.status === 'checked_in' || r?.status === 'checked_out'

/**
 * #272 — El mismo snapshot en todas las filas, atómico si hay transacción: o quedan todas
 * `cancelled` o ninguna. Si una escritura falla, el error sube (la cancelación NO se procesó y
 * el huésped puede reintentar) y no se emite evento ni se libera inventario.
 */
async function cancelRows(deps: CancelPublicDeps, rows: any[], snapshot: Record<string, unknown>): Promise<void> {
  if (deps.orm?.transaction) {
    await deps.orm.transaction(async (tx) => {
      for (const row of rows) await tx.update('Reservations', String(row.id), snapshot)
    })
    return
  }
  for (const row of rows) await deps.reservationsRepo.update(String(row.id), snapshot)
}

/** #272 — Todas las filas del grupo (líder + hermanas). Si no hay grupo o falla la lectura → [item]. */
async function groupRowsOf(reservationsRepo: RepositoryAdapter<any>, item: any): Promise<any[]> {
  if (!item.groupId) return [item]
  try {
    const rows = (await reservationsRepo.findMany({ hotelId: item.hotelId, groupId: item.groupId })) as any[]
    return Array.isArray(rows) && rows.length ? rows : [item]
  } catch {
    return [item]
  }
}

/** #272 — La líder es la que tiene el desglose (primera creada, la que carga el pago del grupo). */
const leaderOf = (rows: any[], id: string): any =>
  rows.find((r) => r.priceBreakdown) ?? rows.find((r) => r.id === id) ?? rows[0]

/** Base sobre la que se aplica la política. Reserva simple → su `deposit` (como siempre).
 *  Grupo → la política se aplica sobre lo que el huésped PAGÓ: el total del grupo, que vive en
 *  la líder (el webhook deja `deposit` = pagado en la líder y 0 en las hermanas). Sin pago no
 *  hay nada que retener ni devolver. */
function penaltyBaseOf(rows: any[], leader: any, item: any): number {
  if (!item.groupId) return Number(item.deposit) || 0
  if (!(Number(leader.deposit) > 0)) return 0
  return Number(leader.priceBreakdown?.total) || rows.reduce((acc, r) => acc + (Number(r.totalAmount) || 0), 0)
}

/**
 * Cancela una reserva pública validando el token HMAC del huésped.
 *
 * @returns 404 (anti-enumeración) si no existe / sin token / token incorrecto / accessToken null.
 *          409 si la reserva está checked_in o checked_out (no se puede auto-cancelar).
 *          200 (idempotente) si ya estaba cancelled — retorna el snapshot sin re-procesar.
 *          200 con refundAmount/cancellationFee/policyApplied si la cancelación se procesó.
 */
export async function cancelPublicBooking(
  deps: CancelPublicDeps,
  id: string,
  token: string | undefined | null,
  reason?: string,
): Promise<{ status: number; body: any }> {
  const { reservationsRepo, policyRepo, hotelsRepo, logger, groupsRepo, pushAvailability, onCancelled } = deps

  // Sin token → 404 (anti-enumeración, mismo body que not-found).
  if (!token) return NOT_FOUND

  // Lookup por findMany({id}) — mismo patrón que public-reservation.ts (no findById,
  // que dispararía el falso positivo del analyzer sobre assertOwnership en un endpoint público).
  const found = (await reservationsRepo.findMany({ id })) as any[]
  const item = found[0]
  // No existe o creada desde panel (accessToken null) → 404 mismo body.
  if (!item || !item.accessToken) return NOT_FOUND

  // HMAC sobre el token recibido vs el accessToken almacenado. timingSafeEqual anti timing.
  const secret = hotelSecret(item.hotelId)
  const expected = hmac(secret, String(item.accessToken))
  const received = hmac(secret, String(token))
  if (!safeEqual(expected, received)) return NOT_FOUND

  // ── State machine ──────────────────────────────────────────────────────────

  // Idempotencia: ya cancelada → retornar snapshot sin re-procesar. #272: `refundStatus`
  // lo escribe el connector de refunds al procesar el evento; acá se relee tal cual.
  if (item.status === 'cancelled') {
    const siblings = await groupRowsOf(reservationsRepo, item)
    return {
      status: 200,
      body: {
        reservationId: id,
        status: 'cancelled',
        refundAmount: item.refundAmount ?? 0,
        cancellationFee: item.cancellationFee ?? 0,
        policyApplied: item.policyApplied ?? null,
        refundStatus: item.refundStatus ?? 'none',
        refundedAt: item.refundedAt ?? null,
        roomsCount: siblings.length,
        idempotent: true,
      },
    }
  }

  // #272 — Grupo: todo o nada. Si CUALQUIER habitación del grupo ya hizo check-in, no se
  // auto-cancela ninguna (el reembolso parcial requiere gestión humana).
  const rows = await groupRowsOf(reservationsRepo, item)
  const leader = leaderOf(rows, id)

  // checked_in / checked_out → 409. El huésped ya está en el hotel (o ya se fue);
  // cancelar online no tiene sentido y el reembolso requiere gestión humana.
  if (rows.some(isCheckedIn)) {
    return {
      status: 409,
      body: {
        error: 'La reserva ya está activa (check-in realizado). Contactá al hotel para gestionar la cancelación.',
      },
    }
  }

  // ── Resolver política + computar penalidad (F1 cancellation-math) ──────────
  // El 4º argumento (preset `hotels.cancellationType`) es OBLIGATORIO en la práctica:
  // public-rates.ts lo pasa para ANUNCIAR la política al huésped; si acá no se pasa, un
  // hotel 'strict' sin filas custom anuncia 100% de penalidad y reembolsa el 100%.
  // Fail-soft: si no se puede leer el hotel → null → default flexible (no bloquea).
  const hotelType = await hotelCancellationTypeOf(hotelsRepo, item.hotelId)
  const policy = await resolvePolicy(policyRepo, item.hotelId, item.channel, hotelType)
  const penalty = computePenalty(policy, {
    now: new Date().toISOString(),
    checkIn: item.checkIn,
    depositAmount: penaltyBaseOf(rows, leader, item),
  })

  const cancelledAt = new Date().toISOString()
  const cancellationReason = reason?.trim() || 'Cancelled by guest'

  // Persistir. Los campos cancelledAt/cancellationReason/cancellationFee/refundAmount/
  // policyApplied están declarados en reservas/model.ts (F1 #627) — case-sensitive.
  // #272 — El MISMO snapshot va en TODAS las filas activas del grupo (se saltan las ya
  // cancelled): cualquiera de ellas abre la misma página pública con el token compartido y
  // tiene que mostrar el mismo reembolso.
  const snapshot = {
    status: 'cancelled',
    cancelledAt,
    cancellationReason,
    cancellationFee: penalty.cancellationFee,
    refundAmount: penalty.refundAmount,
    policyApplied: penalty.policyApplied,
  }
  const cancelledRows = rows.filter((r) => r.status !== 'cancelled')
  await cancelRows(deps, cancelledRows, snapshot)

  // #272 — El grupo entero queda cancelled (best-effort, molde de pending-payment-expiry).
  if (item.groupId && groupsRepo) {
    try {
      await groupsRepo.update(String(item.groupId), { status: 'cancelled' })
    } catch (e) {
      logger.warn('public-cancel: no se pudo marcar el grupo como cancelled', { groupId: item.groupId, error: String(e) })
    }
  }

  // #272 — Liberar inventario habitación por habitación ANTES del evento (best-effort cada una).
  const roomIds = cancelledRows.map((r) => String(r.roomId || '')).filter(Boolean)
  if (pushAvailability) {
    for (const roomId of roomIds) {
      try { pushAvailability(String(item.hotelId), roomId) } catch (e) {
        logger.warn('public-cancel: pushAvailability falló', { id, roomId, error: String(e) })
      }
    }
  }

  // Emitir onBookingCancelled UNA sola vez por cancelación (resilient: no bloquea la
  // cancelación si un connector falla). `reservationId` = la líder (la que carga el pago).
  if (onCancelled) {
    try {
      await onCancelled({
        reservationId: String(leader.id),
        hotelId: item.hotelId,
        refundAmount: penalty.refundAmount,
        cancellationFee: penalty.cancellationFee,
        policyApplied: penalty.policyApplied,
        // PC-5: el connector promo-codes libera el uso consumido (canje de puntos no queda
        // quemado al cancelar desde la web). Dato de la propia reserva.
        promoCode: leader.promoCode ?? item.promoCode ?? null,
        reservationIds: cancelledRows.map((r) => String(r.id)),
        roomIds,
        groupId: item.groupId ?? null,
      })
    } catch (e) {
      logger.error('socket onBookingCancelled falló (no bloquea la cancelación)', {
        error: (e as Error).message,
      })
    }
  }

  // El estado REAL del reembolso lo escribe el connector de refunds mientras se procesa el evento
  // (los sockets se encadenan y se esperan). Se relee la líder para devolverlo — la pantalla
  // pública muestra lo que pasó, no el cálculo. Si no se pudo releer, se anticipa 'pending'.
  let refundStatus: string = penalty.refundAmount > 0 ? 'pending' : 'none'
  let refundedAt: string | null = null
  try {
    const fresh = ((await reservationsRepo.findMany({ id: String(leader.id) })) as any[])[0]
    if (fresh?.refundStatus) refundStatus = String(fresh.refundStatus)
    refundedAt = fresh?.refundedAt ?? null
  } catch {
    // Se queda con el anticipo: el GET público relee el estado real.
  }

  return {
    status: 200,
    body: {
      reservationId: id,
      status: 'cancelled',
      refundAmount: penalty.refundAmount,
      cancellationFee: penalty.cancellationFee,
      policyApplied: penalty.policyApplied,
      reservationIds: cancelledRows.map((r) => String(r.id)),
      roomsCount: rows.length,
      refundStatus,
      refundedAt,
    },
  }
}
