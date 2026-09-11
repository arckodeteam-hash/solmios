// shared/utils/in-house-query.ts — #209: tope del término del buscador "quién está alojado". Lo validan
// los DOS lados del puerto (restaurant/usecases/in-house.ts antes de llamar y reservas/usecases/in-house.ts
// al ejecutar) y tiene que ser el MISMO número con el MISMO mensaje: si divergieran, el mozo vería dos
// errores distintos para el mismo término según qué capa lo cortó. Un número de habitación o un apellido
// no pasan de esto; más largo es basura o abuso.
import { ValidationError } from 'arckode-framework'

export const IN_HOUSE_QUERY_MAX = 60

/** Recorta el término y rechaza con 400 si supera el tope. */
export function assertInHouseQuery(q: unknown): string {
  const term = String(q ?? '').trim()
  if (term.length > IN_HOUSE_QUERY_MAX) throw new ValidationError(`La búsqueda admite hasta ${IN_HOUSE_QUERY_MAX} caracteres`)
  return term
}
