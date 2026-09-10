// cache.test.ts — REQ-SOP-05: caché del listado versionada (unidad, sin pasar por el service).
import { describe, it, expect } from 'bun:test'
import { MemoryCache } from 'arckode-framework'
import { ticketsListCacheKey, invalidateTicketsCaches } from '../usecases/cache'

describe('ticketsListCacheKey', () => {
  it('filtros distintos → claves distintas', async () => {
    const cache = new MemoryCache()
    const k1 = await ticketsListCacheKey(cache, 'h1', { filters: { status: 'open' }, page: 1, limit: 20 })
    const k2 = await ticketsListCacheKey(cache, 'h1', { filters: { status: 'closed' }, page: 1, limit: 20 })
    expect(k1).not.toBe(k2)
  })

  it('páginas distintas → claves distintas', async () => {
    const cache = new MemoryCache()
    const k1 = await ticketsListCacheKey(cache, 'h1', { filters: {}, page: 1, limit: 20 })
    const k2 = await ticketsListCacheKey(cache, 'h1', { filters: {}, page: 2, limit: 20 })
    expect(k1).not.toBe(k2)
  })

  it('mismos filtros/página/hotel → misma clave (cache hit real)', async () => {
    const cache = new MemoryCache()
    const k1 = await ticketsListCacheKey(cache, 'h1', { filters: { status: 'open' }, page: 1, limit: 20 })
    const k2 = await ticketsListCacheKey(cache, 'h1', { filters: { status: 'open' }, page: 1, limit: 20 })
    expect(k1).toBe(k2)
  })

  it('hotelId undefined/null → misma clave "all" (bucket del super_admin)', async () => {
    const cache = new MemoryCache()
    const k1 = await ticketsListCacheKey(cache, undefined, { filters: {}, page: 1, limit: 20 })
    const k2 = await ticketsListCacheKey(cache, null, { filters: {}, page: 1, limit: 20 })
    expect(k1).toBe(k2)
    expect(k1).toContain(':all:')
  })

  it('h1 y h2 no comparten bucket de versión', async () => {
    const cache = new MemoryCache()
    const kBefore = await ticketsListCacheKey(cache, 'h1', { filters: {}, page: 1, limit: 20 })
    await invalidateTicketsCaches(cache, 'h2')
    const kAfter = await ticketsListCacheKey(cache, 'h1', { filters: {}, page: 1, limit: 20 })
    expect(kBefore).toBe(kAfter) // invalidar h2 NO cambia la clave de h1...
  })
})

describe('invalidateTicketsCaches', () => {
  it('invalidar un hotel cambia su propia clave', async () => {
    const cache = new MemoryCache()
    const before = await ticketsListCacheKey(cache, 'h1', { filters: {}, page: 1, limit: 20 })
    await invalidateTicketsCaches(cache, 'h1')
    const after = await ticketsListCacheKey(cache, 'h1', { filters: {}, page: 1, limit: 20 })
    expect(before).not.toBe(after)
  })

  it('invalidar un hotel TAMBIÉN cambia la clave "all" (super_admin ve el hotel nuevo)', async () => {
    const cache = new MemoryCache()
    const before = await ticketsListCacheKey(cache, undefined, { filters: {}, page: 1, limit: 20 })
    await invalidateTicketsCaches(cache, 'h1')
    const after = await ticketsListCacheKey(cache, undefined, { filters: {}, page: 1, limit: 20 })
    expect(before).not.toBe(after)
  })

  it('invalidar "all" (hotelId undefined) NO duplica el bump — no revienta ni entra en loop', async () => {
    const cache = new MemoryCache()
    await expect(invalidateTicketsCaches(cache, undefined)).resolves.toBeUndefined()
  })
})
