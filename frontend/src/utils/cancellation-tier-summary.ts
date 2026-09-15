// utils/cancellation-tier-summary.ts — Resumen en palabras de una política de cancelación.
//
// Lo muestra el editor de políticas debajo de los niveles para que el hotel entienda qué está
// firmando. Tiene que describir EXACTAMENTE lo que aplica el backend
// (`shared/usecases/cancellation-math.ts#computePenalty`):
//   · los niveles se ordenan de mayor a menor anticipación;
//   · aplica el primer nivel cuyo `deadlineHours` sea <= a las horas que faltan;
//   · pasado el check-in (o con menos anticipación que el nivel más chico) aplica el último.
//
// Antes cada nivel se describía solo, y el nivel de 0 h salía como "pasado el check-in / siempre"
// cuando en realidad cubre TODO el tramo por debajo del nivel anterior: una política "gratis con
// 72 h, 50% si es menor" se leía como si el 50% se cobrara únicamente después del check-in.
import type { Tier } from '@/types/cancellation'

/** Umbral que el backend usa como "sin límite" (preset flexible). */
const NO_LIMIT_HOURS = 99_999
const HOURS_PER_DAY = 24

/** "72" → "3 días" · "24" → "1 día" · "36" → "36 h". */
export function anticipationLabel(hours: number): string {
  if (hours % HOURS_PER_DAY === 0) {
    const days = hours / HOURS_PER_DAY
    return days === 1 ? '1 día' : `${days} días`
  }
  return `${hours} h`
}

function moneyLabel(tier: Tier): string {
  if (!tier.refundable) return 'sin reembolso'
  if (tier.penaltyPercent <= 0) return 'reembolso total'
  if (tier.penaltyPercent >= 100) return 'retiene el 100%, sin reembolso'
  return `retiene el ${tier.penaltyPercent}% y devuelve el ${100 - tier.penaltyPercent}%`
}

function whenLabel(hours: number, higher: number | undefined): string {
  if (hours >= NO_LIMIT_HOURS) return 'Hasta el check-in'
  if (higher === undefined) {
    return hours > 0 ? `Con ${anticipationLabel(hours)} o más de anticipación` : 'En cualquier momento'
  }
  if (hours > 0) {
    return higher >= NO_LIMIT_HOURS
      ? `Con ${anticipationLabel(hours)} o más de anticipación`
      : `Entre ${anticipationLabel(hours)} y ${anticipationLabel(higher)} antes`
  }
  return higher >= NO_LIMIT_HOURS
    ? 'Después del check-in'
    : `Con menos de ${anticipationLabel(higher)} de anticipación o después del check-in`
}

/** Una línea por nivel, de mayor a menor anticipación. */
export function tierSummary(tiers: readonly Tier[]): string[] {
  const sorted = [...tiers].sort((a, b) => b.deadlineHours - a.deadlineHours)
  return sorted.map((tier, i) => `${whenLabel(tier.deadlineHours, sorted[i - 1]?.deadlineHours)}: ${moneyLabel(tier)}`)
}
