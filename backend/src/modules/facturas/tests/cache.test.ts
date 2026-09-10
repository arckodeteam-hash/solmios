// cache.test.ts — #174: dos invalidaciones en el mismo milisegundo tienen que producir dos claves
// de listado distintas. Con `Date.now()` a secas la segunda repetía el token y el listado seguía
// sirviendo la copia vieja hasta vencer el TTL. El reloj se congela para forzar la ventana.
import { describe, it, expect, afterEach } from 'bun:test'
import type { CacheAdapter } from 'arckode-framework'
import { facturasListCacheKey, invalidateFacturasCaches } from '../usecases/cache'

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

const query = { filters: { status: 'paid' }, page: 1, limit: 20 }

describe('facturas cache — invalidación monotónica (#174)', () => {
  it('dos invalidaciones seguidas en el MISMO milisegundo → tres claves de listado distintas (hotel y all)', async () => {
    const cache = makeCache()
    const frozen = 1_800_000_000_000
    Date.now = () => frozen

    const k0 = await facturasListCacheKey(cache, 'h1', query)
    const a0 = await facturasListCacheKey(cache, null, query)
    cache.store.set(k0, { data: ['vieja'] })

    await invalidateFacturasCaches(cache, 'h1')
    const k1 = await facturasListCacheKey(cache, 'h1', query)
    const a1 = await facturasListCacheKey(cache, null, query)

    await invalidateFacturasCaches(cache, 'h1')
    const k2 = await facturasListCacheKey(cache, 'h1', query)
    const a2 = await facturasListCacheKey(cache, null, query)

    // El listado se vuelve a consultar las dos veces: ninguna clave repite la anterior.
    expect(new Set([k0, k1, k2]).size).toBe(3)
    expect(new Set([a0, a1, a2]).size).toBe(3)
    // La entrada vieja quedó huérfana: bajo la clave nueva no hay nada.
    expect(cache.store.get(k2)).toBeUndefined()
  })

  it('el token nunca retrocede aunque el reloj vaya para atrás', async () => {
    const cache = makeCache()
    Date.now = () => 2_000_000_000_000
    const k0 = await facturasListCacheKey(cache, 'h1', query)
    Date.now = () => 1_000_000_000_000 // reloj corregido hacia atrás (NTP)
    await invalidateFacturasCaches(cache, 'h1')
    const k1 = await facturasListCacheKey(cache, 'h1', query)
    expect(k1).not.toBe(k0)
    const v = cache.store.get('facturas:ver:h1') as number
    expect(v).toBeGreaterThan(2_000_000_000_000)
  })
})
