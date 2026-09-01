// pricing/usecases/season-catalog.ts — Reglas del catálogo de temporadas.
// Extraído del service para que no crezca a God Object (gate del analyzer): acá vive la regla,
// el service solo lee/escribe y audita.

import { AuthError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { defaultSeasons } from './defaults'

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

/**
 * Temporadas del hotel, ordenadas — sembrando el catálogo por defecto la primera vez.
 *
 * El seed no es cosmético: `activateSeason` y la matriz de tarifas necesitan que exista algo
 * sobre lo que operar, y un hotel recién creado no tiene ninguna fila.
 */
export async function listSeasonsSeeded(repo: RepositoryAdapter<any>, hotelId: string): Promise<any[]> {
  let data = (await repo.findMany({ hotelId })) as any[]
  if (data.length === 0) {
    for (const s of defaultSeasons()) await repo.create({ id: crypto.randomUUID(), hotelId, ...s })
    data = (await repo.findMany({ hotelId })) as any[]
  }
  return data.sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0))
}
