// meal-plans.ts — Régimen de alimentación (MR-03 #268, catálogo abierto #361): UNA sola regla
// para decidir qué régimen muestra el panel y UN solo lugar donde vive el fallback de etiquetas.
//
// #361: el catálogo de regímenes es ABIERTO (CRUD en Configuración Base, `name` libre) y el motor
// público persiste código + NOMBRE (`Reservations.mealPlanName`) al reservar. Lo que se muestra
// es el nombre — el mapa `MEAL_PLAN_LABELS` / `MEAL_PLAN_LABEL_KEY` queda SOLO como fallback
// legacy para los códigos históricos (reservas anteriores a #361 sin `mealPlanName`, y el
// `regime` que recepción edita a mano en el panel). Un código nuevo NO se agrega acá: su nombre
// viene del catálogo. Todo lo que muestre un régimen lo resuelve acá; un .vue no importa de otro.
import type { BookingMessageKey } from '@/composables/useBookingI18n'

/** Códigos HISTÓRICOS que admite `Reservations.regime` (el select del panel,
 *  `ReservationWizardModal.vue`). `full_board` existe solo como régimen cargado a mano.
 *  `room_only` = "solo alojamiento" (desde #361 puede ser también una fila del catálogo). */
export type RegimeCode = 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive'

/** Etiquetas LEGACY del panel (castellano) para los códigos históricos. Fallback: un régimen con
 *  `mealPlanName` persistido se muestra con ese nombre (`reservationMealPlanLabel`). */
export const MEAL_PLAN_LABELS: Record<string, string> = {
  room_only: 'Solo alojamiento',
  breakfast: 'Desayuno incluido',
  half_board: 'Media pensión',
  full_board: 'Pensión completa',
  all_inclusive: 'Todo incluido',
}

/** Etiqueta legacy del panel para un código; un código desconocido se muestra crudo (nunca se
 *  oculta), y sin código se devuelve `fallback`. */
export function mealPlanLabel(code?: string | null, fallback = '—'): string {
  if (!code) return fallback
  return MEAL_PLAN_LABELS[code] ?? code
}

/** Código histórico → key i18n del widget público (es/en/pt via `useBookingI18n`). Fallback
 *  LEGACY: el widget muestra `PublicMealPlan.name` (`publicMealPlanLabel`); esto sólo cubre una
 *  fila del catálogo sin nombre o una reserva vieja sin `mealPlanName`. */
export const MEAL_PLAN_LABEL_KEY: Record<string, BookingMessageKey> = {
  room_only: 'rooms.board.roomOnly',
  breakfast: 'rooms.board.breakfast',
  half_board: 'rooms.board.halfBoard',
  all_inclusive: 'rooms.board.allInclusive',
}

/** Key i18n del widget para un código histórico, o `undefined` si no tiene traducción fija. */
export function mealPlanLabelKey(code?: string | null): BookingMessageKey | undefined {
  return code ? MEAL_PLAN_LABEL_KEY[code] : undefined
}

/** #361 — etiqueta de una opción/línea del motor PÚBLICO: el `name` del catálogo tal cual vino
 *  (trim, no vacío); si no lo trae, la traducción legacy del código histórico; si tampoco, el
 *  código crudo (nunca se oculta). `t` es el traductor del widget (`useBookingI18n`). */
export function publicMealPlanLabel(
  opt: { code: string; name?: string | null },
  t: (key: BookingMessageKey) => string,
): string {
  const name = typeof opt.name === 'string' ? opt.name.trim() : ''
  if (name) return name
  const key = mealPlanLabelKey(opt.code)
  return key ? t(key) : opt.code
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

/** #361 — etiqueta del régimen de una reserva para el PANEL: si el régimen efectivo sigue siendo
 *  el que se reservó en la web (`regime` vacío o igual a `mealPlan`) y la reserva trae el nombre
 *  persistido (`mealPlanName`), se muestra ESE nombre (el del catálogo al reservar, aunque el
 *  hotel lo haya renombrado o borrado después). Si recepción cambió el `regime` a mano, manda el
 *  código editado con su etiqueta legacy (`mealPlanLabel`) — el nombre persistido ya no describe
 *  lo que se ve. Sin régimen → `fallback`. */
export function reservationMealPlanLabel(
  r: { regime?: string | null; mealPlan?: string | null; mealPlanName?: string | null } | null | undefined,
  fallback = '—',
): string {
  const code = effectiveMealPlan(r)
  if (!code) return fallback
  const name = typeof r?.mealPlanName === 'string' ? r.mealPlanName.trim() : ''
  if (name && (!r?.regime || r.regime === r.mealPlan)) return name
  return mealPlanLabel(code, fallback)
}

/** `true` cuando hay un régimen que vale la pena anunciar (distinto de "solo alojamiento"). */
export function hasMealPlan(code?: string | null): boolean {
  return !!code && code !== 'room_only'
}
