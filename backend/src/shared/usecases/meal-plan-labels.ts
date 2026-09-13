// shared/usecases/meal-plan-labels.ts — Etiqueta del régimen para lo que ve el huésped.
//
// MR-03 (#268) persiste el régimen como CÓDIGO (`reservations.mealPlan`). Desde #361 el catálogo
// `meal_plans` es ABIERTO (nombre libre, código slug) y la reserva guarda además el snapshot
// `mealPlanName`: `reservationMealPlanLabel(row, language)` lo prefiere y sólo cae a la etiqueta
// fija por código (`mealPlanLabel`) en reservas anteriores o sin nombre. El correo de
// confirmación (#270, en el idioma del huésped) y el recibo PDF (es) la usan; `bookingengine/
// usecases/public-booking.ts` (`MEAL_PLAN_LABEL`, para `notes`) usa la fija como fallback, así
// que vive acá una sola vez. Un código desconocido cae al código crudo: mejor que un hueco.

import type { NotificationLanguage } from '../../services/notification-defaults'

export const ROOM_ONLY_CODE = 'room_only'

export const ROOM_ONLY: Record<NotificationLanguage, string> = {
  es: 'Sólo alojamiento', en: 'Room only', pt: 'Somente hospedagem',
}

export const MEAL_PLAN_LABELS: Record<NotificationLanguage, Record<string, string>> = {
  es: { breakfast: 'Desayuno', half_board: 'Media pensión', all_inclusive: 'Todo incluido' },
  en: { breakfast: 'Breakfast', half_board: 'Half board', all_inclusive: 'All inclusive' },
  pt: { breakfast: 'Café da manhã', half_board: 'Meia pensão', all_inclusive: 'Tudo incluído' },
}

/** `true` si el código es un régimen real (no vacío ni `room_only`). */
export function hasMealPlan(code: unknown): boolean {
  const c = String(code ?? '').trim()
  return c !== '' && c !== ROOM_ONLY_CODE
}

/**
 * #361 — `true` si la fila de reserva lleva una línea de régimen que mostrar (recibo/correo): un
 * código real (`hasMealPlan`) O un cargo (`mealPlanTotal > 0`). Desde #361 `room_only` puede ser
 * una fila del catálogo con precio: sin esto el cargo se cobraba pero no aparecía en el desglose.
 */
export function hasMealPlanCharge(
  row: { mealPlan?: unknown; mealPlanTotal?: unknown } | null | undefined,
): boolean {
  return hasMealPlan(row?.mealPlan) || (Number(row?.mealPlanTotal ?? 0) || 0) > 0
}

/** Etiqueta del régimen en el idioma pedido; sin régimen → "sólo alojamiento". */
export function mealPlanLabel(code: unknown, language: NotificationLanguage = 'es'): string {
  const c = String(code ?? '').trim()
  if (!hasMealPlan(c)) return ROOM_ONLY[language] ?? ROOM_ONLY.es
  return MEAL_PLAN_LABELS[language]?.[c] ?? MEAL_PLAN_LABELS.es[c] ?? c
}

/**
 * #361 — Etiqueta del régimen de UNA fila de reserva: el snapshot `mealPlanName` (nombre del
 * catálogo al reservar, trim no vacío) y, si no lo hay, `mealPlanLabel(mealPlan, language)`.
 * Sin código (`hasMealPlan` false) y sin nombre → "sólo alojamiento" en el idioma, como antes.
 * Un `room_only` del catálogo con nombre propio ("Solo alojamiento") sale con ese nombre.
 */
export function reservationMealPlanLabel(
  row: { mealPlan?: unknown; mealPlanName?: unknown } | null | undefined,
  language: NotificationLanguage = 'es',
): string {
  const name = typeof row?.mealPlanName === 'string' ? row.mealPlanName.trim() : ''
  return name || mealPlanLabel(row?.mealPlan, language)
}
