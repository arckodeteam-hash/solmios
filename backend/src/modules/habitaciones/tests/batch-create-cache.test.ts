// batch-create-cache.test.ts — El alta EN LOTE tiene que invalidar el listado igual que el alta
// de a una. Reproduce el bug encontrado en producción (2026-09-01): un hotel nuevo cargaba sus
// primeras 4 habitaciones por lote, el POST devolvía 201 y el panel seguía diciendo "Todavía no
// hay habitaciones" — el listado se servía de la caché vieja durante los 5 min del TTL.
import { describe, it, expect } from 'bun:test'
import type { CacheAdapter, RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { batchCreateRooms } from '../usecases/batch-create'
import { listCacheKey } from '../usecases/cache'
import type { HabitacionesDTO } from '../types'

const log = silentLogger()

/** Caché en memoria: hace falta una de verdad para ver si la clave del listado cambia. */
function memoryCache(): CacheAdapter & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    store,
    get: async <T>(k: string) => (store.has(k) ? (store.get(k) as T) : null),
    set: async (k: string, v: unknown) => { store.set(k, v) },
    delete: async (k: string) => { store.delete(k) },
    flush: async () => { store.clear() },
  } as CacheAdapter & { store: Map<string, unknown> }
}

const repo = (): RepositoryAdapter<HabitacionesDTO> => ({
  findMany: async () => [],
  findById: async () => null,
  findOne: async () => null,
  create: async (data: any) => ({ id: `room-${data.number}`, ...data }),
  update: async (id, data) => ({ id, ...data } as HabitacionesDTO),
  delete: async () => true,
  count: async () => 0,
  paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
})

const user = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const parts = { page: 1, limit: 100 }

describe('batchCreateRooms — invalidación del listado', () => {
  it('la clave del listado cambia después del lote (si no, el panel sigue vacío)', async () => {
    const cache = memoryCache()
    const before = await listCacheKey(cache, 'h1', parts)

    const created = await batchCreateRooms(
      { repo: repo(), logger: log, cache },
      { hotelId: 'h1', type: 'double', basePrice: 120, from: 101, to: 104 },
      user,
    )

    expect(created).toHaveLength(4)
    const after = await listCacheKey(cache, 'h1', parts)
    expect(after).not.toBe(before)
  })

  it('también invalida el listado global que ve el super admin', async () => {
    const cache = memoryCache()
    const before = await listCacheKey(cache, null, parts)
    await batchCreateRooms(
      { repo: repo(), logger: log, cache },
      { hotelId: 'h1', type: 'twin', basePrice: 110, from: 201, to: 202 },
      user,
    )
    expect(await listCacheKey(cache, null, parts)).not.toBe(before)
  })
})
