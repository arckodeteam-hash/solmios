// utils/season-apply.ts — Qué rango de días proponer cuando el hotel aplica una temporada desde la
// pantalla de tarifas, sin pasar por el planning.
//
// Aplicar una temporada es pintar días en `season_assignments` (POST /api/season-assignments), y
// esos días PISAN al rango del catálogo: `shared/utils/rate-resolution.ts: buildSeasonByDate`
// resuelve primero por el catálogo y aplica los assignments encima. Por eso el rango que se propone
// acá no es un detalle de comodidad: es exactamente lo que va a cobrar el motor.
//
// Las fechas se comparan SIEMPRE como strings ISO `YYYY-MM-DD` (orden lexicográfico), nunca con
// `new Date`: parsear un ISO suelto lo toma como UTC y corre el día por zona horaria, y un día de
// corrimiento acá cambia qué noche se vende a qué precio. Misma decisión que `season-state.ts`.

export interface SeasonRange {
  startDate?: string
  endDate?: string
}

/**
 * Rango con el que abre el diálogo "Aplicar temporada". El hotel puede editarlo; esto es solo el
 * punto de partida más útil.
 *
 * Con rango del catálogo vigente o futuro se propone ese, que es lo que el hotel ya cargó. Los dos
 * casos que NO sirven se recortan contra hoy:
 *
 * - Temporada terminada (`endDate` anterior a hoy): proponer sus fechas pintaría días pasados, que
 *   no cambian ninguna reserva ni ningún precio que se esté vendiendo. El hotel apretaría "Aplicar",
 *   la llamada saldría 200 y nada cambiaría en pantalla — el mismo molde de "el panel dice una cosa
 *   y el motor cobra otra".
 * - Temporada en curso (empezó antes de hoy): se recorta el inicio a hoy. Repintar el pasado no
 *   mueve nada a futuro y sí reescribe historia de precios ya facturada.
 *
 * Sin rango utilizable (le falta alguna de las dos puntas) se propone solo hoy: es el mínimo que
 * vuelve visible el cambio en la pantalla, que muestra cuál temporada rige hoy.
 */
export function proposedApplyRange(
  season: SeasonRange | undefined,
  todayISO: string,
): { from: string; to: string } {
  const from = season?.startDate || ''
  const to = season?.endDate || ''

  if (!from || !to) return { from: todayISO, to: todayISO }
  if (to < todayISO) return { from: todayISO, to: todayISO }
  if (from < todayISO) return { from: todayISO, to }
  return { from, to }
}

/**
 * Motivo por el que el rango elegido no se puede aplicar; `''` cuando sí se puede.
 *
 * Se valida antes de llamar al backend porque un rango invertido no falla: pinta cero días y
 * devuelve OK, así que el hotel se queda creyendo que aplicó la temporada.
 *
 * Con `todayISO` se rechaza además el pasado. `proposedApplyRange` ya recorta contra hoy al abrir el
 * diálogo, pero eso es solo la propuesta: los inputs son editables y su `min` es una ayuda del
 * navegador que se saltea tipeando. Sin este chequeo, confirmar un rango pasado repinta
 * `season_assignments` de noches ya vendidas y facturadas — el precio de una reserva pasada deja de
 * coincidir con lo que se cobró. Para corregir historia está el planning, que pinta día por día.
 */
export function applyRangeError(from: string, to: string, todayISO?: string): string {
  if (!from || !to) return 'Elegí las dos fechas'
  if (to < from) return 'La fecha de fin no puede ser anterior a la de inicio'
  if (todayISO && from < todayISO) return 'No se pueden aplicar días pasados: elegí desde hoy en adelante'
  return ''
}
