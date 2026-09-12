// meal-plans.ts — Régimen de alimentación (MR-03 #268): UN solo mapa código → etiqueta y UNA
// sola regla para decidir qué código muestra el panel.
//
// Antes cada vista tenía su copia del mapa (modal, listado, check-in, widget, confirmación) con
// textos que no coincidían entre sí y con la regla `mealPlan ?? regime` al revés de lo que el
// panel edita. Todo lo que muestre un régimen lo resuelve acá; un .vue no importa de otro .vue.
import type { BookingMessageKey } from '@/composables/useBookingI18n'
import type { MealPlanCode } from '@/types/booking'

/** Códigos que admite `Reservations.regime` (el select del panel, `ReservationWizardModal.vue`).
 *  Es un SUPERCONJUNTO de `MealPlanCode` (lo reservable desde la web: breakfast / half_board /
 *  all_inclusive): `full_board` existe solo como régimen cargado a mano — no está en el catálogo
 *  `meal_plans` y la web no lo ofrece, pero una reserva del panel puede tenerlo y hay que
 *  etiquetarlo. `room_only` = sin régimen. */
export type RegimeCode = MealPlanCode | 'room_only' | 'full_board'

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

/** Código → key i18n del widget público (es/en/pt via `useBookingI18n`). Mapa explícito para que
 *  un código nuevo en el backend rompa el typecheck acá en vez de mostrar la key cruda. Solo los
 *  reservables desde la web: `full_board` no llega al widget. */
export const MEAL_PLAN_LABEL_KEY: Record<MealPlanCode | 'room_only', BookingMessageKey> = {
  room_only: 'rooms.board.roomOnly',
  breakfast: 'rooms.board.breakfast',
  half_board: 'rooms.board.halfBoard',
  all_inclusive: 'rooms.board.allInclusive',
}

/** Key i18n del widget para un código, o `undefined` si no es reservable desde la web. */
export function mealPlanLabelKey(code?: string | null): BookingMessageKey | undefined {
  return code ? (MEAL_PLAN_LABEL_KEY as Record<string, BookingMessageKey | undefined>)[code] : undefined
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
