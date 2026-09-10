// anuncios/usecases/cache.ts — Claves e invalidación del listado.
//
// El listado se cacheaba con `anuncios:list:<hotelId>:p<page>:l<limit>:<filtros>` y la escritura
// borraba `anuncios:list:<hotelId>` — una clave que NO existe. `CacheAdapter` solo borra claves
// exactas (no hay glob ni prefijo), así que publicar un anuncio no invalidaba nada y el hotel
// podía tardar hasta CACHE_TTL (300 s) en ver un aviso urgente.
//
// Se invalida por VERSIÓN, igual que en facturas y folios. La versión es UNA sola para todo el
// módulo, no una por hotel: un anuncio de plataforma cambia lo que ven TODOS los hoteles y no hay
// forma de enumerarlos para bumpear sus tokens uno por uno.

import type { CacheAdapter } from 'arckode-framework'

const VERSION_KEY = 'anuncios:ver'
/** El token debe sobrevivir a cualquier entrada de listado que dependa de él. */
const VERSION_TTL_SECONDS = 3600

/**
 * Contador de proceso. El token NO puede ser solo `Date.now()`: dos operaciones dentro del mismo
 * milisegundo producen el mismo valor, la clave no cambia y la invalidación no invalida nada —
 * que es justamente el defecto que este archivo viene a corregir. Con el sufijo, cada bump da un
 * token distinto sí o sí.
 */
let bump = 0
const nextToken = (): string => `${Date.now()}-${++bump}`

async function currentVersion(cache: CacheAdapter): Promise<string> {
  const v = await cache.get<string>(VERSION_KEY)
  if (v) return String(v)
  const seed = nextToken()
  await cache.set(VERSION_KEY, seed, VERSION_TTL_SECONDS)
  return seed
}

export interface AnunciosCacheScope {
  hotelId?: string | null
  role: string
  filters: Record<string, unknown>
  scope: string
  page: number
  limit: number
}

/**
 * La clave incluye el ROL además del hotel: dos usuarios del mismo hotel ven conjuntos distintos
 * si el anuncio es `audience: 'admins'`. Sin el rol, el primer recepcionista que lista deja
 * cacheada su vista recortada y se la sirve también al dueño.
 */
export async function anunciosListCacheKey(cache: CacheAdapter, s: AnunciosCacheScope): Promise<string> {
  const ver = await currentVersion(cache)
  const f = Object.keys(s.filters).sort().map((k) => `${k}=${String(s.filters[k])}`).join(',')
  return `anuncios:list:v${ver}:${s.hotelId || 'all'}:${s.role}:${s.scope}:${f}:p${s.page}:l${s.limit}`
}

/** Bump de versión → quedan huérfanas TODAS las entradas de listado y expiran por TTL. */
export async function invalidateAnunciosCaches(cache: CacheAdapter): Promise<void> {
  await cache.set(VERSION_KEY, nextToken(), VERSION_TTL_SECONDS)
}
