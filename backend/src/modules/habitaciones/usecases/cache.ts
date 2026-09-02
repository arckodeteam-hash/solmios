// habitaciones/usecases/cache.ts — Claves e invalidación del listado.
//
// El listado se cachea por VERSIÓN, no por clave fija. La clave incluye página y
// filtros, y `CacheAdapter` solo borra claves EXACTAS —no hay borrado por
// prefijo—, así que el `delete('habitaciones:list:<hotelId>')` que había no
// borraba nada: esa clave nunca existió.
//
// El efecto era el peor posible para un hotel nuevo: cargabas tu primera
// habitación, el POST devolvía 201, y la lista seguía diciendo "Todavía no hay
// habitaciones" durante los 5 minutos del TTL. Parecía que el sistema no
// guardaba nada.
//
// Cambiar el token de versión deja las entradas viejas huérfanas y las expira el
// TTL, que es la única invalidación posible con este adapter.
import type { CacheAdapter } from 'arckode-framework'

/** El token debe sobrevivir a cualquier entrada de listado que dependa de él. */
const VERSION_TTL_SECONDS = 3600

type HotelKey = string | null | undefined

const versionKey = (hotelId?: HotelKey) => `habitaciones:ver:${hotelId || 'all'}`

async function currentVersion(cache: CacheAdapter, hotelId?: HotelKey): Promise<number> {
  const v = await cache.get<number>(versionKey(hotelId))
  if (v) return v
  const seed = Date.now()
  await cache.set(versionKey(hotelId), seed, VERSION_TTL_SECONDS)
  return seed
}

/** Clave del listado, versionada. Al bumpear la versión, deja de encontrarse. */
export async function listCacheKey(
  cache: CacheAdapter,
  hotelId: HotelKey,
  parts: { page: number; limit: number; status?: string; type?: string; search?: string },
): Promise<string> {
  const ver = await currentVersion(cache, hotelId)
  return `habitaciones:list:${hotelId || 'all'}:v${ver}:p${parts.page}:l${parts.limit}:${parts.status || ''}:${parts.type || ''}:${parts.search || ''}`
}

/**
 * Invalida TODO el listado del hotel tras crear, editar o borrar.
 * También se bumpea la versión global (`all`), que es la que ve el super_admin.
 */
export async function bumpListVersion(cache: CacheAdapter, hotelId?: HotelKey): Promise<void> {
  // MONOTÓNICO, no `Date.now()` pelado: dos escrituras en el mismo milisegundo daban el MISMO
  // token y la invalidación quedaba en nada (crear y listar enseguida es exactamente ese caso).
  const next = Math.max(Date.now(), (await currentVersion(cache, hotelId)) + 1)
  await cache.set(versionKey(hotelId), next, VERSION_TTL_SECONDS)
  if (hotelId) {
    const global = Math.max(next, (await currentVersion(cache, null)) + 1)
    await cache.set(versionKey(null), global, VERSION_TTL_SECONDS)
  }
}
