// tickets/usecases/cache.ts — Caché del listado VERSIONADA (REQ-SOP-05), mismo patrón que
// facturas/usecases/cache.ts.
//
// Antes: una clave fija por hotel (`tickets:list:{hotelId}`, TTL 300s) que create/update borraban
// — pero el super_admin lee con clave `tickets:list:all`, que create/update NUNCA invalidaban (no
// hay forma de saber, desde un hotel, qué claves 'all' hay que borrar) → un ticket nuevo tardaba
// hasta 5 min en aparecer en la pantalla de soporte de la plataforma. Tampoco distinguía
// filtros/paginación: dos queries distintas compartían la misma entrada.
//
// CacheAdapter no borra por prefijo — solo delete(key) exacto — así que invalidar es cambiar el
// token de versión: las entradas viejas quedan huérfanas y expiran por TTL.
import type { CacheAdapter } from 'arckode-framework'

const VERSION_TTL_SECONDS = 3600

/** El usuario puede no tener hotel (super_admin): sus entradas viven bajo 'all'. */
type HotelKey = string | null | undefined

const versionKey = (hotelId?: HotelKey) => `tickets:ver:${hotelId || 'all'}`

/** Token de versión vigente del hotel/'all'. Cambia en cada mutación. */
async function currentVersion(cache: CacheAdapter, hotelId?: HotelKey): Promise<number> {
  const v = await cache.get<number>(versionKey(hotelId))
  if (v) return v
  await cache.set(versionKey(hotelId), 1, VERSION_TTL_SECONDS)
  return 1
}

/**
 * Incrementa el token de versión de una clave. Contador monotónico (no `Date.now()`): dos
 * mutaciones en el mismo milisegundo con timestamp NO se distinguirían y una quedaría "invalidando"
 * a la nada — con contador, cada bump es distinto sí o sí.
 */
async function bumpVersion(cache: CacheAdapter, key: string): Promise<void> {
  const v = (await cache.get<number>(key)) ?? 0
  await cache.set(key, v + 1, VERSION_TTL_SECONDS)
}

/** Clave del listado: versión + filtros + paginación. Dos queries distintas → dos entradas. */
export async function ticketsListCacheKey(
  cache: CacheAdapter,
  hotelId: HotelKey,
  query: { filters: Record<string, unknown>; page: number; limit: number },
): Promise<string> {
  const ver = await currentVersion(cache, hotelId)
  const { filters, page, limit } = query
  const f = Object.keys(filters).sort().map((k) => `${k}=${String(filters[k])}`).join(',')
  return `tickets:list:${hotelId || 'all'}:v${ver}:${f}:p${page}:l${limit}`
}

/**
 * Bumpea la versión del hotel Y la de 'all' — el super_admin lee across-hotel, así que una
 * mutación en CUALQUIER hotel tiene que invalidar también su listado.
 */
export async function invalidateTicketsCaches(cache: CacheAdapter, hotelId?: HotelKey): Promise<void> {
  const s = hotelId || 'all'
  await bumpVersion(cache, versionKey(s))
  if (s !== 'all') {
    await bumpVersion(cache, versionKey('all'))
  }
}
