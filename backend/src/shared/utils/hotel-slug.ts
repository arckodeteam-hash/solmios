// shared/utils/hotel-slug.ts — El slug público de un hotel (`GET /api/public/hotels/:slug`).
//
// Vive en `shared` porque lo necesitan dos caminos que no se conocen entre sí: el ALTA
// (`subscriptions/usecases/signup.ts`, que se lo pone al hotel al crearlo) y el seeder
// idempotente `scripts/seed-hotel-slugs.ts`, que rellena los hoteles viejos que nacieron sin él.
// Tener dos copias de esta regla significaría que un hotel dado de alta hoy y uno rellenado por
// el seeder pueden terminar con slugs distintos para el mismo nombre.
//
// Reglas (heredadas del seeder, que fue el primer origen):
//  - el slug es ESTABLE: se calcula UNA vez, al crear. Renombrar el hotel NO lo cambia — es el
//    namespace público de una URL que puede estar compartida, indexada o impresa en un folleto;
//  - la colisión se desempata con un hash corto del ID del hotel, no del nombre: dos hoteles que
//    se llamen igual sufijan distinto, y recalcularlo da siempre el mismo resultado;
//  - un nombre que no deja ninguna letra utilizable (solo símbolos) cae a `hotel-<hash>`, no a
//    vacío: sin slug el hotel queda sin página pública y fuera del sitemap.

import { createHash } from 'node:crypto'

/** "Hotel Boutique Palma" → "hotel-boutique-palma". Sin acentos, sin símbolos, sin guiones dobles. */
export function slugifyHotelName(input: string): string {
  const lower = (input || '').toLowerCase()
  // NFD separa las letras de sus marcas combinantes (acentos, diéresis) para poder stripearlas.
  const withoutDiacritics = lower.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return withoutDiacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

/** Hash determinístico corto (6 hex) para desempatar colisiones. */
export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 6)
}

/**
 * Slug definitivo de un hotel. `isTaken` decide si el slug base ya está en uso — el caller la
 * implementa contra su repo/base, así esta función se mantiene pura y testeable.
 */
export async function buildHotelSlug(
  hotelId: string,
  hotelName: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugifyHotelName(hotelName)
  if (!base) return `hotel-${shortHash(hotelId)}`
  return (await isTaken(base)) ? `${base}-${shortHash(hotelId)}` : base
}
