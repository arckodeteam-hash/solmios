// shared/usecases/versioned-list-cache.ts — Listados cacheados por VERSIÓN, no por clave fija.
//
// `CacheAdapter` solo borra claves exactas (no hay glob ni prefijo). Si la clave del listado
// incluye filtros y paginación (como debe, para que dos páginas no compartan entrada), entonces
// `cache.delete('x:list:{hotelId}')` tras una mutación NO borra nada: la entrada real se llama
// `x:list:{...filtros}:p2:l20`. Ese fue el bug de apikeys y webhooks: crear una clave y volver a
// listar devolvía la lista vieja hasta que venciera el TTL (5 min).
//
// Solución (misma que facturas/folios): la clave lleva un token de versión por hotel y uno global
// ('all', el del super_admin). Invalidar = cambiar el token; las entradas viejas quedan huérfanas
// y expiran solas.
import type { CacheAdapter } from 'arckode-framework'

/** Debe sobrevivir a cualquier entrada de listado que dependa de él. */
const VERSION_TTL_SECONDS = 3600

type HotelKey = string | null | undefined

export interface VersionedListCache {
  /** Clave del listado para estos filtros/página bajo la versión vigente del hotel (o 'all'). */
  key(hotelId: HotelKey, query: { filters: Record<string, unknown>; page: number; limit: number }): Promise<string>
  /** Bump de versión del hotel Y de 'all': invalida todas las páginas/filtros cacheados. */
  invalidate(hotelId: HotelKey): Promise<void>
}

export function versionedListCache(cache: CacheAdapter, prefix: string): VersionedListCache {
  const versionKey = (hotelId: HotelKey) => `${prefix}:ver:${hotelId || 'all'}`

  async function currentVersion(hotelId: HotelKey): Promise<number> {
    const v = await cache.get<number>(versionKey(hotelId))
    if (v) return v
    const seed = Date.now()
    await cache.set(versionKey(hotelId), seed, VERSION_TTL_SECONDS)
    return seed
  }

  return {
    async key(hotelId, { filters, page, limit }) {
      // El super_admin sin filtro de hotel lista TODO: su entrada depende de la versión global,
      // que también se bumpea cuando cambia cualquier hotel.
      const scope = hotelId || 'all'
      const ver = await currentVersion(scope)
      const f = Object.keys(filters).sort().map((k) => `${k}=${String(filters[k])}`).join(',')
      return `${prefix}:list:${scope}:v${ver}:${f}:p${page}:l${limit}`
    },
    async invalidate(hotelId) {
      const now = Date.now()
      const scope = hotelId || 'all'
      await cache.set(versionKey(scope), now, VERSION_TTL_SECONDS)
      if (scope !== 'all') await cache.set(versionKey('all'), now, VERSION_TTL_SECONDS)
    },
  }
}
