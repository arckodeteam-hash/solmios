// anuncios/usecases/cache.ts — claves e invalidación del listado de avisos (#160).
//
// El bug: `create`/`update`/`delete` borraban `anuncios:list:{hotelId}`, una clave que NO EXISTE.
// La real incluye página, límite y filtros (`anuncios:list:h1:p1:l20:{...}`), y `CacheAdapter`
// sólo borra claves EXACTAS — no hay borrado por prefijo ni glob. Resultado: publicabas un aviso
// y el panel seguía mostrando la lista vieja hasta 5 minutos. Lo mismo al borrarlo: seguía ahí.
// Un aviso urgente que tarda cinco minutos en aparecer no es un aviso urgente.
//
// La salida es la misma que ya usan `facturas` y `folios`: la clave lleva un TOKEN DE VERSIÓN, e
// invalidar es cambiar el token. Las entradas viejas quedan huérfanas y mueren por TTL.
//
// Acá hacen falta DOS tokens, porque un aviso no siempre es de un hotel:
//
//   - `anuncios:ver:{hotel}` — lo bumpea una mutación de ESE hotel.
//   - `anuncios:ver:global`  — lo bumpea una mutación SIN hotel (aviso de plataforma, que lo ve
//     todo el mundo). Con un solo token por hotel no habría forma de alcanzar a los demás: no se
//     pueden enumerar las claves para borrarlas una por una.
//
// El costo es que un aviso de plataforma tira el caché de todos los hoteles. Es lo correcto:
// escribir un aviso es raro, leer la lista es constante, y el error caro es el otro (mostrar
// durante cinco minutos algo que ya no existe).
import type { CacheAdapter } from 'arckode-framework'

/** El token tiene que sobrevivir a cualquier entrada de listado que dependa de él (TTL 300). */
const VERSION_TTL_SECONDS = 3600

/** El super_admin lista sin hotel: sus entradas viven bajo 'all'. */
type HotelKey = string | null | undefined

const GLOBAL_VERSION_KEY = 'anuncios:ver:global'
const hotelVersionKey = (hotelId?: HotelKey) => `anuncios:ver:${hotelId || 'all'}`

/** Token vigente. Si no hay, se siembra con el reloj: dos procesos no necesitan coordinarse. */
async function currentVersion(cache: CacheAdapter, key: string): Promise<number> {
  const v = await cache.get<number>(key)
  if (v) return v
  const seed = Date.now()
  await cache.set(key, seed, VERSION_TTL_SECONDS)
  return seed
}

/**
 * Sube el token. `Math.max(ahora, anterior + 1)` y no `Date.now()` a secas: dos mutaciones en el
 * MISMO milisegundo (crear y borrar seguido, o un update que toca dos hoteles) escribirían el
 * mismo número y la segunda no invalidaría nada. Con el `+1` el token siempre avanza.
 */
async function bumpVersion(cache: CacheAdapter, key: string): Promise<void> {
  const prev = (await cache.get<number>(key)) ?? 0
  await cache.set(key, Math.max(Date.now(), prev + 1), VERSION_TTL_SECONDS)
}

/**
 * Clave del listado: las dos versiones + filtros + paginación. Dos consultas distintas, dos entradas.
 *
 * Con `scope: 'active'` (ANN-3) lo que se cachea NO es una página sino la lista CRUDA de la
 * consulta (la ventana de vigencia se aplica después, con el reloj del request), así que la
 * clave termina en `:active` y no lleva página ni límite: todas las páginas salen de la misma
 * entrada. La página de `scope: 'all'` (o sin scope) conserva la clave de siempre.
 */
export async function anunciosListCacheKey(
  cache: CacheAdapter,
  hotelId: HotelKey,
  query: { filters: Record<string, unknown>; page: number; limit: number; scope?: 'active' | 'all' },
): Promise<string> {
  const [global, hotel] = await Promise.all([
    currentVersion(cache, GLOBAL_VERSION_KEY),
    currentVersion(cache, hotelVersionKey(hotelId)),
  ])
  const { filters, page, limit, scope } = query
  // Filtros ordenados: `{type,priority}` y `{priority,type}` son la MISMA consulta y tienen que
  // compartir entrada (con `JSON.stringify` crudo dependía del orden de inserción).
  const f = Object.keys(filters).sort().map((k) => `${k}=${String(filters[k])}`).join(',')
  const tail = scope === 'active' ? 'active' : `p${page}:l${limit}`
  return `anuncios:list:${hotelId || 'all'}:g${global}:v${hotel}:${f}:${tail}`
}

/**
 * Invalida lo que dejó de ser cierto. `hotelId` vacío = aviso de plataforma: se bumpea el token
 * global y con eso caen TODAS las listas cacheadas, la de cada hotel incluida.
 */
export async function invalidateAnunciosCaches(cache: CacheAdapter, hotelId?: HotelKey): Promise<void> {
  if (!hotelId) {
    await bumpVersion(cache, GLOBAL_VERSION_KEY)
    return
  }
  await bumpVersion(cache, hotelVersionKey(hotelId))
  // La vista del super_admin (sin hotel) incluye las filas de este hotel: también quedó vieja.
  await bumpVersion(cache, hotelVersionKey('all'))
}
