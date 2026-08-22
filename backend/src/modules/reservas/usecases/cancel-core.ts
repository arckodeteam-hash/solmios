// reservas/usecases/cancel-core.ts — Núcleo compartido de la cancelación REAL de una reserva.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────────────────
// Había tres caminos internos que cancelaban con `repo.update({ status: 'cancelled' })` /
// `orm.update(...)` directo (ingesta OTA de Channex, ai-recepcionista, ai-gerente). Ninguno
// resolvía la política del hotel, ninguno persistía el snapshot financiero y —lo caro— ninguno
// emitía `onReservationCancelled`, que es LO ÚNICO que libera el depósito retenido
// (connectors/reservas-deposits.ts). Resultado: plata del hotel trabada en un hold que nadie
// soltaba, y una reserva "cancelada" sin rastro de con qué política se canceló.
//
// Este archivo es el pedazo que comparten TODOS los caminos de cancelación de `reservas`:
//   idempotencia → state machine → política → penalidad → snapshot → evento → cache.
// `cancel.ts` (usuario del panel, con ownership) y `cancel-system.ts` (sistema, sin usuario)
// son dos envoltorios de AUTORIZACIÓN sobre este mismo núcleo.
//
// ── POR QUÉ NO SE REUSA `bookingengine/usecases/public-cancel.ts` ─────────────────────────
// Ese flujo ya resuelve "cancelar sin usuario logueado", pero resuelve OTRO problema: ahí el
// actor es el HUÉSPED y la autorización es un token HMAC por reserva. Acá el actor es el
// SISTEMA (un cron de OTA, un bot) y la autorización es el TENANT: el caller declara para qué
// hotel actúa y no puede tocar reservas de otro. Además `reservas` no puede importar de
// `bookingengine` (regla del proyecto: nada de imports cruzados entre módulos) y ese flujo
// emite su propio evento (`onBookingCancelled`, no `onReservationCancelled`).
// Lo que SÍ comparten los dos módulos —la matemática de la política— ya vive en
// `shared/usecases/cancellation-math.ts` y ambos la usan. Subir el snapshot a `shared/` sólo
// para que un módulo ajeno lo importe sería fabricar el acoplamiento que la regla prohíbe.

import type { Logger, CacheAdapter, RepositoryAdapter } from 'arckode-framework'
import { assertValidTransition } from './state-machine'
import { safeEmit } from './safe-emit'
import { invalidateReservasCaches } from './cache'
import {
  resolvePolicy,
  computePenalty,
  hotelCancellationTypeOf,
  type PenaltyResult,
} from '../../../shared/usecases/cancellation-math'

/**
 * Quién define la penalidad comercial de esta cancelación.
 *
 * - `hotel-policy` (default): se aplica la política del hotel (cancellation_policies →
 *   preset de `hotels.cancellationType` → default flexible). Es el caso de una cancelación
 *   directa: panel, huésped, o un bot cancelando una reserva directa.
 *
 * - `channel-managed`: la penalidad la cobra y retiene el CANAL (OTA) según el rate plan con
 *   el que el huésped reservó; los tiers del hotel no aplican a esa reserva. El hotel igual
 *   tiene que registrar el snapshot y —sobre todo— soltar el depósito/garantía retenido, que
 *   es plata suya trabada. Por eso: fee 0, refund = depósito completo.
 *   ⚠ Decisión de NEGOCIO, no técnica: si un hotel quiere aplicar su propia penalidad también
 *   a las cancelaciones OTA, alcanza con que el caller pase `hotel-policy`.
 */
export type PenaltyMode = 'hotel-policy' | 'channel-managed'

export interface CancelCoreDeps {
  repo: RepositoryAdapter<any>
  policyRepo: RepositoryAdapter<any>
  /** Hotels — para leer `cancellationType` (nivel 3 de resolvePolicy). Opcional: fail-soft. */
  hotelRepo?: RepositoryAdapter<any>
  logger: Logger
  cache: CacheAdapter
  sockets: any
  /**
   * RTC-8.7 — expira las sesiones de cobro ABIERTAS de la reserva (links `pending` de
   * `payment-requests` + sesiones de checkout de `payments`) ANTES de marcarla `cancelled`.
   * `pendingBalance` no mira `status`, así que sin esto la reserva cancelada seguía con saldo
   * > 0 y el link quedaba vivo y pagable. Fail-loud: si Stripe no responde, la reserva NO se
   * cancela (sesiones pagables que nadie controla ya) — mismo criterio que el borrado (SEC3-3).
   * Lo arma el service desde `orchestrationDeps.paymentRequestsCeiling` (fail-closed).
   */
  releaseChargeSessions: (reservationId: string, hotelId: string) => Promise<void>
}

export interface CancelCoreResult {
  /** La reserva ya persistida con el snapshot (o la existente, si fue no-op idempotente). */
  reservation: any
  penalty: PenaltyResult
  /** true → la reserva YA estaba cancelada: no se recalculó, no se re-emitió el evento. */
  idempotent: boolean
}

/** Snapshot sintético para `channel-managed`: sin penalidad del hotel, reembolso total. */
function channelManagedPenalty(depositAmount: number): PenaltyResult {
  const matchedTier = {
    deadlineHours: 0,
    penaltyPercent: 0,
    refundable: true,
    label: 'Penalidad gestionada por el canal (OTA)',
  } as PenaltyResult['matchedTier']
  return {
    refundable: true,
    penaltyPercent: 0,
    refundAmount: depositAmount,
    cancellationFee: 0,
    matchedTier,
    // `source: 'default'` porque el tipo de ResolvedPolicy sólo admite custom|preset|default;
    // el `policyId` es el que identifica el caso en la auditoría.
    policyApplied: {
      tiers: [matchedTier],
      policyId: 'channel-managed',
      source: 'default',
      label: 'Penalidad gestionada por el canal (OTA)',
    },
  }
}

/** Reconstruye el snapshot ya persistido de una reserva cancelada (para el retorno idempotente). */
function snapshotOf(item: any): PenaltyResult {
  const policyApplied = item.policyApplied ?? null
  return {
    refundable: true,
    penaltyPercent: 0,
    refundAmount: Number(item.refundAmount ?? 0),
    cancellationFee: Number(item.cancellationFee ?? 0),
    matchedTier: policyApplied?.tiers?.[0] ?? ({ deadlineHours: 0, penaltyPercent: 0, refundable: true } as PenaltyResult['matchedTier']),
    policyApplied,
  }
}

/**
 * Aplica la cancelación sobre una reserva YA leída y YA autorizada por el caller.
 *
 * NO autoriza: el ownership (usuario) o el scoping por tenant (sistema) es responsabilidad del
 * envoltorio — `cancel.ts` y `cancel-system.ts` respectivamente.
 *
 * Idempotente: si la reserva ya está `cancelled` devuelve el snapshot persistido sin recalcular
 * la penalidad ni re-emitir `onReservationCancelled` (si re-emitiera, el connector de depósitos
 * volvería a "liberar" un hold ya liberado — la ingesta OTA reprocesa revisiones repetidas).
 *
 * Lanza `ConflictError` (409) si el estado actual no admite la transición a `cancelled`
 * (checked_in / checked_out).
 */
export async function applyCancellation(
  deps: CancelCoreDeps,
  item: any,
  opts: { reason?: string; penaltyMode?: PenaltyMode } = {},
): Promise<CancelCoreResult> {
  const { repo, policyRepo, hotelRepo, logger, cache, sockets } = deps

  // Idempotencia: ya cancelada → no-op (no recalcula penalidad, no re-emite socket).
  if (item.status === 'cancelled') {
    return { reservation: item, penalty: snapshotOf(item), idempotent: true }
  }

  // State machine: checked_in → sólo checked_out; checked_out → nada. Cancelar desde esos
  // estados es un 409 (la reserva ya consumió recursos: folio, habitación ocupada).
  assertValidTransition(item.status, 'cancelled')

  // RTC-8.7: sesiones de cobro muertas ANTES del update a `cancelled`. Si esto tira (Stripe
  // caído), la cancelación no ocurre: preferible reintentar que dejar links pagables sobre una
  // reserva que el staff ya dio por cancelada.
  await deps.releaseChargeSessions(String(item.id), String(item.hotelId))

  const nowIso = new Date().toISOString()
  const depositAmount = Number(item.deposit ?? 0)

  let penalty: PenaltyResult
  if (opts.penaltyMode === 'channel-managed') {
    penalty = channelManagedPenalty(depositAmount)
  } else {
    // resolvePolicy trae TODAS las políticas del hotel y aplica channel > base > preset > default.
    // computePenalty (F1) devuelve el snapshot a persistir. USAR TAL CUAL.
    //
    // ⚠ El 4º argumento (preset de `hotels.cancellationType`) NO es opcional en la práctica:
    // sin él, un hotel 'strict'/'moderate' SIN filas custom en cancellation_policies cae al
    // default flexible y devuelve el 100% del depósito, mientras el widget público
    // (public-rates.ts, que SÍ lo pasa) le anunció al huésped una penalidad del 100%.
    // Plata que el hotel perdía. Fail-soft: si no se puede leer el hotel → null → default.
    const hotelType = await hotelCancellationTypeOf(hotelRepo, item.hotelId)
    const policy = await resolvePolicy(policyRepo, item.hotelId, item.channel, hotelType)
    penalty = computePenalty(policy, { now: nowIso, checkIn: item.checkIn, depositAmount })
  }

  const updated = await repo.update(item.id, {
    status: 'cancelled',
    cancelledAt: nowIso,
    cancellationReason: opts.reason ?? '',
    cancellationFee: penalty.cancellationFee,
    refundAmount: penalty.refundAmount,
    policyApplied: penalty.policyApplied,
  })

  // Socket hacia connectors: deposits (release/refund), promo-codes (devuelve el uso del
  // código, PC-5), CRM, channel manager (availability). safeEmit: si el handler falla, NO
  // rompe la cancelación (side-effect resilient).
  await safeEmit(logger, 'onReservationCancelled', sockets.onReservationCancelled, {
    reservationId: item.id,
    hotelId: item.hotelId,
    refundAmount: penalty.refundAmount,
    cancellationFee: penalty.cancellationFee,
    policyApplied: penalty.policyApplied,
    // PC-5: el connector promo-codes libera el uso consumido para que un canje de puntos no
    // quede quemado al cancelar (dato de la propia reserva — no es cross-module).
    promoCode: item.promoCode ?? null,
  })
  await invalidateReservasCaches(cache, item.hotelId)

  return { reservation: updated ?? null, penalty, idempotent: false }
}
