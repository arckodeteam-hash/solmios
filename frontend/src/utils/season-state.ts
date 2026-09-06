// utils/season-state.ts — Si una temporada llega o no al canal, y cuál rige HOY.
//
// Espeja la regla del backend (`canales/usecases/channex.ts:487,501`): el push saltea la temporada
// que no tiene rango de fechas utilizable, y lo único que cubre esos días es la línea base, que se
// emite con `percentage: 0`. Efecto para el hotel: escribe un ajuste en "Temporada Especial", el
// canal sigue vendiendo al precio base y nada avisa que ese número no salió a ningún lado.
//
// Dos orígenes de rango, igual que el backend: las fechas propias del catálogo de temporadas, o los
// días pintados en el planning (`season_assignments`).
//
// QUIÉN GANA CUANDO LAS DOS FUENTES DISCREPAN: el planning. `shared/utils/rate-resolution.ts:
// buildSeasonByDate` resuelve primero por el rango del catálogo y DESPUÉS aplica los assignments
// encima (segundo loop, `out.set`), así que un día pintado pisa al catálogo. Esta función tiene que
// usar el mismo orden: mirar solo el catálogo hacía que el panel anunciara "Vigente hoy" en una
// temporada mientras el motor cobraba la que estaba pintada para hoy.

export interface SeasonDates {
  name: string
  startDate?: string
  endDate?: string
}

export interface SeasonState {
  /** El push la publica: tiene fechas vigentes o días pintados a futuro. */
  publishes: boolean
  /** Hoy cae dentro de su rango — es el precio que el canal está vendiendo ahora. */
  live: boolean
  /** Texto corto para el encabezado de la tarjeta. */
  badge: string
  /** Por qué no se publica. Vacío cuando sí se publica. */
  reason: string
}

/**
 * `2026-12-01` → `1/12`. Sin `Date` de por medio: parsear un ISO suelto corre el día por zona horaria.
 *
 * Con `referenceISO`, un año distinto al de esa fecha se muestra: `2027-04-16` visto desde 2026 sale
 * `16/4/27`. El día y el mes solos son ambiguos apenas el catálogo pasa de un año — una temporada
 * cargada para abril de 2027 se leía "16/4 → 31/8" y parecía la de este año, recién terminada, sin
 * ninguna forma de notar la diferencia desde la pantalla.
 */
export function formatShortDate(iso?: string, referenceISO?: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  const short = `${Number(d)}/${Number(m)}`
  const refYear = referenceISO?.slice(0, 4)
  return refYear && refYear !== y ? `${short}/${y.slice(2)}` : short
}

export function seasonState(
  season: SeasonDates | undefined,
  todayISO: string,
  paintedSeasons: ReadonlySet<string> = new Set(),
  /** Temporada que el planning tiene pintada para HOY, si hay alguna. Manda sobre el catálogo. */
  paintedToday?: string,
): SeasonState {
  const painted = !!season && paintedSeasons.has(season.name)
  const from = season?.startDate || ''
  const to = season?.endDate || ''
  // Hoy pintado con ESTA temporada la vuelve la vigente aunque su rango diga otra cosa; hoy pintado
  // con OTRA se la saca, aunque el rango la incluya. Es lo que hace el motor al cotizar.
  const todayIsThis = !!season && !!paintedToday && paintedToday === season.name
  const todayIsOther = !!paintedToday && (!season || paintedToday !== season.name)

  if (from && to) {
    if (to < todayISO && !todayIsThis) {
      // Terminada, pero si además está pintada a futuro en el planning igual sale por ese lado.
      return painted
        ? { publishes: true, live: false, badge: 'Pintada en el planning', reason: '' }
        : { publishes: false, live: false, badge: `Terminó el ${formatShortDate(to, todayISO)}`, reason: `Terminó el ${formatShortDate(to, todayISO)} · no se publica` }
    }
    const live = todayIsThis || (from <= todayISO && todayISO <= to && !todayIsOther)
    return {
      publishes: true,
      live,
      badge: live ? 'Vigente hoy' : `${formatShortDate(from, todayISO)} → ${formatShortDate(to, todayISO)}`,
      reason: '',
    }
  }

  // Sin fechas propias: el planning es la única fuente, y si pintó HOY con ella, hoy rige ella.
  if (todayIsThis) return { publishes: true, live: true, badge: 'Vigente hoy', reason: '' }
  if (painted) return { publishes: true, live: false, badge: 'Pintada en el planning', reason: '' }
  return { publishes: false, live: false, badge: 'Sin fechas', reason: 'Sin fechas · no se publica' }
}
