// cache.test.ts — invalidación del listado de avisos (#160).
//
// Lo que se prueba NO es qué clave se borra (eso era el bug: se borraba una que no existía), sino
// lo único que le importa a quien mira la pantalla: después de publicar, editar o borrar un
// aviso, el listado que le llega YA NO es el viejo.
//
// El caché es real (un Map) y el repo cuenta llamadas: un hit se ve como "el repo no se consultó".
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { CacheAdapter, RepositoryAdapter } from 'arckode-framework'
import { AnunciosService } from '../service'
import type { AnunciosDTO } from '../types'

function makeCache(): CacheAdapter {
  const store = new Map<string, unknown>()
  return {
    get: (async (key: string) => store.get(key) ?? null) as CacheAdapter['get'],
    set: async (key: string, value: unknown) => { store.set(key, value) },
    delete: async (key: string) => { store.delete(key) },
    flush: async () => { store.clear() },
  }
}

/** Repo con filas mutables y contador de `paginate`: cada consulta real se nota. */
function makeRepo(rows: AnunciosDTO[] = []) {
  const state = { rows: [...rows], paginates: 0 }
  const repo = {
    paginate: async (filters: Record<string, unknown> = {}, opts: any = {}) => {
      state.paginates++
      const data = state.rows.filter((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v))
      const offset = opts.offset ?? 0
      const limit = opts.limit ?? 20
      return { data: data.slice(offset, offset + limit), total: data.length, limit, offset, pages: 1 }
    },
    findById: async (id: string) => state.rows.find((r) => r.id === id) ?? null,
    findMany: async () => [],
    findOne: async () => null,
    create: async (d: any) => { const row = { id: `a${state.rows.length + 1}`, ...d }; state.rows.push(row); return row },
    update: async (id: string, patch: any) => {
      const row = state.rows.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row ?? null
    },
    delete: async (id: string) => { state.rows = state.rows.filter((r) => r.id !== id); return true },
    count: async () => state.rows.length,
  } as unknown as RepositoryAdapter<AnunciosDTO>
  return { repo, state }
}

const userRepo = { findById: async () => ({ id: 'u1', hotelId: 'h1', role: 'hotel_admin' }) } as unknown as RepositoryAdapter<any>
const readsRepo = {
  findMany: async () => [], count: async () => 0, findById: async () => null, findOne: async () => null,
  create: async (d: any) => d, update: async () => null, delete: async () => true,
} as unknown as RepositoryAdapter<any>
const auth = { authenticate: () => async () => {}, assertOwnership: () => {} } as any

const HOTEL_ADMIN = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const SUPER_ADMIN = { id: 'sa', role: 'super_admin' }

const anuncio = (over: Partial<AnunciosDTO> = {}): AnunciosDTO => ({
  id: 'a1', hotelId: 'h1', title: 'Corte de agua', active: true,
  date: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
} as AnunciosDTO)

function makeService(rows: AnunciosDTO[] = []) {
  const cache = makeCache()
  const { repo, state } = makeRepo(rows)
  return { svc: new AnunciosService(repo, silentLogger(), cache, userRepo, readsRepo, auth), state, cache }
}

describe('listado de avisos — caché', () => {
  it('la segunda consulta idéntica sale del caché (no vuelve a pegarle a la base)', async () => {
    const { svc, state } = makeService([anuncio()])
    await svc.list({}, HOTEL_ADMIN)
    await svc.list({}, HOTEL_ADMIN)
    expect(state.paginates).toBe(1)
  })

  it('cada página y cada filtro tienen su propia entrada (no se pisan entre sí)', async () => {
    const { svc, state } = makeService([anuncio()])
    await svc.list({ page: 1, limit: 20 }, HOTEL_ADMIN)
    await svc.list({ page: 2, limit: 20 }, HOTEL_ADMIN)
    await svc.list({ page: 1, limit: 50 }, HOTEL_ADMIN)
    await svc.list({ page: 1, limit: 20, type: 'urgent' } as any, HOTEL_ADMIN)
    expect(state.paginates).toBe(4)
  })
})

describe('#160 — publicar, editar o borrar tira el caché del listado', () => {
  it('un aviso NUEVO aparece en el acto, no cinco minutos después', async () => {
    const { svc, state } = makeService([anuncio()])
    const antes = await svc.list({}, HOTEL_ADMIN)
    expect(antes.total).toBe(1)

    await svc.create({ title: 'Mantenimiento el sábado', hotelId: 'h1' } as any, HOTEL_ADMIN)

    const despues = await svc.list({}, HOTEL_ADMIN)
    expect(despues.total).toBe(2) // antes de #160 seguía en 1 hasta que expiraba el TTL
    expect(state.paginates).toBe(2)
  })

  it('un aviso BORRADO desaparece en el acto', async () => {
    const { svc } = makeService([anuncio(), anuncio()])
    await svc.list({}, HOTEL_ADMIN)
    await svc.delete('a1', HOTEL_ADMIN)
    const despues = await svc.list({}, HOTEL_ADMIN)
    expect(despues.data.some((a) => a.id === 'a1')).toBe(false)
  })

  it('un aviso EDITADO se ve con el texto nuevo', async () => {
    const { svc } = makeService([anuncio()])
    await svc.list({}, HOTEL_ADMIN)
    await svc.update('a1', { title: 'Corte de agua CANCELADO' } as any, HOTEL_ADMIN)
    const despues = await svc.list({}, HOTEL_ADMIN)
    expect(despues.data[0]!.title).toBe('Corte de agua CANCELADO')
  })

  it('la vista del super_admin también se refresca cuando cambia un aviso de un hotel', async () => {
    const { svc, state } = makeService([anuncio()])
    await svc.list({}, SUPER_ADMIN)
    await svc.create({ title: 'Otro', hotelId: 'h1' } as any, SUPER_ADMIN)
    const despues = await svc.list({}, SUPER_ADMIN)
    expect(despues.total).toBe(2)
    expect(state.paginates).toBe(2)
  })

  it('un aviso SIN hotel (de plataforma) invalida la lista de TODOS los hoteles', async () => {
    const { svc, state } = makeService([anuncio()])
    await svc.list({}, HOTEL_ADMIN) // hotel h1 cachea su lista
    expect(state.paginates).toBe(1)

    // El super_admin publica un aviso de plataforma (sin hotelId).
    await svc.create({ title: 'Mantenimiento de la plataforma' } as any, SUPER_ADMIN)

    await svc.list({}, HOTEL_ADMIN)
    // Sin el token global, h1 seguiría sirviendo su copia vieja: no hay forma de borrar
    // clave por clave la lista de cada hotel.
    expect(state.paginates).toBe(2)
  })

  it('mover un aviso de hotel invalida el origen Y el destino', async () => {
    const { svc, state } = makeService([anuncio()])
    await svc.list({}, HOTEL_ADMIN)
    const conteoTrasH1 = state.paginates

    await svc.update('a1', { hotelId: 'h2' } as any, SUPER_ADMIN)

    await svc.list({}, HOTEL_ADMIN)
    expect(state.paginates).toBe(conteoTrasH1 + 1)
    // Y la lista de h2, que ahora tiene un aviso que antes no estaba, tampoco quedó vieja.
    await svc.list({ hotelId: 'h2' } as any, SUPER_ADMIN)
    await svc.list({ hotelId: 'h2' } as any, SUPER_ADMIN)
    expect(state.paginates).toBe(conteoTrasH1 + 2)
  })
})
