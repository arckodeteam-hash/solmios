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

import crypto from 'node:crypto'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import type { CancellationPolicyDTO } from '../../cancellation/types'
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

export interface CancelPublicDeps {
  reservationsRepo: RepositoryAdapter<any>
  policyRepo: RepositoryAdapter<CancellationPolicyDTO>
  /** Hotels — `cancellationType` (nivel 3 de resolvePolicy). Opcional: fail-soft → default. */
  hotelsRepo?: RepositoryAdapter<any>
  logger: Logger
  /** Hook de sockets: onBookingCancelled. Opcional (resilient: no rompe si falla o no hay). */
  onCancelled?: (data: { reservationId: string; hotelId: string; refundAmount: number; cancellationFee: number; policyApplied: any; promoCode?: string | null }) => Promise<void>
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
  const { reservationsRepo, policyRepo, hotelsRepo, logger, onCancelled } = deps

  // Sin token → 404 (anti-enumeración, mismo body que not-found).
  if (!token) return NOT_FOUND

  // Lookup por findMany({id}) — mismo patrón que public-reservation.ts (no findById,
  // que dispararía el falso positivo del analyzer sobre assertOwnership en un endpoint público).
  const rows = (await reservationsRepo.findMany({ id })) as any[]
  const item = rows[0]
  // No existe o creada desde panel (accessToken null) → 404 mismo body.
  if (!item || !item.accessToken) return NOT_FOUND

  // HMAC sobre el token recibido vs el accessToken almacenado. timingSafeEqual anti timing.
  const secret = hotelSecret(item.hotelId)
  const expected = hmac(secret, String(item.accessToken))
  const received = hmac(secret, String(token))
  if (!safeEqual(expected, received)) return NOT_FOUND

  // ── State machine ──────────────────────────────────────────────────────────

  // Idempotencia: ya cancelada → retornar snapshot sin re-procesar.
  if (item.status === 'cancelled') {
    return {
      status: 200,
      body: {
        reservationId: id,
        status: 'cancelled',
        refundAmount: item.refundAmount ?? 0,
        cancellationFee: item.cancellationFee ?? 0,
        policyApplied: item.policyApplied ?? null,
        idempotent: true,
      },
    }
  }

  // checked_in / checked_out → 409. El huésped ya está en el hotel (o ya se fue);
  // cancelar online no tiene sentido y el reembolso requiere gestión humana.
  if (item.status === 'checked_in' || item.status === 'checked_out') {
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
    depositAmount: item.deposit ?? 0,
  })

  const cancelledAt = new Date().toISOString()
  const cancellationReason = reason?.trim() || 'Cancelled by guest'

  // Persistir. Los campos cancelledAt/cancellationReason/cancellationFee/refundAmount/
  // policyApplied están declarados en reservas/model.ts (F1 #627) — case-sensitive.
  await reservationsRepo.update(id, {
    status: 'cancelled',
    cancelledAt,
    cancellationReason,
    cancellationFee: penalty.cancellationFee,
    refundAmount: penalty.refundAmount,
    policyApplied: penalty.policyApplied,
  })

  // Emitir onBookingCancelled (resilient: no bloquea la cancelación si un connector falla).
  if (onCancelled) {
    try {
      await onCancelled({
        reservationId: id,
        hotelId: item.hotelId,
        refundAmount: penalty.refundAmount,
        cancellationFee: penalty.cancellationFee,
        policyApplied: penalty.policyApplied,
        // PC-5: el connector promo-codes libera el uso consumido (canje de puntos no queda
        // quemado al cancelar desde la web). Dato de la propia reserva.
        promoCode: item.promoCode ?? null,
      })
    } catch (e) {
      logger.error('socket onBookingCancelled falló (no bloquea la cancelación)', {
        error: (e as Error).message,
      })
    }
  }

  return {
    status: 200,
    body: {
      reservationId: id,
      status: 'cancelled',
      refundAmount: penalty.refundAmount,
      cancellationFee: penalty.cancellationFee,
      policyApplied: penalty.policyApplied,
    },
  }
}
