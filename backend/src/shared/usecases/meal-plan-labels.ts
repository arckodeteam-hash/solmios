// shared/usecases/meal-plan-labels.ts — Etiqueta del régimen para lo que ve el huésped.
//
// MR-03 (#268) persiste el régimen como CÓDIGO (`reservations.mealPlan`). Desde #360 el catálogo
// `meal_plans` es abierto (nombre libre por hotel) y la reserva guarda además el nombre congelado
// (`reservations.mealPlanName`): `mealPlanLabel` lo prefiere y sólo cae a la tabla legacy por
// código cuando no está (reservas anteriores). El correo de confirmación (#270, en el idioma del
// huésped) y el recibo PDF (es) lo usan; `notes` de public-booking usa `MealPlanLine.name`
// directamente. Un código desconocido cae al código crudo: mejor que un hueco.

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
 * Etiqueta del régimen en el idioma pedido; sin régimen → "sólo alojamiento".
 *
 * #360 — catálogo abierto: si viene `name` (el snapshot `reservations.mealPlanName`, congelado al
 * reservar) manda ese nombre tal cual, en cualquier idioma (es el nombre que el hotel definió y
 * el huésped eligió). Sin `name` (reservas anteriores a la columna) cae a la tabla legacy por
 * código, y un código desconocido al código crudo.
 */
export function mealPlanLabel(code: unknown, language: NotificationLanguage = 'es', name?: unknown): string {
  const n = String(name ?? '').trim()
  if (n) return n
  const c = String(code ?? '').trim()
  if (!hasMealPlan(c)) return ROOM_ONLY[language] ?? ROOM_ONLY.es
  return MEAL_PLAN_LABELS[language]?.[c] ?? MEAL_PLAN_LABELS.es[c] ?? c
}
