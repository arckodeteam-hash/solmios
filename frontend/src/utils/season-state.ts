// utils/season-state.ts — Si una temporada llega o no al canal.
//
// Espeja la regla del backend (`canales/usecases/channex.ts:487,501`): el push saltea la temporada
// que no tiene rango de fechas utilizable, y lo único que cubre esos días es la línea base, que se
// emite con `percentage: 0`. Efecto para el hotel: escribe un ajuste en "Temporada Especial", el
// canal sigue vendiendo al precio base y nada avisa que ese número no salió a ningún lado.
//
// Dos orígenes de rango, igual que el backend: las fechas propias del catálogo de temporadas, o los
// días pintados en el planning (`season_assignments`).

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

/** `2026-12-01` → `1/12`. Sin `Date` de por medio: parsear un ISO suelto corre el día por zona horaria. */
export function formatShortDate(iso?: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${Number(d)}/${Number(m)}` : iso
}

export function seasonState(
  season: SeasonDates | undefined,
  todayISO: string,
  paintedSeasons: ReadonlySet<string> = new Set(),
): SeasonState {
  const painted = !!season && paintedSeasons.has(season.name)
  const from = season?.startDate || ''
  const to = season?.endDate || ''

  if (from && to) {
    if (to < todayISO) {
      // Terminada, pero si además está pintada a futuro en el planning igual sale por ese lado.
      return painted
        ? { publishes: true, live: false, badge: 'Pintada en el planning', reason: '' }
        : { publishes: false, live: false, badge: `Terminó el ${formatShortDate(to)}`, reason: `Terminó el ${formatShortDate(to)} · no se publica` }
    }
    const live = from <= todayISO && todayISO <= to
    return {
      publishes: true,
      live,
      badge: live ? 'Vigente hoy' : `${formatShortDate(from)} → ${formatShortDate(to)}`,
      reason: '',
    }
  }

  if (painted) return { publishes: true, live: false, badge: 'Pintada en el planning', reason: '' }
  return { publishes: false, live: false, badge: 'Sin fechas', reason: 'Sin fechas · no se publica' }
}
