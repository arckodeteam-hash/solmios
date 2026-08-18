// crm/tests/segments.test.ts — Segmentos: reglas puras, count derivado y creación sin hotelId.
//
// Cubre tres regresiones que dejaban la pantalla /panel/crm inutilizable:
//
//  1. `getGuestsInSegment` armaba el filtro con `{ $gte: n }`. El ORM no tiene operadores: emite
//     `campo = ?` y pasa el objeto al bind → 500 `Binding expected string...`. Sólo `tier` andaba.
//  2. `listSegments` devolvía la columna `count`, escrita en 0 al crear y jamás actualizada: toda
//     tarjeta decía "0 huéspedes".
//  3. `createSegment`/`createCoupon` validaban el body ANTES de inyectarle el `hotelId` del token,
//     que el schema exige. El frontend no lo manda → 400 `hotelId is required` en ambos botones.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { CrmService } from '../service'
import { CrmController } from '../controller'
import { equalityFilters, matchesRules, parseRules } from '../usecases/segments'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

function makeRepo(overrides: Partial<RepositoryAdapter<any>> = {}): RepositoryAdapter<any> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (data) => ({ id: 'test-id', ...data }),
    update: async (id, data) => ({ id, ...data }),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

const GUESTS = [
  { id: 'g1', name: 'Ana', tier: 'gold', totalStays: 6, totalSpent: 9000, active: 1 },
  { id: 'g2', name: 'Beto', tier: 'bronze', totalStays: 1, totalSpent: 400, active: 1 },
  { id: 'g3', name: 'Cora', tier: 'gold', totalStays: 3, totalSpent: 12000, active: 1 },
]

describe('parseRules', () => {
  it('devuelve {} ante reglas vacías, nulas o JSON corrupto', () => {
    expect(parseRules(null)).toEqual({})
    expect(parseRules('')).toEqual({})
    expect(parseRules('{no es json')).toEqual({})
    expect(parseRules('[1,2]')).toEqual({})
  })

  it('parsea las reglas soportadas', () => {
    expect(parseRules('{"tier":"gold","minStays":5}')).toEqual({ tier: 'gold', minStays: 5 })
  })
})

describe('equalityFilters', () => {
  // El bug original: un objeto `{$gte}` viajaba al bind del driver. Ningún valor puede ser objeto.
  it('nunca emite un objeto como valor de filtro', () => {
    const filters = equalityFilters('h1', { tier: 'gold', minStays: 5, minSpent: 8000 })
    for (const value of Object.values(filters)) {
      expect(typeof value === 'object' && value !== null).toBe(false)
    }
  })

  it('sólo manda al WHERE lo que el ORM sabe traducir: igualdad', () => {
    expect(equalityFilters('h1', { tier: 'gold', minStays: 5 })).toEqual({ hotelId: 'h1', active: 1, tier: 'gold' })
    expect(equalityFilters('h1', { minSpent: 100 })).toEqual({ hotelId: 'h1', active: 1 })
  })
})

describe('matchesRules', () => {
  it('sin reglas, entran todos', () => {
    expect(GUESTS.filter((g) => matchesRules(g, {}))).toHaveLength(3)
  })

  it('exige TODAS las reglas a la vez', () => {
    const match = GUESTS.filter((g) => matchesRules(g, { tier: 'gold', minStays: 5 }))
    expect(match.map((g) => g.name)).toEqual(['Ana'])   // Cora es gold pero tiene 3 estadías
  })

  it('el umbral es inclusivo', () => {
    expect(matchesRules({ totalStays: 5 }, { minStays: 5 })).toBe(true)
    expect(matchesRules({ totalStays: 4 }, { minStays: 5 })).toBe(false)
  })

  it('filtra por gasto mínimo', () => {
    const match = GUESTS.filter((g) => matchesRules(g, { minSpent: 8000 }))
    expect(match.map((g) => g.name)).toEqual(['Ana', 'Cora'])
  })
})

describe('CrmService.listSegments', () => {
  it('calcula el count real en vez de devolver el 0 guardado', async () => {
    const segmentRepo = makeRepo({
      findMany: async () => [
        { id: 's1', hotelId: 'h1', name: 'Gold', rules: '{"tier":"gold"}', count: 0, active: 1 },
        { id: 's2', hotelId: 'h1', name: 'Recurrentes', rules: '{"minStays":3}', count: 0, active: 1 },
      ],
    })
    const guestRepo = makeRepo({ findMany: async () => GUESTS })
    const svc = new CrmService(makeRepo(), makeRepo(), segmentRepo, guestRepo, makeRepo(), log, silentCache)

    const segments = await svc.listSegments('h1')
    expect(segments.map((s) => s.count)).toEqual([2, 2])   // Ana+Cora / Ana+Cora
  })

  it('no consulta huéspedes si no hay segmentos', async () => {
    let consultado = false
    const guestRepo = makeRepo({ findMany: async () => { consultado = true; return GUESTS } })
    const svc = new CrmService(makeRepo(), makeRepo(), makeRepo(), guestRepo, makeRepo(), log, silentCache)

    expect(await svc.listSegments('h1')).toEqual([])
    expect(consultado).toBe(false)
  })
})

describe('CrmService.getGuestsInSegment', () => {
  it('filtra por umbrales sin mandarle operadores al ORM', async () => {
    let filtrosRecibidos: any = null
    const segmentRepo = makeRepo({ findById: async () => ({ id: 's1', hotelId: 'h1', rules: '{"minStays":3}' }) })
    const guestRepo = makeRepo({
      findMany: async (filters: any) => { filtrosRecibidos = filters; return GUESTS },
    })
    const svc = new CrmService(makeRepo(), makeRepo(), segmentRepo, guestRepo, makeRepo(), log, silentCache)

    const guests = await svc.getGuestsInSegment('h1', 's1')
    expect(guests.map((g: any) => g.name)).toEqual(['Ana', 'Cora'])
    expect(filtrosRecibidos).toEqual({ hotelId: 'h1', active: 1 })   // sin totalStays: {$gte}
  })

  it('trae los huéspedes del hotel DUEÑO del segmento, no los del que consulta', async () => {
    let filtrosRecibidos: any = null
    const segmentRepo = makeRepo({ findById: async () => ({ id: 's1', hotelId: 'hotel-ajeno', rules: null }) })
    const guestRepo = makeRepo({ findMany: async (f: any) => { filtrosRecibidos = f; return [] } })
    const svc = new CrmService(makeRepo(), makeRepo(), segmentRepo, guestRepo, makeRepo(), log, silentCache)

    await svc.getGuestsInSegment('hotel-propio', 's1')   // sin auth: llamada interna
    expect(filtrosRecibidos.hotelId).toBe('hotel-ajeno')
  })
})

describe('CrmController — el hotelId sale del token, no del body', () => {
  const req = (body: any, user: any) => ({ body, user, params: {}, query: {} }) as any
  const service = { createSegment: async (d: any) => d } as any
  const controller = new CrmController(service, log)

  it('crea un segmento con el body que manda la UI (sin hotelId)', async () => {
    const res = await controller.createSegment(req({ name: 'Recurrentes', rules: '{"minStays":1}' }, { hotelId: 'h1' }))
    expect(res.status).toBe(201)
    expect((res.body as any).hotelId).toBe('h1')
  })

  it('el token pisa el hotelId del body: no se crea en un hotel ajeno', async () => {
    const res = await controller.createSegment(req({ hotelId: 'hotel-ajeno', name: 'Ajeno', rules: '{}' }, { hotelId: 'h1' }))
    expect((res.body as any).hotelId).toBe('h1')
  })

  it('cupones del CRM: 410 explícito con puntero a promo-codes (spec crm-coupons)', async () => {
    const res = await controller.couponGone()
    expect(res.status).toBe(410)
    expect((res.body as any).error).toContain('/api/promo-codes')
  })
})
