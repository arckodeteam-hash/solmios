// pricing/usecases/season-catalog.ts — Reglas del catálogo de temporadas.
// Extraído del service para que no crezca a God Object (gate del analyzer): acá vive la regla,
// el service solo lee/escribe y audita.

import { AuthError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'

/**
 * Deja ACTIVA una sola temporada del hotel (#148) y apaga el resto.
 *
 * Solo escribe las filas que efectivamente cambian: activar la temporada que ya estaba activa no
 * genera un UPDATE por cada temporada del hotel (y con eso, ruido en el audit log y en el push a
 * las OTAs, que escucha los cambios de temporada).
 */
export async function applyActiveSeason(
  repo: RepositoryAdapter<any>, seasons: any[], name: string,
): Promise<void> {
  if (!seasons.some((s) => s.name === name)) {
    throw new AuthError(`Temporada '${name}' no existe en este hotel`)
  }
  for (const s of seasons) {
    const shouldBeActive = s.name === name ? 1 : 0
    if ((s.active ? 1 : 0) !== shouldBeActive) await repo.update(s.id, { active: shouldBeActive })
  }
}
