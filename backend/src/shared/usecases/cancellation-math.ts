// shared/usecases/cancellation-math.ts — Cálculo de políticas de cancelación (F1 plan #627).
//
// CORAZÓN de F1. Funciones PURAS importables por `reservas` y `bookingengine` sin
// violar "no importar de otro módulo" (la capa `shared/` está sancionada — molde
// `shared/usecases/audit.ts`). El type-only import de Tier se borra al compilar: no
// crea dependencia runtime con el módulo cancellation.
//
// Resolución de política (precedencia):
//   1. Override por canal (scope='channel', scopeId=channel) si vino channel.
//   2. Base del hotel (scope='base').
//   3. Preset mapeado desde hotels.cancellationType (flexible/moderate/strict/non_refundable).
//   4. Default flexible (siempre reembolsable, 0% penalty).
//
// ⚠ NOTA DE DESVIACIÓN DEL SPEC (reportada): el plan #627 dice "primer tier cuyo
// deadlineHours >= horas-restantes". Esa comparación está invertida: con ella,
// cancelar 30 min antes del checkIn matchea el tier de 72h → 0% penalty (cualquier
// hoursRemaining > 0 matchea el tier de mayor deadlineHours). El caso test "24h con
// moderate→50%" del propio plan es el canario que prueba que la comparación correcta
// es `deadlineHours <= horasRestantes` (tier cuya anticipación requerida es menor o
// igual al tiempo restante → ese tier aplica). Implementamos la semántica correcta de
// cancelación del mundo real. Ver tests para los casos cubiertos.
import type { RepositoryAdapter } from 'arckode-framework'
import type { Tier, CancellationPolicyDTO } from '../../modules/cancellation/types'
import { effectiveCheckInTime, hotelTimezone, zonedTimeToUtc } from '../utils/hotel-schedule'

/** Política ya resuelta (lista para computar penalidad). */
export interface ResolvedPolicy {
  tiers: Tier[]
  policyId: string
  source: 'custom' | 'preset' | 'default'
  label?: string
}

/** Resultado del cálculo de penalidad sobre un depósito. */
export interface PenaltyResult {
  refundable: boolean
  penaltyPercent: number
  refundAmount: number
  cancellationFee: number
  matchedTier: Tier
  policyApplied: ResolvedPolicy
}

/**
 * Presets de tiers por tipo de cancelación (espejan BookingConfig.cancellationPolicy).
 * - flexible: 0% siempre (hasta el checkIn).
 * - moderate: 0% si >72h antes; 50% si <=72h.
 * - strict: 0% si >168h (7d) antes; 100% si <=168h.
 * - non_refundable: 100%, no reembolsable.
 */
export const PRESET_TIERS: Record<string, Tier[]> = {
  flexible: [{ deadlineHours: 99_999, penaltyPercent: 0, refundable: true, label: 'Cancelación gratis' }],
  moderate: [
    { deadlineHours: 72, penaltyPercent: 0, refundable: true },
    { deadlineHours: 0, penaltyPercent: 50, refundable: true },
  ],
  strict: [
    { deadlineHours: 168, penaltyPercent: 0, refundable: true },
    { deadlineHours: 0, penaltyPercent: 100, refundable: true },
  ],
  non_refundable: [{ deadlineHours: 0, penaltyPercent: 100, refundable: false }],
}

/**
 * Nombre visible (español) de cada preset. `policyId` sigue guardando la clave en inglés
 * (`strict`, …) para auditoría; lo que ve el recepcionista en el modal de cancelación y en el
 * snapshot `policyApplied.label` es este texto — antes aparecía "Política aplicada: strict".
 */
export const PRESET_LABELS: Record<string, string> = {
  flexible: 'Flexible',
  moderate: 'Moderada',
  strict: 'Estricta',
  non_refundable: 'No reembolsable',
}

/** Nombre visible de un preset; una clave desconocida se muestra tal cual (nunca vacío). */
export function presetLabel(type: string): string {
  return PRESET_LABELS[type] ?? type
}

/** Devuelve los tiers del preset pedido (copia profunda). Unknown → flexible. */
export function presetFromEnum(type: string | undefined | null): Tier[] {
  const tiers = type != null ? PRESET_TIERS[type] : undefined
  return (tiers ?? PRESET_TIERS.flexible).map((t) => ({ ...t, label: t.label }))
}

/**
 * Resuelve la política aplicable para un hotel/canal. Trae todas las políticas activas
 * del hotel en una sola query (robusto multi-motor: sin ambigüedad de filtros booleanos)
 * y aplica la precedencia channel > base > preset > default.
 */
export async function resolvePolicy(
  policyRepo: RepositoryAdapter<CancellationPolicyDTO>,
  hotelId: string,
  channel?: string,
  hotelCancellationType?: string | null,
): Promise<ResolvedPolicy> {
  const all = await policyRepo.findMany({ hotelId } as any)
  // ORM normaliza active (boolean ↔ INTEGER): llega true/false. Treat-undefined como
  // activa (default:true en el modelo). Solo excluimos false explícito.
  const actives = (all as CancellationPolicyDTO[]).filter((p) => p.active !== false)

  // 1. Override por canal (scope='channel', scopeId=canal).
  if (channel) {
    const ch = actives.find((p) => p.scope === 'channel' && p.scopeId === channel)
    if (ch && Array.isArray(ch.tiers) && ch.tiers.length > 0) {
      return { tiers: ch.tiers, policyId: ch.id, source: 'custom', label: ch.name || undefined }
    }
  }
  // 2. Base del hotel (scope='base', sin scopeId).
  const base = actives.find((p) => p.scope === 'base' && (!p.scopeId || p.scopeId === ''))
  if (base && Array.isArray(base.tiers) && base.tiers.length > 0) {
    return { tiers: base.tiers, policyId: base.id, source: 'custom', label: base.name || undefined }
  }
  // 3. Preset desde hotels.cancellationType (legacy, antes de tener filas custom).
  if (hotelCancellationType) {
    return { tiers: presetFromEnum(hotelCancellationType), policyId: hotelCancellationType, source: 'preset', label: presetLabel(hotelCancellationType) }
  }
  // 4. Default flexible (seguro: nunca bloquea una cancelación legítima).
  return { tiers: presetFromEnum('flexible'), policyId: 'default', source: 'default', label: presetLabel('flexible') }
}

/**
 * Lee `hotels.cancellationType` para alimentar el nivel 3 de `resolvePolicy`.
 *
 * FAIL-SOFT por diseño: sin repo, hotel inexistente, campo vacío o error de BD → `null`
 * (resolvePolicy cae al default flexible). Una cancelación legítima NUNCA se bloquea
 * porque no se pudo leer el hotel.
 *
 * Usa `findMany({id})` y NO `findById` a propósito: el analyzer del framework matchea
 * `findById` por TEXTO y exigiría un `assertOwnership` sobre el hotel — acá el hotelId ya
 * viene de la reserva cuyo ownership el caller validó (mem analyzer-textual-match-comments).
 */
export async function hotelCancellationTypeOf(
  hotelRepo: RepositoryAdapter<any> | undefined | null,
  hotelId: string,
): Promise<string | null> {
  if (!hotelRepo || !hotelId) return null
  try {
    const rows = (await hotelRepo.findMany({ id: hotelId } as any)) as any[]
    const type = rows?.[0]?.cancellationType
    return typeof type === 'string' && type !== '' ? type : null
  } catch {
    return null
  }
}

/**
 * Instante REAL de la entrada (ISO UTC): la fecha de llegada a la hora de check-in, en la zona del
 * hotel. Es contra esto que se miden las "horas antes" de cada tier.
 *
 * Hasta el 2026-09-15 los tres llamadores pasaban `reservation.checkIn` ('YYYY-MM-DD') tal cual y
 * `Date.parse` lo leía como medianoche UTC. En America/Santo_Domingo (UTC-4) con entrada a las 15:00
 * el corte de cada tier quedaba 19 h antes de lo que dice la política: un huésped que cancelaba 80 h
 * antes de su entrada caía en el tramo "menos de 72 h" y pagaba la penalidad. Mismo bug que tuvo la
 * cerradura (`shared/utils/hotel-schedule.ts`), misma solución.
 *
 * La hora sale del override de la reserva (early check-in) o del horario del hotel. Fail-soft: si el
 * hotel no se puede leer se usan los defaults del modelo (15:00, America/Santo_Domingo), nunca
 * medianoche UTC.
 */
export function checkInInstant(
  reservation: { checkIn?: unknown; checkInTime?: unknown },
  hotel: { checkIn?: unknown; timezone?: unknown } | null | undefined,
): string {
  const date = String(reservation.checkIn ?? '').slice(0, 10)
  const instant = zonedTimeToUtc(date, effectiveCheckInTime(reservation, hotel), hotelTimezone(hotel))
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : String(reservation.checkIn ?? '')
}

/** Fila del hotel para `checkInInstant`. Fail-soft → null (mismo criterio que `hotelCancellationTypeOf`). */
export async function hotelScheduleOf(
  hotelRepo: RepositoryAdapter<any> | undefined | null,
  hotelId: string,
): Promise<{ checkIn?: unknown; timezone?: unknown } | null> {
  if (!hotelRepo || !hotelId) return null
  try {
    const rows = (await hotelRepo.findMany({ id: hotelId } as any)) as any[]
    return rows?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Calcula la penalidad dado la política resuelta + contexto temporal.
 *
 * Algoritmo: tiers ordenados DESC por deadlineHours; el primer tier cuyo
 * `deadlineHours <= horasRestantes` es el match (el huésped dio >= anticipación que
 * ese tier exige). Si horasRestantes <= 0 (pasado checkIn) o ningún tier matchea
 * (menos tiempo que el deadline más chico) → último tier (mayor penalidad).
 *
 * `refundAmount = refundable ? depositAmount * (1 - penaltyPercent/100) : 0`.
 * `cancellationFee = depositAmount - refundAmount`.
 */
export function computePenalty(
  policy: ResolvedPolicy,
  ctx: { now: string; checkIn: string; depositAmount: number },
): PenaltyResult {
  const hoursRemaining = (Date.parse(ctx.checkIn) - Date.parse(ctx.now)) / 3_600_000
  const ordered = [...policy.tiers].sort((a, b) => b.deadlineHours - a.deadlineHours)
  const fallbackTier: Tier = ordered[ordered.length - 1] ?? { deadlineHours: 0, penaltyPercent: 0, refundable: true }

  let matched: Tier
  if (hoursRemaining <= 0) {
    // Pasado el checkIn → último tier (mayor penalidad).
    matched = fallbackTier
  } else {
    // Primer tier (DESC) con deadlineHours <= horasRestantes.
    matched = ordered.find((t) => t.deadlineHours <= hoursRemaining) ?? fallbackTier
  }

  const { penaltyPercent, refundable } = matched
  const refundAmount = refundable ? ctx.depositAmount * (1 - penaltyPercent / 100) : 0
  const cancellationFee = ctx.depositAmount - refundAmount
  return { refundable, penaltyPercent, refundAmount, cancellationFee, matchedTier: matched, policyApplied: policy }
}
