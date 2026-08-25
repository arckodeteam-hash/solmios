// facturas/tests/search.test.ts — Comportamiento de `?search=` (DT-07, issue #15).
// El match de texto corre en memoria (el adapter no tiene LIKE), pero el filtrado es sobre
// filas CRUDAS y el enrich solo sobre la página: estos tests clavan el contrato funcional
// (matchea invoiceNumber | notes | nombre del huésped, paginación y totales correctos).
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { FacturasService } from '../service'
import type { FacturasDTO, CurrentUser } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const mockAuth = { assertOwnership: () => {} } as unknown as Auth
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

const emptyRepo = (): RepositoryAdapter<any> => ({
  findMany: async () => [], findById: async () => null, findOne: async () => null,
  create: async (d: any) => ({ id: 'x', ...d }), update: async (id: string, d: any) => ({ id, ...d }),
  delete: async () => true, count: async () => 0,
  paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0, hasNext: false, hasPrev: false }),
})

// 6 facturas del hotel: 3 matchean "caro" (2 por notes, 1 por nombre del huésped),
// 1 matchea por invoiceNumber, 2 no matchean nada.
const invoices = [
  { id: 'i1', hotelId: 'h1', invoiceNumber: 'F-0001', guestId: 'g1', notes: 'estadía caro', amount: 100 },
  { id: 'i2', hotelId: 'h1', invoiceNumber: 'F-0002', guestId: 'g2', notes: 'otra cosa', amount: 100 },
  { id: 'i3', hotelId: 'h1', invoiceNumber: 'CARO-3', guestId: 'g3', notes: 'x', amount: 100 },
  { id: 'i4', hotelId: 'h1', invoiceNumber: 'F-0004', guestId: 'g4', notes: 'evento caro', amount: 100 },
  { id: 'i5', hotelId: 'h1', invoiceNumber: 'F-0005', guestId: 'gCaro', notes: 'sin notas', amount: 100 },
  { id: 'i6', hotelId: 'h1', invoiceNumber: 'F-0006', guestId: 'g2', notes: 'zzz', amount: 100 },
] as FacturasDTO[]

const guests = [
  { id: 'g1', hotelId: 'h1', name: 'Ana Pérez' },
  { id: 'g2', hotelId: 'h1', name: 'Luis Rey' },
  { id: 'g3', hotelId: 'h1', name: 'Marta Díaz' },
  { id: 'g4', hotelId: 'h1', name: 'Pedro López' },
  { id: 'gCaro', hotelId: 'h1', name: 'Carlos Caro' },
]

const buildRepo = () => ({ ...emptyRepo(), findMany: async () => invoices }) as RepositoryAdapter<FacturasDTO>
const buildEnrichDeps = () => ({
  guest: { ...emptyRepo(), findMany: async () => guests },
  reservation: { ...emptyRepo(), findMany: async () => [] },
  room: { ...emptyRepo(), findMany: async () => [] },
})
const buildService = (repo = buildRepo(), enrichDeps = buildEnrichDeps(), cache: CacheAdapter = silentCache) =>
  new FacturasService(repo, emptyRepo(), enrichDeps, emptyRepo(), log, cache, mockAuth, emptyRepo())

describe('FacturasService.list — ?search= (DT-07)', () => {
  it('matchea por invoiceNumber, notes y nombre del huésped; total refleja solo los matches', async () => {
    const result = await buildService().list({ search: 'caro' }, user)
    // i1 (notes), i3 (invoiceNumber CARO-3), i4 (notes), i5 (guest "Carlos Caro") => 4.
    expect(result.total).toBe(4)
    expect(result.data.map((d: any) => d.id).sort()).toEqual(['i1', 'i3', 'i4', 'i5'])
  })

  it('sin matches devuelve lista vacía y total 0 (no página completa)', async () => {
    const result = await buildService().list({ search: 'inexistente' }, user)
    expect(result.total).toBe(0)
    expect(result.data).toHaveLength(0)
  })

  it('search sensible a minúsculas/mayúsculas en ambos lados', async () => {
    const result = await buildService().list({ search: 'CARO' }, user)
    expect(result.total).toBe(4)
  })

  it('pagina los matches: página 2 de 2 con limit=3', async () => {
    const svc = buildService()
    const p1 = await svc.list({ search: 'caro', page: 1, limit: 3 }, user)
    const p2 = await svc.list({ search: 'caro', page: 2, limit: 3 }, user)
    expect(p1.total).toBe(4)
    expect(p1.data).toHaveLength(3)
    expect(p1.hasNext).toBe(true)
    expect(p2.data).toHaveLength(1)
    expect(p2.hasPrev).toBe(true)
    expect(p2.hasNext).toBe(false)
    // Sin solapamiento entre páginas.
    const ids1 = p1.data.map((d: any) => d.id)
    const ids2 = p2.data.map((d: any) => d.id)
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0)
  })

  it('el enrich corre solo sobre la página: las filas devueltas llegan enriquecidas (guest resuelto)', async () => {
    const result = await buildService().list({ search: 'caro', limit: 2 }, user)
    expect(result.data).toHaveLength(2)
    for (const d of result.data as any[]) {
      expect(typeof d.subtotal).toBe('number')
      expect(typeof d.balance).toBe('number')
    }
    // REG-2: con limit=2 la página es [i1, i3] — la aserción vieja miraba i5, que NUNCA
    // está en la página, así que el `if` la volvía muerta. Se aserta sobre filas reales.
    const byId = (id: string) => (result.data as any[]).find((d) => d.id === id)
    expect(byId('i1')?.guest).toBe('Ana Pérez')

    // La fila i5 matchea por NOMBRE del huésped (columna de otra tabla): sin limit cae en
    // la página y el enrich resuelve el nombre sobre la página final.
    const full = await buildService().list({ search: 'caro' }, user)
    const i5 = (full.data as any[]).find((d) => d.id === 'i5')
    expect(i5?.guest).toBe('Carlos Caro')
  })

  it('sin search NO trae todo el conjunto: usa paginate del repo', async () => {
    let findManyCalls = 0
    const repo = { ...buildRepo(), findMany: async () => { findManyCalls++; return invoices } }
    const result = await buildService(repo).list({}, user)
    expect(findManyCalls).toBe(0)
    expect(result.total).toBe(0)
  })

  // COR-8: la búsqueda degradada (falla la carga de huéspedes → matches por nombre = 0)
  // no puede quedar cacheada 300s con 200 OK: el panel mostraría el total equivocado
  // aunque la query ya haya sanado. Sólo el resultado sano entra a la caché.
  const recordingCache = () => {
    const sets: Array<{ key: string; value: unknown; ttl?: number }> = []
    const cache: CacheAdapter = {
      get: async () => null,
      set: async (key, value, ttl) => { sets.push({ key, value, ttl }) },
      delete: async () => {},
      flush: async () => {},
    }
    // Sólo las entradas de LISTADO importan: la primera set es el seed del token de
    // versión (`facturas:ver:*`, TTL 3600) que hace facturasListCacheKey.
    const listSets = () => sets.filter((s) => s.key.startsWith('facturas:list:'))
    return { cache, sets, listSets }
  }

  it('search sano SÍ se cachea (control: TTL 300)', async () => {
    const { cache, listSets } = recordingCache()
    const result = await buildService(buildRepo(), buildEnrichDeps(), cache).list({ search: 'caro' }, user)
    expect(result.total).toBe(4)
    expect(listSets()).toHaveLength(1)
    expect(listSets()[0]!.ttl).toBe(300)
    expect((listSets()[0]!.value as any).total).toBe(4)
  })

  it('search DEGRADADO (falla la carga de huéspedes) NO se cachea', async () => {
    const { cache, listSets } = recordingCache()
    const brokenGuests = {
      ...buildEnrichDeps(),
      guest: { ...emptyRepo(), findMany: async () => { throw new Error('guests down') } },
    }
    // Degradado: i5 ("Carlos Caro") desaparece de los matches, total 3 en vez de 4.
    const result = await buildService(buildRepo(), brokenGuests, cache).list({ search: 'caro' }, user)
    expect(result.total).toBe(3)
    expect(listSets()).toHaveLength(0) // el total degradado no entra a la caché
  })

  it('la request degradada reintenta: al sanar la query el resultado correcto vuelve', async () => {
    const { cache, listSets } = recordingCache()
    let guestsDown = true
    const flakyGuests = {
      ...buildEnrichDeps(),
      guest: {
        ...emptyRepo(),
        findMany: async () => {
          if (guestsDown) throw new Error('guests down')
          return guests
        },
      },
    }
    const svc = buildService(buildRepo(), flakyGuests, cache)
    const degraded = await svc.list({ search: 'caro' }, user)
    expect(degraded.total).toBe(3)
    expect(listSets()).toHaveLength(0)

    guestsDown = false
    const healed = await svc.list({ search: 'caro' }, user) // sin caché de por medio
    expect(healed.total).toBe(4)
    expect(listSets()).toHaveLength(1) // el resultado sano recién ahora se cachea
  })
})
