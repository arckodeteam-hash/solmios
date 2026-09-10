// folios/usecases/cache.ts — Claves e invalidación de caché del listado de folios.
//
// La clave del listado depende de la query (status, reservationId, ...), así que no se puede
// invalidar con una sola `delete`. Antes el service hacía `cache.delete('folios:list:{hotel}:*')`:
// el `*` no es un glob — CacheAdapter solo borra claves exactas — así que NO borraba nada y el
// listado quedaba stale hasta 300s (agregabas un cargo y el folio seguía mostrando el total viejo).
//
// Solución: versionar. La clave incluye un token que cambia en cada mutación; las entradas
// viejas quedan huérfanas y expiran por TTL.

import type { CacheAdapter } from 'arckode-framework'

/** El token de versión debe sobrevivir a cualquier entrada de listado que dependa de él. */
const VERSION_TTL_SECONDS = 3600

/** El usuario puede no tener hotel (super_admin): sus entradas viven bajo 'all'. */
type HotelKey = string | null | undefined

const versionKey = (hotelId?: HotelKey) => `folios:ver:${hotelId || 'all'}`

async function currentVersion(cache: CacheAdapter, hotelId?: HotelKey): Promise<number> {
  const v = await cache.get<number>(versionKey(hotelId))
  if (v) return v
  const seed = Date.now()
  await cache.set(versionKey(hotelId), seed, VERSION_TTL_SECONDS)
  return seed
}

/**
 * Sube el token. `Math.max(ahora, anterior + 1)` y no `Date.now()` a secas (#174): dos
 * invalidaciones en el MISMO milisegundo (pagar y emitir la nota de crédito, o el bump del hotel
 * seguido del de 'all') escribirían el mismo número y la segunda no invalidaría nada — el listado
 * seguiría sirviendo la copia vieja hasta que venza el TTL. Con el `+1` el token siempre avanza.
 */
async function bumpVersion(cache: CacheAdapter, hotelId?: HotelKey): Promise<void> {
  const key = versionKey(hotelId)
  const prev = (await cache.get<number>(key)) ?? 0
  await cache.set(key, Math.max(Date.now(), prev + 1), VERSION_TTL_SECONDS)
}

/** Clave del listado: versión + query serializada. */
export async function foliosListCacheKey(
  cache: CacheAdapter,
  hotelId: HotelKey,
  query: unknown,
): Promise<string> {
  const ver = await currentVersion(cache, hotelId)
  return `folios:list:${hotelId || 'all'}:v${ver}:${JSON.stringify(query ?? {})}`
}

/** Bump de versión → invalida todas las entradas cacheadas del hotel (y las del super_admin). */
export async function invalidateFoliosCaches(cache: CacheAdapter, hotelId?: HotelKey): Promise<void> {
  const s = hotelId || 'all'
  await bumpVersion(cache, s)
  if (s !== 'all') await bumpVersion(cache, 'all')
}
