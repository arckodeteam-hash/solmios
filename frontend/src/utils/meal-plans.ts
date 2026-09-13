// meal-plans.ts — Régimen de alimentación (MR-03 #268): UN solo mapa código → etiqueta y UNA
// sola regla para decidir qué código muestra el panel.
//
// Antes cada vista tenía su copia del mapa (modal, listado, check-in, widget, confirmación) con
// textos que no coincidían entre sí y con la regla `mealPlan ?? regime` al revés de lo que el
// panel edita. Todo lo que muestre un régimen lo resuelve acá; un .vue no importa de otro .vue.
import type { BookingMessageKey } from '@/composables/useBookingI18n'

/** Códigos que admite `Reservations.regime` (el select del panel, `ReservationWizardModal.vue`).
 *  `full_board` existe solo como régimen cargado a mano — no está en el catálogo `meal_plans` y
 *  la web no lo ofrece, pero una reserva del panel puede tenerlo y hay que etiquetarlo.
 *  `room_only` = sin régimen. #360: `MealPlanCode` pasó a ser `string` (catálogo abierto); estos
 *  5 siguen siendo los únicos con etiqueta fija del panel. */
export type RegimeCode = 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive'

/** Etiquetas del PANEL (castellano). El widget público usa `MEAL_PLAN_LABEL_KEY` + i18n. */
export const MEAL_PLAN_LABELS: Record<RegimeCode, string> = {
  room_only: 'Solo alojamiento',
  breakfast: 'Desayuno incluido',
  half_board: 'Media pensión',
  full_board: 'Pensión completa',
  all_inclusive: 'Todo incluido',
}

/** Etiqueta del panel para un código; un código desconocido se muestra crudo (nunca se oculta),
 *  y sin código se devuelve `fallback`. */
export function mealPlanLabel(code?: string | null, fallback = '—'): string {
  if (!code) return fallback
  return (MEAL_PLAN_LABELS as Record<string, string>)[code] ?? code
}

/** Código LEGACY → key i18n del widget público (es/en/pt via `useBookingI18n`). #360: el catálogo
 *  es abierto y cada fila trae su `name`; estas 4 keys quedan SOLO como fallback para snapshots
 *  sin nombre (reservas/líneas anteriores al catálogo abierto). Un código custom no tiene key:
 *  se muestra `name` o, sin él, el código crudo (ver `mealPlanDisplayName`). */
export const MEAL_PLAN_LABEL_KEY: Record<string, BookingMessageKey> = {
  room_only: 'rooms.board.roomOnly',
  breakfast: 'rooms.board.breakfast',
  half_board: 'rooms.board.halfBoard',
  all_inclusive: 'rooms.board.allInclusive',
}

/** Key i18n del widget para un código legacy, o `undefined` si no tiene (código custom). */
export function mealPlanLabelKey(code?: string | null): BookingMessageKey | undefined {
  return code ? (MEAL_PLAN_LABEL_KEY as Record<string, BookingMessageKey | undefined>)[code] : undefined
}

/** #360 — nombre visible de un régimen en el widget público, UNA regla para radio, carrito,
 *  pago, desglose y confirmación: `name` si viene (catálogo/snapshot); si no, la key i18n legacy
 *  traducida con `t` (cuando el caller la pasa); si no, el código crudo (nunca se oculta ni se
 *  muestra una key). `''` cuando no hay ni código. */
export function mealPlanDisplayName(
  code?: string | null,
  name?: string | null,
  t?: (key: BookingMessageKey) => string,
): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed) return trimmed
  if (!code) return ''
  const key = mealPlanLabelKey(code)
  if (key && t) return t(key)
  return code
}

/** Qué régimen MUESTRA el panel para una reserva.
 *
 *  `regime` es el campo editable (el select del wizard) y MANDA; `mealPlan` es el snapshot que
 *  escribe el motor web al reservar (código + precio congelado) y solo cubre cuando `regime`
 *  no vino. El motor escribe los dos con el mismo código, así que arrancan iguales; si después
 *  recepción cambia el régimen desde el panel, lo que se ve es lo que editó — no el snapshot.
 *  `''` cuenta como ausente. Devuelve `null` si la reserva no tiene ninguno. */
export function effectiveMealPlan(r: { regime?: string | null; mealPlan?: string | null } | null | undefined): string | null {
  if (!r) return null
  return r.regime || r.mealPlan || null
}

/** `true` cuando hay un régimen que vale la pena anunciar (distinto de "solo alojamiento"). */
export function hasMealPlan(code?: string | null): boolean {
  return !!code && code !== 'room_only'
}
