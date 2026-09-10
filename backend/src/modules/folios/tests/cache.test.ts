// cache.test.ts — #174: dos invalidaciones en el mismo milisegundo (cerrar el folio y facturarlo)
// tienen que producir dos claves de listado distintas. Con `Date.now()` a secas la segunda repetía
// el token y el listado seguía sirviendo la copia vieja hasta vencer el TTL.
import { describe, it, expect, afterEach } from 'bun:test'
import type { CacheAdapter } from 'arckode-framework'
import { foliosListCacheKey, invalidateFoliosCaches } from '../usecases/cache'

function makeCache(): CacheAdapter & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    store,
    get: (async (key: string) => store.get(key) ?? null) as CacheAdapter['get'],
    set: async (key: string, value: unknown) => { store.set(key, value) },
    delete: async (key: string) => { store.delete(key) },
    flush: async () => { store.clear() },
  }
}

const realNow = Date.now
afterEach(() => { Date.now = realNow })

const query = { status: 'open' }

describe('folios cache — invalidación monotónica (#174)', () => {
  it('dos invalidaciones seguidas en el MISMO milisegundo → tres claves de listado distintas (hotel y all)', async () => {
    const cache = makeCache()
    Date.now = () => 1_800_000_000_000

    const k0 = await foliosListCacheKey(cache, 'h1', query)
    const a0 = await foliosListCacheKey(cache, null, query)
    cache.store.set(k0, { data: ['vieja'] })

    await invalidateFoliosCaches(cache, 'h1')
    const k1 = await foliosListCacheKey(cache, 'h1', query)
    const a1 = await foliosListCacheKey(cache, null, query)

    await invalidateFoliosCaches(cache, 'h1')
    const k2 = await foliosListCacheKey(cache, 'h1', query)
    const a2 = await foliosListCacheKey(cache, null, query)

    expect(new Set([k0, k1, k2]).size).toBe(3)
    expect(new Set([a0, a1, a2]).size).toBe(3)
    expect(cache.store.get(k2)).toBeUndefined()
  })

  it('el token nunca retrocede aunque el reloj vaya para atrás', async () => {
    const cache = makeCache()
    Date.now = () => 2_000_000_000_000
    const k0 = await foliosListCacheKey(cache, 'h1', query)
    Date.now = () => 1_000_000_000_000
    await invalidateFoliosCaches(cache, 'h1')
    expect(await foliosListCacheKey(cache, 'h1', query)).not.toBe(k0)
    expect(cache.store.get('folios:ver:h1') as number).toBeGreaterThan(2_000_000_000_000)
  })
})
