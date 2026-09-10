// facturas/usecases/cache.ts — Claves e invalidación de caché tras mutaciones.
// Borra listado + stats para que las tarjetas de contabilidad muestren datos
// tiempo-real tras crear/pagar/actualizar/borrar (antes solo se invalidaba el list,
// por lo que "Ingresos del mes" / "Pendiente" quedaban stale hasta 120s).
//
// El listado se cachea por VERSIÓN, no por clave fija: la clave incluye page/limit/filtros,
// así que dos páginas distintas ya no comparten entrada (antes `facturas:list:{hotelId}`
// ignoraba la página y la página 2 devolvía la 1 hasta la próxima escritura). CacheAdapter
// no ofrece borrado por prefijo — solo delete(key) exacto — así que invalidar significa
// cambiar el token de versión: las entradas viejas quedan huérfanas y expiran por TTL.

import type { CacheAdapter } from 'arckode-framework'

/** El token de versión debe sobrevivir a cualquier entrada de listado que dependa de él. */
const VERSION_TTL_SECONDS = 3600

/** El usuario puede no tener hotel (super_admin): sus entradas viven bajo 'all'. */
type HotelKey = string | null | undefined

const versionKey = (hotelId?: HotelKey) => `facturas:ver:${hotelId || 'all'}`

/** Token de versión vigente del hotel. Cambia en cada mutación. */
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

/** Clave del listado: versión + filtros + paginación. Dos queries distintas → dos entradas. */
export async function facturasListCacheKey(
  cache: CacheAdapter,
  hotelId: HotelKey,
  query: { filters: Record<string, unknown>; page: number; limit: number; search?: string },
): Promise<string> {
  const ver = await currentVersion(cache, hotelId)
  const { filters, page, limit, search } = query
  const f = Object.keys(filters).sort().map((k) => `${k}=${String(filters[k])}`).join(',')
  return `facturas:list:${hotelId || 'all'}:v${ver}:${f}:p${page}:l${limit}:s${search ?? ''}`
}

export async function invalidateFacturasCaches(cache: CacheAdapter, hotelId?: HotelKey): Promise<void> {
  const s = hotelId || 'all'
  // Bump de versión → invalida TODAS las páginas/filtros cacheados de este hotel.
  await bumpVersion(cache, s)
  await cache.delete('facturas:stats:' + s)
  // El super_admin lee con hotelId 'all'; sus entradas también quedan obsoletas.
  if (s !== 'all') {
    await bumpVersion(cache, 'all')
    await cache.delete('facturas:stats:all')
  }
}
