// Reproduce el bug de apikeys/webhooks: la clave del listado incluía filtros+página y las
// mutaciones borraban una clave fija que nunca coincidía → la lista quedaba vieja hasta el TTL.
import { describe, it, expect } from 'bun:test'
import type { CacheAdapter } from 'arckode-framework'
import { versionedListCache } from '../versioned-list-cache'

function memoryCache(): CacheAdapter & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    store,
    get: async <T,>(k: string) => (store.has(k) ? (store.get(k) as T) : null),
    set: async (k: string, v: unknown) => { store.set(k, v) },
    delete: async (k: string) => { store.delete(k) },
    flush: async () => { store.clear() },
  }
}

describe('versionedListCache', () => {
  it('la misma query bajo la misma versión da la misma clave; distinta página, otra clave', async () => {
    const c = versionedListCache(memoryCache(), 'x')
    const a = await c.key('h1', { filters: { hotelId: 'h1' }, page: 1, limit: 20 })
    const b = await c.key('h1', { filters: { hotelId: 'h1' }, page: 1, limit: 20 })
    const p2 = await c.key('h1', { filters: { hotelId: 'h1' }, page: 2, limit: 20 })
    expect(a).toBe(b)
    expect(p2).not.toBe(a)
  })

  it('invalidate(hotel) cambia la clave del hotel Y la global del super_admin', async () => {
    const c = versionedListCache(memoryCache(), 'x')
    const hotelBefore = await c.key('h1', { filters: { hotelId: 'h1' }, page: 1, limit: 20 })
    const allBefore = await c.key(undefined, { filters: {}, page: 1, limit: 20 })
    await new Promise((r) => setTimeout(r, 2)) // Date.now() distinto
    await c.invalidate('h1')
    expect(await c.key('h1', { filters: { hotelId: 'h1' }, page: 1, limit: 20 })).not.toBe(hotelBefore)
    expect(await c.key(undefined, { filters: {}, page: 1, limit: 20 })).not.toBe(allBefore)
  })

  it('invalidate(undefined) (mutación global) cambia la clave global', async () => {
    const c = versionedListCache(memoryCache(), 'x')
    const before = await c.key(undefined, { filters: {}, page: 1, limit: 20 })
    await new Promise((r) => setTimeout(r, 2))
    await c.invalidate(undefined)
    expect(await c.key(undefined, { filters: {}, page: 1, limit: 20 })).not.toBe(before)
  })
})
