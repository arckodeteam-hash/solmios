// pricing/usecases/season-calendar.ts — La temporada EFECTIVA de cada fecha. Una sola respuesta.
//
// Por qué existe. El hotel define temporadas en DOS lugares —el rango de fechas del catálogo
// (`/panel/config/tarifas`) y los días pintados en el planning (`season_assignments`)— y hasta ahora
// cada pantalla resolvía la mezcla por su cuenta, o directamente no la resolvía:
//
//  - el planning leía `GET /api/season-assignments`, que devuelve SOLO lo pintado: un día que cae en
//    el rango del catálogo no se teñía y no había forma de ver qué temporada regía, aunque el motor
//    ya estuviera cobrando esa;
//  - el editor de canal miraba solo el rango del catálogo;
//  - `/panel/config/tarifas` marcaba "Activa" una temporada elegida a mano (`seasons.active`), que no
//    entra en ningún cálculo de precio.
//
// Tres pantallas, tres respuestas distintas a la misma pregunta. Este usecase la contesta UNA vez, y
// lo hace con `buildSeasonByDate` — exactamente la función que usa el motor para cobrar
// (`shared/utils/rate-resolution.ts`, y de ahí `bookingengine`, `reservas/quote` y `reprice`). Si el
// panel y el cobro alguna vez discrepan, es porque alguien dejó de llamar acá.

import type { RepositoryAdapter } from 'arckode-framework'
import { buildSeasonByDate } from '../../../shared/utils/rate-resolution'

/** De dónde salió la temporada de ese día. El planning pisa al catálogo, igual que en el motor. */
export type SeasonSource = 'planning' | 'catalog'

export interface SeasonCalendarDay {
  date: string
  season: string
  source: SeasonSource
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000
const MAX_DAYS = 400   // tope anti-abuso: un año y monedas por consulta

/** Fechas YYYY-MM-DD de [from, to] inclusive. Vacío si el rango no sirve. */
export function datesBetween(from: string, to: string): string[] {
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return []
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return []
  const out: string[] = []
  for (let t = start, i = 0; t <= end && i < MAX_DAYS; t += MS_PER_DAY, i++) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

export interface SeasonCalendarDeps {
  seasons: (hotelId: string) => Promise<Array<{ name?: string; startDate?: string; endDate?: string }>>
  assignments: (hotelId: string) => Promise<Array<{ date?: string; season?: string }>>
}

/**
 * Temporada efectiva por día en [from, to]. Solo devuelve los días que TIENEN temporada: un día sin
 * rango que lo cubra ni pintura queda afuera, que es lo mismo que hace el motor (esa noche cotiza el
 * precio base sin recargo).
 */
export async function seasonCalendar(
  deps: SeasonCalendarDeps, hotelId: string, from: string, to: string,
): Promise<SeasonCalendarDay[]> {
  const dates = datesBetween(from, to)
  if (!dates.length) return []
  const [seasons, assignments] = await Promise.all([deps.seasons(hotelId), deps.assignments(hotelId)])
  const painted = new Map<string, string>()
  for (const a of assignments) {
    if (a?.date && a?.season) painted.set(String(a.date).slice(0, 10), String(a.season))
  }
  const resolved = buildSeasonByDate(assignments as any[], seasons as any[], dates)
  const out: SeasonCalendarDay[] = []
  for (const date of dates) {
    const season = resolved.get(date)
    if (!season) continue
    out.push({ date, season, source: painted.get(date) === season ? 'planning' : 'catalog' })
  }
  return out
}
