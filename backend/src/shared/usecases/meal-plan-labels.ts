// shared/usecases/meal-plan-labels.ts — Etiqueta del régimen para lo que ve el huésped.
//
// MR-03 (#268) persiste el régimen como CÓDIGO (`reservations.mealPlan`: `room_only` |
// `breakfast` | `half_board` | `all_inclusive`; el catálogo `meal_plans` no tiene nombre libre).
// El correo de confirmación (#270, en el idioma del huésped) y el recibo PDF (es) necesitan la
// etiqueta legible; `bookingengine/usecases/public-booking.ts` (`MEAL_PLAN_LABEL`, para `notes`)
// también, así que vive acá una sola vez. Un código desconocido cae al código crudo: mejor que
// un hueco.

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

/** Etiqueta del régimen en el idioma pedido; sin régimen → "sólo alojamiento". */
export function mealPlanLabel(code: unknown, language: NotificationLanguage = 'es'): string {
  const c = String(code ?? '').trim()
  if (!hasMealPlan(c)) return ROOM_ONLY[language] ?? ROOM_ONLY.es
  return MEAL_PLAN_LABELS[language]?.[c] ?? MEAL_PLAN_LABELS.es[c] ?? c
}
