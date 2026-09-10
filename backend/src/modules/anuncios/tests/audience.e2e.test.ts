// anuncios/tests/audience.e2e.test.ts — E2E de la AUDIENCIA del listado (ANN-1) contra una SQLite REAL.
//
// Existe porque `service.test.ts` no podía ver el bug: su repo mock ignora los filtros
// (`findMany`/`paginate` devuelven la "tabla" entera pase lo que pase), así que un
// `filters.hotelId = hotelId` que en la base real se traduce a `hotelId = ?` y deja afuera a
// todos los globales (hotelId NULL o '') pasaba verde igual. Acá la tabla la crea
// orm.migrate() sobre el registro real del módulo, las filas van por OrmRepository y el
// service se arma con sus deps reales (salvo cache, que es no-op: cada aserción tiene que
// pegarle a la base, no a la página que dejó el usuario anterior).
//
// ESTE test falla contra el `service.ts` de origin/main: hotel-1 recibía sólo `a1` (total 1)
// porque los dos globales no cumplen `hotelId = 'hotel-1'`. Con el usecase de audiencia
// (`usecases/announcement-audience.ts`) recibe exactamente los globales más los suyos.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { silentLogger } from 'arckode-framework/testing'
import { registerAnunciosModels } from '../model'
import { AnunciosService } from '../service'
import type { AnunciosDTO } from '../types'

const hotel1Admin = { id: 'u1', role: 'hotel_admin', hotelId: 'hotel-1' }
const hotel2Admin = { id: 'u2', role: 'hotel_admin', hotelId: 'hotel-2' }
const superAdmin = { id: 'sa', role: 'super_admin' }

const GLOBALES = ['g-empty', 'g-null']
const HOTEL_1 = [...GLOBALES, 'a1'].sort()
const HOTEL_2 = [...GLOBALES, 'a2'].sort()

let orm: any
let adapter: any
let dbPath: string
let repo: OrmRepository<AnunciosDTO>
let service: AnunciosService

// Cache no-op a propósito: la clave del listado incluye el hotel de AUDIENCIA, así que dos
// usuarios de hoteles distintos no compartirían página; pero el mismo usuario con la misma
// query sí, y acá cada `it` tiene que leer la base y no lo que quedó de la aserción anterior.
const noopCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const ids = (page: { data: Array<{ id: string }> }) => page.data.map((a) => a.id).sort()

beforeAll(async () => {
  dbPath = `/tmp/solmios-anuncios-audience-e2e-${crypto.randomUUID()}.db`
  adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  // El registro es el del módulo: el mismo camino que recorre composition-root al bootear.
  registerAnunciosModels(orm)
  await orm.migrate()
  repo = new OrmRepository<AnunciosDTO>(orm, 'Announcements')
  const readsRepo = new OrmRepository<any>(orm, 'AnnouncementReads')
  // Los usuarios traen hotelId en el token: `resolveHotelId` no llega a consultar userRepo.
  const userRepo = { findById: async () => null } as unknown as RepositoryAdapter<any>
  service = new AnunciosService(repo, silentLogger(), noopCache, userRepo, readsRepo, fakeAuth)

  // Las cuatro filas del caso: dos globales (NULL y '' — las dos formas conviven en la base),
  // una de cada hotel. Todas activas.
  await repo.create({ id: 'g-null', title: 'Global NULL', message: 'para todos', active: 1 } as any)
  await repo.create({ id: 'g-empty', hotelId: '', title: 'Global vacío', message: 'para todos', active: 1 } as any)
  await repo.create({ id: 'a1', hotelId: 'hotel-1', title: 'Solo hotel 1', message: 'h1', active: 1 } as any)
  await repo.create({ id: 'a2', hotelId: 'hotel-2', title: 'Solo hotel 2', message: 'h2', active: 1 } as any)
}, 60_000) // migrate() sobre SQLite tarda varios segundos en CI/sandbox

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('anuncios — audiencia del listado sobre SQLite real (ANN-1)', () => {
  it('la base guarda hotelId NULL para g-null y vacío para g-empty (el fixture es el que dice ser)', async () => {
    const rows = (await adapter.query(
      'SELECT id, hotelId FROM announcements WHERE id IN (?, ?) ORDER BY id', ['g-empty', 'g-null'],
    )) as Array<{ id: string; hotelId: string | null }>
    expect(rows).toEqual([
      { id: 'g-empty', hotelId: '' },
      { id: 'g-null', hotelId: null },
    ])
  })

  it('hotel-1 recibe exactamente los globales y los suyos, nunca los de hotel-2', async () => {
    const page = await service.list({}, hotel1Admin)
    expect(ids(page)).toEqual(HOTEL_1)
    expect(page.total).toBe(3)
    expect(page.data.map((a) => a.title).sort()).toEqual(['Global NULL', 'Global vacío', 'Solo hotel 1'])
    expect(page.data.some((a) => a.hotelId === 'hotel-2')).toBe(false)
  })

  it('hotel-2 nunca ve los de hotel-1', async () => {
    const page = await service.list({}, hotel2Admin)
    expect(ids(page)).toEqual(HOTEL_2)
    expect(page.total).toBe(3)
    expect(page.data.some((a) => a.hotelId === 'hotel-1')).toBe(false)
  })

  it('hotelId NULL y hotelId vacío cuentan como globales', async () => {
    const page = await service.list({}, hotel1Admin)
    const nulo = page.data.find((a) => a.id === 'g-null')
    const vacio = page.data.find((a) => a.id === 'g-empty')
    expect(nulo).toBeTruthy()
    expect(nulo!.hotelId ?? null).toBeNull()
    expect(vacio).toBeTruthy()
    expect(vacio!.hotelId).toBe('')
  })

  it('super_admin sin hotelId ve todo', async () => {
    const page = await service.list({}, superAdmin)
    expect(ids(page)).toEqual(['a1', 'a2', 'g-empty', 'g-null'])
    expect(page.total).toBe(4)
  })

  it('super_admin con ?hotelId=hotel-1 ve hotel-1 más los globales', async () => {
    const page = await service.list({ hotelId: 'hotel-1' }, superAdmin)
    expect(ids(page)).toEqual(HOTEL_1)
    expect(page.total).toBe(3)
    expect(page.data.some((a) => a.hotelId === 'hotel-2')).toBe(false)
  })

  it('la paginación respeta la audiencia', async () => {
    const p1 = await service.list({ limit: 2, page: 1 }, hotel1Admin)
    expect(p1.data).toHaveLength(2)
    expect(p1.total).toBe(3)
    expect(p1.pages).toBe(2)

    const p2 = await service.list({ limit: 2, page: 2 }, hotel1Admin)
    expect(p2.data).toHaveLength(1)
    expect(p2.total).toBe(3)

    // Las dos páginas juntas son exactamente la audiencia de hotel-1, sin repetidos ni ajenos.
    const todos = [...p1.data, ...p2.data]
    expect(todos.map((a) => a.id).sort()).toEqual(HOTEL_1)
    expect(todos.some((a) => a.hotelId === 'hotel-2')).toBe(false)
  })
})
